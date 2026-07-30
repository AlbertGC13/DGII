CREATE TABLE IF NOT EXISTS ecf31_draft_evidence_snapshots (
  scope_id text NOT NULL,
  ecf_type text NOT NULL DEFAULT 'E31' CHECK (ecf_type = 'E31'),
  e_ncf text NOT NULL,
  allocation_idempotency_key text NOT NULL CHECK (allocation_idempotency_key <> ''),
  request_fingerprint text NOT NULL CHECK (request_fingerprint <> ''),
  allocated_value bigint NOT NULL CHECK (allocated_value BETWEEN 0 AND 9999999999),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (scope_id, e_ncf),
  UNIQUE (scope_id, allocation_idempotency_key),
  FOREIGN KEY (scope_id, ecf_type, allocation_idempotency_key)
    REFERENCES sequence_allocation_requests (scope_id, ecf_type, idempotency_key)
);

CREATE OR REPLACE FUNCTION validate_ecf31_draft_evidence_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := transaction_timestamp();
  IF NEW.e_ncf <> 'E31' || lpad(NEW.allocated_value::text, 10, '0') THEN
    RAISE EXCEPTION 'e-NCF does not match the allocated E31 sequence';
  END IF;
  -- Full decimal and domain semantics remain enforced by the TypeScript codec before persistence.
  IF NOT (
    jsonb_typeof(NEW.snapshot) = 'object'
    AND NEW.snapshot ?& ARRAY['schema', 'header', 'lineAdjustments', 'headerTotals']
    AND (SELECT count(*) = 4 FROM jsonb_object_keys(NEW.snapshot))
    AND NEW.snapshot->>'schema' = 'ecf31-draft-evidence-v1'
    AND jsonb_typeof(NEW.snapshot->'header') = 'object'
    AND NEW.snapshot->'header' ?& ARRAY['schema', 'version', 'eNcf', 'issuer', 'buyer', 'issueDate', 'incomeType', 'paymentType']
    AND NEW.snapshot->'header'->>'schema' = 'ecf31-core-header'
    AND jsonb_typeof(NEW.snapshot->'header'->'version') = 'number' AND NEW.snapshot->'header'->>'version' = '1'
    AND jsonb_typeof(NEW.snapshot->'header'->'eNcf') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'issueDate') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'incomeType') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'paymentType') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'issuer') = 'object'
    AND NEW.snapshot->'header'->'issuer' ?& ARRAY['taxpayerIdentifier', 'legalName', 'address']
    AND jsonb_typeof(NEW.snapshot->'header'->'issuer'->'taxpayerIdentifier') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'issuer'->'legalName') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'issuer'->'address') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'buyer') = 'object'
    AND NEW.snapshot->'header'->'buyer' ?& ARRAY['taxpayerIdentifier', 'legalName']
    AND jsonb_typeof(NEW.snapshot->'header'->'buyer'->'taxpayerIdentifier') = 'string'
    AND jsonb_typeof(NEW.snapshot->'header'->'buyer'->'legalName') = 'string'
    AND jsonb_typeof(NEW.snapshot->'lineAdjustments') = 'array'
    AND jsonb_array_length(NEW.snapshot->'lineAdjustments') > 0
    AND jsonb_typeof(NEW.snapshot->'headerTotals') = 'object'
    AND NEW.snapshot->'headerTotals' ?& ARRAY['schema', 'version', 'montoGravadoTotal', 'totalItbis', 'montoTotal']
    AND NEW.snapshot->'headerTotals'->>'schema' = 'ecf31-header-totals'
    AND jsonb_typeof(NEW.snapshot->'headerTotals'->'version') = 'number' AND NEW.snapshot->'headerTotals'->>'version' = '1'
    AND jsonb_typeof(NEW.snapshot->'headerTotals'->'montoGravadoTotal') = 'string'
    AND jsonb_typeof(NEW.snapshot->'headerTotals'->'totalItbis') = 'string'
    AND jsonb_typeof(NEW.snapshot->'headerTotals'->'montoTotal') = 'string'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'lineAdjustments') AS line(value)
      WHERE NOT (
        jsonb_typeof(line.value) = 'object'
        AND line.value ?& ARRAY['schema', 'version', 'coreLine', 'discountAmount', 'surchargeAmount', 'adjustedAmount', 'adjustedDelta', 'quantizedAmount', 'policyId']
        AND line.value->>'schema' = 'ecf31-line-adjustment'
        AND jsonb_typeof(line.value->'version') = 'number' AND line.value->>'version' = '1'
        AND jsonb_typeof(line.value->'discountAmount') = 'string'
        AND jsonb_typeof(line.value->'surchargeAmount') = 'string'
        AND jsonb_typeof(line.value->'adjustedAmount') = 'string'
        AND jsonb_typeof(line.value->'adjustedDelta') = 'string'
        AND jsonb_typeof(line.value->'quantizedAmount') = 'string'
        AND line.value->>'policyId' = 'ecf31-monto-item-half-up-v1'
        AND jsonb_typeof(line.value->'coreLine') = 'object'
        AND line.value->'coreLine' ?& ARRAY['schema', 'version', 'sequence', 'quantity', 'unitPrice', 'computedAmount', 'declaredAmount', 'delta', 'itemName', 'billingIndicator', 'goodOrServiceIndicator']
        AND line.value->'coreLine'->>'schema' = 'ecf31-core-line'
        AND jsonb_typeof(line.value->'coreLine'->'version') = 'number' AND line.value->'coreLine'->>'version' = '1'
        AND jsonb_typeof(line.value->'coreLine'->'sequence') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'quantity') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'unitPrice') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'computedAmount') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'declaredAmount') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'delta') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'itemName') = 'string'
        AND jsonb_typeof(line.value->'coreLine'->'billingIndicator') = 'number'
        AND line.value->'coreLine'->>'billingIndicator' IN ('0', '1', '2', '3', '4')
        AND jsonb_typeof(line.value->'coreLine'->'goodOrServiceIndicator') = 'number'
        AND line.value->'coreLine'->>'goodOrServiceIndicator' IN ('1', '2')
      )
    )
  ) THEN
    RAISE EXCEPTION 'snapshot is not the canonical e-CF 31 evidence envelope';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sequence_allocation_requests
    WHERE scope_id = NEW.scope_id AND ecf_type = 'E31'
      AND idempotency_key = NEW.allocation_idempotency_key
      AND request_fingerprint = NEW.request_fingerprint
      AND allocated_value = NEW.allocated_value
  ) THEN
    RAISE EXCEPTION 'snapshot does not match an E31 allocation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_ecf31_draft_evidence_snapshot_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'e-CF 31 evidence snapshots are append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'validate_ecf31_draft_evidence_snapshot_insert') THEN
    CREATE TRIGGER validate_ecf31_draft_evidence_snapshot_insert
      BEFORE INSERT ON ecf31_draft_evidence_snapshots
      FOR EACH ROW EXECUTE FUNCTION validate_ecf31_draft_evidence_snapshot();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reject_ecf31_draft_evidence_snapshot_change') THEN
    CREATE TRIGGER reject_ecf31_draft_evidence_snapshot_change
      BEFORE UPDATE OR DELETE ON ecf31_draft_evidence_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_ecf31_draft_evidence_snapshot_change();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION store_ecf31_draft_evidence(
  p_scope_id text,
  p_e_ncf text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_snapshot jsonb
) RETURNS TABLE (outcome text, created_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE
  allocation sequence_allocation_requests%ROWTYPE;
  existing ecf31_draft_evidence_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO allocation FROM sequence_allocation_requests
  WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing_allocation'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF allocation.request_fingerprint <> p_request_fingerprint
    OR p_e_ncf <> 'E31' || lpad(allocation.allocated_value::text, 10, '0') THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO existing FROM ecf31_draft_evidence_snapshots
  WHERE scope_id = p_scope_id AND e_ncf = p_e_ncf;
  IF FOUND THEN
    IF existing.allocation_idempotency_key = p_idempotency_key
      AND existing.request_fingerprint = p_request_fingerprint
      AND existing.allocated_value = allocation.allocated_value
      AND existing.snapshot = p_snapshot THEN
      RETURN QUERY SELECT 'replayed'::text, existing.created_at;
    ELSE
      RETURN QUERY SELECT 'conflict'::text, NULL::timestamptz;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO existing FROM ecf31_draft_evidence_snapshots
  WHERE scope_id = p_scope_id AND allocation_idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO ecf31_draft_evidence_snapshots (
    scope_id, e_ncf, allocation_idempotency_key, request_fingerprint, allocated_value, snapshot
  ) VALUES (
    p_scope_id, p_e_ncf, p_idempotency_key, p_request_fingerprint, allocation.allocated_value, p_snapshot
  ) RETURNING ecf31_draft_evidence_snapshots.created_at INTO created_at;
  outcome := 'stored';
  RETURN NEXT;
END;
$$;
