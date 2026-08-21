ALTER TABLE ecf31_delivery_attempts ALTER COLUMN track_id DROP NOT NULL;
ALTER TABLE ecf31_delivery_attempts ADD COLUMN IF NOT EXISTS intent_state text NOT NULL DEFAULT 'ACKNOWLEDGED' CHECK (intent_state IN ('PREPARED', 'ACKNOWLEDGED'));
ALTER TABLE ecf31_delivery_attempts ADD COLUMN IF NOT EXISTS e_ncf text;
ALTER TABLE ecf31_delivery_attempts ADD COLUMN IF NOT EXISTS issuer_rnc text;
ALTER TABLE ecf31_delivery_current ALTER COLUMN latest_track_id DROP NOT NULL;
ALTER TABLE ecf31_delivery_current DROP CONSTRAINT IF EXISTS ecf31_delivery_current_delivery_state_check;
ALTER TABLE ecf31_delivery_current ADD CONSTRAINT ecf31_delivery_current_delivery_state_check CHECK (delivery_state IN ('PREPARED', 'POST_STARTED', 'ACKNOWLEDGED', 'OUTCOME_UNKNOWN', 'RECEPTION_ACKNOWLEDGED', 'INDETERMINATE', 'IN_PROCESS', 'ACCEPTED', 'REJECTED', 'ACCEPTED_CONDITIONAL', 'PENDING_RECONCILIATION'));
ALTER TABLE ecf31_delivery_events ALTER COLUMN track_id DROP NOT NULL;
ALTER TABLE ecf31_delivery_events DROP CONSTRAINT IF EXISTS ecf31_delivery_events_event_kind_check;
ALTER TABLE ecf31_delivery_events ADD CONSTRAINT ecf31_delivery_events_event_kind_check CHECK (event_kind IN ('POST_STARTED', 'OUTCOME_UNKNOWN', 'RECEPTION_ACKNOWLEDGED', 'RESULT_OBSERVED', 'POLLING_DEADLINE_EXPIRED', 'POLLING_CANCELLED', 'POLLING_ERROR'));
ALTER TABLE ecf31_delivery_events DROP CONSTRAINT IF EXISTS ecf31_delivery_events_check;
ALTER TABLE ecf31_delivery_events DROP CONSTRAINT IF EXISTS ecf31_delivery_events_payload_check;
ALTER TABLE ecf31_delivery_events ADD CONSTRAINT ecf31_delivery_events_payload_check CHECK (
  (event_kind IN ('POST_STARTED', 'OUTCOME_UNKNOWN', 'RECEPTION_ACKNOWLEDGED', 'POLLING_DEADLINE_EXPIRED', 'POLLING_CANCELLED', 'POLLING_ERROR') AND codigo IS NULL AND estado IS NULL AND rnc IS NULL AND e_ncf IS NULL AND fecha IS NULL AND mensajes = '[]'::jsonb AND secuencia_utilizada IS NULL AND disposition IS NULL)
  OR (event_kind = 'RESULT_OBSERVED' AND codigo IS NOT NULL AND estado IS NOT NULL
    AND ((codigo IN (0, 3) AND rnc IS NULL AND e_ncf IS NULL AND fecha IS NULL AND mensajes = '[]'::jsonb AND secuencia_utilizada IS NULL AND disposition IS NULL)
      OR (codigo IN (1, 4) AND secuencia_utilizada IS NULL AND disposition IS NULL)
      OR (codigo = 2 AND secuencia_utilizada IS NOT NULL AND disposition = CASE WHEN secuencia_utilizada THEN 'CONSUMED_NON_REUSABLE' ELSE 'POTENTIALLY_REUSABLE_NO_BLIND_RESEND' END)))
);

