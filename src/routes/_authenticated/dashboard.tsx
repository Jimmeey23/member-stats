import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { listMembers, summary, refreshMembers, type MemberRow } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, BellRing, CalendarClock, ChevronRight, LogOut, RefreshCw, Search, Users, Sparkles, MapPin, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { MemberModal } from "@/components/member-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnimatedLogo } from "@/components/animated-logo";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type ViewMode = "overview" | "engagement" | "membership" | "contact" | "risk";

const VIEW_MODES: { id: ViewMode; label: string; desc: string }[] = [
  { id: "overview", label: "Overview", desc: "Risk, plan, expiry, owner" },
  { id: "engagement", label: "Engagement", desc: "Classes, attendance, cancellations" },
  { id: "membership", label: "Membership", desc: "Plan, status, dates, spend" },
  { id: "contact", label: "Contact", desc: "Email, phone, last contacted" },
  { id: "risk", label: "Risk detail", desc: "Score, flags, follow-ups" },
];

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchMembers = useServerFn(listMembers);
  const fetchSummary = useServerFn(summary);
  const refresh = useServerFn(refreshMembers);

  const membersQ = useQuery({ queryKey: ["members"], queryFn: () => fetchMembers() });
  const summaryQ = useQuery({ queryKey: ["summary"], queryFn: () => fetchSummary() });

  const refreshMut = useMutation({
    mutationFn: () => refresh(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      if (r?.synced) toast.success(`Refreshed ${r.synced} members`);
    },
    onError: (e: any) => toast.error(e.message ?? "Refresh failed"),
  });

  // Initial data is loaded by useQuery above; no polling interval — manual refresh only.

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "high" | "unactioned" | "expiring">("all");
  const [view, setView] = useState<ViewMode>("overview");
  const [activeLoc, setActiveLoc] = useState<string>("__all");
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const bootstrapRefreshRan = useRef(false);

  const members = membersQ.data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (bootstrapRefreshRan.current) return;
    if (membersQ.isLoading || membersQ.isFetching || membersQ.error) return;
    if (members.length > 0) return;
    bootstrapRefreshRan.current = true;
    refreshMut.mutate();
  }, [members.length, membersQ.error, membersQ.isFetching, membersQ.isLoading, refreshMut]);

  // Derive top 4 locations by member count
  const locationTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      const loc = (m.primary_location ?? "").trim();
      if (!loc) continue;
      counts.set(loc, (counts.get(loc) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([loc]) => loc);
  }, [members]);

  const tabs = useMemo(() => [
    { id: "__all", label: "All locations", count: members.length },
    ...locationTabs.map((l) => ({
      id: l,
      label: l,
      count: members.filter((m) => m.primary_location === l).length,
    })),
  ], [locationTabs, members]);

  const locationFiltered = useMemo(
    () => activeLoc === "__all" ? members : members.filter((m) => m.primary_location === activeLoc),
    [members, activeLoc],
  );

  const filtered = useMemo(() => {
    return locationFiltered.filter((m) => {
      if (filter === "high" && m.lapse_risk !== "High") return false;
      if (filter === "unactioned" && !(m.lapse_risk === "High" && (!m.outreach_status || m.outreach_status === "0"))) return false;
      if (filter === "expiring" && !(m.days_to_expiry !== null && m.days_to_expiry <= 14 && m.days_to_expiry >= 0)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${m.first_name ?? ""} ${m.last_name ?? ""} ${m.email ?? ""} ${m.member_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [locationFiltered, filter, search]);

  const locStats = useMemo(() => {
    const all = locationFiltered;
    const high = all.filter((m) => m.lapse_risk === "High");
    const overdue = all.filter((m) => m.next_follow_up && m.next_follow_up < today);
    const unactioned = high.filter((m) => !m.outreach_status || m.outreach_status === "0");
    const expiringSoon = all.filter((m) => m.days_to_expiry !== null && m.days_to_expiry !== undefined && m.days_to_expiry >= 0 && m.days_to_expiry <= 14);
    return {
      total: all.length,
      high: high.length,
      overdue: overdue.length,
      unactioned: unactioned.length,
      expiringSoon: expiringSoon.length,
    };
  }, [locationFiltered, today]);

  const reminders = useMemo(() => {
    return locationFiltered
      .filter((m) => m.lapse_risk === "High" && (!m.outreach_status || m.outreach_status === "0" || (m.next_follow_up && m.next_follow_up < today)))
      .slice(0, 6);
  }, [locationFiltered, today]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const s = activeLoc === "__all" ? (summaryQ.data ?? locStats) : locStats;
  const empty = members.length === 0 && !membersQ.isLoading && !refreshMut.isPending;

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[500px]">
        <div className="absolute left-1/3 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <AnimatedLogo size={42} />
            <div className="min-w-0">
              <div className="font-display text-base font-semibold tracking-tight truncate">Physique 57 · Retention</div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Member Command Center</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              title="Refresh data"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              {refreshMut.isPending ? "Refreshing…" : "Refresh"}
            </button>
            <ThemeToggle />
            <button onClick={signOut} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>

        {/* Location tabs — 5 equal-width */}
        <div className="mx-auto max-w-7xl px-6 pb-3">
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface/70 p-1 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => {
              const t = tabs[i];
              if (!t) {
                return <div key={i} className="rounded-xl px-3 py-2.5 text-center text-xs text-muted-foreground/50">—</div>;
              }
              const active = t.id === activeLoc;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveLoc(t.id)}
                  className={`flex flex-col items-center justify-center rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> <span className="truncate">{t.label}</span></span>
                  <span className={`mt-0.5 text-[10px] tabular-nums ${active ? "opacity-90" : "opacity-60"}`}>{t.count} members</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight grad-text">
              {activeLoc === "__all" ? "Today's retention pulse" : activeLoc}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {activeLoc === "__all" ? "Live view across all studios." : `Members assigned to ${activeLoc}.`}
            </p>
          </div>
        </div>

        {membersQ.error && (
          <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/10 p-6">
            <h3 className="font-display text-lg font-semibold">Could not load member data</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {membersQ.error instanceof Error ? membersQ.error.message : "Unknown error"}
            </p>
            <button
              type="button"
              onClick={() => membersQ.refetch()}
              className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        )}

        {empty && !membersQ.error && (
          <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
            <h3 className="font-display text-lg font-semibold">No member data yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">Loading the latest snapshot…</p>
          </div>
        )}

        {/* Stats */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat icon={<Users className="h-4 w-4" />} label="Active members" value={s?.total ?? "—"} />
          <Stat icon={<AlertTriangle className="h-4 w-4 text-destructive" />} label="High risk" value={s?.high ?? "—"} accent="destructive" />
          <Stat icon={<BellRing className="h-4 w-4 text-warning" />} label="Unactioned" value={s?.unactioned ?? "—"} accent="warning" />
          <Stat icon={<CalendarClock className="h-4 w-4 text-warning" />} label="Overdue follow-ups" value={s?.overdue ?? "—"} accent="warning" />
          <Stat icon={<Sparkles className="h-4 w-4 text-primary" />} label="Expiring ≤ 14d" value={s?.expiringSoon ?? "—"} />
        </div>

        {/* Reminders */}
        {reminders.length > 0 && (
          <div className="mt-8 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-5">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-primary" />
              <div className="text-sm font-medium">{reminders.length} high-risk member{reminders.length === 1 ? "" : "s"} need attention</div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {reminders.map((m) => (
                <button key={m.member_id} onClick={() => setSelected(m)} className="group flex items-center justify-between rounded-xl border border-border bg-surface/60 p-3 text-left hover:bg-surface-2 hover:ring-glow transition">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{m.first_name} {m.last_name}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{m.risk_flags ?? "Risk flagged"}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, member ID…"
              className="h-11 w-full rounded-full border border-border bg-surface pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["high", "High risk"],
              ["unactioned", "Unactioned"],
              ["expiring", "Expiring soon"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full border px-4 py-2 text-sm transition ${filter === k ? "border-primary bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* View mode selector */}
        <div className="mt-4 flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface/60 p-1.5">
          {VIEW_MODES.map((v) => {
            const active = v.id === view;
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                title={v.desc}
                className={`flex-1 min-w-[110px] rounded-lg px-3 py-2 text-xs font-medium transition ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_0_0_oklch(1_0_0/4%)_inset,0_8px_30px_-12px_oklch(0_0_0/8%)]">
          <div className="scroll-fade overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-surface-2/95 text-[11px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">

                <tr>
                  <Th>Member</Th>
                  {view === "overview" && (<>
                    <Th>Risk</Th>
                    <Th>Plan</Th>
                    <Th className="text-right">Expiry</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Attend %</Th>
                    <Th className="text-right">Cancel %</Th>
                    <Th className="text-right">Last class</Th>
                  </>)}
                  {view === "engagement" && (<>
                    <Th className="text-right">Classes</Th>
                    <Th className="text-right">Bookings</Th>
                    <Th className="text-right">Attend %</Th>
                    <Th className="text-right">Cancel %</Th>
                    <Th className="text-right">Avg/mo</Th>
                    <Th>Freq. trend</Th>
                    <Th className="text-right">No-shows</Th>
                    <Th className="text-right">Late cancels</Th>
                    <Th className="text-right">Days since</Th>
                  </>)}
                  {view === "membership" && (<>
                    <Th>Plan</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Ends</Th>
                    <Th className="text-right">Remaining</Th>
                    <Th>Auto-renew</Th>
                    <Th>Frozen</Th>
                    <Th className="text-right">Rev/class ₹</Th>
                    <Th className="text-right">Lifetime ₹</Th>
                    <Th>Sold by</Th>
                  </>)}
                  {view === "contact" && (<>
                    <Th>Email</Th>
                    <Th>Phone</Th>
                    <Th>Location</Th>
                    <Th>Owner</Th>
                    <Th>Status</Th>
                    <Th>Last contacted</Th>
                    <Th>Next follow-up</Th>
                  </>)}
                  {view === "risk" && (<>
                    <Th>Risk</Th>
                    <Th className="text-right">Score</Th>
                    <Th>Why</Th>
                    <Th>Status</Th>
                    <Th>Owner</Th>
                    <Th>Next follow-up</Th>
                    <Th className="text-right">Expiry</Th>
                  </>)}
                  <Th></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m, idx) => (
                  <tr key={m.member_id} onClick={() => setSelected(m)} className={`group cursor-pointer transition ${idx % 2 ? "bg-surface" : "bg-surface-2/40"} hover:bg-primary/5`}>

                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={`${m.first_name ?? ""} ${m.last_name ?? ""}`} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{m.first_name} {m.last_name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[220px]">{m.email}</div>
                        </div>
                      </div>
                    </Td>

                    {view === "overview" && (<>
                      <Td><RiskBadge risk={m.lapse_risk} score={m.risk_score} /></Td>
                      <Td><span className="text-xs text-muted-foreground line-clamp-1 max-w-[180px]">{m.current_membership}</span></Td>
                      <Td className="text-right">
                        <span className={`tabular-nums ${m.days_to_expiry !== null && m.days_to_expiry <= 14 ? "text-warning font-medium" : ""}`}>
                          {m.days_to_expiry ?? "—"}d
                        </span>
                      </Td>
                      <Td><StatusPill status={m.outreach_status} /></Td>
                      <Td className="text-right tabular-nums text-xs">{m.data?.["Attendance Rate %"] ?? "0"}%</Td>
                      <Td className="text-right tabular-nums text-xs"><span className={Number(m.data?.["Cancellation Rate %"]) >= 25 ? "text-destructive font-medium" : ""}>{m.data?.["Cancellation Rate %"] ?? "0"}%</span></Td>
                      <Td className="text-right text-xs text-muted-foreground">{m.data?.["Days Since Last Class"] ?? "—"}d</Td>
                    </>)}

                    {view === "engagement" && (<>
                      <Td className="text-right tabular-nums">{m.data?.["Total Classes Completed"] ?? "—"}</Td>
                      <Td className="text-right tabular-nums">{m.data?.["Total Bookings (All Time)"] ?? "—"}</Td>
                      <Td className="text-right tabular-nums">{m.data?.["Attendance Rate %"] ?? "0"}%</Td>
                      <Td className="text-right tabular-nums"><span className={Number(m.data?.["Cancellation Rate %"]) >= 25 ? "text-destructive font-medium" : ""}>{m.data?.["Cancellation Rate %"] ?? "0"}%</span></Td>
                      <Td className="text-right tabular-nums">{m.data?.["Avg Classes / Month"] ?? "—"}</Td>
                      <Td><span className="text-xs text-muted-foreground">{m.data?.["Frequency Trend"] || "—"}</span></Td>
                      <Td className="text-right tabular-nums">{m.data?.["No Shows"] ?? "0"}</Td>
                      <Td className="text-right tabular-nums">{m.data?.["Late Cancellations"] ?? "0"}</Td>
                      <Td className="text-right text-xs text-muted-foreground">{m.data?.["Days Since Last Class"] ?? "—"}d</Td>
                    </>)}

                    {view === "membership" && (<>
                      <Td><span className="text-xs">{m.current_membership ?? "—"}</span></Td>
                      <Td><span className="text-xs text-muted-foreground">{m.data?.["Membership Type"] ?? "—"}</span></Td>
                      <Td><span className="text-xs">{m.membership_status ?? "—"}</span></Td>
                      <Td><span className="text-xs text-muted-foreground">{m.end_date ?? "—"}</span></Td>
                      <Td className="text-right tabular-nums">{m.data?.["Remaining Sessions"] ?? "—"}</Td>
                      <Td><span className="text-xs">{m.data?.["Auto Renew"] ?? "—"}</span></Td>
                      <Td><span className="text-xs">{m.data?.["Currently Frozen"] ?? "—"}</span></Td>
                      <Td className="text-right tabular-nums text-xs">{m.data?.["Revenue / Class"] ? `₹${m.data?.["Revenue / Class"]}` : "—"}</Td>
                      <Td className="text-right tabular-nums text-xs">{m.data?.["Lifetime Spend"] ? `₹${m.data?.["Lifetime Spend"]}` : "—"}</Td>
                      <Td><span className="text-xs text-muted-foreground">{m.data?.["Sold By"] ?? "—"}</span></Td>
                    </>)}

                    {view === "contact" && (<>
                      <Td><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{m.email ?? "—"}</span></Td>
                      <Td><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{m.data?.["Phone"] ?? "—"}</span></Td>
                      <Td><span className="text-xs text-muted-foreground">{m.primary_location ?? "—"}</span></Td>
                      <Td><span className="text-xs">{m.owner ?? "—"}</span></Td>
                      <Td><StatusPill status={m.outreach_status} /></Td>
                      <Td><span className="text-xs text-muted-foreground">{m.data?.["Last Contacted"] ?? "—"}</span></Td>
                      <Td><span className="text-xs">{m.next_follow_up ?? "—"}</span></Td>
                    </>)}

                    {view === "risk" && (<>
                      <Td><RiskBadge risk={m.lapse_risk} score={m.risk_score} /></Td>
                      <Td className="text-right tabular-nums">{m.risk_score ?? 0}</Td>
                      <Td><span className="text-xs text-muted-foreground line-clamp-2 max-w-[260px]">{m.risk_flags ?? "—"}</span></Td>
                      <Td><StatusPill status={m.outreach_status} /></Td>
                      <Td><span className="text-xs">{m.owner ?? "—"}</span></Td>
                      <Td><span className="text-xs">{m.next_follow_up ?? "—"}</span></Td>
                      <Td className="text-right tabular-nums">{m.days_to_expiry ?? "—"}d</Td>
                    </>)}

                    <Td><ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></Td>
                  </tr>
                ))}
                {filtered.length === 0 && !membersQ.isLoading && (
                  <tr><td colSpan={9} className="p-12 text-center text-sm text-muted-foreground">No members match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {selected && <MemberModal member={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | string; accent?: "destructive" | "warning" }) {
  const ring = accent === "destructive" ? "ring-1 ring-destructive/20" : accent === "warning" ? "ring-1 ring-warning/20" : "";
  return (
    <div className={`glass rounded-2xl p-5 ${ring}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="mt-3 font-display text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3.5 text-left font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3.5 align-middle ${className}`}>{children}</td>;
}

function Avatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "·";
  return <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-surface-2 to-surface text-xs font-semibold ring-1 ring-border">{initials}</div>;
}

function RiskBadge({ risk, score }: { risk: string | null; score: number | null }) {
  const tone =
    risk === "High"
      ? "bg-destructive/12 text-destructive ring-destructive/35"
      : risk === "Medium"
      ? "bg-warning/12 text-warning ring-warning/35"
      : "bg-success/12 text-success ring-success/35";
  return (
    <span className={`inline-flex w-28 items-center justify-between rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${tone}`}>
      <span>{risk ?? "—"}</span>
      <span className="tabular-nums opacity-60 font-mono text-[11px]">{score ?? 0}</span>
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status || status === "0") return (
    <span className="inline-flex w-32 items-center justify-center rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground">
      Not contacted
    </span>
  );
  return (
    <span className="inline-flex w-32 items-center justify-center rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/25">
      {status}
    </span>
  );
}
