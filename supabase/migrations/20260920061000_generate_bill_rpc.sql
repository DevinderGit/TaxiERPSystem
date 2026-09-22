-- M9 — TAXI-901 — generate_bill RPC
-- Bundles one or more unbilled duty slips into a single bill in a
-- single transaction. Returns the new bill row.

SET search_path TO public, master, operations, billing, accounts;

CREATE OR REPLACE FUNCTION public.generate_bill(
  p_customer_id     bigint,
  p_duty_slip_ids   bigint[],
  p_remarks         text     DEFAULT NULL,
  p_bill_date       date     DEFAULT CURRENT_DATE
)
RETURNS SETOF billing.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'master', 'operations', 'billing', 'accounts'
AS $function$
DECLARE
  v_company_id        bigint;
  v_caller_role       text;
  v_caller_uid        uuid;
  v_customer          master.customers%ROWTYPE;
  v_gst               master.gst_config%ROWTYPE;
  v_base_total        numeric(12,2) := 0;
  v_extra_total       numeric(12,2) := 0;
  v_extra_km          numeric(12,2) := 0;
  v_extra_hour        numeric(12,2) := 0;
  v_night_halt        numeric(12,2) := 0;
  v_driver_all        numeric(12,2) := 0;
  v_other             numeric(12,2) := 0;
  v_slip_count        int;
  v_duty_slip_id      bigint;
  v_slip              operations.duty_slips%ROWTYPE;
  v_slip_total        numeric(12,2);
  v_new_bill          billing.bills%ROWTYPE;