CREATE TABLE IF NOT EXISTS ecf31_delivery_acknowledgements (
  scope_id text NOT NULL, ecf_type text NOT NULL CHECK (ecf_type = 'E31'), allocation_idempotency_key text NOT NULL, attempt_key text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('testecf', 'certecf', 'ecf')), track_id text NOT NULL CHECK (length(track_id) BETWEEN 1 AND 256 AND track_id !~ '[[:cntrl:]]'), acknowledged_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (scope_id, ecf_type, allocation_idempotency_key, attempt_key), UNIQUE (scope_id, environment, track_id),
  FOREIGN KEY (scope_id, ecf_type, allocation_idempotency_key, attempt_key) REFERENCES ecf31_delivery_attempts (scope_id, ecf_type, allocation_idempotency_key, attempt_key)
);
REVOKE INSERT, UPDATE, DELETE ON ecf31_delivery_acknowledgements FROM PUBLIC;
CREATE OR REPLACE FUNCTION reject_ecf31_delivery_acknowledgement_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delivery acknowledgements are append-only'; END $$;
REVOKE EXECUTE ON FUNCTION public.reject_ecf31_delivery_acknowledgement_change() FROM PUBLIC;
DROP TRIGGER IF EXISTS reject_ecf31_delivery_acknowledgement_change ON ecf31_delivery_acknowledgements;
CREATE TRIGGER reject_ecf31_delivery_acknowledgement_change BEFORE UPDATE OR DELETE ON ecf31_delivery_acknowledgements FOR EACH ROW EXECUTE FUNCTION reject_ecf31_delivery_acknowledgement_change();

CREATE OR REPLACE FUNCTION initialize_ecf31_delivery_current() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN
  INSERT INTO public.ecf31_delivery_current(scope_id, ecf_type, allocation_idempotency_key, attempt_key, latest_track_id, delivery_state, polling_state, auto_resend_blocked)
  VALUES (NEW.scope_id, NEW.ecf_type, NEW.allocation_idempotency_key, NEW.attempt_key, NEW.track_id, NEW.intent_state, 'NOT_STARTED', NEW.intent_state = 'ACKNOWLEDGED'); RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.initialize_ecf31_delivery_current() FROM PUBLIC;
CREATE OR REPLACE FUNCTION apply_ecf31_delivery_acknowledgement() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN
  UPDATE public.ecf31_delivery_current SET latest_track_id = NEW.track_id, delivery_state = 'ACKNOWLEDGED', auto_resend_blocked = true, version = version + 1, updated_at = transaction_timestamp()
  WHERE scope_id = NEW.scope_id AND ecf_type = NEW.ecf_type AND allocation_idempotency_key = NEW.allocation_idempotency_key AND attempt_key = NEW.attempt_key; RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_ecf31_delivery_acknowledgement() FROM PUBLIC;
DROP TRIGGER IF EXISTS apply_ecf31_delivery_acknowledgement ON ecf31_delivery_acknowledgements;
CREATE TRIGGER apply_ecf31_delivery_acknowledgement AFTER INSERT ON ecf31_delivery_acknowledgements FOR EACH ROW EXECUTE FUNCTION apply_ecf31_delivery_acknowledgement();
INSERT INTO ecf31_delivery_acknowledgements SELECT scope_id, ecf_type, allocation_idempotency_key, attempt_key, environment, track_id, acknowledged_at FROM ecf31_delivery_attempts WHERE track_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION apply_ecf31_delivery_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current public.ecf31_delivery_current%ROWTYPE; state text; polling text;
BEGIN
  SELECT * INTO current FROM public.ecf31_delivery_current WHERE scope_id = NEW.scope_id AND ecf_type = NEW.ecf_type AND allocation_idempotency_key = NEW.allocation_idempotency_key AND attempt_key = NEW.attempt_key FOR UPDATE;
  state := CASE WHEN NOT NEW.state_applied THEN current.delivery_state WHEN NEW.event_kind = 'POST_STARTED' THEN 'POST_STARTED' WHEN NEW.event_kind = 'OUTCOME_UNKNOWN' THEN 'OUTCOME_UNKNOWN' WHEN NEW.event_kind = 'RECEPTION_ACKNOWLEDGED' THEN 'ACKNOWLEDGED' WHEN NEW.event_kind = 'RESULT_OBSERVED' THEN CASE NEW.codigo WHEN 0 THEN 'INDETERMINATE' WHEN 1 THEN 'ACCEPTED' WHEN 2 THEN 'REJECTED' WHEN 3 THEN 'IN_PROCESS' WHEN 4 THEN 'ACCEPTED_CONDITIONAL' END WHEN NEW.event_kind = 'POLLING_DEADLINE_EXPIRED' THEN 'PENDING_RECONCILIATION' ELSE current.delivery_state END;
  polling := CASE WHEN NEW.event_kind = 'POLLING_DEADLINE_EXPIRED' THEN 'DEADLINE_EXPIRED' WHEN NEW.event_kind = 'POLLING_CANCELLED' THEN 'CANCELLED' WHEN NEW.event_kind = 'POLLING_ERROR' THEN 'ERROR' WHEN NEW.codigo IN (1,2,4) THEN 'COMPLETED' WHEN NEW.event_kind IN ('RECEPTION_ACKNOWLEDGED','RESULT_OBSERVED') THEN 'ACTIVE' ELSE current.polling_state END;
  UPDATE public.ecf31_delivery_current SET latest_event_id = NEW.event_id, latest_result_event_id = CASE WHEN NEW.event_kind = 'RESULT_OBSERVED' THEN NEW.event_id ELSE latest_result_event_id END, delivery_state = state, polling_state = polling, disposition = coalesce(NEW.disposition, disposition), auto_resend_blocked = auto_resend_blocked OR NEW.event_kind IN ('POST_STARTED','OUTCOME_UNKNOWN','RECEPTION_ACKNOWLEDGED') OR coalesce(NEW.codigo = 2, false), anomaly = anomaly OR NEW.anomaly, version = version + 1, updated_at = transaction_timestamp() WHERE scope_id = NEW.scope_id AND ecf_type = NEW.ecf_type AND allocation_idempotency_key = NEW.allocation_idempotency_key AND attempt_key = NEW.attempt_key; RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_ecf31_delivery_event() FROM PUBLIC;

