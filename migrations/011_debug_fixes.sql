-- ============================================================
-- MIGRATION 011: Debug fixes from NOTES checklist
-- Run this once in Supabase SQL Editor after previous migrations.
-- ============================================================

-- Optional reference fields on new customer form
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reference_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reference_mobile TEXT;

-- Keep searchable UTR values indexed
CREATE INDEX IF NOT EXISTS idx_payment_requests_utr ON payment_requests(utr);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_utr ON emi_schedule(utr);

-- Fix due breakdown:
-- Fine due must include any EMI row where a fine is still unpaid,
-- even if the EMI principal was already paid.
CREATE OR REPLACE FUNCTION get_due_breakdown(
  p_customer_id     UUID,
  p_selected_emi_no INT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_customer             RECORD;
  v_next_emi             RECORD;
  v_selected_emi         RECORD;
  v_fine_due             NUMERIC := 0;
  v_first_emi_charge_due NUMERIC := 0;
  v_emi_amount           NUMERIC := 0;
  v_total_payable        NUMERIC := 0;
  v_popup_first_charge   BOOLEAN := FALSE;
  v_popup_fine           BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RETURN '{"error": "Customer not found"}'::JSONB;
  END IF;

  PERFORM calculate_and_apply_fines();

  SELECT * INTO v_next_emi
  FROM emi_schedule
  WHERE customer_id = p_customer_id AND status = 'UNPAID'
  ORDER BY emi_no ASC LIMIT 1;

  IF p_selected_emi_no IS NOT NULL THEN
    SELECT * INTO v_selected_emi
    FROM emi_schedule
    WHERE customer_id = p_customer_id
      AND emi_no = p_selected_emi_no
      AND status = 'UNPAID';

    IF FOUND THEN
      v_emi_amount := v_selected_emi.amount;
    END IF;
  ELSE
    v_emi_amount := COALESCE(v_next_emi.amount, 0);
  END IF;

  SELECT COALESCE(SUM(
    GREATEST(0, COALESCE(fine_amount, 0) - COALESCE(fine_paid_amount, 0))
  ), 0) INTO v_fine_due
  FROM emi_schedule
  WHERE customer_id = p_customer_id
    AND fine_waived = FALSE
    AND COALESCE(fine_amount, 0) > COALESCE(fine_paid_amount, 0);

  IF v_fine_due > 0 THEN
    v_popup_fine := TRUE;
  END IF;

  IF v_customer.first_emi_charge_amount > 0
     AND v_customer.first_emi_charge_paid_at IS NULL THEN
    v_first_emi_charge_due := v_customer.first_emi_charge_amount;
    v_popup_first_charge   := TRUE;
  END IF;

  v_total_payable := v_emi_amount + v_fine_due + v_first_emi_charge_due;

  RETURN jsonb_build_object(
    'customer_id',             p_customer_id,
    'customer_status',         v_customer.status,
    'next_emi_no',             v_next_emi.emi_no,
    'next_emi_amount',         v_next_emi.amount,
    'next_emi_due_date',       v_next_emi.due_date,
    'next_emi_status',         v_next_emi.status,
    'selected_emi_no',         COALESCE(p_selected_emi_no, v_next_emi.emi_no),
    'selected_emi_amount',     v_emi_amount,
    'fine_due',                v_fine_due,
    'first_emi_charge_due',    v_first_emi_charge_due,
    'total_payable',           v_total_payable,
    'popup_first_emi_charge',  v_popup_first_charge,
    'popup_fine_due',          v_popup_fine,
    'is_overdue',              (v_next_emi IS NOT NULL AND CURRENT_DATE > v_next_emi.due_date)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID, INT) TO anon;
GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID, INT) TO service_role;

NOTIFY pgrst, 'reload schema';
