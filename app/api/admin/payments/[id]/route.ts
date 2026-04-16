import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  return v.includes('T') ? v : `${v}T00:00:00.000Z`;
}

async function reverseFinePayment(
  svc: any,
  customerId: string,
  amount: number,
  preferredEmiNo?: number | null
) {
  let remaining = Math.max(0, Number(amount || 0));
  if (remaining <= 0) return;

  let query = svc
    .from('emi_schedule')
    .select('id, emi_no, fine_paid_amount')
    .eq('customer_id', customerId)
    .gt('fine_paid_amount', 0)
    .order('fine_paid_at', { ascending: false, nullsFirst: false })
    .order('emi_no', { ascending: true });

  if (preferredEmiNo) query = query.eq('emi_no', preferredEmiNo);

  let { data: rows } = await query;

  if ((!rows || rows.length === 0) && preferredEmiNo) {
    const retry = await svc
      .from('emi_schedule')
      .select('id, emi_no, fine_paid_amount')
      .eq('customer_id', customerId)
      .gt('fine_paid_amount', 0)
      .order('fine_paid_at', { ascending: false, nullsFirst: false })
      .order('emi_no', { ascending: true });
    rows = retry.data || [];
  }

  for (const row of rows || []) {
    if (remaining <= 0) break;
    const paid = Number(row.fine_paid_amount || 0);
    const takeBack = Math.min(paid, remaining);
    const nextPaid = Math.max(0, paid - takeBack);
    const fineUpdate: Record<string, unknown> = {
      fine_paid_amount: nextPaid,
      updated_at: new Date().toISOString(),
    };
    if (nextPaid <= 0) fineUpdate.fine_paid_at = null;
    await svc.from('emi_schedule').update(fineUpdate).eq('id', row.id);
    remaining -= takeBack;
  }
}

async function clearFirstChargeIfNoOtherApprovedPayment(
  svc: any,
  customerId: string,
  exceptPaymentId: string
) {
  const { count } = await svc
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'APPROVED')
    .gt('first_emi_charge_amount', 0)
    .neq('id', exceptPaymentId);

  if (!count) {
    await svc.from('customers')
      .update({ first_emi_charge_paid_at: null, updated_at: new Date().toISOString() })
      .eq('id', customerId);
  }
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
  const paymentId = params.id;

  const { data: before, error: fetchErr } = await svc
    .from('payment_requests')
    .select('*')
    .eq('id', paymentId)
    .single();

  if (fetchErr || !before) {
    return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
  }

  const body = await req.json();
  const {
    status,
    mode,
    total_emi_amount,
    fine_amount,
    first_emi_charge_amount,
    total_amount,
    notes,
    paid_at,
    approved_by,
    collected_by_role,
    collected_by_user_id,
  } = body as Record<string, unknown>;

  const nowIso = new Date().toISOString();
  const paidAtIso = paid_at !== undefined ? toIsoDate(paid_at) : null;
  const nextStatus = String(status ?? before.status);

  const updates: Record<string, unknown> = { updated_at: nowIso };

  if (status !== undefined) updates.status = status;
  if (mode !== undefined) updates.mode = mode;
  if (total_emi_amount !== undefined) updates.total_emi_amount = Number(total_emi_amount) || 0;
  if (fine_amount !== undefined) updates.fine_amount = Number(fine_amount) || 0;
  if (first_emi_charge_amount !== undefined) updates.first_emi_charge_amount = Number(first_emi_charge_amount) || 0;
  if (total_amount !== undefined) updates.total_amount = Number(total_amount) || 0;
  if (notes !== undefined) updates.notes = notes;
  if (approved_by !== undefined) updates.approved_by = approved_by;
  if (collected_by_role !== undefined) updates.collected_by_role = collected_by_role;
  if (collected_by_user_id !== undefined) updates.collected_by_user_id = collected_by_user_id;

  if (nextStatus === 'APPROVED') {
    if (paid_at !== undefined && paidAtIso) updates.approved_at = paidAtIso;
    if (before.status !== 'APPROVED') {
      updates.approved_at = paidAtIso || nowIso;
      updates.approved_by = updates.approved_by || user.id;
    }
  } else if (status !== undefined) {
    // Critical bug fix: rejected/deleted-style payment edits must not keep the
    // old approved date, otherwise the payment still appears in payment-date
    // summaries even though it is no longer approved.
    updates.approved_at = null;
    updates.approved_by = null;
  }

  const { data: items } = await svc
    .from('payment_request_items')
    .select('emi_schedule_id, emi_no')
    .eq('payment_request_id', paymentId);

  const emiIds = (items || []).map(i => i.emi_schedule_id).filter(Boolean);
  const emiNos = (items || []).map(i => Number(i.emi_no)).filter(n => Number.isFinite(n));
  const lowestEmiNo = emiNos.length ? Math.min(...emiNos) : (before.fine_for_emi_no || null);

  const isReversingApprovedPayment = before.status === 'APPROVED' && nextStatus !== 'APPROVED';

  if (isReversingApprovedPayment) {
    if (emiIds.length > 0) {
      await svc.from('emi_schedule').update({
        status: nextStatus === 'PENDING' ? 'PENDING_APPROVAL' : 'UNPAID',
        paid_at: null,
        mode: null,
        utr: null,
        approved_by: null,
        collected_by_role: null,
        collected_by_user_id: null,
        updated_at: nowIso,
      }).in('id', emiIds);
    }

    await reverseFinePayment(svc, before.customer_id as string, Number(before.fine_amount || 0), lowestEmiNo);

    if (Number(before.first_emi_charge_amount || 0) > 0) {
      await clearFirstChargeIfNoOtherApprovedPayment(svc, before.customer_id as string, paymentId);
    }
  }

  if (nextStatus === 'APPROVED') {
    const effectivePaidAt = (paid_at !== undefined ? paidAtIso : (before.approved_at as string | null)) || nowIso;

    if (emiIds.length > 0) {
      await svc.from('emi_schedule').update({
        status: 'APPROVED',
        paid_at: effectivePaidAt,
        mode: (mode as string) || before.mode,
        utr: (body.utr as string) || before.utr || null,
        approved_by: user.id,
        collected_by_role: (collected_by_role as string) || before.collected_by_role || 'admin',
        collected_by_user_id: (collected_by_user_id as string) || before.collected_by_user_id || user.id,
        updated_at: nowIso,
      }).in('id', emiIds);
    }

    const nextFine = Number(fine_amount ?? before.fine_amount) || 0;
    const previousFine = Number(before.fine_amount || 0);
    if (nextFine > 0 && lowestEmiNo) {
      await svc.from('emi_schedule')
        .update({ fine_paid_amount: nextFine, fine_paid_at: effectivePaidAt, updated_at: nowIso })
        .eq('customer_id', before.customer_id)
        .eq('emi_no', lowestEmiNo);

      if (before.status !== 'APPROVED') {
        await svc.from('fine_history').insert({
          customer_id: before.customer_id,
          emi_no: lowestEmiNo,
          fine_type: 'PAID',
          fine_amount: nextFine,
          cumulative_fine: nextFine,
          fine_date: effectivePaidAt.split('T')[0],
          reason: 'Admin manual edit: fine collected',
        }).catch(() => {});
      }
    } else if (previousFine > 0 && nextFine <= 0) {
      await reverseFinePayment(svc, before.customer_id as string, previousFine, lowestEmiNo);
    }

    const firstChargeCollected = Number(first_emi_charge_amount ?? before.first_emi_charge_amount) || 0;
    if (firstChargeCollected > 0) {
      await svc.from('customers')
        .update({ first_emi_charge_paid_at: effectivePaidAt, updated_at: nowIso })
        .eq('id', before.customer_id);
    }
  }

  const { data: after, error: updateErr } = await svc
    .from('payment_requests')
    .update(updates)
    .eq('id', paymentId)
    .select('*')
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await svc.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: isReversingApprovedPayment ? 'REVERSE_APPROVED_PAYMENT' : 'EDIT_PAYMENT',
    table_name: 'payment_requests',
    record_id: paymentId,
    before_data: before,
    after_data: after,
    remark: `Admin edited payment: ${Object.keys(updates).filter(k => k !== 'updated_at').join(', ')}`,
  }).catch(() => {});

  return NextResponse.json({ success: true, updated: after });
}

