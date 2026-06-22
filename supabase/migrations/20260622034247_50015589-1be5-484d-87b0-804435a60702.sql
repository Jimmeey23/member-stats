
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Members (synced from Google Sheet)
CREATE TABLE public.members (
  member_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  lapse_risk TEXT,
  risk_score INTEGER,
  risk_flags TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  current_membership TEXT,
  membership_status TEXT,
  end_date TEXT,
  days_to_expiry INTEGER,
  primary_location TEXT,
  outreach_status TEXT,
  owner TEXT,
  next_follow_up TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_select_all_auth" ON public.members FOR SELECT TO authenticated USING (true);
CREATE POLICY "members_update_all_auth" ON public.members FOR UPDATE TO authenticated USING (true);
CREATE POLICY "members_insert_all_auth" ON public.members FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_members_lapse_risk ON public.members(lapse_risk);
CREATE INDEX idx_members_outreach_status ON public.members(outreach_status);

-- Follow-ups history
CREATE TABLE public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL REFERENCES public.members(member_id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  action_type TEXT NOT NULL DEFAULT 'note',
  status TEXT,
  note TEXT,
  follow_up_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fu_select_all_auth" ON public.follow_ups FOR SELECT TO authenticated USING (true);
CREATE POLICY "fu_insert_auth" ON public.follow_ups FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fu_update_own" ON public.follow_ups FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fu_delete_own" ON public.follow_ups FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_follow_ups_member_id ON public.follow_ups(member_id);
CREATE INDEX idx_follow_ups_follow_up_date ON public.follow_ups(follow_up_date);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