BEGIN
  -- ---- 1. Caller authorization (owner / operator only) ----
  v_caller_uid := auth.uid();
  v_caller_role := public.current_user_role();
  IF v_caller_role IS DISTINCT FROM 'owner' AND v_caller_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Only owner or operator can generate bills (your role: %).',
      COALESCE(v_caller_role, 'unknown')
      USING ERRCODE = '42501';
  END IF;

  v_company_id := public.current_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No current_company_id() in JWT claims. Sign in again.'
      USING ERRCODE = '42501';
  END IF;

  -- ---- 2. Argument validation ----
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required.' USING ERRCODE = '22023';
  END IF;
  IF p_duty_slip_ids IS NULL OR array_length(p_duty_slip_ids, 1) IS NULL OR array_length(p_duty_slip_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one duty slip is required.' USING ERRCODE = '22023';
  END IF;
  IF p_bill_date IS NULL THEN
    RAISE EXCEPTION 'Bill date is required.' USING ERRCODE = '22023';
  END IF;

  -- ---- 3. Validate the customer belongs to the caller's company ----
  SELECT * INTO v_customer FROM master.customers
    WHERE id = p_customer_id AND company_id = v_company_id;
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found in this company.', p_customer_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ---- 4. Find the active GST config for this (company, customer) ----
  SELECT * INTO v_gst FROM master.gst_config
    WHERE company_id   = v_company_id
      AND customer_id  = p_customer_id
      AND effective_to IS NULL
      AND is_active    = true
    ORDER BY effective_from DESC
    LIMIT 1;
  IF v_gst.id IS NULL THEN
    RAISE EXCEPTION 'No active GST config for customer %. Configure one in Master
      → GST Management first.', p_customer_id USING ERRCODE = '22023';
  END IF;

  -- ---- 5. Lock + validate each duty slip + sum amounts ----
  v_slip_count := 0;
  FOR v_slip IN
    SELECT * FROM operations.duty_slips
      WHERE id = ANY(p_duty_slip_ids)
      ORDER BY id
      FOR UPDATE
  LOOP
    -- Tenant check
    IF v_slip.company_id <> v_company_id THEN
      RAISE EXCEPTION 'Duty slip % does not belong to your company.', v_slip.id
        USING ERRCODE = '42501';
    END IF;
    -- Customer match
    IF v_slip.customer_id <> p_customer_id THEN
      RAISE EXCEPTION 'Duty slip % belongs to customer %, not the selected customer %.',
        v_slip.id, v_slip.customer_id, p_customer_id USING ERRCODE = '22023';
    END IF;
    -- Already cancelled?
    IF v_slip.status = 'cancelled' THEN
      RAISE EXCEPTION 'Duty slip % is cancelled and cannot be billed.', v_slip.id
        USING ERRCODE = '22023';
    END IF;
    -- Already billed?
    IF v_slip.bill_id IS NOT NULL AND v_slip.status = 'billed' THEN
      RAISE EXCEPTION 'Duty slip % is already billed (bill_id=%).',
        v_slip.id, v_slip.bill_id USING ERRCODE = '22023';
    END IF;

    v_base_total   := v_base_total   + COALESCE(v_slip.base_amount,   0);
    v_extra_km     := v_extra_km     + COALESCE(v_slip.extra_km_amount,   0);
    v_extra_hour   := v_extra_hour   + COALESCE(v_slip.extra_hour_amount, 0);
    v_night_halt   := v_night_halt   + COALESCE(v_slip.night_halt_amount, 0);
    v_driver_all   := v_driver_all   + COALESCE(v_slip.driver_allowance,   0);
    v_other        := v_other        + COALESCE(v_slip.other_charges,      0);
    v_slip_count   := v_slip_count + 1;
  END LOOP;

  -- Did we actually lock all the requested slips?
  IF v_slip_count <> array_length(p_duty_slip_ids, 1) THEN
    RAISE EXCEPTION 'Mismatch: % slips requested, % found.',
      array_length(p_duty_slip_ids, 1), v_slip_count USING ERRCODE = '22023';
  END IF;

  -- extra_amount is the sum of all five extra-* columns
  v_extra_total := v_extra_km + v_extra_hour + v_night_halt + v_driver_all + v_other;

  -- ---- 6. INSERT the bill. fn_calculate_gst computes tax columns;
  --         fn_assign_bill_no assigns bill_no ----
  INSERT INTO billing.bills (
    company_id, customer_id, gst_config_id,
    bill_date, remarks, status,
    base_amount, extra_amount,
    created_by
  )
  VALUES (
    v_company_id, p_customer_id, v_gst.id,
    p_bill_date, NULLIF(trim(p_remarks), ''), 'issued',
    v_base_total, v_extra_total,
    v_caller_uid
  )
  RETURNING * INTO v_new_bill;

  -- ---- 7. INSERT bill_duty_slips rows with snapshotted amounts ----
  FOREACH v_duty_slip_id IN ARRAY p_duty_slip_ids LOOP
    SELECT * INTO v_slip FROM operations.duty_slips WHERE id = v_duty_slip_id;
    -- included_total = base + sum(extras) for this one slip
    v_slip_total := COALESCE(v_slip.base_amount, 0)
                  + COALESCE(v_slip.extra_km_amount,   0)
                  + COALESCE(v_slip.extra_hour_amount, 0)
                  + COALESCE(v_slip.night_halt_amount, 0)
                  + COALESCE(v_slip.driver_allowance,   0)
                  + COALESCE(v_slip.other_charges,      0);

    INSERT INTO billing.bill_duty_slips (
      bill_id, duty_slip_id, included_base, included_extra, included_total
    )
    VALUES (
      v_new_bill.id, v_duty_slip_id,
      COALESCE(v_slip.base_amount, 0),
      v_slip_total - COALESCE(v_slip.base_amount, 0),
      v_slip_total
    );
  END LOOP;

  -- ---- 8. UPDATE duty_slips: stamp bill_id + flip status to 'billed' ----
  UPDATE operations.duty_slips
    SET bill_id = v_new_bill.id, status = 'billed'
    WHERE id = ANY(p_duty_slip_ids);

  -- ---- 9. INSERT the sale ledger entry ----
  INSERT INTO accounts.ledger_entries (
    company_id, entry_date, entry_type,
    customer_id, linked_bill_id,
    debit_amount, narration,
    created_by
  )
  VALUES (
    v_company_id, p_bill_date, 'sale',
    p_customer_id, v_new_bill.id,
    v_new_bill.grand_total,
    'Bill ' || v_new_bill.bill_no || ' raised against ' || v_customer.name,
    v_caller_uid
  );

  -- ---- 10. Return the complete bill row ----
  RETURN NEXT v_new_bill;
  RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_bill(bigint, bigint[], text, date) TO authenticated;

COMMENT ON FUNCTION public.generate_bill(bigint, bigint[], text, date)
  IS 'Bundles the given unbilled duty slips into one bill in a single
      transaction: locks + validates slips, looks up active gst_config,
      computes base/extra totals, INSERTs the bill (triggers stamp bill_no
      + compute GST), INSERTs bill_duty_slips rows, UPDATEs the slips to
      billed, INSERTs the sale ledger entry. Raises 42501 for non-owner /
      non-operator callers.';