import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
    if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { customer_id, emi_ids, emi_nos, mode, utr, notes, total_emi_amount, scheduled_emi_amount, fine_amount, first_emi_charge_amount, total_amount, fine_for_emi_no, fine_due_date, collect_type } = body;
    const noEmi = collect_type === 'fine_only' || collect_type === 'first_charge_only';
    if (!customer_id || (!noEmi && !emi_ids?.length) || !mode) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    if (mode === 'UPI' && !utr?.trim()) return NextResponse.json({ error: 'UTR required' }, { status: 400 });

    const svc = createServiceClient();
    const { data: customer } = await svc.from('customers').select('retailer_id, status').eq('id', customer_id).single();
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    if (customer.status !== 'RUNNING') {
      return NextResponse.json({ error: `Cannot collect payment for ${customer.status} customer` }, { status: 400 });
    }

    if (!noEmi && emi_ids?.length) {
      const { data: ch } = await svc
        .from('emi_schedule')
        .select('id, status')
        .in('id', emi_ids)
        .eq('customer_id', customer_id);

      if ((ch || []).length !== emi_ids.length) {
        return NextResponse.json({ error: 'One or more selected EMIs are invalid for this customer' }, { status: 400 });
      }
      if ((ch || []).some(e => e.status === 'APPROVED' || e.status === 'PENDING_APPROVAL')) {
        return NextResponse.json({ error: 'EMI already pending or fully paid' }, { status: 409 });
      }
    }

    const { data: request, error } = await svc.from('payment_requests').insert({
      customer_id, retailer_id: customer.retailer_id, submitted_by: user.id, status: 'PENDING_APPROVAL', mode,
      utr: utr || null, total_emi_amount: total_emi_amount || 0, scheduled_emi_amount: scheduled_emi_amount || 0,
      fine_amount: fine_amount || 0, first_emi_charge_amount: first_emi_charge_amount || 0, total_amount: total_amount || 0,
      notes: [notes, utr ? 'UTR: ' + utr : ''].filter(Boolean).join(' | ') || null,
      selected_emi_nos: emi_nos || [], fine_for_emi_no: fine_for_emi_no || null, fine_due_date: fine_due_date || null,
      collected_by_role: 'admin', collected_by_user_id: user.id,
    }).select().single();
    if (error || !request) return NextResponse.json({ error: error?.message || 'Failed to create payment' }, { status: 500 });

    if (!noEmi && emi_ids?.length) {
      const eachAmount = Number(total_emi_amount || 0) / Math.max(emi_ids.length, 1);
      const items = emi_ids.map((eid: string, i: number) => ({ payment_request_id: request.id, emi_schedule_id: eid, emi_no: emi_nos[i], amount: eachAmount }));
      const { error: itemErr } = await svc.from('payment_request_items').insert(items);
      if (itemErr) {
        await svc.from('payment_requests').delete().eq('id', request.id);
        return NextResponse.json({ error: itemErr.message }, { status: 500 });
      }
    }

    const { data: approved, error: approveErr } = await svc.rpc('approve_payment_request_v3', {
      p_request_id: request.id,
      p_admin_id: user.id,
      p_remark: notes || 'Direct admin collection',
    });
    if (approveErr || approved?.success === false) {
      await svc.from('payment_requests').delete().eq('id', request.id);
      return NextResponse.json({ error: approveErr?.message || approved?.error || 'Failed to approve payment' }, { status: 500 });
    }

    return NextResponse.json({ success: true, request_id: request.id, approved_at: approved?.approved_at });
  } catch (error) {
    console.error('approve-direct failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
