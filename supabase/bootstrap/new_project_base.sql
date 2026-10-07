-- Fresh development project only. This file is included by build-dev-setup.mjs.
-- Supabase owns auth.users/auth.uid/auth.jwt; never recreate those in Dashboard.
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
    OR to_regclass('public.match_history') IS NOT NULL
    OR to_regclass('public.friendships') IS NOT NULL
    OR to_regclass('public.account_progress') IS NOT NULL
    OR EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'Fresh development project required. Existing schema or users found; no changes applied.';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname varchar(30) UNIQUE NOT NULL,
  mmr integer NOT NULL DEFAULT 1200,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);
-- The following settlement migration supplies restricted profile column grants.

CREATE TABLE public.match_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  white_player_id uuid NOT NULL REFERENCES public.profiles(id),
  black_player_id uuid NOT NULL REFERENCES public.profiles(id),
  winner_id uuid REFERENCES public.profiles(id),
  white_mmr_change integer NOT NULL,
  black_mmr_change integer NOT NULL,
  played_at timestamptz NOT NULL DEFAULT now(),
  CHECK (white_player_id <> black_player_id),
  CHECK (winner_id IS NULL OR winner_id IN (white_player_id, black_player_id))
);
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.match_history TO authenticated;
CREATE POLICY "Participants read match history" ON public.match_history
  FOR SELECT TO authenticated USING (auth.uid() IN (white_player_id, black_player_id));

CREATE TABLE public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX friendships_pair_unique ON public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.friendships FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.friendships TO authenticated;
GRANT INSERT (requester_id, addressee_id, status) ON public.friendships TO authenticated;
GRANT UPDATE (status, updated_at) ON public.friendships TO authenticated;
CREATE POLICY "Participants read friendships" ON public.friendships
  FOR SELECT TO authenticated USING (auth.uid() IN (requester_id, addressee_id));
CREATE POLICY "Requester creates pending friendship" ON public.friendships
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id AND status = 'pending');
CREATE POLICY "Recipient accepts friendship" ON public.friendships
  FOR UPDATE TO authenticated USING (auth.uid() = addressee_id AND status = 'pending')
  WITH CHECK (auth.uid() = addressee_id AND status = 'accepted');
CREATE POLICY "Participants delete friendships" ON public.friendships
  FOR DELETE TO authenticated USING (auth.uid() IN (requester_id, addressee_id));
