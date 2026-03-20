-- ============================================================
-- MIGRATION 010: All fixes — fine engine, lock, broadcast, auto-complete
-- Run in Supabase SQL Editor (idempotent)
-- ============================================================

-- ── 1. New columns ──────────────────────────────────────────
ALTER TABLE fine_settings ADD COLUMN IF NOT EXISTS weekly_fine_increment NUMERIC(12,2) DEFAULT 25;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_last_calculated_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emi_start_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emi_card_photo_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lock_provider TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lock_device_id TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_name TEXT DEFAULT 'TELEPOINT';
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'admin';

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check CHECK (status IN ('RUNNING','COMPLETE','SETTLED','NPA'));

-- ── 2. Fine History table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  emi_schedule_id UUID REFERENCES emi_schedule(id) ON DELETE CASCADE,
  emi_no INT,
  fine_type TEXT NOT NULL CHECK (fine_type IN ('BASE','WEEKLY','PAID','WAIVED')),
  fine_amount NUMERIC(12,2) NOT NULL,
  cumulative_fine NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fine_history_cust ON fine_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_fine_history_emi ON fine_history(emi_schedule_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_utr ON payment_requests(utr);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_utr ON emi_schedule(utr);

ALTER TABLE fine_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fh_admin" ON fine_history;
DROP POLICY IF EXISTS "fh_retailer" ON fine_history;
DROP POLICY IF EXISTS "fh_insert" ON fine_history;
CREATE POLICY "fh_admin" ON fine_history FOR ALL USING (get_my_role() = 'super_admin');
CREATE POLICY "fh_retailer" ON fine_history FOR SELECT USING (get_my_role() = 'retailer' AND customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id()));
CREATE POLICY "fh_insert" ON fine_history FOR INSERT WITH CHECK (TRUE);

-- ── 3. Broadcast RLS for retailers ──────────────────────────
DROP POLICY IF EXISTS "broadcast_retailer_insert" ON broadcast_messages;
CREATE POLICY "broadcast_retailer_insert" ON broadcast_messages FOR INSERT WITH CHECK (get_my_role() = 'retailer' AND target_retailer_id = get_my_retailer_id());

-- ── 4. FINE ENGINE — CORRECT FORMULA ────────────────────────
-- Rule: 450 base + 25/week CONTINUOUS (no monthly reset)
-- Fine keeps growing until paid, even if EMI itself is paid
CREATE OR REPLACE FUNCTION calculate_and_apply_fines()
RETURNS TABLE(updated_count INT) AS $$
DECLARE
  v_base NUMERIC; v_weekly NUMERIC; v_count INT := 0;
  v_emi RECORD; v_days INT; v_weeks INT; v_calc NUMERIC; v_old NUMERIC;
BEGIN
  SELECT default_fine_amount, COALESCE(weekly_fine_increment, 25) INTO v_base, v_weekly FROM fine_settings WHERE id = 1;
  IF v_base IS NULL THEN v_base := 450; END IF;
  IF v_weekly IS NULL THEN v_weekly := 25; END IF;

  FOR v_emi IN
    SELECT es.id, es.customer_id, es.emi_no, es.due_date, es.fine_amount, es.fine_waived, es.fine_paid_amount
    FROM emi_schedule es JOIN customers c ON c.id = es.customer_id
    WHERE es.due_date < CURRENT_DATE AND es.fine_waived = FALSE AND c.status = 'RUNNING'
      AND (es.status = 'UNPAID' OR (COALESCE(es.fine_paid_amount, 0) < COALESCE(es.fine_amount, 0)))
  LOOP
    v_days := CURRENT_DATE - v_emi.due_date;
    IF v_days <= 0 THEN CONTINUE; END IF;
    v_weeks := v_days / 7;
    v_calc := v_base + (v_weeks * v_weekly);
    v_old := COALESCE(v_emi.fine_amount, 0);

    IF v_calc != v_old THEN
      UPDATE emi_schedule SET fine_amount = v_calc, fine_last_calculated_at = NOW(), updated_at = NOW() WHERE id = v_emi.id;
      INSERT INTO fine_history (customer_id, emi_schedule_id, emi_no, fine_type, fine_amount, cumulative_fine, fine_date, reason)
      VALUES (v_emi.customer_id, v_emi.id, v_emi.emi_no,
        CASE WHEN v_old = 0 THEN 'BASE' ELSE 'WEEKLY' END,
        v_calc - v_old, v_calc, CURRENT_DATE,
        v_days || 'd overdue, ' || v_weeks || 'wk. Fine: ' || v_old || '→' || v_calc);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION calculate_and_apply_fines() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_and_apply_fines() TO service_role;

