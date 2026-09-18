-- Profile Cosmetics account-progress capability (cosmetics-v1).
-- Extends mastery/banner preferences with 6 equipped slots:
-- banner, frame, badge, badgeFrame, title, titleFrame.
-- Introduces member implicit defaults (frame:classic-gold, title:challenger, badgeFrame/titleFrame prefixes)
-- and get_player_cosmetics public RPC.
-- Retains source and storage compatibility for v1, v2, and v3 clients.

BEGIN;

CREATE OR REPLACE FUNCTION public._validate_mastery_preferences_v4(
  p_serialized text,
  p_rewards_serialized text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  root jsonb;
  tracked jsonb;
  equipped jsonb;
  slot_name text;
  slot_value jsonb;
  item_id text;
  rewards jsonb;
BEGIN
  IF p_serialized IS NULL OR octet_length(p_serialized) > 4096 THEN
    RAISE EXCEPTION 'ca_mastery_preferences_v1 exceeds its 4096-byte limit' USING ERRCODE = '22023';
  END IF;

  BEGIN
    root := p_serialized::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid JSON format for ca_mastery_preferences_v1' USING ERRCODE = '22023';
  END;

  IF NOT public._account_progress_has_only_keys(root, ARRAY['schemaVersion','tracked','equipped'])
     OR NOT (root ?& ARRAY['schemaVersion','tracked','equipped'])
     OR root->'schemaVersion' <> '1'::jsonb
     OR jsonb_typeof(root->'tracked') <> 'object'
     OR jsonb_typeof(root->'equipped') <> 'object' THEN
    RAISE EXCEPTION 'Invalid ca_mastery_preferences_v1 envelope' USING ERRCODE = '22023';
  END IF;

  tracked := root->'tracked';
  IF NOT public._account_progress_has_only_keys(tracked, ARRAY['medalId','updatedAt','deviceId'])
     OR NOT (tracked ?& ARRAY['medalId','updatedAt','deviceId'])
     OR jsonb_typeof(tracked->'medalId') NOT IN ('string','null')
     OR (jsonb_typeof(tracked->'medalId') = 'string'
         AND tracked->>'medalId' NOT IN ('M01','M02','M03','M04','M05','M06','M07','M08'))
     OR NOT public._account_progress_is_iso_utc(tracked->>'updatedAt')
     OR NOT public._account_progress_is_identifier(tracked->>'deviceId') THEN
    RAISE EXCEPTION 'Invalid tracked mastery preference' USING ERRCODE = '22023';
  END IF;

  equipped := root->'equipped';
  IF NOT public._account_progress_has_only_keys(equipped, ARRAY['badge','title','frame','banner','badgeFrame','titleFrame']) THEN
    RAISE EXCEPTION 'Invalid equipped mastery preference slots' USING ERRCODE = '22023';
  END IF;

  IF p_rewards_serialized IS NOT NULL THEN
    BEGIN
      rewards := p_rewards_serialized::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Cannot validate equipment against malformed mastery rewards' USING ERRCODE = '22023';
    END;
  END IF;

  FOR slot_name, slot_value IN SELECT * FROM jsonb_each(equipped)
  LOOP
    IF NOT public._account_progress_has_only_keys(slot_value, ARRAY['itemId','updatedAt','deviceId'])
       OR NOT (slot_value ?& ARRAY['itemId','updatedAt','deviceId'])
       OR jsonb_typeof(slot_value->'itemId') NOT IN ('string','null')
       OR NOT public._account_progress_is_iso_utc(slot_value->>'updatedAt')
       OR NOT public._account_progress_is_identifier(slot_value->>'deviceId') THEN
      RAISE EXCEPTION 'Invalid equipped mastery preference: %', slot_name USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(slot_value->'itemId') = 'string' THEN
      item_id := slot_value->>'itemId';
      IF NOT public._account_progress_is_identifier(item_id) THEN
        RAISE EXCEPTION 'Invalid item ID format in equipped mastery slot: %', slot_name USING ERRCODE = '22023';
      END IF;

      IF slot_name = 'badge' THEN
        IF item_id !~ '^badge:mastery-m0[1-8]$' OR rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
          RAISE EXCEPTION 'Unowned or invalid badge item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
      ELSIF slot_name = 'title' THEN
        IF item_id NOT IN ('title:challenger', 'title:explorer') THEN
          RAISE EXCEPTION 'Invalid title item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
        -- title:challenger is member default implicit.
        -- title:explorer requires milestone reward grant.
        IF item_id = 'title:explorer' THEN
          IF rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
            RAISE EXCEPTION 'Unowned explorer title equipped: %', item_id USING ERRCODE = '22023';
          END IF;
        END IF;
      ELSIF slot_name = 'frame' THEN
        IF item_id NOT IN ('frame:classic-gold', 'frame:mastery-complete') THEN
          RAISE EXCEPTION 'Invalid frame item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
        -- frame:classic-gold is member default implicit.
        -- frame:mastery-complete requires mastery complete reward grant.
        IF item_id = 'frame:mastery-complete' THEN
          IF rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
            RAISE EXCEPTION 'Unowned mastery complete frame equipped: %', item_id USING ERRCODE = '22023';
          END IF;
        END IF;
      ELSIF slot_name = 'banner' THEN
        IF item_id NOT IN ('banner:classic', 'banner:slate', 'banner:forest', 'banner:banner_cosmic_knight', 'banner:banner_crimson_sun', 'banner:banner_hidden_myeongnyang') THEN
          RAISE EXCEPTION 'Invalid banner item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
        -- Basic banners (classic, slate, forest) are member default implicit.
        -- Achievement banners require reward grant ownership.
        IF item_id IN ('banner:banner_cosmic_knight', 'banner:banner_crimson_sun', 'banner:banner_hidden_myeongnyang') THEN
          IF rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
            RAISE EXCEPTION 'Unowned achievement banner equipped: %', item_id USING ERRCODE = '22023';
          END IF;
        END IF;
      ELSIF slot_name = 'badgeFrame' THEN
        IF item_id NOT IN ('badgeFrame:gold', 'badgeFrame:silver', 'badgeFrame:violet') THEN
          RAISE EXCEPTION 'Invalid badgeFrame item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
      ELSIF slot_name = 'titleFrame' THEN
        IF item_id NOT IN ('titleFrame:gold', 'titleFrame:silver', 'titleFrame:violet') THEN
          RAISE EXCEPTION 'Invalid titleFrame item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
      ELSE
        RAISE EXCEPTION 'Unknown equipped mastery slot: %', slot_name USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_account_progress_v4(p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  k text;
  v jsonb;
  legacy_data jsonb := '{}'::jsonb;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_data::text) > 262144 THEN
    RAISE EXCEPTION 'Progress payload exceeds maximum allowed size of 262144 bytes' USING ERRCODE = '22023';
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(p_data)
  LOOP
    IF k IN ('ca_mastery_progress_v1','ca_mastery_rewards_v1','ca_mastery_preferences_v1') THEN
      IF jsonb_typeof(v) <> 'string' THEN
        RAISE EXCEPTION 'All progress snapshot values must be strings: %', k USING ERRCODE = '22023';
      END IF;
    ELSE
      legacy_data := legacy_data || jsonb_build_object(k, v);
    END IF;
  END LOOP;

  PERFORM public._validate_account_progress_legacy(legacy_data);

  IF p_data ? 'ca_mastery_progress_v1' THEN
    PERFORM public._validate_mastery_progress_v3(p_data->>'ca_mastery_progress_v1');
  END IF;
  IF p_data ? 'ca_mastery_rewards_v1' THEN
    PERFORM public._validate_mastery_rewards_v3(p_data->>'ca_mastery_rewards_v1');
  END IF;
  IF p_data ? 'ca_mastery_preferences_v1' THEN
    PERFORM public._validate_mastery_preferences_v4(
      p_data->>'ca_mastery_preferences_v1',
      p_data->>'ca_mastery_rewards_v1'
    );
  END IF;
  -- A grant must agree with the stored achievement evidence, not merely its item ID.
  IF coalesce((p_data->>'ca_mastery_rewards_v1')::jsonb->'items', '{}'::jsonb) ? 'banner:banner_cosmic_knight'
     AND (SELECT count(*) FROM jsonb_object_keys(coalesce((p_data->>'ca_mastery_progress_v1')::jsonb #> '{banners,banner_cosmic_knight,fallenEnemies}', '{}'::jsonb))) < 50 THEN
    RAISE EXCEPTION 'Banner reward without knight progress' USING ERRCODE = '22023';
  END IF;
  IF coalesce((p_data->>'ca_mastery_rewards_v1')::jsonb->'items', '{}'::jsonb) ? 'banner:banner_crimson_sun'
     AND coalesce(((p_data->>'ca_mastery_progress_v1')::jsonb #>> '{banners,banner_crimson_sun,bestTripleOut,fallCount}')::integer, 0) < 3 THEN
    RAISE EXCEPTION 'Banner reward without triple-out progress' USING ERRCODE = '22023';
  END IF;
  IF coalesce((p_data->>'ca_mastery_rewards_v1')::jsonb->'items', '{}'::jsonb) ? 'banner:banner_hidden_myeongnyang'
     AND (SELECT count(*) FROM jsonb_object_keys(coalesce((p_data->>'ca_mastery_progress_v1')::jsonb #> '{banners,banner_hidden_myeongnyang,eventIds}', '{}'::jsonb))) < 1 THEN
    RAISE EXCEPTION 'Banner reward without comeback progress' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Helpers to project stored data for v3 clients (removes badgeFrame/titleFrame, nullifies frame:classic-gold & title:challenger)
CREATE OR REPLACE FUNCTION public._project_account_data_v3(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  result jsonb := p_data;
  pref jsonb;
  equipped jsonb;
  v jsonb;
BEGIN
  IF result ? 'ca_mastery_preferences_v1' THEN
    BEGIN
      pref := (result->>'ca_mastery_preferences_v1')::jsonb;
      IF pref ? 'equipped' AND jsonb_typeof(pref->'equipped') = 'object' THEN
        equipped := pref->'equipped';
        equipped := equipped - 'badgeFrame' - 'titleFrame';

        IF equipped ? 'frame' AND (equipped->'frame'->>'itemId' = 'frame:classic-gold') THEN
          v := equipped->'frame';
          v := jsonb_set(v, ARRAY['itemId'], 'null'::jsonb, false);
          equipped := jsonb_set(equipped, ARRAY['frame'], v, false);
        END IF;

        IF equipped ? 'title' AND (equipped->'title'->>'itemId' = 'title:challenger') THEN
          v := equipped->'title';
          v := jsonb_set(v, ARRAY['itemId'], 'null'::jsonb, false);
          equipped := jsonb_set(equipped, ARRAY['title'], v, false);
        END IF;

        pref := pref || jsonb_build_object('equipped', equipped);
        result := result || jsonb_build_object('ca_mastery_preferences_v1', pref::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  RETURN result;
END;
$$;

-- Helpers to project stored data for v2 legacy clients (chains v3 projection, then strips banner domain)
CREATE OR REPLACE FUNCTION public._project_account_data_v2(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  result jsonb := p_data;
  prog jsonb;
  rew jsonb;
  pref jsonb;
  grants jsonb := '{}'::jsonb;
  items jsonb := '{}'::jsonb;
  k text;
  v jsonb;
BEGIN
  result := public._project_account_data_v3(result);

  IF result ? 'ca_mastery_progress_v1' THEN
    BEGIN
      prog := (result->>'ca_mastery_progress_v1')::jsonb;
      IF prog ? 'banners' THEN
        prog := prog - 'banners';
        result := result || jsonb_build_object('ca_mastery_progress_v1', prog::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  IF result ? 'ca_mastery_rewards_v1' THEN
    BEGIN
      rew := (result->>'ca_mastery_rewards_v1')::jsonb;
      IF rew ? 'grants' AND jsonb_typeof(rew->'grants') = 'object' THEN
        FOR k, v IN SELECT * FROM jsonb_each(rew->'grants')
        LOOP
          IF NOT (k LIKE 'banner:%') THEN
            grants := grants || jsonb_build_object(k, v);
          END IF;
        END LOOP;
        rew := rew || jsonb_build_object('grants', grants);
      END IF;
      IF rew ? 'items' AND jsonb_typeof(rew->'items') = 'object' THEN
        FOR k, v IN SELECT * FROM jsonb_each(rew->'items')
        LOOP
          IF NOT (k LIKE 'banner:%') THEN
            items := items || jsonb_build_object(k, v);
          END IF;
        END LOOP;
        rew := rew || jsonb_build_object('items', items);
      END IF;
      result := result || jsonb_build_object('ca_mastery_rewards_v1', rew::text);
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  IF result ? 'ca_mastery_preferences_v1' THEN
    BEGIN
      pref := (result->>'ca_mastery_preferences_v1')::jsonb;
      IF pref ? 'equipped' AND jsonb_typeof(pref->'equipped') = 'object' AND (pref->'equipped' ? 'banner') THEN
        pref := pref || jsonb_build_object('equipped', (pref->'equipped') - 'banner');
        result := result || jsonb_build_object('ca_mastery_preferences_v1', pref::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  RETURN result;
END;
$$;

-- Update legacy v1 save to preserve all v2, v3, and v4 mastery/banner/cosmetics keys
CREATE OR REPLACE FUNCTION public.save_account_progress(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_result_data jsonb;
  v_result_rev bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;

  PERFORM public._validate_account_progress_legacy(p_data);

  IF p_expected_revision = 0 THEN
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, p_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.account_progress
    SET data = p_data || jsonb_strip_nulls(jsonb_build_object(
          'ca_mastery_progress_v1', data->'ca_mastery_progress_v1',
          'ca_mastery_rewards_v1', data->'ca_mastery_rewards_v1',
          'ca_mastery_preferences_v1', data->'ca_mastery_preferences_v1'
        )),
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
    IF octet_length(v_result_data::text) > 262144 THEN
      RAISE EXCEPTION 'Progress payload exceeds maximum allowed size of 262144 bytes after preserving mastery data' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', v_result_data - ARRAY['ca_mastery_progress_v1','ca_mastery_rewards_v1','ca_mastery_preferences_v1'],
    'revision', v_result_rev
  );
END;
$$;

-- Update get_account_progress_v2 to project data into v2 format without unknown banner/cosmetics keys
CREATE OR REPLACE FUNCTION public.get_account_progress_v2(
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_data jsonb;
  v_revision bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may access account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'mastery-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;

  SELECT data, revision INTO v_data, v_revision
  FROM public.account_progress
  WHERE user_id = caller;

  IF NOT FOUND THEN
    v_data := '{}'::jsonb;
    v_revision := 0;
  END IF;

  RETURN jsonb_build_object(
    'data', public._project_account_data_v2(v_data),
    'revision', v_revision,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1')
  );
END;
$$;

-- Update save_account_progress_v2 to validate v2 data and preserve banner & cosmetic extensions
CREATE OR REPLACE FUNCTION public.save_account_progress_v2(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_existing_data jsonb;
  v_existing_rev bigint;
  v_effective_data jsonb;
  v_result_data jsonb;
  v_result_rev bigint;
  v_curr_prog jsonb;
  v_exist_prog jsonb;
  v_curr_rew jsonb;
  v_exist_rew jsonb;
  v_curr_pref jsonb;
  v_exist_pref jsonb;
  k text;
  v jsonb;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'mastery-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;

  PERFORM public._validate_account_progress_v2(p_data);

  IF p_expected_revision = 0 THEN
    v_effective_data := p_data;
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, v_effective_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    SELECT data, revision INTO v_existing_data, v_existing_rev
    FROM public.account_progress
    WHERE user_id = caller
    FOR UPDATE;

    IF NOT FOUND OR v_existing_rev <> p_expected_revision THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;

    v_effective_data := p_data;

    -- Preserve banners in ca_mastery_progress_v1
    IF v_existing_data ? 'ca_mastery_progress_v1' THEN
      BEGIN
        v_exist_prog := (v_existing_data->>'ca_mastery_progress_v1')::jsonb;
        IF v_exist_prog ? 'banners' THEN
          IF v_effective_data ? 'ca_mastery_progress_v1' THEN
            v_curr_prog := (v_effective_data->>'ca_mastery_progress_v1')::jsonb;
            v_curr_prog := v_curr_prog || jsonb_build_object('banners', v_exist_prog->'banners');
            v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_progress_v1', v_curr_prog::text);
          ELSE
            v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_progress_v1', v_existing_data->>'ca_mastery_progress_v1');
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
      END;
    END IF;

    -- Preserve banner grants/items in ca_mastery_rewards_v1
    IF v_existing_data ? 'ca_mastery_rewards_v1' THEN
      BEGIN
        v_exist_rew := (v_existing_data->>'ca_mastery_rewards_v1')::jsonb;
        IF v_effective_data ? 'ca_mastery_rewards_v1' THEN
          v_curr_rew := (v_effective_data->>'ca_mastery_rewards_v1')::jsonb;
          IF v_exist_rew ? 'grants' AND jsonb_typeof(v_exist_rew->'grants') = 'object' THEN
            FOR k, v IN SELECT * FROM jsonb_each(v_exist_rew->'grants')
            LOOP
              IF k LIKE 'banner:%' THEN
                v_curr_rew := jsonb_set(v_curr_rew, ARRAY['grants', k], v, true);
              END IF;
            END LOOP;
          END IF;
          IF v_exist_rew ? 'items' AND jsonb_typeof(v_exist_rew->'items') = 'object' THEN
            FOR k, v IN SELECT * FROM jsonb_each(v_exist_rew->'items')
            LOOP
              IF k LIKE 'banner:%' THEN
                v_curr_rew := jsonb_set(v_curr_rew, ARRAY['items', k], v, true);
              END IF;
            END LOOP;
          END IF;
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_rewards_v1', v_curr_rew::text);
        ELSE
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_rewards_v1', v_existing_data->>'ca_mastery_rewards_v1');
        END IF;
      EXCEPTION WHEN OTHERS THEN
      END;
    END IF;

    -- Preserve banner, badgeFrame, titleFrame, and basic frame/title in ca_mastery_preferences_v1
    IF v_existing_data ? 'ca_mastery_preferences_v1' THEN
      BEGIN
        v_exist_pref := (v_existing_data->>'ca_mastery_preferences_v1')::jsonb;
        IF v_effective_data ? 'ca_mastery_preferences_v1' THEN
          v_curr_pref := (v_effective_data->>'ca_mastery_preferences_v1')::jsonb;
          IF v_exist_pref ? 'equipped' AND jsonb_typeof(v_exist_pref->'equipped') = 'object' THEN
            IF v_exist_pref->'equipped' ? 'banner' THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'banner'], v_exist_pref->'equipped'->'banner', true);
            END IF;
            IF v_exist_pref->'equipped' ? 'badgeFrame' THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'badgeFrame'], v_exist_pref->'equipped'->'badgeFrame', true);
            END IF;
            IF v_exist_pref->'equipped' ? 'titleFrame' THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'titleFrame'], v_exist_pref->'equipped'->'titleFrame', true);
            END IF;
            IF (v_exist_pref->'equipped'->'frame'->>'itemId' = 'frame:classic-gold')
               AND (v_curr_pref->'equipped'->'frame'->>'itemId' IS NULL) THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'frame'], v_exist_pref->'equipped'->'frame', true);
            END IF;
            IF (v_exist_pref->'equipped'->'title'->>'itemId' = 'title:challenger')
               AND (v_curr_pref->'equipped'->'title'->>'itemId' IS NULL) THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'title'], v_exist_pref->'equipped'->'title', true);
            END IF;
          END IF;
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_curr_pref::text);
        ELSE
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_existing_data->>'ca_mastery_preferences_v1');
        END IF;
      EXCEPTION WHEN OTHERS THEN
      END;
    END IF;

    -- If a domain was completely absent in v2 submission, retain full domain
    IF NOT (v_effective_data ? 'ca_mastery_progress_v1') AND (v_existing_data ? 'ca_mastery_progress_v1') THEN
      v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_progress_v1', v_existing_data->'ca_mastery_progress_v1');
    END IF;
    IF NOT (v_effective_data ? 'ca_mastery_rewards_v1') AND (v_existing_data ? 'ca_mastery_rewards_v1') THEN
      v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_rewards_v1', v_existing_data->'ca_mastery_rewards_v1');
    END IF;
    IF NOT (v_effective_data ? 'ca_mastery_preferences_v1') AND (v_existing_data ? 'ca_mastery_preferences_v1') THEN
      v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_existing_data->'ca_mastery_preferences_v1');
    END IF;

    PERFORM public._validate_account_progress_v4(v_effective_data);

    UPDATE public.account_progress
    SET data = v_effective_data,
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', public._project_account_data_v2(v_result_data),
    'revision', v_result_rev,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1')
  );
END;
$$;

-- Update get_account_progress_v3 to project data into v3 format without cosmetics extensions
CREATE OR REPLACE FUNCTION public.get_account_progress_v3(
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_data jsonb;
  v_revision bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may access account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'banners-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;

  SELECT data, revision INTO v_data, v_revision
  FROM public.account_progress
  WHERE user_id = caller;

  IF NOT FOUND THEN
    v_data := '{}'::jsonb;
    v_revision := 0;
  END IF;

  RETURN jsonb_build_object(
    'data', public._project_account_data_v3(v_data),
    'revision', v_revision,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1','banners-v1')
  );
END;
$$;

-- Update save_account_progress_v3 to validate v3 data and preserve cosmetics extensions
CREATE OR REPLACE FUNCTION public.save_account_progress_v3(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_existing_data jsonb;
  v_existing_rev bigint;
  v_effective_data jsonb;
  v_result_data jsonb;
  v_result_rev bigint;
  v_curr_pref jsonb;
  v_exist_pref jsonb;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'banners-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision = 0 THEN
    v_effective_data := p_data;
    PERFORM public._validate_account_progress_v3(v_effective_data);
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, v_effective_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    SELECT data, revision INTO v_existing_data, v_existing_rev
    FROM public.account_progress
    WHERE user_id = caller
    FOR UPDATE;

    IF NOT FOUND OR v_existing_rev <> p_expected_revision THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;

    -- Missing mastery/banner fields mean "preserve" during save
    v_effective_data := p_data || jsonb_strip_nulls(jsonb_build_object(
      'ca_mastery_progress_v1', CASE WHEN p_data ? 'ca_mastery_progress_v1' THEN NULL ELSE v_existing_data->'ca_mastery_progress_v1' END,
      'ca_mastery_rewards_v1', CASE WHEN p_data ? 'ca_mastery_rewards_v1' THEN NULL ELSE v_existing_data->'ca_mastery_rewards_v1' END,
      'ca_mastery_preferences_v1', CASE WHEN p_data ? 'ca_mastery_preferences_v1' THEN NULL ELSE v_existing_data->'ca_mastery_preferences_v1' END
    ));

    -- If preferences was submitted in v3 format, validate as v3 then preserve cosmetics extensions from existing row
    IF p_data ? 'ca_mastery_preferences_v1' THEN
      PERFORM public._validate_account_progress_v3(p_data);
      IF v_existing_data ? 'ca_mastery_preferences_v1' THEN
        BEGIN
          v_exist_pref := (v_existing_data->>'ca_mastery_preferences_v1')::jsonb;
          v_curr_pref := (v_effective_data->>'ca_mastery_preferences_v1')::jsonb;
          IF v_exist_pref ? 'equipped' AND jsonb_typeof(v_exist_pref->'equipped') = 'object' THEN
            IF v_exist_pref->'equipped' ? 'badgeFrame' AND NOT (v_curr_pref->'equipped' ? 'badgeFrame') THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'badgeFrame'], v_exist_pref->'equipped'->'badgeFrame', true);
            END IF;
            IF v_exist_pref->'equipped' ? 'titleFrame' AND NOT (v_curr_pref->'equipped' ? 'titleFrame') THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'titleFrame'], v_exist_pref->'equipped'->'titleFrame', true);
            END IF;
            IF (v_exist_pref->'equipped'->'frame'->>'itemId' = 'frame:classic-gold')
               AND (v_curr_pref->'equipped'->'frame'->>'itemId' IS NULL) THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'frame'], v_exist_pref->'equipped'->'frame', true);
            END IF;
            IF (v_exist_pref->'equipped'->'title'->>'itemId' = 'title:challenger')
               AND (v_curr_pref->'equipped'->'title'->>'itemId' IS NULL) THEN
              v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'title'], v_exist_pref->'equipped'->'title', true);
            END IF;
          END IF;
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_curr_pref::text);
        EXCEPTION WHEN OTHERS THEN
        END;
      END IF;
    END IF;

    PERFORM public._validate_account_progress_v4(v_effective_data);
    UPDATE public.account_progress
    SET data = v_effective_data,
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', public._project_account_data_v3(v_result_data),
    'revision', v_result_rev,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1','banners-v1')
  );
