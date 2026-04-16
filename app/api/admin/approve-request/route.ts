import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { applyApprovedRequestEffects, recomputeCustomerCompletion } from '@/lib/paymentReconcile';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
    if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { request_id, remark } = body as { request_id?: string; remark?: string };
    if (!request_id) return NextResponse.json({ error: 'request_id is required' }, { status: 400 });

    const svc = createServiceClient();
    const { data: request, error: fetchErr } = await svc.from('payment_requests').select('*').eq('id', request_id).single();
    if (fetchErr || !request) return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
    if (request.status === 'APPROVED') return NextResponse.json({ success: true, already_approved: true, request_id });
    if (request.status !== 'PENDING') return NextResponse.json({ error: `Cannot approve: status is ${request.status}` }, { status: 400 });

    const now = new Date().toISOString();
    const notes = remark ? [request.notes, `Admin remark: ${remark}`].filter(Boolean).join('\n') : request.notes;
    const { error: reqErr } = await svc.from('payment_requests').update({
      status: 'APPROVED', approved_by: user.id, approved_at: now, notes,
    }).eq('id', request_id);
    if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 });

    await applyApprovedRequestEffects(svc, { ...request, status: 'APPROVED', approved_by: user.id, approved_at: now, notes }, user.id, now);
    await recomputeCustomerCompletion(svc, request.customer_id);

    await svc.from('audit_log').insert({
      actor_user_id: user.id,
      actor_role: 'super_admin',
      action: 'APPROVE_PAYMENT',
      table_name: 'payment_requests',
      record_id: request_id,
      before_data: { status: 'PENDING' },
      after_data: { status: 'APPROVED', approved_at: now },
      remark: remark ?? null,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, request_id, approved_at: now });
  } catch (error) {
    console.error('approve-request failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
