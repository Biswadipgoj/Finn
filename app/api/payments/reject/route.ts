import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recomputeCustomerCompletion, recomputeCustomerLedgerFromRequests } from '@/lib/paymentReconcile';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
    if (profile?.role !== 'super_admin') return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { request_id, reason } = body;
    if (!request_id || !reason) return NextResponse.json({ ok: false, error: 'request_id and reason are required' }, { status: 400 });

    const svc = createServiceClient();
    const { data: request, error } = await svc.from('payment_requests').select('*').eq('id', request_id).single();
    if (error || !request) return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });


    const { error: reqErr } = await svc.from('payment_requests').update({
      status: 'REJECTED',
      rejected_by: user.id,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
      approved_by: null,
      approved_at: null,
    }).eq('id', request_id);
    if (reqErr) return NextResponse.json({ ok: false, error: reqErr.message }, { status: 500 });

    await recomputeCustomerLedgerFromRequests(svc, request.customer_id);
    await recomputeCustomerCompletion(svc, request.customer_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('payments/reject failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
