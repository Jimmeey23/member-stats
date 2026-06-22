import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type MemberRow = {
  member_id: string;
  data: Record<string, string>;
  lapse_risk: string | null;
  risk_score: number | null;
  risk_flags: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  current_membership: string | null;
  membership_status: string | null;
  end_date: string | null;
  days_to_expiry: number | null;
  primary_location: string | null;
  outreach_status: string | null;
  owner: string | null;
  next_follow_up: string | null;
  last_synced_at: string;
};

export const refreshMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readSheet } = await import("./google-sheets.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { headers, rows } = await readSheet();
    if (headers.length === 0) return { synced: 0 };

    const idx = (name: string) => headers.indexOf(name);
    const get = (row: string[], name: string) => {
      const i = idx(name);
      return i === -1 ? "" : (row[i] ?? "");
    };
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const records = rows
      .filter((r) => get(r, "Member ID"))
      .map((r) => {
        const data: Record<string, string> = {};
        headers.forEach((h, i) => { data[h] = r[i] ?? ""; });
        return {
          member_id: get(r, "Member ID"),
          data,
          lapse_risk: get(r, "Lapse Risk") || null,
          risk_score: num(get(r, "Risk Score")),
          risk_flags: get(r, "Risk Flags") || null,
          first_name: get(r, "First Name") || null,
          last_name: get(r, "Last Name") || null,
          email: get(r, "Email") || null,
          current_membership: get(r, "Current Membership") || null,
          membership_status: get(r, "Membership Status") || null,
          end_date: get(r, "End Date") || null,
          days_to_expiry: num(get(r, "Days to Expiry")),
          primary_location: get(r, "Primary Location") || null,
          outreach_status: get(r, "Outreach Status") || null,
          owner: get(r, "Owner") || null,
          next_follow_up: get(r, "Next Follow-Up") || null,
          last_synced_at: new Date().toISOString(),
        };
      });

    for (let i = 0; i < records.length; i += 200) {
      const chunk = records.slice(i, i + 200);
      const { error } = await supabaseAdmin.from("members").upsert(chunk, { onConflict: "member_id" });
      if (error) throw error;
    }
    return { synced: records.length, userId: context.userId };
  });

// Back-compat alias
export const syncFromSheet = refreshMembers;

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("members")
      .select("*")
      .order("risk_score", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as MemberRow[];
  });

export const getMemberFollowUps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { memberId: string }) => z.object({ memberId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("follow_ups")
      .select("*")
      .eq("member_id", data.memberId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    memberId: string;
    actionType: string;
    note?: string;
    status?: string;
    followUpDate?: string | null;
  }) => z.object({
    memberId: z.string(),
    actionType: z.string(),
    note: z.string().optional(),
    status: z.string().optional(),
    followUpDate: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await context.supabase
      .from("profiles").select("email,display_name").eq("id", context.userId).single();
    const userEmail = profile?.display_name || profile?.email || "Unknown";

    const { data: row, error } = await supabaseAdmin.from("follow_ups").insert({
      member_id: data.memberId,
      user_id: context.userId,
      user_email: userEmail,
      action_type: data.actionType,
      note: data.note ?? null,
      status: data.status ?? null,
      follow_up_date: data.followUpDate ?? null,
    }).select().single();
    if (error) throw new Error(error.message);

    // Mirror latest action to members table + sheet
    const updates: Record<string, string> = {};
    const memberPatch: Record<string, string> = {};
    if (data.status) {
      memberPatch.outreach_status = data.status;
      updates["Outreach Status"] = data.status;
    }
    if (data.followUpDate) {
      memberPatch.next_follow_up = data.followUpDate;
      updates["Next Follow-Up"] = data.followUpDate;
    }
    if (data.note) updates["Latest Note"] = data.note;
    updates["Last Contacted"] = new Date().toISOString().slice(0, 19).replace("T", " ");

    if (Object.keys(memberPatch).length > 0) {
      await supabaseAdmin.from("members").update(memberPatch as never).eq("member_id", data.memberId);
    }

    // Best-effort sheet write
    try {
      const { writeMemberRow } = await import("./google-sheets.server");
      await writeMemberRow(data.memberId, updates);
    } catch (e) {
      console.error("Sheet write failed (non-fatal):", e);
    }

    return row;
  });

export const summary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members } = await supabaseAdmin.from("members").select("*");
    const all = (members ?? []) as MemberRow[];
    const high = all.filter((m) => m.lapse_risk === "High");
    const today = new Date().toISOString().slice(0, 10);
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
  });
