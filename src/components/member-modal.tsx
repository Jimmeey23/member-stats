import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addFollowUp, getMemberFollowUps, type MemberRow } from "@/lib/members.functions";
import { generateMemberInsight } from "@/lib/ai.functions";
import { analyzeMemberFeedback, type FeedbackAnalysis } from "@/lib/ai-feedback.functions";
import { sendMemberEmail, updateMemberOwner } from "@/lib/email.functions";
import { OWNERS, STATUSES } from "@/lib/constants";
import { X, Sparkles, MessageSquare, CalendarPlus, Loader2, Mail, Phone, MapPin, Activity, TrendingDown, Clock, Brain, AlertTriangle, Gauge, Send, GripVertical, User } from "lucide-react";
import { toast } from "sonner";


export function MemberModal({ member, onClose }: { member: MemberRow; onClose: () => void }) {
  const qc = useQueryClient();
  const fetchFollowUps = useServerFn(getMemberFollowUps);
  const addFu = useServerFn(addFollowUp);
  const aiFn = useServerFn(generateMemberInsight);
  const feedbackFn = useServerFn(analyzeMemberFeedback);
  const sendEmailFn = useServerFn(sendMemberEmail);
  const updateOwnerFn = useServerFn(updateMemberOwner);

  const fuQ = useQuery({
    queryKey: ["follow-ups", member.member_id],
    queryFn: () => fetchFollowUps({ data: { memberId: member.member_id } }),
  });

  const [note, setNote] = useState("");
  const [status, setStatus] = useState(member.outreach_status || "Attempted");
  const [assignee, setAssignee] = useState<string>(member.owner || "");
  const [followUpDate, setFollowUpDate] = useState<string>(member.next_follow_up?.slice(0, 10) || "");
  const [aiInsight, setAiInsight] = useState<{ diagnosis: string; nextAction: string; messageDraft: string } | null>(null);
  const [feedback, setFeedback] = useState<FeedbackAnalysis | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // Resizable width
  const [width, setWidth] = useState<number>(() => {
    const saved = typeof window !== "undefined" ? Number(localStorage.getItem("memberModalWidth")) : 0;
    return saved && saved > 360 ? saved : 760;
  });
  const dragging = useRef(false);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const next = Math.min(Math.max(window.innerWidth - e.clientX, 380), Math.min(1400, window.innerWidth - 40));
      setWidth(next);
    }
    function onUp() {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.userSelect = "";
        localStorage.setItem("memberModalWidth", String(width));
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const saveMut = useMutation({
    mutationFn: (vars: { actionType: string; note?: string; status?: string; followUpDate?: string | null }) =>
      addFu({ data: { memberId: member.member_id, ...vars } }),
    onSuccess: async () => {
      toast.success("Saved");
      // If assignee changed, persist it as owner too
      if (assignee && assignee !== member.owner) {
        try { await updateOwnerFn({ data: { memberId: member.member_id, owner: assignee } }); } catch {/* ignore */}
      }
      qc.invalidateQueries({ queryKey: ["follow-ups", member.member_id] });
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      setNote("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const aiMut = useMutation({
    mutationFn: () => aiFn({ data: { memberId: member.member_id } }),
    onSuccess: (r: any) => setAiInsight(r),
    onError: (e: any) => toast.error(e.message),
  });

  const feedbackMut = useMutation({
    mutationFn: () => feedbackFn({ data: { memberId: member.member_id } }),
    onSuccess: (r) => setFeedback(r),
    onError: (e: any) => toast.error(e.message),
  });

  const emailMut = useMutation({
    mutationFn: () => sendEmailFn({ data: { memberId: member.member_id, subject: emailSubject, body: emailBody } }),
    onSuccess: (result: any) => {
      toast.success(result?.testMode ? "Email logged (test mode — not sent)" : "Email sent");
      setEmailOpen(false); setEmailSubject(""); setEmailBody("");
      qc.invalidateQueries({ queryKey: ["follow-ups", member.member_id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Send failed"),
  });

  const ownerMut = useMutation({
    mutationFn: (owner: string) => updateOwnerFn({ data: { memberId: member.member_id, owner } }),
    onSuccess: () => {
      toast.success("Owner updated");
      qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const d = member.data || {};

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-foreground/30 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="relative ml-auto h-full overflow-y-auto bg-background shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.35)] scroll-fade animate-in slide-in-from-right duration-300 border-l border-border"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle for resizing */}
        <div
          onMouseDown={(e) => { e.preventDefault(); dragging.current = true; document.body.style.userSelect = "none"; }}
          className="absolute left-0 top-0 z-20 flex h-full w-2 cursor-col-resize items-center justify-center hover:bg-primary/10 group"
          title="Drag to resize"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary" />
        </div>

        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/8 via-primary/3 to-transparent" />
          <div className="relative flex items-start justify-between p-6">
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl grad-coral text-lg font-semibold text-primary-foreground ring-glow">
                {(member.first_name?.[0] ?? "") + (member.last_name?.[0] ?? "")}
              </div>
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight">{member.first_name} {member.last_name}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3" />{member.email}</span>
                  <span className="opacity-40">·</span>
                  <span className="font-mono tracking-tight">ID {member.member_id}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full border border-border bg-surface/60 p-2 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>

          {/* Risk strip */}
          <div className="relative grid grid-cols-3 gap-px bg-border">
            <RiskCell label="Lapse risk" value={member.lapse_risk ?? "—"} highlight={member.lapse_risk === "High"} />
            <RiskCell label="Risk score" value={`${member.risk_score ?? 0}/10`} />
            <RiskCell label="Days to expiry" value={`${member.days_to_expiry ?? "—"}d`} highlight={(member.days_to_expiry ?? 99) <= 14} />
          </div>
        </div>


        <div className="space-y-8 p-6">
          {/* Risk flags */}
          {member.risk_flags && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-destructive">Why we're concerned</div>
              <p className="mt-2 text-sm">{member.risk_flags}</p>
            </div>
          )}

          {/* AI Insight */}
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div className="font-medium">AI retention coach</div>
              </div>
              <button onClick={() => aiMut.mutate()} disabled={aiMut.isPending} className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
                {aiMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {aiInsight ? "Regenerate" : "Generate insight"}
              </button>
            </div>
            {aiInsight && (
              <div className="mt-4 space-y-3 text-sm">
                <Block label="Diagnosis">{aiInsight.diagnosis}</Block>
                <Block label="Next best action">{aiInsight.nextAction}</Block>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Suggested message</div>
                  <div className="mt-2 flex items-start gap-2 rounded-xl bg-surface p-3">
                    <p className="flex-1 text-sm">{aiInsight.messageDraft}</p>
                    <button onClick={() => { navigator.clipboard.writeText(aiInsight.messageDraft); toast.success("Copied"); }} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2">Copy</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI feedback analysis */}
          <div className="rounded-2xl border border-border bg-surface/40 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <div className="font-medium">Sentiment & outcome prediction</div>
              </div>
              <button
                onClick={() => feedbackMut.mutate()}
                disabled={feedbackMut.isPending}
                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-60"
              >
                {feedbackMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                {feedback ? "Re-analyze" : "Analyze notes"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Reads this member's follow-up notes and profile to score sentiment, predict the likely outcome, and pin a risk × urgency level.
            </p>

            {feedback && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <ScoreTile icon={<Gauge className="h-3 w-3" />} label="Sentiment" value={feedback.sentiment} sub={`${feedback.sentimentScore > 0 ? "+" : ""}${feedback.sentimentScore}`} tone={sentimentTone(feedback.sentiment)} />
                  <ScoreTile icon={<Activity className="h-3 w-3" />} label="Predicted" value={feedback.predictedOutcome} sub={`${feedback.outcomeConfidence}% conf.`} />
                  <ScoreTile icon={<AlertTriangle className="h-3 w-3" />} label="Risk × urgency" value={`${feedback.risk} / ${feedback.urgency}`} tone={riskTone(feedback.risk)} />
                  <ScoreTile icon={<Gauge className="h-3 w-3" />} label="Retention score" value={`${feedback.retentionScore}/100`} sub={retentionLabel(feedback.retentionScore)} tone={retentionTone(feedback.retentionScore)} />
                </div>

                {feedback.keyThemes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {feedback.keyThemes.map((t, i) => (
                      <span key={i} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground">{t}</span>
                    ))}
                  </div>
                )}

                {feedback.rationale && <Block label="Why">{feedback.rationale}</Block>}
                {feedback.recommendedAction && <Block label="Recommended action">{feedback.recommendedAction}</Block>}
              </div>
            )}
          </div>

          {/* Stats grid */}
          <section>
            <h3 className="font-display text-lg font-semibold">Engagement</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Mini icon={<Activity />} label="Total classes" value={d["Total Classes Completed"] ?? "—"} />
              <Mini icon={<TrendingDown />} label="Cancel rate" value={`${d["Cancellation Rate %"] ?? "0"}%`} />
              <Mini icon={<Activity />} label="Attendance" value={`${d["Attendance Rate %"] ?? "0"}%`} />
              <Mini icon={<Clock />} label="Avg / month" value={d["Avg Classes / Month"] ?? "—"} />
              <Mini icon={<Activity />} label="Remaining sessions" value={d["Remaining Sessions"] ?? "—"} />
              <Mini icon={<Clock />} label="No shows" value={d["No Shows"] ?? "0"} />
              <Mini icon={<Clock />} label="Late cancels" value={d["Late Cancellations"] ?? "0"} />
              <Mini icon={<Clock />} label="Times frozen" value={d["Times Frozen"] ?? "0"} />
            </div>
          </section>

          {/* Membership & profile */}
          <section className="grid gap-4 md:grid-cols-2">
            <Panel title="Membership">
              <KV k="Plan" v={member.current_membership} />
              <KV k="Status" v={member.membership_status} />
              <KV k="Start" v={d["Start Date"]} />
              <KV k="Ends" v={member.end_date} />
              <KV k="Auto-renew" v={d["Auto Renew"]} />
              <KV k="Lifetime spend" v={d["Lifetime Spend"] ? `₹${d["Lifetime Spend"]}` : "—"} />
            </Panel>
            <Panel title="Profile">
              <KV k="Location" v={<span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{member.primary_location}</span>} />
              <KV k="Preferred days" v={d["Preferred Days"]} />
              <KV k="Preferred time" v={d["Preferred Time Slot"]} />
              <KV k="Most recent class" v={d["Most Recent Class"]} />
              <KV k="Last class was" v={d["No Class Since"]} />
              <KV k="Phone" v={d["Phone"] ?? "—"} />
              <div className="flex items-center justify-between gap-3 pt-1 text-sm">
                <dt className="text-muted-foreground inline-flex items-center gap-1"><User className="h-3 w-3" /> Owner</dt>
                <dd>
                  <select
                    value={member.owner ?? ""}
                    onChange={(e) => ownerMut.mutate(e.target.value)}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-xs focus:border-primary focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </dd>
              </div>
            </Panel>
          </section>

          {/* Send email */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Reach out</h3>
              <button
                onClick={() => setEmailOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
              >
                <Mail className="h-3 w-3" /> {emailOpen ? "Close" : "Send email"}
              </button>
            </div>
            {emailOpen && (
              <div className="mt-3 space-y-3 rounded-2xl border border-border bg-surface/50 p-4">
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary focus:outline-none"
                />
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder={`Hi ${member.first_name ?? ""}, we noticed…`}
                  rows={6}
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">Sending to {member.email ?? "—"}</div>
                  <div className="flex gap-2">
                    {aiInsight?.messageDraft && (
                      <button
                        onClick={() => { setEmailBody(aiInsight.messageDraft); if (!emailSubject) setEmailSubject("Checking in from Physique 57"); }}
                        className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
                      >Use AI draft</button>
                    )}
                    <button
                      onClick={() => emailMut.mutate()}
                      disabled={emailMut.isPending || !emailSubject || !emailBody || !member.email}
                      className="inline-flex items-center gap-1.5 rounded-full grad-coral px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                    >
                      {emailMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Add follow-up */}
          <section>
            <h3 className="font-display text-lg font-semibold">Log a follow-up</h3>
            <div className="mt-3 space-y-3 rounded-2xl border border-border bg-surface/50 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary focus:outline-none">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">Assigned to</span>
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary focus:outline-none">
                    <option value="">Unassigned</option>
                    {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">Next follow-up</span>
                  <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary focus:outline-none" />
                </label>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you discuss? Any commitments?"
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => saveMut.mutate({ actionType: "follow_up", followUpDate: followUpDate || null, status })}
                  disabled={saveMut.isPending}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-60"
                >
                  <CalendarPlus className="h-3.5 w-3.5" /> Schedule only
                </button>
                <button
                  onClick={() => saveMut.mutate({ actionType: note ? "note" : "status", note: note || undefined, status, followUpDate: followUpDate || null })}
                  disabled={saveMut.isPending || (!note && !status)}
                  className="inline-flex items-center gap-2 rounded-full grad-coral px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                  Save action
                </button>
              </div>
            </div>
          </section>


          {/* History */}
          <section>
            <h3 className="font-display text-lg font-semibold">Activity history</h3>
            <div className="mt-3 space-y-2">
              {(fuQ.data ?? []).map((f: any) => (
                <div key={f.id} className="rounded-xl border border-border bg-surface/50 p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{f.user_email ?? "User"}</span>
                    <span>{new Date(f.created_at).toLocaleString()}</span>
                  </div>
                  {f.status && <div className="mt-1 text-xs"><span className="text-muted-foreground">Status:</span> {f.status}</div>}
                  {f.follow_up_date && <div className="mt-1 text-xs"><span className="text-muted-foreground">Follow-up:</span> {f.follow_up_date}</div>}
                  {f.note && <p className="mt-2 text-sm">{f.note}</p>}
                </div>
              ))}
              {(fuQ.data ?? []).length === 0 && !fuQ.isLoading && (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No activity yet. Be the first to reach out.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function RiskCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`px-6 py-3.5 transition ${highlight ? "bg-destructive/10" : "bg-surface/70"}`}>
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-lg font-semibold tracking-tight ${highlight ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <p className="mt-1.5 leading-relaxed">{children}</p>
    </div>
  );
}

function Mini({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="group rounded-xl border border-border bg-surface/60 p-3.5 transition hover:border-primary/30 hover:bg-surface">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground [&>svg]:h-3 [&>svg]:w-3">{icon}<span>{label}</span></div>
      <div className="mt-2 font-display text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-5 shadow-[0_1px_0_0_oklch(1_0_0/4%)_inset]">
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{title}</div>
      <dl className="mt-3.5 space-y-2.5">{children}</dl>
    </div>
  );
}


function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v ?? "—"}</dd>
    </div>
  );
}

type Tone = "positive" | "neutral" | "warn" | "danger";
function toneClass(t?: Tone) {
  switch (t) {
    case "positive": return "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "warn":     return "border-amber-600/40 bg-amber-500/15 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
    case "danger":   return "border-destructive/40 bg-destructive/15 text-destructive dark:border-destructive/30 dark:bg-destructive/10";
    default:         return "border-border bg-surface/60 text-foreground";
  }
}
function sentimentTone(s: FeedbackAnalysis["sentiment"]): Tone {
  if (s === "Positive") return "positive";
  if (s === "Negative") return "danger";
  if (s === "Mixed") return "warn";
  return "neutral";
}
function riskTone(r: FeedbackAnalysis["risk"]): Tone {
  if (r === "Critical" || r === "High") return "danger";
  if (r === "Medium") return "warn";
  return "positive";
}
function retentionTone(n: number): Tone {
  if (n >= 70) return "positive";
  if (n >= 40) return "warn";
  return "danger";
}
function retentionLabel(n: number): string {
  if (n >= 75) return "Strong";
  if (n >= 50) return "Stable";
  if (n >= 25) return "Fragile";
  return "Critical";
}

function ScoreTile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: Tone }) {
  return (
    <div className={`rounded-xl border p-3 ${toneClass(tone)}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] opacity-80">{icon}<span>{label}</span></div>
      <div className="mt-1.5 font-display text-sm font-semibold leading-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}
