-- Google members: one free rename; subsequent changes consume server-issued tickets.
BEGIN;

CREATE OR REPLACE FUNCTION public.nickname_key_v1(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$ SELECT pg_catalog.lower(pg_catalog.btrim(pg_catalog.normalize(p_name, 'NFKC'))) $$;

-- Fail without modifying existing names if legacy normalized duplicates exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles GROUP BY public.nickname_key_v1(nickname) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'nickname_duplicates_exist: resolve duplicate normalized names before applying this migration';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_key_v1 ON public.profiles(public.nickname_key_v1(nickname));

CREATE TABLE IF NOT EXISTS public.nickname_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  free_used boolean NOT NULL DEFAULT false,
  tickets integer NOT NULL DEFAULT 0 CHECK (tickets >= 0)
);
CREATE TABLE IF NOT EXISTS public.nickname_change_requests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  nickname text NOT NULL,
  cost text NOT NULL CHECK (cost IN ('free', 'ticket')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE TABLE IF NOT EXISTS public.nickname_ticket_grants (
  purchase_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nickname_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nickname_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nickname_ticket_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nickname_entitlements, public.nickname_change_requests, public.nickname_ticket_grants FROM PUBLIC, anon, authenticated;

-- Also covers deployments where an auth.users trigger creates the OAuth profile.
CREATE OR REPLACE FUNCTION public.initialize_google_nickname_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_candidate text; v_attempt integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM auth.identities WHERE user_id = NEW.id AND provider = 'google')
    OR EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.id AND (
      raw_app_meta_data->>'provider' = 'google' OR raw_app_meta_data->'providers' ? 'google'
    )) THEN
    FOR v_attempt IN 0..20 LOOP
      v_candidate := 'Player_' || substr(replace(CASE WHEN v_attempt = 0 THEN NEW.id::text ELSE gen_random_uuid()::text END, '-', ''), 1, 12);
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE public.nickname_key_v1(nickname) = public.nickname_key_v1(v_candidate)) THEN
        NEW.nickname := v_candidate; RETURN NEW;
      END IF;
    END LOOP;
    RAISE EXCEPTION 'nickname_generation_failed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS google_profile_nickname_v1 ON public.profiles;
CREATE TRIGGER google_profile_nickname_v1 BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.initialize_google_nickname_v1();

-- Keep legacy same-name upserts working, but disallow direct rename bypasses.
-- SECURITY INVOKER is intentional: only trusted definer RPCs/server roles may rename.
CREATE OR REPLACE FUNCTION public.guard_profile_nickname_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.nickname IS DISTINCT FROM OLD.nickname THEN
    IF current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'nickname_rpc_required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.nickname IS DISTINCT FROM OLD.nickname THEN
    NEW.nickname := pg_catalog.btrim(pg_catalog.normalize(NEW.nickname, 'NFKC'));
    IF NEW.nickname IS NULL OR char_length(NEW.nickname) NOT BETWEEN 2 AND 20
      OR NEW.nickname ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'nickname_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_profile_nickname_v1 ON public.profiles;
CREATE TRIGGER guard_profile_nickname_v1 BEFORE INSERT OR UPDATE OF nickname ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_nickname_v1();

CREATE OR REPLACE FUNCTION public.get_nickname_state_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_name text; v_free boolean; v_tickets integer;
BEGIN
  IF v_user IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT nickname INTO v_name FROM public.profiles WHERE id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_required'; END IF;
  SELECT NOT coalesce(e.free_used, false) AND EXISTS (
      SELECT 1 FROM auth.identities i WHERE i.user_id = v_user AND i.provider = 'google'
    ), coalesce(e.tickets, 0)
    INTO v_free, v_tickets FROM (SELECT v_user AS id) u
    LEFT JOIN public.nickname_entitlements e ON e.user_id = u.id;
  RETURN jsonb_build_object('nickname', v_name, 'free_available', v_free, 'tickets', v_tickets);
END $$;

CREATE OR REPLACE FUNCTION public.check_nickname_v1(p_nickname text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text := pg_catalog.btrim(pg_catalog.normalize(p_nickname, 'NFKC')); v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 2 AND 20 OR v_name ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id <> v_user AND public.nickname_key_v1(nickname) = public.nickname_key_v1(v_name)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'taken');
  END IF;
  RETURN jsonb_build_object('ok', true, 'nickname', v_name);
