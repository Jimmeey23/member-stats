import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ADMIN_EMAIL = "admin-test@physique57.local";

export const adminCodeLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => z.object({ code: z.string().trim().min(1).max(32) }).parse(d))
  .handler(async ({ data }) => {
    const expected = process.env.ADMIN_LOGIN_CODE ?? "9818";
    if (data.code.trim() !== expected.trim()) {
      // Generic message — don't leak which field is wrong.
      throw new Error("Invalid admin code");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ensure the test user exists (idempotent).
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email === ADMIN_EMAIL);
    if (!existing) {
      await supabaseAdmin.auth.admin.createUser({
        email: ADMIN_EMAIL,
        email_confirm: true,
        user_metadata: { display_name: "Admin (test)" },
      });
    }

    const { data: refreshed } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = refreshed?.users?.find((u) => u.email === ADMIN_EMAIL);
    if (!user) {
      throw new Error("Could not create test admin user");
    }

    await supabaseAdmin.from("user_roles").upsert(
      [
        { user_id: user.id, role: "staff" },
        { user_id: user.id, role: "admin" },
      ],
      { onConflict: "user_id,role" },
    );

    // Generate a magic link the client can immediately consume.
    const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: ADMIN_EMAIL,
    });
    if (error || !linkData?.properties?.hashed_token) {
      throw new Error(error?.message ?? "Could not create session");
    }
    return {
      token_hash: linkData.properties.hashed_token,
    };
  });
