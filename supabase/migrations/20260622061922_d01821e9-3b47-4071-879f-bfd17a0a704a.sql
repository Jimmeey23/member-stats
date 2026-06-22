
-- 1. Role enum + user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2. has_role security definer function (no recursion on user_roles policies)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Helper: is this user staff or admin?
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','staff')
  )
$$;

-- Lock down EXECUTE on definer functions
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

-- Existing trigger-only functions: revoke direct execute
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- 3. user_roles policies
CREATE POLICY "users can view their own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Tighten MEMBERS policies (staff-only)
DROP POLICY IF EXISTS members_select_all_auth ON public.members;
DROP POLICY IF EXISTS members_insert_all_auth ON public.members;
DROP POLICY IF EXISTS members_update_all_auth ON public.members;

CREATE POLICY "staff can view members"
  ON public.members FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "staff can insert members"
  ON public.members FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "staff can update members"
  ON public.members FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- 5. Tighten FOLLOW_UPS SELECT
DROP POLICY IF EXISTS fu_select_all_auth ON public.follow_ups;

CREATE POLICY "users view own follow-ups"
  ON public.follow_ups FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "staff view all follow-ups"
  ON public.follow_ups FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- 6. Tighten PROFILES SELECT (own + staff)
DROP POLICY IF EXISTS profiles_select_all_auth ON public.profiles;

CREATE POLICY "users view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "staff view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- 7. Seed existing users as staff so the app keeps working
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'staff'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- Promote the first user to admin too
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;
