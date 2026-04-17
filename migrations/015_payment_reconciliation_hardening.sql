-- 015_payment_reconciliation_hardening.sql
-- Hardens reconciliation after edit/delete/re-approval flows.
-- Idempotent cleanup: remove legacy auto-apply trigger path,
-- normalize EMI/fine paid aggregates from approved payment rows,
-- and keep high-traffic reconciliation queries indexed.

-- 1) Ensure legacy DB auto-apply logic cannot double-apply payments.
DROP TRIGGER IF EXISTS trg_auto_apply ON payment_requests;
DROP TRIGGER IF EXISTS trg_auto_apply_payment_on_approval ON payment_requests;
DROP FUNCTION IF EXISTS fn_auto_apply_payment_on_approval();

-- 2) Ensure partial status is always valid.
DO $$
BEGIN
  ALTER TABLE emi_schedule DROP CONSTRAINT IF EXISTS emi_schedule_status_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE emi_schedule
  ADD CONSTRAINT emi_schedule_status_check
  CHECK (status IN ('UNPAID', 'PENDING_APPROVAL', 'PARTIALLY_PAID', 'APPROVED'));

-- 3) Rebuild EMI principal paid aggregates from approved request items only.
WITH approved_item_totals AS (
  SELECT
    pri.emi_schedule_id,
    SUM(COALESCE(pri.amount, 0)) AS principal_paid
  FROM payment_request_items pri
  JOIN payment_requests pr ON pr.id = pri.payment_request_id
  WHERE pr.status = 'APPROVED'
  GROUP BY pri.emi_schedule_id
),
first_full_paid AS (
  SELECT
    x.emi_schedule_id,
    MIN(x.approved_at) AS paid_at
  FROM (
    SELECT
      pri.emi_schedule_id,
      pr.approved_at,
      SUM(COALESCE(pri.amount, 0)) OVER (
        PARTITION BY pri.emi_schedule_id
        ORDER BY pr.approved_at NULLS LAST, pr.created_at, pr.id
      ) AS running_paid,
      es.amount AS emi_amount
    FROM payment_request_items pri
    JOIN payment_requests pr ON pr.id = pri.payment_request_id
    JOIN emi_schedule es ON es.id = pri.emi_schedule_id
    WHERE pr.status = 'APPROVED'
  ) x
  WHERE x.running_paid >= x.emi_amount
  GROUP BY x.emi_schedule_id
),
last_partial_paid AS (
  SELECT
    pri.emi_schedule_id,
    MAX(pr.approved_at) AS partial_paid_at
  FROM payment_request_items pri
  JOIN payment_requests pr ON pr.id = pri.payment_request_id
  WHERE pr.status = 'APPROVED'
  GROUP BY pri.emi_schedule_id
)
UPDATE emi_schedule es
SET
  partial_paid_amount = LEAST(COALESCE(es.amount, 0), GREATEST(0, COALESCE(ait.principal_paid, 0))),
  partial_paid_at = CASE
    WHEN COALESCE(ait.principal_paid, 0) > 0 THEN lpp.partial_paid_at
    ELSE NULL
  END,
  status = CASE
    WHEN COALESCE(ait.principal_paid, 0) >= COALESCE(es.amount, 0) AND COALESCE(es.amount, 0) > 0 THEN 'APPROVED'
    WHEN COALESCE(ait.principal_paid, 0) > 0 THEN 'PARTIALLY_PAID'
    ELSE 'UNPAID'
  END,
  paid_at = CASE
    WHEN COALESCE(ait.principal_paid, 0) >= COALESCE(es.amount, 0) AND COALESCE(es.amount, 0) > 0 THEN ffp.paid_at
    ELSE NULL
  END,
  updated_at = NOW()
FROM approved_item_totals ait
LEFT JOIN first_full_paid ffp ON ffp.emi_schedule_id = ait.emi_schedule_id
LEFT JOIN last_partial_paid lpp ON lpp.emi_schedule_id = ait.emi_schedule_id
WHERE es.id = ait.emi_schedule_id;

