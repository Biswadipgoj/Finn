import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recomputeCustomerCompletion } from '@/lib/paymentReconcile';

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toIsoOrNull(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return { error: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }

  return { user };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;

    const emiId = params.id;
    const svc = createServiceClient();
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { data: existing, error: fetchError } = await svc
      .from('emi_schedule')
      .select('*')
      .eq('id', emiId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ ok: false, error: 'EMI row not found' }, { status: 404 });
    }

    const emiAmount = asNumber(body.amount ?? existing.amount);
    const paidAmount = Math.max(0, asNumber(body.partial_paid_amount ?? existing.partial_paid_amount));

    const nextStatus = (() => {
      if (body.status) return String(body.status);
      if (paidAmount >= emiAmount && emiAmount > 0) return 'APPROVED';
      if (paidAmount > 0) return 'PARTIALLY_PAID';
      return 'UNPAID';
    })();

    const payload: Record<string, unknown> = {
      emi_no: Math.max(1, asNumber(body.emi_no ?? existing.emi_no, 1)),
      due_date: body.due_date || existing.due_date,
      amount: emiAmount,
      status: nextStatus,
      partial_paid_amount: paidAmount,
      partial_paid_at: body.partial_paid_at !== undefined ? toIsoOrNull(body.partial_paid_at) : existing.partial_paid_at,
      paid_at: body.paid_at !== undefined ? toIsoOrNull(body.paid_at) : existing.paid_at,
      mode: body.mode !== undefined ? (body.mode || null) : existing.mode,
      utr: body.utr !== undefined ? (body.utr || null) : existing.utr,
      fine_amount: Math.max(0, asNumber(body.fine_amount ?? existing.fine_amount)),
      fine_paid_amount: Math.max(0, asNumber(body.fine_paid_amount ?? existing.fine_paid_amount)),
      fine_paid_at: body.fine_paid_at !== undefined ? toIsoOrNull(body.fine_paid_at) : existing.fine_paid_at,
      fine_waived: body.fine_waived !== undefined ? !!body.fine_waived : !!existing.fine_waived,
      collected_by_role: body.collected_by_role !== undefined ? (body.collected_by_role || null) : existing.collected_by_role,
      collected_by_user_id: body.collected_by_user_id !== undefined ? (body.collected_by_user_id || null) : existing.collected_by_user_id,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === 'APPROVED' && !payload.paid_at) {
      payload.paid_at = new Date().toISOString();
      payload.partial_paid_amount = Math.max(emiAmount, paidAmount);
    }
    if (nextStatus === 'UNPAID') {
      payload.paid_at = null;
      payload.partial_paid_at = null;
      payload.partial_paid_amount = 0;
    }

    const { data, error } = await svc
      .from('emi_schedule')
      .update(payload)
      .eq('id', emiId)
      .select('*')
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    await recomputeCustomerCompletion(svc, existing.customer_id);

    return NextResponse.json({ ok: true, message: 'EMI updated successfully', emi: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
