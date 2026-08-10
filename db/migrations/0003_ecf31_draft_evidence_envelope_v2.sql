CREATE OR REPLACE FUNCTION validate_ecf31_draft_evidence_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := transaction_timestamp();
  IF NEW.e_ncf <> 'E31' || lpad(NEW.allocated_value::text, 10, '0') THEN
    RAISE EXCEPTION 'e-NCF does not match the allocated E31 sequence';
  END IF;
  IF NOT (
    jsonb_typeof(NEW.snapshot) = 'object'
    AND (
      (
        NEW.snapshot ?& ARRAY['schema', 'header', 'lineAdjustments', 'headerTotals']
        AND (SELECT count(*) = 4 FROM jsonb_object_keys(NEW.snapshot))
        AND NEW.snapshot->>'schema' = 'ecf31-draft-evidence-v1'
      ) OR (
        NEW.snapshot ?& ARRAY['schema', 'version', 'header', 'lineAdjustments', 'headerTotals', 'headerTotalsPolicyId']
        AND (SELECT count(*) = 6 FROM jsonb_object_keys(NEW.snapshot))
        AND NEW.snapshot->>'schema' = 'ecf31-draft-evidence'
        AND jsonb_typeof(NEW.snapshot->'version') = 'number' AND NEW.snapshot->>'version' = '2'
        AND NEW.snapshot->>'headerTotalsPolicyId' = 'ecf31-derived-header-totals-v1'
      )
    )
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