-- Reset rows with no approved contributions.
UPDATE emi_schedule
SET
  partial_paid_amount = 0,
  partial_paid_at = NULL,
  status = CASE WHEN status = 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL' ELSE 'UNPAID' END,
  paid_at = NULL,
  mode = NULL,
  utr = NULL,
  approved_by = NULL,
  collected_by_role = NULL,
  collected_by_user_id = NULL,
  updated_at = NOW()
WHERE id NOT IN (
  SELECT DISTINCT pri.emi_schedule_id
  FROM payment_request_items pri
  JOIN payment_requests pr ON pr.id = pri.payment_request_id
  WHERE pr.status = 'APPROVED'
);

-- 4) Rebuild fine paid aggregates from approved requests only.
WITH approved_fine_targets AS (
  SELECT
    pr.id AS payment_request_id,
    pr.customer_id,
    pr.approved_at,
    COALESCE(pr.fine_amount, 0) AS fine_amount,
    COALESCE(
      pr.fine_for_emi_no,
      (
        SELECT MIN(pri.emi_no)
        FROM payment_request_items pri
        WHERE pri.payment_request_id = pr.id
      ),
      (
        SELECT MIN(es.emi_no)
        FROM emi_schedule es
        WHERE es.customer_id = pr.customer_id
      )
    ) AS target_emi_no
  FROM payment_requests pr
  WHERE pr.status = 'APPROVED'
    AND COALESCE(pr.fine_amount, 0) > 0
),
fine_rollup AS (
  SELECT
    aft.customer_id,
    aft.target_emi_no,
    SUM(aft.fine_amount) AS fine_paid_amount,
    MAX(aft.approved_at) AS fine_paid_at
  FROM approved_fine_targets aft
  GROUP BY aft.customer_id, aft.target_emi_no
)
UPDATE emi_schedule es
SET
  fine_paid_amount = GREATEST(0, COALESCE(fr.fine_paid_amount, 0)),
  fine_paid_at = CASE WHEN COALESCE(fr.fine_paid_amount, 0) > 0 THEN fr.fine_paid_at ELSE NULL END,
  updated_at = NOW()
FROM fine_rollup fr
WHERE es.customer_id = fr.customer_id
  AND es.emi_no = fr.target_emi_no;

-- Clear fine paid where no approved fine payments exist.
UPDATE emi_schedule es
SET
  fine_paid_amount = 0,
  fine_paid_at = NULL,
  updated_at = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM payment_requests pr
  WHERE pr.customer_id = es.customer_id
    AND pr.status = 'APPROVED'
    AND COALESCE(pr.fine_amount, 0) > 0
    AND COALESCE(
      pr.fine_for_emi_no,
      (SELECT MIN(pri.emi_no) FROM payment_request_items pri WHERE pri.payment_request_id = pr.id),
      (SELECT MIN(es2.emi_no) FROM emi_schedule es2 WHERE es2.customer_id = pr.customer_id)
    ) = es.emi_no
);

-- 5) Rebuild customer first EMI charge paid marker.
UPDATE customers c
SET first_emi_charge_paid_at = src.paid_at
FROM (
  SELECT
    pr.customer_id,
    MAX(pr.approved_at) AS paid_at
  FROM payment_requests pr
  WHERE pr.status = 'APPROVED'
    AND COALESCE(pr.first_emi_charge_amount, 0) > 0
  GROUP BY pr.customer_id
) src
WHERE src.customer_id = c.id;

UPDATE customers c
SET first_emi_charge_paid_at = NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM payment_requests pr
  WHERE pr.customer_id = c.id
    AND pr.status = 'APPROVED'
    AND COALESCE(pr.first_emi_charge_amount, 0) > 0
);

-- 6) Helpful reconciliation indexes.
CREATE INDEX IF NOT EXISTS idx_payment_requests_customer_status_approved
  ON payment_requests(customer_id, status, approved_at);

CREATE INDEX IF NOT EXISTS idx_payment_request_items_payment_request_emi
  ON payment_request_items(payment_request_id, emi_schedule_id);

CREATE INDEX IF NOT EXISTS idx_emi_schedule_customer_emi_status
  ON emi_schedule(customer_id, emi_no, status);
