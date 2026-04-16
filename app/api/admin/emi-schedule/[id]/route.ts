import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ALLOWED_STATUSES = new Set(['UNPAID', 'PENDING_APPROVAL', 'APPROVED']);
const ALLOWED_MODES = new Set(['CASH', 'UPI']);

function asNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function asNullableIso(value: unknown): string | null | undefined {
  const s = asNullableString(value);
  if (s === undefined || s === null) return s;
  return s.includes('T') ? s : `${s}T00:00:00.000Z`;
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden — super admin only' }, { status: 403 });
  }

  const svc = createServiceClient();
  const emiId = params.id;

  const { data: before, error: fetchErr } = await svc
    .from('emi_schedule')
    .select('*')
    .eq('id', emiId)
    .single();

  if (fetchErr || !before) {
    return NextResponse.json({ error: 'EMI row not found' }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const dueDate = asNullableString(body.due_date);
  if (dueDate !== undefined) updates.due_date = dueDate;

  const amount = asNumber(body.amount);
  if (amount !== undefined) updates.amount = amount;

  const fineAmount = asNumber(body.fine_amount);
  if (fineAmount !== undefined) updates.fine_amount = fineAmount;

  const finePaidAmount = asNumber(body.fine_paid_amount);
  if (finePaidAmount !== undefined) updates.fine_paid_amount = finePaidAmount;

  if (body.fine_waived !== undefined) updates.fine_waived = Boolean(body.fine_waived);

  const status = asNullableString(body.status);
  if (status !== undefined) {
    if (status === null || !ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid EMI status' }, { status: 400 });
    }
    updates.status = status;
  }

  const paidAt = asNullableIso(body.paid_at);
  if (paidAt !== undefined) updates.paid_at = paidAt;

  const finePaidAt = asNullableIso(body.fine_paid_at);
  if (finePaidAt !== undefined) updates.fine_paid_at = finePaidAt;

  const mode = asNullableString(body.mode);
  if (mode !== undefined) {
    if (mode !== null && !ALLOWED_MODES.has(mode)) {
      return NextResponse.json({ error: 'Invalid payment mode' }, { status: 400 });
    }
    updates.mode = mode;
  }

  const utr = asNullableString(body.utr);
  if (utr !== undefined) updates.utr = utr;

  if (body.collected_by_role !== undefined) {
    const role = asNullableString(body.collected_by_role);
    updates.collected_by_role = role;
  }

  // Convenience cleanup: when super admin marks an EMI as unpaid and leaves
  // payment fields blank in the editor, remove the old paid date/mode/UTR so
  // the payment date no longer appears in EMI summaries.
  if (updates.status === 'UNPAID') {
    if (body.paid_at === undefined) updates.paid_at = null;
    if (body.mode === undefined) updates.mode = null;
    if (body.utr === undefined) updates.utr = null;
    updates.approved_by = null;
    updates.collected_by_role = null;
    updates.collected_by_user_id = null;
  }

  const { data: after, error: updateErr } = await svc
    .from('emi_schedule')
    .update(updates)
    .eq('id', emiId)
    .select('*')
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await svc.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'EDIT_EMI_SCHEDULE',
    table_name: 'emi_schedule',
    record_id: emiId,
    before_data: before,
    after_data: after,
    remark: 'Super admin edited EMI/fine/payment data',
  }).catch(() => {});

  return NextResponse.json({ success: true, emi: after });
}