-- ── 5. Updated get_due_breakdown ────────────────────────────
CREATE OR REPLACE FUNCTION get_due_breakdown(p_customer_id UUID, p_selected_emi_no INT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_cust RECORD; v_next RECORD; v_sel RECORD;
  v_fine NUMERIC := 0; v_fc NUMERIC := 0; v_emi NUMERIC := 0;
  v_total NUMERIC := 0; v_pfc BOOLEAN := FALSE; v_pf BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_cust FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RETURN '{"error":"Not found"}'::JSONB; END IF;

  PERFORM calculate_and_apply_fines();

  SELECT * INTO v_next FROM emi_schedule WHERE customer_id = p_customer_id AND status = 'UNPAID' ORDER BY emi_no LIMIT 1;

  IF p_selected_emi_no IS NOT NULL THEN
    SELECT * INTO v_sel FROM emi_schedule WHERE customer_id = p_customer_id AND emi_no = p_selected_emi_no AND status = 'UNPAID';
    IF FOUND THEN v_emi := v_sel.amount; END IF;
  ELSE v_emi := COALESCE(v_next.amount, 0); END IF;

  -- Total fine = all overdue + unpaid-fine EMIs
  SELECT COALESCE(SUM(GREATEST(0, COALESCE(fine_amount,0) - COALESCE(fine_paid_amount,0))), 0) INTO v_fine
  FROM emi_schedule WHERE customer_id = p_customer_id AND fine_waived = FALSE
    AND (status = 'UNPAID' AND due_date < CURRENT_DATE OR (fine_amount > 0 AND COALESCE(fine_paid_amount,0) < fine_amount));

  IF v_fine > 0 THEN v_pf := TRUE; END IF;
  IF v_cust.first_emi_charge_amount > 0 AND v_cust.first_emi_charge_paid_at IS NULL THEN v_fc := v_cust.first_emi_charge_amount; v_pfc := TRUE; END IF;
  v_total := v_emi + v_fine + v_fc;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id, 'customer_status', v_cust.status,
    'next_emi_no', v_next.emi_no, 'next_emi_amount', v_next.amount,
    'next_emi_due_date', v_next.due_date, 'next_emi_status', v_next.status,
    'selected_emi_no', COALESCE(p_selected_emi_no, v_next.emi_no), 'selected_emi_amount', v_emi,
    'fine_due', v_fine, 'first_emi_charge_due', v_fc, 'total_payable', v_total,
    'popup_first_emi_charge', v_pfc, 'popup_fine_due', v_pf,
    'is_overdue', (v_next IS NOT NULL AND CURRENT_DATE > v_next.due_date));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 6. EMI generator with emi_start_date ────────────────────
CREATE OR REPLACE FUNCTION generate_emi_schedule(p_customer_id UUID)
RETURNS VOID AS $$
DECLARE v RECORD; sd DATE; dd DATE; i INT;
BEGIN
  SELECT * INTO v FROM customers WHERE id = p_customer_id;
  DELETE FROM emi_schedule WHERE customer_id = p_customer_id;
  sd := COALESCE(v.emi_start_date, v.purchase_date);
  FOR i IN 1..v.emi_tenure LOOP
    dd := DATE_TRUNC('month', sd + (i || ' months')::INTERVAL) + (v.emi_due_day - 1) * INTERVAL '1 day';
    IF dd > DATE_TRUNC('month', sd + (i || ' months')::INTERVAL) + INTERVAL '1 month - 1 day'
    THEN dd := DATE_TRUNC('month', sd + (i || ' months')::INTERVAL) + INTERVAL '1 month - 1 day'; END IF;
    INSERT INTO emi_schedule (customer_id, emi_no, due_date, amount) VALUES (p_customer_id, i, dd, v.emi_amount);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 7. Auto-complete trigger — fires when ALL conditions met ─
CREATE OR REPLACE FUNCTION fn_check_auto_complete()
RETURNS TRIGGER AS $$
DECLARE v_unpaid INT; v_fine_unpaid INT; v_cust RECORD;
BEGIN
  SELECT * INTO v_cust FROM customers WHERE id = NEW.customer_id AND status = 'RUNNING';
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_unpaid FROM emi_schedule WHERE customer_id = NEW.customer_id AND status IN ('UNPAID','PENDING_APPROVAL');
  SELECT COUNT(*) INTO v_fine_unpaid FROM emi_schedule WHERE customer_id = NEW.customer_id AND fine_amount > 0 AND COALESCE(fine_paid_amount,0) < fine_amount AND fine_waived = FALSE;

  IF v_unpaid = 0 AND v_fine_unpaid = 0 AND (v_cust.first_emi_charge_amount = 0 OR v_cust.first_emi_charge_paid_at IS NOT NULL) THEN
    UPDATE customers SET status = 'COMPLETE', completion_date = CURRENT_DATE WHERE id = NEW.customer_id AND status = 'RUNNING';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_complete ON emi_schedule;
CREATE TRIGGER trg_auto_complete AFTER UPDATE ON emi_schedule FOR EACH ROW EXECUTE FUNCTION fn_check_auto_complete();

-- ── 8. Run fines now ────────────────────────────────────────
SELECT * FROM calculate_and_apply_fines();

-- ── 9. Cron ─────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('calculate-fines-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('calculate-fines-daily', '0 0 * * *', 'SELECT calculate_and_apply_fines()');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
DO $$ BEGIN RAISE NOTICE 'Migration 010 complete.'; END $$;