END $$;

CREATE OR REPLACE FUNCTION public.change_nickname_v1(p_nickname text, p_request_id uuid, p_expected_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_check jsonb; v_state jsonb; v_current text; v_name text;
  v_previous text; v_cost text;
BEGIN
  -- Authorization happens before creating/locking entitlement rows.
  PERFORM public.get_nickname_state_v1();
  IF p_expected_user_id IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  INSERT INTO public.nickname_entitlements(user_id) VALUES(v_user) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.nickname_entitlements WHERE user_id = v_user FOR UPDATE;
  SELECT nickname INTO v_current FROM public.profiles WHERE id = v_user FOR UPDATE;
  v_name := pg_catalog.btrim(pg_catalog.normalize(p_nickname, 'NFKC'));
  SELECT nickname INTO v_previous FROM public.nickname_change_requests WHERE user_id = v_user AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous IS DISTINCT FROM v_name THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
    RETURN public.get_nickname_state_v1() || jsonb_build_object('ok', true, 'replayed', true);
  END IF;
  IF v_name = v_current THEN
    RETURN public.get_nickname_state_v1() || jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  v_check := public.check_nickname_v1(p_nickname);
  IF NOT (v_check->>'ok')::boolean THEN RETURN v_check; END IF;
  v_state := public.get_nickname_state_v1();
  IF (v_state->>'free_available')::boolean THEN v_cost := 'free';
  ELSIF (v_state->>'tickets')::integer > 0 THEN v_cost := 'ticket';
  ELSE RETURN jsonb_build_object('ok', false, 'code', 'ticket_required'); END IF;
  BEGIN
    UPDATE public.profiles SET nickname = v_name, updated_at = now() WHERE id = v_user;
    UPDATE public.nickname_entitlements SET
      free_used = free_used OR v_cost = 'free',
      tickets = tickets - CASE WHEN v_cost = 'ticket' THEN 1 ELSE 0 END
      WHERE user_id = v_user;
    INSERT INTO public.nickname_change_requests(user_id, request_id, nickname, cost) VALUES(v_user, p_request_id, v_name, v_cost);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'taken');
  END;
  RETURN public.get_nickname_state_v1() || jsonb_build_object('ok', true, 'cost', v_cost);
END $$;

-- Future verified shop/payment backend calls this with a stable purchase/order ID.
-- Browsers cannot mint tickets. Repeating the same fulfilled purchase grants nothing twice.
CREATE OR REPLACE FUNCTION public.grant_nickname_change_ticket_v1(p_user_id uuid, p_purchase_id text, p_quantity integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.nickname_ticket_grants; v_inserted integer;
BEGIN
  IF p_purchase_id IS NULL OR char_length(btrim(p_purchase_id)) NOT BETWEEN 1 AND 200
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_purchase'; END IF;
  INSERT INTO public.nickname_ticket_grants(purchase_id, user_id, quantity)
    VALUES(p_purchase_id, p_user_id, p_quantity) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT * INTO v_existing FROM public.nickname_ticket_grants WHERE purchase_id = p_purchase_id;
    IF v_existing.user_id IS DISTINCT FROM p_user_id OR v_existing.quantity IS DISTINCT FROM p_quantity THEN
      RAISE EXCEPTION 'purchase_conflict';
    END IF;
  ELSE
    INSERT INTO public.nickname_entitlements(user_id, tickets) VALUES(p_user_id, p_quantity)
      ON CONFLICT(user_id) DO UPDATE SET tickets = public.nickname_entitlements.tickets + excluded.tickets;
  END IF;
  RETURN jsonb_build_object('ok', true, 'granted', v_inserted = 1);
END $$;

REVOKE ALL ON FUNCTION public.get_nickname_state_v1(), public.check_nickname_v1(text), public.change_nickname_v1(text,uuid,uuid), public.grant_nickname_change_ticket_v1(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_nickname_state_v1(), public.check_nickname_v1(text), public.change_nickname_v1(text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_nickname_change_ticket_v1(uuid,text,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'nickname_changes_ready' AS result;
