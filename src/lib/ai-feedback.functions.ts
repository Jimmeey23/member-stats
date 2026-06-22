import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type FeedbackAnalysis = {
  sentiment: "Positive" | "Neutral" | "Mixed" | "Negative";
  sentimentScore: number; // -100..100
  predictedOutcome: "Won back" | "Likely to retain" | "At risk" | "Likely to lapse" | "Lost";
  outcomeConfidence: number; // 0..100
  risk: "Low" | "Medium" | "High" | "Critical";
  urgency: "Low" | "Medium" | "High" | "Immediate";
  retentionScore: number; // 0..100
  keyThemes: string[];
  rationale: string;
  recommendedAction: string;
};

export const analyzeMemberFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { memberId: string }) => z.object({ memberId: z.string() }).parse(d))
  .handler(async ({ data }): Promise<FeedbackAnalysis> => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("AI not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m } = await supabaseAdmin
      .from("members")
      .select("member_id, first_name, last_name, lapse_risk, risk_score, risk_flags, days_to_expiry, current_membership, membership_status, data")
      .eq("member_id", data.memberId)
      .single();
    if (!m) throw new Error("Member not found");

    const { data: fus } = await supabaseAdmin
      .from("follow_ups")
      .select("created_at, action_type, status, note, follow_up_date, user_email")
      .eq("member_id", data.memberId)
      .order("created_at", { ascending: true });

    const history = (fus ?? [])
      .map((f, i) => `#${i + 1} [${new Date(f.created_at).toISOString().slice(0, 10)}] ` +
        `status=${f.status ?? "-"} type=${f.action_type ?? "-"}` +
        (f.note ? `\n  note: ${f.note}` : ""))
      .join("\n");

    const sys = `You are an analyst at a boutique fitness studio. From a member's profile and the team's follow-up notes, produce a strict JSON object:
{
  "sentiment": "Positive" | "Neutral" | "Mixed" | "Negative",
  "sentimentScore": number from -100 (very negative) to 100 (very positive),
  "predictedOutcome": "Won back" | "Likely to retain" | "At risk" | "Likely to lapse" | "Lost",
  "outcomeConfidence": integer 0-100,
  "risk": "Low" | "Medium" | "High" | "Critical",
  "urgency": "Low" | "Medium" | "High" | "Immediate",
  "retentionScore": integer 0-100 (higher = more likely to retain),
  "keyThemes": array of up to 5 short phrases (e.g. "pricing concern", "schedule conflict", "loved new instructor"),
  "rationale": 1-2 sentences citing specific notes,
  "recommendedAction": one concrete next step
}
Base sentiment on member tone in the notes, not on the team's tone. If there are no notes, infer from profile risk/expiry signals and say so in rationale. Return JSON only.`;

    const usr = `MEMBER PROFILE:\n${JSON.stringify({
      name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
      plan: m.current_membership,
      status: m.membership_status,
      lapse_risk: m.lapse_risk,
      risk_score: m.risk_score,
      risk_flags: m.risk_flags,
      days_to_expiry: m.days_to_expiry,
      engagement: m.data,
    }, null, 2)}\n\nFOLLOW-UP HISTORY (${(fus ?? []).length} entries):\n${history || "(none)"}`;

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        response_format: { type: "json_object" },
      }),
    });
    if (res.status === 429) throw new Error("AI rate limit — try again in a minute");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace billing");
    if (!res.ok) throw new Error(`AI error: ${res.status}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: Partial<FeedbackAnalysis> = {};
    try { parsed = JSON.parse(content); } catch { /* ignore */ }

    // Defensive normalisation
    const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
      const v = typeof n === "number" ? n : Number(n);
      if (Number.isNaN(v)) return fallback;
      return Math.max(lo, Math.min(hi, Math.round(v)));
    };
    return {
      sentiment: (parsed.sentiment as FeedbackAnalysis["sentiment"]) ?? "Neutral",
      sentimentScore: clamp(parsed.sentimentScore, -100, 100, 0),
      predictedOutcome: (parsed.predictedOutcome as FeedbackAnalysis["predictedOutcome"]) ?? "At risk",
      outcomeConfidence: clamp(parsed.outcomeConfidence, 0, 100, 50),
      risk: (parsed.risk as FeedbackAnalysis["risk"]) ?? "Medium",
      urgency: (parsed.urgency as FeedbackAnalysis["urgency"]) ?? "Medium",
      retentionScore: clamp(parsed.retentionScore, 0, 100, 50),
      keyThemes: Array.isArray(parsed.keyThemes) ? parsed.keyThemes.slice(0, 5).map(String) : [],
      rationale: String(parsed.rationale ?? ""),
      recommendedAction: String(parsed.recommendedAction ?? ""),
    };
  });