END;
$$;

-- New v4 read RPC with cosmetics-v1 capability
CREATE OR REPLACE FUNCTION public.get_account_progress_v4(
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_data jsonb;
  v_revision bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may access account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'cosmetics-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;

  SELECT data, revision INTO v_data, v_revision
  FROM public.account_progress
  WHERE user_id = caller;

  IF NOT FOUND THEN
    v_data := '{}'::jsonb;
    v_revision := 0;
  END IF;

  RETURN jsonb_build_object(
    'data', v_data,
    'revision', v_revision,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1','banners-v1','cosmetics-v1')
  );
END;
$$;

-- New v4 write RPC with cosmetics-v1 capability
CREATE OR REPLACE FUNCTION public.save_account_progress_v4(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_existing_data jsonb;
  v_existing_rev bigint;
  v_effective_data jsonb;
  v_result_data jsonb;
  v_result_rev bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'cosmetics-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision = 0 THEN
    v_effective_data := p_data;
    PERFORM public._validate_account_progress_v4(v_effective_data);
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, v_effective_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    SELECT data, revision INTO v_existing_data, v_existing_rev
    FROM public.account_progress
    WHERE user_id = caller
    FOR UPDATE;

    IF NOT FOUND OR v_existing_rev <> p_expected_revision THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;

    -- Missing mastery/banner/cosmetic fields mean "preserve" during save
    v_effective_data := p_data || jsonb_strip_nulls(jsonb_build_object(
      'ca_mastery_progress_v1', CASE WHEN p_data ? 'ca_mastery_progress_v1' THEN NULL ELSE v_existing_data->'ca_mastery_progress_v1' END,
      'ca_mastery_rewards_v1', CASE WHEN p_data ? 'ca_mastery_rewards_v1' THEN NULL ELSE v_existing_data->'ca_mastery_rewards_v1' END,
      'ca_mastery_preferences_v1', CASE WHEN p_data ? 'ca_mastery_preferences_v1' THEN NULL ELSE v_existing_data->'ca_mastery_preferences_v1' END
    ));

    PERFORM public._validate_account_progress_v4(v_effective_data);
    UPDATE public.account_progress
    SET data = v_effective_data,
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', v_result_data,
    'revision', v_result_rev,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1','banners-v1','cosmetics-v1')
  );
END;
$$;

-- Public RPC to look up another player's equipped and verified 6-slot cosmetics
CREATE OR REPLACE FUNCTION public.get_player_cosmetics(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_data jsonb;
  v_pref jsonb;
  v_rew jsonb;
  v_raw text;
  v_banner text := 'classic';
  v_frame text := null;
  v_badge text := null;
  v_badge_frame text := null;
  v_title text := null;
  v_title_frame text := null;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may query player cosmetics' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'banner', 'classic',
      'frame', null,
      'badge', null,
      'badgeFrame', null,
      'title', null,
      'titleFrame', null
    );
  END IF;

  SELECT data INTO v_data
  FROM public.account_progress
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_data IS NULL THEN
    RETURN jsonb_build_object(
      'banner', 'classic',
      'frame', null,
      'badge', null,
      'badgeFrame', null,
      'title', null,
      'titleFrame', null
    );
  END IF;

  IF v_data ? 'ca_mastery_rewards_v1' THEN
    BEGIN
      v_rew := (v_data->>'ca_mastery_rewards_v1')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_rew := null;
    END;
  END IF;

  IF v_data ? 'ca_mastery_preferences_v1' THEN
    BEGIN
      v_pref := (v_data->>'ca_mastery_preferences_v1')::jsonb;
      IF v_pref ? 'equipped' AND jsonb_typeof(v_pref->'equipped') = 'object' THEN
        -- 1. banner slot
        v_raw := v_pref->'equipped'->'banner'->>'itemId';
        IF v_raw IS NOT NULL THEN
          IF v_raw LIKE 'banner:%' THEN
            v_banner := substr(v_raw, 8);
          ELSE
            v_banner := v_raw;
          END IF;
          IF v_banner NOT IN ('classic', 'slate', 'forest', 'banner_cosmic_knight', 'banner_crimson_sun', 'banner_hidden_myeongnyang') THEN
            v_banner := 'classic';
          ELSIF v_banner IN ('banner_cosmic_knight', 'banner_crimson_sun', 'banner_hidden_myeongnyang') THEN
            IF v_rew IS NULL OR NOT (
              (v_rew ? 'items') AND ((v_rew->'items' ? ('banner:' || v_banner)) OR (v_rew->'items' ? v_banner))
            ) THEN
              v_banner := 'classic';
            END IF;
          END IF;
        END IF;

        -- 2. frame slot
        v_raw := v_pref->'equipped'->'frame'->>'itemId';
        IF v_raw = 'frame:classic-gold' THEN
          v_frame := 'frame:classic-gold';
        ELSIF v_raw = 'frame:mastery-complete' THEN
          IF v_rew IS NOT NULL AND (v_rew ? 'items') AND (v_rew->'items' ? 'frame:mastery-complete') THEN
            v_frame := 'frame:mastery-complete';
          END IF;
        END IF;

        -- 3. badge slot
        v_raw := v_pref->'equipped'->'badge'->>'itemId';
        IF v_raw ~ '^badge:mastery-m0[1-8]$' THEN
          IF v_rew IS NOT NULL AND (v_rew ? 'items') AND (v_rew->'items' ? v_raw) THEN
            v_badge := v_raw;
          END IF;
        END IF;

        -- 4. badgeFrame slot
        v_raw := v_pref->'equipped'->'badgeFrame'->>'itemId';
        IF v_raw IN ('badgeFrame:gold', 'badgeFrame:silver', 'badgeFrame:violet') THEN
          v_badge_frame := v_raw;
        END IF;

        -- 5. title slot
        v_raw := v_pref->'equipped'->'title'->>'itemId';
        IF v_raw = 'title:challenger' THEN
          v_title := 'title:challenger';
        ELSIF v_raw = 'title:explorer' THEN
          IF v_rew IS NOT NULL AND (v_rew ? 'items') AND (v_rew->'items' ? 'title:explorer') THEN
            v_title := 'title:explorer';
          END IF;
        END IF;

        -- 6. titleFrame slot
        v_raw := v_pref->'equipped'->'titleFrame'->>'itemId';
        IF v_raw IN ('titleFrame:gold', 'titleFrame:silver', 'titleFrame:violet') THEN
          v_title_frame := v_raw;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  RETURN jsonb_build_object(
    'banner', v_banner,
    'frame', v_frame,
    'badge', v_badge,
    'badgeFrame', v_badge_frame,
    'title', v_title,
    'titleFrame', v_title_frame
  );
END;
$$;

-- Security permissions
REVOKE ALL ON FUNCTION public._validate_mastery_preferences_v4(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_account_progress_v4(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._project_account_data_v3(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._project_account_data_v2(jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_account_progress_v4(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_progress_v4(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_account_progress_v4(jsonb, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_account_progress_v4(jsonb, bigint, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_player_cosmetics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_cosmetics(uuid) TO authenticated;

SELECT 'profile_cosmetics_migration_applied' AS migration_status;

COMMIT;
