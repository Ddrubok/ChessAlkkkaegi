BEGIN;

-- A grant is independent of the client-authored progress snapshot. Existing
-- completion=true is grandfathered as already rewarded without changing points.
CREATE TABLE public.tutorial_reward_grants (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tutorial_type text NOT NULL CHECK (tutorial_type IN ('basic', 'advanced')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutorial_type)
);
ALTER TABLE public.tutorial_reward_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tutorial_reward_grants FROM PUBLIC, anon, authenticated;
INSERT INTO public.tutorial_reward_grants(user_id, tutorial_type)
SELECT user_id, 'basic' FROM public.account_progress WHERE data->>'has_completed_tutorial' = 'true'
UNION ALL
SELECT user_id, 'advanced' FROM public.account_progress WHERE data->>'has_completed_adv_tutorial' = 'true';

CREATE FUNCTION public.claim_tutorial_first_reward(p_expected_user_id uuid, p_tutorial_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  completion_key text;
  current_data jsonb;
  current_revision bigint;
  current_points bigint;
  granted boolean := false;
BEGIN
  IF caller IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
     OR p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_tutorial_type NOT IN ('basic', 'advanced') OR p_tutorial_type IS NULL THEN
    RAISE EXCEPTION 'Invalid tutorial type' USING ERRCODE = '22023';
  END IF;
  completion_key := CASE p_tutorial_type WHEN 'basic' THEN 'has_completed_tutorial' ELSE 'has_completed_adv_tutorial' END;

  -- The ordinary save must create the account row first. This row lock serializes
  -- claims with CAS saves; the unique grant key serializes duplicate claims.
  SELECT data, revision INTO current_data, current_revision
  FROM public.account_progress WHERE user_id = caller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save account progress before claiming tutorial reward' USING ERRCODE = '40001';
  END IF;
  IF current_data->>completion_key = 'true' THEN
    INSERT INTO public.tutorial_reward_grants(user_id, tutorial_type)
    VALUES (caller, p_tutorial_type) ON CONFLICT DO NOTHING;
  ELSIF NOT EXISTS (SELECT 1 FROM public.tutorial_reward_grants WHERE user_id = caller AND tutorial_type = p_tutorial_type) THEN
    IF NOT (current_data ? 'chessAlkkagi.meta.points' AND current_data ? 'chessAlkkagi.meta.upgrades') THEN
      RAISE EXCEPTION 'Save complete research state before claiming tutorial reward' USING ERRCODE = '40001';
    END IF;
    current_points := coalesce((current_data->>'chessAlkkagi.meta.points')::bigint, 0);
    IF current_points > 9007199254740891 THEN
      RAISE EXCEPTION 'Point balance exceeds safe reward range' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.tutorial_reward_grants(user_id, tutorial_type) VALUES (caller, p_tutorial_type);
    current_data := jsonb_set(jsonb_set(current_data, ARRAY['chessAlkkagi.meta.points'], to_jsonb((current_points + 100)::text)), ARRAY[completion_key], '"true"'::jsonb);
    UPDATE public.account_progress SET data = current_data, revision = revision + 1, updated_at = now()
    WHERE user_id = caller RETURNING revision INTO current_revision;
    granted := true;
  END IF;
  RETURN jsonb_build_object('granted', granted, 'data', current_data, 'revision', current_revision);
END;
$$;

-- A stale/older save may not clear a completion recorded by the grant RPC.
CREATE FUNCTION public._preserve_tutorial_reward_completions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tutorial_reward_grants WHERE user_id = NEW.user_id AND tutorial_type = 'basic') THEN
    NEW.data := jsonb_set(NEW.data, ARRAY['has_completed_tutorial'], '"true"'::jsonb);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tutorial_reward_grants WHERE user_id = NEW.user_id AND tutorial_type = 'advanced') THEN
    NEW.data := jsonb_set(NEW.data, ARRAY['has_completed_adv_tutorial'], '"true"'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_tutorial_reward_completions
  BEFORE INSERT OR UPDATE ON public.account_progress
  FOR EACH ROW EXECUTE FUNCTION public._preserve_tutorial_reward_completions();

REVOKE ALL ON FUNCTION public._preserve_tutorial_reward_completions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_tutorial_first_reward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_tutorial_first_reward(uuid, text) TO authenticated;
COMMIT;
