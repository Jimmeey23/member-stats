import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const generateMemberInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { memberId: string }) => z.object({ memberId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("AI not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m } = await supabaseAdmin.from("members").select("*").eq("member_id", data.memberId).single();
    if (!m) throw new Error("Member not found");

    const profile = m.data ?? {};
    const sys = `You are a fitness studio retention coach. Given a member profile, write:
1. A 2-sentence diagnosis of their churn risk.
2. A single concrete next-best-action for the studio team.
3. A short personalized SMS the team can send (under 200 chars, warm tone, no emojis).
Return clean JSON: { "diagnosis": string, "nextAction": string, "messageDraft": string }`;

    const usr = `Member profile:\n${JSON.stringify(profile, null, 2)}`;

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
    if (!res.ok) throw new Error(`AI error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { choices: { message: { content: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    try { return JSON.parse(content); } catch { return { diagnosis: content, nextAction: "", messageDraft: "" }; }
  });