export async function DELETE(
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
  const paymentId = params.id;

  const { data: before, error: fetchErr } = await svc
    .from('payment_requests')
    .select('*')
    .eq('id', paymentId)
    .single();

  if (fetchErr || !before) {
    return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
  }

  const { data: items } = await svc
    .from('payment_request_items')
    .select('emi_schedule_id, emi_no')
    .eq('payment_request_id', paymentId);

  const emiIds = (items || []).map(i => i.emi_schedule_id).filter(Boolean);
  const emiNos = (items || []).map(i => Number(i.emi_no)).filter(n => Number.isFinite(n));
  const lowestEmiNo = emiNos.length ? Math.min(...emiNos) : (before.fine_for_emi_no || null);
  const nowIso = new Date().toISOString();

  if (before.status === 'APPROVED') {
    if (emiIds.length > 0) {
      await svc.from('emi_schedule').update({
        status: 'UNPAID',
        paid_at: null,
        mode: null,
        utr: null,
        approved_by: null,
        collected_by_role: null,
        collected_by_user_id: null,
        updated_at: nowIso,
      }).in('id', emiIds);
    }

    await reverseFinePayment(svc, before.customer_id as string, Number(before.fine_amount || 0), lowestEmiNo);

    if (Number(before.first_emi_charge_amount || 0) > 0) {
      await clearFirstChargeIfNoOtherApprovedPayment(svc, before.customer_id as string, paymentId);
    }
  } else if (emiIds.length > 0) {
    await svc.from('emi_schedule').update({
      status: 'UNPAID',
      paid_at: null,
      mode: null,
      utr: null,
      approved_by: null,
      collected_by_role: null,
      collected_by_user_id: null,
      updated_at: nowIso,
    }).in('id', emiIds);
  }

  await svc.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'DELETE_PAYMENT_AND_REVERSE_EFFECTS',
    table_name: 'payment_requests',
    record_id: paymentId,
    before_data: before,
    after_data: null,
    remark: 'Super admin deleted payment; linked EMI/fine/first-charge payment markers were cleared',
  }).catch(() => {});

  const { error: deleteErr } = await svc.from('payment_requests').delete().eq('id', paymentId);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