CREATE OR REPLACE FUNCTION prepare_ecf31_delivery_attempt(p_scope_id text, p_ecf_type text, p_allocation_key text, p_attempt_key text, p_environment text, p_sha256 text, p_e_ncf text, p_issuer_rnc text)
RETURNS TABLE(outcome text, attempt_no integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE existing public.ecf31_delivery_attempts%ROWTYPE; allocation public.sequence_allocation_requests%ROWTYPE; snapshot jsonb; next_no integer;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS DISTINCT FROM 'E31' OR p_allocation_key IS NULL OR p_attempt_key IS NULL OR length(p_attempt_key) NOT BETWEEN 1 AND 128 OR p_attempt_key ~ '[[:cntrl:]]' OR p_environment NOT IN ('testecf','certecf','ecf') OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_e_ncf !~ '^E31[0-9]{10}$' OR p_issuer_rnc IS NULL OR length(p_issuer_rnc) NOT BETWEEN 1 AND 32 OR p_issuer_rnc ~ '[[:cntrl:]]' THEN RETURN QUERY SELECT 'invalid_attempt', NULL::integer; RETURN; END IF;
  SELECT * INTO allocation FROM public.sequence_allocation_requests WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND idempotency_key = p_allocation_key FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'missing_allocation', NULL::integer; RETURN; END IF;
  SELECT s.snapshot INTO snapshot FROM public.ecf31_draft_evidence_snapshots s WHERE s.scope_id = p_scope_id AND s.allocation_idempotency_key = p_allocation_key;
  IF NOT FOUND THEN RETURN QUERY SELECT 'missing_snapshot', NULL::integer; RETURN; END IF;
  IF p_e_ncf <> 'E31' || lpad(allocation.allocated_value::text, 10, '0') OR snapshot #>> '{header,eNcf}' IS DISTINCT FROM p_e_ncf OR snapshot #>> '{header,issuer,taxpayerIdentifier}' IS DISTINCT FROM p_issuer_rnc THEN RETURN QUERY SELECT 'conflict', NULL::integer; RETURN; END IF;
  SELECT * INTO existing FROM public.ecf31_delivery_attempts WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key AND attempt_key = p_attempt_key;
  IF FOUND THEN IF existing.intent_state = 'PREPARED' AND existing.environment = p_environment AND existing.signed_xml_sha256 = p_sha256 AND existing.e_ncf = p_e_ncf AND existing.issuer_rnc = p_issuer_rnc THEN RETURN QUERY SELECT 'replayed', existing.attempt_no; ELSE RETURN QUERY SELECT 'conflict', NULL::integer; END IF; RETURN; END IF;
  SELECT coalesce(max(public.ecf31_delivery_attempts.attempt_no), 0) + 1 INTO next_no FROM public.ecf31_delivery_attempts WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key;
  INSERT INTO public.ecf31_delivery_attempts(scope_id, ecf_type, allocation_idempotency_key, attempt_key, attempt_no, environment, signed_xml_sha256, track_id, intent_state, e_ncf, issuer_rnc) VALUES (p_scope_id, 'E31', p_allocation_key, p_attempt_key, next_no, p_environment, p_sha256, NULL, 'PREPARED', p_e_ncf, p_issuer_rnc);
  RETURN QUERY SELECT 'prepared', next_no;
END $$;
REVOKE EXECUTE ON FUNCTION public.prepare_ecf31_delivery_attempt(text, text, text, text, text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION record_ecf31_delivery_attempt(p_scope_id text, p_ecf_type text, p_allocation_key text, p_attempt_key text, p_environment text, p_sha256 text, p_track_id text)
RETURNS TABLE(outcome text, attempt_no integer, acknowledged_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE existing public.ecf31_delivery_attempts%ROWTYPE; acknowledgement public.ecf31_delivery_acknowledgements%ROWTYPE; next_no integer; stamp timestamptz;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS DISTINCT FROM 'E31' OR p_allocation_key IS NULL OR p_attempt_key IS NULL OR length(p_attempt_key) NOT BETWEEN 1 AND 128 OR p_attempt_key ~ '[[:cntrl:]]' OR p_environment NOT IN ('testecf','certecf','ecf') OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_track_id IS NULL OR length(p_track_id) NOT BETWEEN 1 AND 256 OR p_track_id ~ '[[:cntrl:]]' THEN RETURN QUERY SELECT 'invalid_attempt', NULL::integer, NULL::timestamptz; RETURN; END IF;
  PERFORM 1 FROM public.sequence_allocation_requests WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND idempotency_key = p_allocation_key FOR UPDATE; IF NOT FOUND THEN RETURN QUERY SELECT 'missing_allocation', NULL::integer, NULL::timestamptz; RETURN; END IF;
  SELECT * INTO existing FROM public.ecf31_delivery_attempts WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key;
  IF FOUND THEN
    IF existing.intent_state = 'ACKNOWLEDGED' AND existing.environment=p_environment AND existing.signed_xml_sha256=p_sha256 AND existing.track_id=p_track_id THEN RETURN QUERY SELECT 'replayed',existing.attempt_no,existing.acknowledged_at; ELSIF existing.intent_state = 'PREPARED' AND existing.environment=p_environment AND existing.signed_xml_sha256=p_sha256 THEN SELECT * INTO acknowledgement FROM public.ecf31_delivery_acknowledgements WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key; IF FOUND THEN IF acknowledgement.track_id=p_track_id THEN RETURN QUERY SELECT 'replayed',existing.attempt_no,acknowledgement.acknowledged_at; ELSE RETURN QUERY SELECT 'conflict',NULL::integer,NULL::timestamptz; END IF; ELSIF EXISTS (SELECT 1 FROM public.ecf31_delivery_current WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key AND delivery_state='PREPARED') THEN INSERT INTO public.ecf31_delivery_acknowledgements VALUES (p_scope_id,'E31',p_allocation_key,p_attempt_key,p_environment,p_track_id,transaction_timestamp()) RETURNING public.ecf31_delivery_acknowledgements.acknowledged_at INTO stamp; RETURN QUERY SELECT 'recorded',existing.attempt_no,stamp; ELSE RETURN QUERY SELECT 'conflict',NULL::integer,NULL::timestamptz; END IF; ELSE RETURN QUERY SELECT 'conflict', NULL::integer, NULL::timestamptz; END IF; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ecf31_delivery_attempts WHERE scope_id=p_scope_id AND environment=p_environment AND track_id=p_track_id) OR EXISTS (SELECT 1 FROM public.ecf31_delivery_acknowledgements WHERE scope_id=p_scope_id AND environment=p_environment AND track_id=p_track_id) THEN RETURN QUERY SELECT 'track_id_conflict', NULL::integer, NULL::timestamptz; RETURN; END IF;
  SELECT coalesce(max(public.ecf31_delivery_attempts.attempt_no),0)+1 INTO next_no FROM public.ecf31_delivery_attempts WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key;
  BEGIN INSERT INTO public.ecf31_delivery_attempts(scope_id,ecf_type,allocation_idempotency_key,attempt_key,attempt_no,environment,signed_xml_sha256,track_id) VALUES (p_scope_id,'E31',p_allocation_key,p_attempt_key,next_no,p_environment,p_sha256,p_track_id) RETURNING public.ecf31_delivery_attempts.acknowledged_at INTO stamp; EXCEPTION WHEN unique_violation THEN RETURN QUERY SELECT 'track_id_conflict',NULL::integer,NULL::timestamptz; RETURN; END; RETURN QUERY SELECT 'recorded',next_no,stamp;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_ecf31_delivery_attempt(text, text, text, text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION acknowledge_ecf31_delivery_attempt(p_scope_id text, p_ecf_type text, p_allocation_key text, p_attempt_key text, p_environment text, p_track_id text)
RETURNS TABLE(outcome text, attempt_no integer, acknowledged_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt public.ecf31_delivery_attempts%ROWTYPE; current public.ecf31_delivery_current%ROWTYPE; acknowledgement public.ecf31_delivery_acknowledgements%ROWTYPE; stamp timestamptz;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS DISTINCT FROM 'E31' OR p_allocation_key IS NULL OR p_attempt_key IS NULL OR p_environment NOT IN ('testecf','certecf','ecf') OR p_track_id IS NULL OR length(p_track_id) NOT BETWEEN 1 AND 256 OR p_track_id ~ '[[:cntrl:]]' THEN RETURN QUERY SELECT 'invalid_attempt',NULL::integer,NULL::timestamptz; RETURN; END IF;
  SELECT * INTO attempt FROM public.ecf31_delivery_attempts WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key FOR UPDATE; IF NOT FOUND THEN RETURN QUERY SELECT 'missing_allocation',NULL::integer,NULL::timestamptz; RETURN; END IF;
  IF attempt.environment <> p_environment THEN RETURN QUERY SELECT 'conflict',NULL::integer,NULL::timestamptz; RETURN; END IF;
  SELECT * INTO acknowledgement FROM public.ecf31_delivery_acknowledgements WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key; IF FOUND THEN IF acknowledgement.track_id=p_track_id THEN RETURN QUERY SELECT 'replayed',attempt.attempt_no,acknowledgement.acknowledged_at; ELSE RETURN QUERY SELECT 'conflict',NULL::integer,NULL::timestamptz; END IF; RETURN; END IF;
  SELECT * INTO current FROM public.ecf31_delivery_current WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key FOR UPDATE; IF current.delivery_state NOT IN ('POST_STARTED','OUTCOME_UNKNOWN') THEN RETURN QUERY SELECT 'conflict',NULL::integer,NULL::timestamptz; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.ecf31_delivery_acknowledgements WHERE scope_id=p_scope_id AND environment=p_environment AND track_id=p_track_id) THEN RETURN QUERY SELECT 'track_id_conflict',NULL::integer,NULL::timestamptz; RETURN; END IF;
  BEGIN INSERT INTO public.ecf31_delivery_acknowledgements VALUES (p_scope_id,'E31',p_allocation_key,p_attempt_key,p_environment,p_track_id,transaction_timestamp()) RETURNING public.ecf31_delivery_acknowledgements.acknowledged_at INTO stamp; EXCEPTION WHEN unique_violation THEN RETURN QUERY SELECT 'track_id_conflict',NULL::integer,NULL::timestamptz; RETURN; END; RETURN QUERY SELECT 'recorded',attempt.attempt_no,stamp;
END $$;
REVOKE EXECUTE ON FUNCTION public.acknowledge_ecf31_delivery_attempt(text, text, text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION append_ecf31_delivery_event(p_scope_id text, p_ecf_type text, p_allocation_key text, p_attempt_key text, p_event_key text, p_kind text, p_codigo smallint, p_estado text, p_rnc text, p_e_ncf text, p_fecha text, p_mensajes jsonb, p_secuencia boolean)
RETURNS TABLE(outcome text,event_id bigint,state_applied boolean,anomaly boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt public.ecf31_delivery_attempts%ROWTYPE; prior public.ecf31_delivery_events%ROWTYPE; current public.ecf31_delivery_current%ROWTYPE; acknowledgement_track_id text; applied boolean; flagged boolean; disposition text;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS DISTINCT FROM 'E31' OR p_allocation_key IS NULL OR p_attempt_key IS NULL OR p_event_key IS NULL OR length(p_event_key) NOT BETWEEN 1 AND 128 OR p_event_key ~ '[[:cntrl:]]' OR p_kind NOT IN ('POST_STARTED','OUTCOME_UNKNOWN','RECEPTION_ACKNOWLEDGED','RESULT_OBSERVED','POLLING_DEADLINE_EXPIRED','POLLING_CANCELLED','POLLING_ERROR') OR p_mensajes IS NULL OR NOT public.ecf31_delivery_messages_valid(p_mensajes) THEN RETURN QUERY SELECT 'invalid_event',NULL::bigint,NULL::boolean,NULL::boolean; RETURN; END IF;
  SELECT * INTO attempt FROM public.ecf31_delivery_attempts WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key FOR UPDATE; IF NOT FOUND THEN RETURN QUERY SELECT 'missing_attempt',NULL::bigint,NULL::boolean,NULL::boolean; RETURN; END IF;
  SELECT * INTO prior FROM public.ecf31_delivery_events WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key AND event_key=p_event_key; IF FOUND THEN IF prior.event_kind=p_kind AND prior.codigo IS NOT DISTINCT FROM p_codigo AND prior.estado IS NOT DISTINCT FROM p_estado AND prior.rnc IS NOT DISTINCT FROM p_rnc AND prior.e_ncf IS NOT DISTINCT FROM p_e_ncf AND prior.fecha IS NOT DISTINCT FROM p_fecha AND prior.mensajes=p_mensajes AND prior.secuencia_utilizada IS NOT DISTINCT FROM p_secuencia THEN RETURN QUERY SELECT 'replayed',prior.event_id,prior.state_applied,prior.anomaly; ELSE RETURN QUERY SELECT 'conflict',NULL::bigint,NULL::boolean,NULL::boolean; END IF; RETURN; END IF;
  IF (p_kind IN ('POST_STARTED','OUTCOME_UNKNOWN','RECEPTION_ACKNOWLEDGED','POLLING_DEADLINE_EXPIRED','POLLING_CANCELLED','POLLING_ERROR') AND (p_codigo IS NOT NULL OR p_estado IS NOT NULL OR p_rnc IS NOT NULL OR p_e_ncf IS NOT NULL OR p_fecha IS NOT NULL OR p_mensajes <> '[]'::jsonb OR p_secuencia IS NOT NULL)) OR (p_kind='RESULT_OBSERVED' AND (p_codigo IS NULL OR p_estado IS NULL)) THEN RETURN QUERY SELECT 'invalid_event',NULL::bigint,NULL::boolean,NULL::boolean; RETURN; END IF;
  SELECT * INTO current FROM public.ecf31_delivery_current WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key FOR UPDATE;
  IF (p_kind='POST_STARTED' AND current.delivery_state <> 'PREPARED') OR (p_kind='OUTCOME_UNKNOWN' AND current.delivery_state <> 'POST_STARTED') THEN RETURN QUERY SELECT 'invalid_transition',NULL::bigint,NULL::boolean,NULL::boolean; RETURN; END IF;
  SELECT track_id INTO acknowledgement_track_id FROM public.ecf31_delivery_acknowledgements WHERE scope_id=p_scope_id AND ecf_type='E31' AND allocation_idempotency_key=p_allocation_key AND attempt_key=p_attempt_key;
  IF p_kind IN ('RECEPTION_ACKNOWLEDGED','RESULT_OBSERVED','POLLING_DEADLINE_EXPIRED','POLLING_CANCELLED','POLLING_ERROR') AND coalesce(acknowledgement_track_id,attempt.track_id) IS NULL THEN RETURN QUERY SELECT 'invalid_transition',NULL::bigint,NULL::boolean,NULL::boolean; RETURN; END IF;
  applied := CASE p_kind WHEN 'POST_STARTED' THEN current.delivery_state='PREPARED' WHEN 'OUTCOME_UNKNOWN' THEN current.delivery_state='POST_STARTED' WHEN 'RECEPTION_ACKNOWLEDGED' THEN current.delivery_state IN ('POST_STARTED','OUTCOME_UNKNOWN','ACKNOWLEDGED','RECEPTION_ACKNOWLEDGED') ELSE NOT current.delivery_state IN ('ACCEPTED','REJECTED','ACCEPTED_CONDITIONAL') END; flagged := NOT applied; disposition := CASE WHEN p_codigo=2 AND p_secuencia THEN 'CONSUMED_NON_REUSABLE' WHEN p_codigo=2 THEN 'POTENTIALLY_REUSABLE_NO_BLIND_RESEND' END;
  INSERT INTO public.ecf31_delivery_events(scope_id,ecf_type,allocation_idempotency_key,attempt_key,event_key,event_kind,track_id,codigo,estado,rnc,e_ncf,fecha,mensajes,secuencia_utilizada,disposition,state_applied,anomaly) VALUES (p_scope_id,'E31',p_allocation_key,p_attempt_key,p_event_key,p_kind,coalesce(acknowledgement_track_id,attempt.track_id),p_codigo,p_estado,p_rnc,p_e_ncf,p_fecha,p_mensajes,p_secuencia,disposition,applied,flagged) RETURNING public.ecf31_delivery_events.event_id INTO event_id; RETURN QUERY SELECT 'appended',event_id,applied,flagged;
END $$;
REVOKE EXECUTE ON FUNCTION public.append_ecf31_delivery_event(text, text, text, text, text, text, smallint, text, text, text, text, jsonb, boolean) FROM PUBLIC;
