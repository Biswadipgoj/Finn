import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recomputeCustomerCompletion, recomputeCustomerLedgerFromRequests } from '@/lib/paymentReconcile';

async function requireSuperAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return { error: NextResponse.json({ ok: false, error: 'Forbidden — super admin only' }, { status: 403 }) };
  return { user };
}

function normalizePaidAt(value: unknown, fallback?: string | null) {
  if (!value) return fallback ?? null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? (fallback ?? null) : d.toISOString();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireSuperAdmin();
    if ('error' in auth) return auth.error;
    const { user } = auth;
    const svc = createServiceClient();
    const paymentId = params.id;

    const { data: before, error: fetchErr } = await svc
      .from('payment_requests')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (fetchErr || !before) return NextResponse.json({ ok: false, error: 'Payment request not found' }, { status: 404 });

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const nextStatus = String(body.status ?? before.status);
    const nextPaidAt = normalizePaidAt(body.paid_at, before.approved_at || null);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      status: nextStatus,
      mode: body.mode ?? before.mode ?? 'CASH',
      utr: body.utr !== undefined ? body.utr || null : before.utr ?? null,
      total_emi_amount: Number(body.total_emi_amount ?? before.total_emi_amount ?? 0),
      fine_amount: Number(body.fine_amount ?? before.fine_amount ?? 0),
      first_emi_charge_amount: Number(body.first_emi_charge_amount ?? before.first_emi_charge_amount ?? 0),
      total_amount: Number(body.total_amount ?? before.total_amount ?? 0),
      notes: body.notes !== undefined ? (body.notes || null) : (before.notes ?? null),
      collected_by_role: body.collected_by_role !== undefined ? (body.collected_by_role || null) : (before.collected_by_role ?? null),
      collected_by_user_id: body.collected_by_user_id !== undefined ? (body.collected_by_user_id || null) : (before.collected_by_user_id ?? null),
      fine_for_emi_no: body.fine_for_emi_no !== undefined ? (body.fine_for_emi_no || null) : (before.fine_for_emi_no ?? null),
      fine_due_date: body.fine_due_date !== undefined ? (body.fine_due_date || null) : (before.fine_due_date ?? null),
    };

    if (nextStatus === 'APPROVED') {
      updates.approved_at = nextPaidAt || new Date().toISOString();
      updates.approved_by = user.id;
    } else if (nextStatus !== 'APPROVED') {
      updates.approved_at = null;
      updates.approved_by = null;
    }

    const { error: updateErr } = await svc.from('payment_requests').update(updates).eq('id', paymentId);
    if (updateErr) {
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    const after = { ...before, ...updates };
    await recomputeCustomerLedgerFromRequests(svc, before.customer_id);
    await recomputeCustomerCompletion(svc, before.customer_id);

    const { error: patchAuditErr } = await svc.from('audit_log').insert({
      actor_user_id: user.id,
      actor_role: 'super_admin',
      action: 'EDIT_PAYMENT',
      table_name: 'payment_requests',
      record_id: paymentId,
      before_data: before,
      after_data: after,
      remark: 'Payment updated from approvals edit form',
    });
    if (patchAuditErr) console.warn('PATCH payment audit_log insert failed', patchAuditErr.message);

    return NextResponse.json({ success: true, message: 'Payment updated successfully.', payment: after });
  } catch (error) {
    console.error('PATCH /api/admin/payments/[id] failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireSuperAdmin();
    if ('error' in auth) return auth.error;
    const { user } = auth;
    const svc = createServiceClient();
    const paymentId = params.id;

    const { data: before, error: fetchErr } = await svc
      .from('payment_requests')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (fetchErr || !before) return NextResponse.json({ ok: false, error: 'Payment request not found' }, { status: 404 });

    const { error: deleteErr } = await svc.from('payment_requests').delete().eq('id', paymentId);
    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });
    }

    await recomputeCustomerLedgerFromRequests(svc, before.customer_id);
    await recomputeCustomerCompletion(svc, before.customer_id);

    const { error: deleteAuditErr } = await svc.from('audit_log').insert({
      actor_user_id: user.id,
      actor_role: 'super_admin',
      action: 'DELETE_PAYMENT',
      table_name: 'payment_requests',
      record_id: paymentId,
      before_data: before,
      after_data: { deleted: true },
      remark: 'Payment deleted from approvals edit form',
    });
    if (deleteAuditErr) console.warn('DELETE payment audit_log insert failed', deleteAuditErr.message);

    return NextResponse.json({ success: true, message: 'Payment deleted successfully.' });
  } catch (error) {
    console.error('DELETE /api/admin/payments/[id] failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
