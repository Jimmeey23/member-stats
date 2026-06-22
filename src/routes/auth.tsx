import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { adminCodeLogin } from "@/lib/admin-login.functions";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import { Activity, Loader2, KeyRound } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "code">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [busy, setBusy] = useState(false);
  const codeLogin = useServerFn(adminCodeLogin);

  async function googleSignIn() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Google sign-in failed");
      window.location.assign(data.url);
    } catch (err: any) {
      toast.error(err.message ?? "Google sign-in failed");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "code") {
        const { token_hash } = await codeLogin({ data: { code: adminCode } });
        const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash });
        if (error) throw error;
        toast.success("Signed in (test admin)");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard`, data: { display_name: name } },
        });
        if (error) throw error;
        toast.success("Account created. You're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally { setBusy(false); }
  }

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="absolute top-4 right-4 z-20"><ThemeToggle /></div>

      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="hidden lg:flex relative items-end p-12">
          <img
            src="https://images.unsplash.com/photo-1599058917212-d750089bc07e?auto=format&fit=crop&w=1600&q=80"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/65" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/30" />
          <div className="relative z-10 max-w-md text-white">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/85 backdrop-blur">
              <Activity className="h-3.5 w-3.5" /> Retention OS
            </div>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] text-white">
              Keep every member<br/>moving forward.
            </h1>
            <p className="mt-4 text-base text-white/75">
              Spot lapse risk before it lapses. Reach the right member at the right moment, every day.
            </p>
          </div>
        </div>



        <div className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md">
            <div className="lg:hidden mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Activity className="h-3.5 w-3.5 text-primary" /> Physique 57
            </div>
            <h2 className="font-display text-3xl font-semibold">
              {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create account" : "Admin test login"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signin" ? "Sign in to your retention dashboard"
                : mode === "signup" ? "Get started in seconds"
                : "Enter the admin access code to sign in as the test admin."}
            </p>

            {mode !== "code" && (
              <>
                <button
                  type="button"
                  onClick={googleSignIn}
                  disabled={busy}
                  className="mt-6 inline-flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-surface/60 font-medium text-foreground transition hover:bg-surface disabled:opacity-60"
                >
                  <GoogleIcon /> Continue with Google
                </button>
                <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form onSubmit={submit} className="space-y-4">
              {mode === "code" ? (
                <Field label="Admin code">
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={adminCode}
                    onChange={(e) => setAdminCode(e.target.value)}
                    required
                    className="auth-input tracking-[0.4em]"
                    placeholder="••••"
                  />
                </Field>
              ) : (
                <>
                  {mode === "signup" && (
                    <Field label="Name">
                      <input value={name} onChange={(e) => setName(e.target.value)} required className="auth-input" placeholder="Your name" />
                    </Field>
                  )}
                  <Field label="Email">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="auth-input" placeholder="you@physique57.com" />
                  </Field>
                  <Field label="Password">
                    <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="auth-input" placeholder="••••••••" />
                  </Field>
                </>
              )}

              <button type="submit" disabled={busy} className="group relative mt-2 inline-flex h-12 w-full items-center justify-center rounded-2xl grad-coral font-medium text-primary-foreground ring-glow transition hover:brightness-110 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Continue")}
              </button>
            </form>

            <div className="mt-6 flex flex-col gap-2 text-sm">
              {mode !== "code" && (
                <button
                  type="button"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="text-muted-foreground hover:text-foreground text-left"
                >
                  {mode === "signin" ? "Don't have an account? Create one" : "Already have an account? Sign in"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode(mode === "code" ? "signin" : "code")}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-left"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {mode === "code" ? "Back to email sign in" : "Use admin access code"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .auth-input { width: 100%; height: 48px; border-radius: 14px; background: var(--color-surface); border: 1px solid var(--color-border); padding: 0 16px; color: var(--color-foreground); font-size: 14px; transition: border-color .15s, box-shadow .15s; }
        .auth-input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 4px var(--color-ring); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.95 10.71A5.41 5.41 0 0 1 3.66 9c0-.6.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z"/>
    </svg>
  );
}
