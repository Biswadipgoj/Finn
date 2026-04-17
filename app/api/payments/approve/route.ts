import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { applyApprovedRequestEffects, recomputeCustomerCompletion } from '@/lib/paymentReconcile';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
    if (profile?.role !== 'super_admin') return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { request_id, remark } = body;
    if (!request_id) return NextResponse.json({ ok: false, error: 'request_id required' }, { status: 400 });

    const svc = createServiceClient();
    const { data: request, error } = await svc.from('payment_requests').select('*').eq('id', request_id).single();
    if (error || !request) return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
    if (request.status !== 'PENDING') return NextResponse.json({ ok: false, error: 'Request is not pending' }, { status: 400 });

    const now = new Date().toISOString();
    const notes = remark ? [request.notes, `Admin remark: ${remark}`].filter(Boolean).join('\n') : request.notes;
    const { error: reqErr } = await svc.from('payment_requests').update({
      status: 'APPROVED', approved_by: user.id, approved_at: now, notes,
    }).eq('id', request_id);
    if (reqErr) return NextResponse.json({ ok: false, error: reqErr.message }, { status: 500 });

    await applyApprovedRequestEffects(svc, { ...request, status: 'APPROVED', approved_by: user.id, approved_at: now, notes }, user.id, now);
    await recomputeCustomerCompletion(svc, request.customer_id);
    return NextResponse.json({ success: true, request_id, approved_at: now });
  } catch (error) {
    console.error('payments/approve failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
