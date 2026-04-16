CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS portal_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notice_key TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL DEFAULT 'retailer'
    CHECK (audience IN ('retailer', 'super_admin', 'customer', 'all')),
  title TEXT,
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_portal_notices_key
  ON portal_notices (notice_key);

CREATE INDEX IF NOT EXISTS idx_portal_notices_active_audience
  ON portal_notices (is_active, audience, sort_order);

CREATE OR REPLACE FUNCTION set_portal_notices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_portal_notices_updated_at ON portal_notices;

CREATE TRIGGER trg_portal_notices_updated_at
BEFORE UPDATE ON portal_notices
FOR EACH ROW
EXECUTE FUNCTION set_portal_notices_updated_at();

INSERT INTO portal_notices (
  notice_key,
  audience,
  title,
  message,
  is_active,
  sort_order
)
VALUES (
  'retailer_bottom_disclaimer',
  'retailer',
  'Payment Reminder',
  'Please verify customer details before collecting payment. Submit payment requests before the due date. Late fine status is calculated automatically based on payment timing.',
  TRUE,
  1
)
ON CONFLICT (notice_key)
DO UPDATE SET
  audience = EXCLUDED.audience,
  title = EXCLUDED.title,
  message = EXCLUDED.message,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

ALTER TABLE portal_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_notices_super_admin_all" ON portal_notices;
DROP POLICY IF EXISTS "portal_notices_authenticated_read_active" ON portal_notices;

CREATE POLICY "portal_notices_super_admin_all"
ON portal_notices
FOR ALL
USING (get_my_role() = 'super_admin')
WITH CHECK (get_my_role() = 'super_admin');

CREATE POLICY "portal_notices_authenticated_read_active"
ON portal_notices
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND is_active = TRUE
  AND (
    audience = 'all'
    OR audience = get_my_role()
  )
);

GRANT SELECT ON portal_notices TO authenticated;
GRANT INSERT, UPDATE, DELETE ON portal_notices TO authenticated;
