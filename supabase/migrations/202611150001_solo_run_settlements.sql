BEGIN;

-- A receipt is scoped to one authenticated owner. The progress row lock also
-- serializes this delta with every account-progress CAS save and tutorial grant.
CREATE TABLE public.solo_run_settlements (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settlement_id text NOT NULL,
  run_id text NOT NULL,
  rules_version text NOT NULL,
  start_stage integer NOT NULL,
  last_cleared_stage integer NOT NULL,
  payout integer NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, settlement_id),
  UNIQUE (user_id, run_id),
  CHECK (rules_version = 'itch-retry-v1'),
  CHECK (start_stage BETWEEN 1 AND 10),
  CHECK (last_cleared_stage BETWEEN start_stage - 1 AND 10),
  CHECK (payout BETWEEN 0 AND 55)
);
ALTER TABLE public.solo_run_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.solo_run_settlements FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.lookup_solo_run_settlement(p_expected_user_id uuid, p_settlement_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  v_payout integer;
  current_data jsonb;
  current_revision bigint;
BEGIN
  IF caller IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
     OR p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_settlement_id IS NULL OR p_settlement_id !~ '^solo-v1:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$' THEN
    RAISE EXCEPTION 'Invalid settlement ID' USING ERRCODE = '22023';
  END IF;
  SELECT payout INTO v_payout FROM public.solo_run_settlements
  WHERE user_id = caller AND settlement_id = p_settlement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unpaid'); END IF;
  SELECT data, revision INTO current_data, current_revision
  FROM public.account_progress WHERE user_id = caller;
  RETURN jsonb_build_object('status', 'paid', 'payout', v_payout,
    'data', current_data, 'revision', current_revision);
END;
$$;

CREATE FUNCTION public.settle_solo_run(
  p_expected_user_id uuid, p_settlement_id text, p_run_id text,
  p_rules_version text, p_start_stage integer, p_last_cleared_stage integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  current_data jsonb;
  current_revision bigint;
  current_points numeric;
  v_payout integer;
  existing public.solo_run_settlements%ROWTYPE;
BEGIN
  IF caller IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
     OR p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Authenticated account required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_run_id !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$'
     OR p_settlement_id IS DISTINCT FROM 'solo-v1:' || p_run_id
     OR p_rules_version IS DISTINCT FROM 'itch-retry-v1'
     OR p_start_stage IS NULL OR p_start_stage NOT BETWEEN 1 AND 10
     OR p_last_cleared_stage IS NULL OR p_last_cleared_stage NOT BETWEEN p_start_stage - 1 AND 10 THEN
    RAISE EXCEPTION 'Invalid solo settlement' USING ERRCODE = '22023';
  END IF;
  v_payout := (p_last_cleared_stage * (p_last_cleared_stage + 1)
    - (p_start_stage - 1) * p_start_stage) / 2;

  SELECT data, revision INTO current_data, current_revision
  FROM public.account_progress WHERE user_id = caller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save account progress before settlement' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO existing FROM public.solo_run_settlements
  WHERE user_id = caller AND settlement_id = p_settlement_id;
  IF FOUND THEN
    IF existing.run_id IS DISTINCT FROM p_run_id
       OR existing.rules_version IS DISTINCT FROM p_rules_version
       OR existing.start_stage IS DISTINCT FROM p_start_stage
       OR existing.last_cleared_stage IS DISTINCT FROM p_last_cleared_stage THEN
      RETURN jsonb_build_object('status', 'conflict');
    END IF;
    RETURN jsonb_build_object('status', 'paid', 'payout', existing.payout,
      'data', current_data, 'revision', current_revision);
  END IF;
  IF NOT (current_data ? 'chessAlkkagi.meta.points' AND current_data ? 'chessAlkkagi.meta.upgrades') THEN
    RAISE EXCEPTION 'Save complete research state before settlement' USING ERRCODE = '40001';
  END IF;
  current_points := (current_data->>'chessAlkkagi.meta.points')::numeric;
  IF current_points < 0 OR current_points + v_payout > 9007199254740991 THEN
    RAISE EXCEPTION 'Point balance exceeds safe range' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.solo_run_settlements
    (user_id, settlement_id, run_id, rules_version, start_stage, last_cleared_stage, payout)
  VALUES (caller, p_settlement_id, p_run_id, p_rules_version,
    p_start_stage, p_last_cleared_stage, v_payout);
  current_data := jsonb_set(current_data, ARRAY['chessAlkkagi.meta.points'],
    to_jsonb((current_points + v_payout)::text));
  UPDATE public.account_progress SET data = current_data, revision = revision + 1, updated_at = now()
  WHERE user_id = caller RETURNING revision INTO current_revision;
  RETURN jsonb_build_object('status', 'paid', 'payout', v_payout,
    'data', current_data, 'revision', current_revision);
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_solo_run_settlement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_solo_run(uuid, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_solo_run_settlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_solo_run(uuid, text, text, text, integer, integer) TO authenticated;
COMMIT;
