import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const sendMemberEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { memberId: string; subject: string; body: string }) =>
    z.object({
      memberId: z.string(),
      subject: z.string().min(1),
      body: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const token = process.env.MAILTRAP_API_TOKEN;
    const from = process.env.MAILTRAP_FROM_EMAIL;
    if (!token || !from) throw new Error("Mailtrap credentials not configured");

    const { data: member, error } = await context.supabase
      .from("members")
      .select("email,first_name,last_name")
      .eq("member_id", data.memberId)
      .single();
    if (error || !member?.email) throw new Error("Member email not found");

    const testMode = process.env.TEST_MODE !== "false" && process.env.TEST_MODE !== "0";

    if (!testMode) {
      const html = `<div style="font-family:Inter,Arial,sans-serif;color:#111;line-height:1.55;">
        <p>Hi ${member.first_name ?? ""},</p>
        <div>${data.body.replace(/\n/g, "<br/>")}</div>
        <p style="margin-top:24px;color:#666;font-size:12px;">— Physique 57 Team</p>
      </div>`;

      const res = await fetch("https://send.api.mailtrap.io/api/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: { email: from, name: "Physique 57" },
          to: [{ email: member.email, name: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() }],
          subject: data.subject,
          text: data.body,
          html,
          category: "Member Outreach",
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Email send failed: ${res.status} ${txt}`);
      }
    }

    // Log as a follow-up
    await context.supabase.from("follow_ups").insert({
      member_id: data.memberId,
      user_id: context.userId,
      action_type: testMode ? "email_draft" : "email_sent",
      note: `Subject: ${data.subject}\n\n${data.body}`,
    });

    return { ok: true, testMode };
  });

export const updateMemberOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { memberId: string; owner: string }) =>
    z.object({ memberId: z.string(), owner: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("members")
      .update({ owner: data.owner })
      .eq("member_id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
