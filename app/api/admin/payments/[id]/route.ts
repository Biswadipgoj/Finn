export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

async function requireSuperAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden — super admin only' }, { status: 403 }) };
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
    const body = await req.json().catch(() => ({}));

    if (body.mode === 'UPI' && !String(body.utr || '').trim()) {
      return NextResponse.json({ error: 'UTR is required for UPI payments.' }, { status: 400 });
    }

    const updates = {
      status: body.status,
      mode: body.mode,
      utr: body.utr ?? null,
      total_emi_amount: Number(body.total_emi_amount ?? 0),
      fine_amount: Number(body.fine_amount ?? 0),
      first_emi_charge_amount: Number(body.first_emi_charge_amount ?? 0),
      total_amount: Number(body.total_amount ?? 0),
      notes: body.notes ?? null,
      paid_at: normalizePaidAt(body.paid_at, null),
      collected_by_role: body.collected_by_role ?? null,
      collected_by_user_id: body.collected_by_user_id ?? null,
      fine_for_emi_no: body.fine_for_emi_no ?? null,
      fine_due_date: body.fine_due_date ?? null,
    };

    const svc = createServiceClient();
    const { data, error } = await svc.rpc('edit_payment_request_v3', {
      p_request_id: params.id,
      p_admin_id: user.id,
      p_updates: updates,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && data.success === false) {
      return NextResponse.json({ error: data.error || 'Payment edit failed' }, { status: 409 });
    }

    return NextResponse.json({ success: true, message: 'Payment updated successfully.', payment: data?.payment ?? null });
  } catch (error) {
    console.error('PATCH /api/admin/payments/[id] failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireSuperAdmin();
    if ('error' in auth) return auth.error;
    const { user } = auth;

    const svc = createServiceClient();
    const { data, error } = await svc.rpc('delete_payment_request_v3', {
      p_request_id: params.id,
      p_admin_id: user.id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && data.success === false) {
      return NextResponse.json({ error: data.error || 'Payment delete failed' }, { status: 409 });
    }

    return NextResponse.json({ success: true, message: 'Payment deleted successfully.' });
  } catch (error) {
    console.error('DELETE /api/admin/payments/[id] failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
