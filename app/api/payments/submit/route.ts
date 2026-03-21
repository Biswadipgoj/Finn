import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { customer_id, emi_ids, emi_nos, mode, utr, notes, retail_pin, total_emi_amount, scheduled_emi_amount, fine_amount, first_emi_charge_amount, total_amount, fine_for_emi_no, fine_due_date, collected_by_role, collect_type } = body;
  const noEmi = collect_type === 'fine_only' || collect_type === 'first_charge_only';
  if (!customer_id || (!noEmi && !emi_ids?.length) || !mode) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  if (!retail_pin?.trim()) return NextResponse.json({ error: 'Retailer PIN required' }, { status: 400 });
  if (mode === 'UPI' && !utr?.trim()) return NextResponse.json({ error: 'UTR required for UPI' }, { status: 400 });

  const supabase = createClient(); const svc = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: retailer } = await svc.from('retailers').select('id, retail_pin, is_active').eq('auth_user_id', user.id).single();
  if (!retailer?.is_active) return NextResponse.json({ error: 'Retailer inactive' }, { status: 403 });
  if (retailer.retail_pin !== retail_pin) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });

  if (!noEmi && emi_ids?.length) {
    const { data: ch } = await svc.from('emi_schedule').select('id, status').in('id', emi_ids).eq('customer_id', customer_id);
    if ((ch || []).some(e => e.status !== 'UNPAID')) return NextResponse.json({ error: 'EMI already pending/paid' }, { status: 409 });
  }

  const { data: request, error: re } = await svc.from('payment_requests').insert({
    customer_id, retailer_id: retailer.id, submitted_by: user.id, status: 'PENDING', mode,
    utr: utr || null, total_emi_amount: total_emi_amount || 0, scheduled_emi_amount: scheduled_emi_amount || 0,
    fine_amount: fine_amount || 0, first_emi_charge_amount: first_emi_charge_amount || 0, total_amount: total_amount || 0,
    notes: [notes, utr ? 'UTR: ' + utr : ''].filter(Boolean).join(' | ') || null,
    selected_emi_nos: emi_nos || [], fine_for_emi_no: fine_for_emi_no || null, fine_due_date: fine_due_date || null,
    collected_by_role: collected_by_role || 'retailer', collected_by_user_id: user.id,
  }).select().single();
  if (re || !request) return NextResponse.json({ error: re?.message || 'Failed' }, { status: 500 });

  if (!noEmi && emi_ids?.length) {
    const items = emi_ids.map((eid: string, i: number) => ({ payment_request_id: request.id, emi_schedule_id: eid, emi_no: emi_nos[i], amount: parseFloat(total_emi_amount) / emi_ids.length }));
    const { error: ie } = await svc.from('payment_request_items').insert(items);
    if (ie) { await svc.from('payment_requests').delete().eq('id', request.id); return NextResponse.json({ error: 'Failed to record items' }, { status: 500 }); }
    await svc.from('emi_schedule').update({ status: 'PENDING_APPROVAL' }).in('id', emi_ids);
  }

  if (noEmi && fine_amount > 0) {
    const { data: oe } = await svc.from('emi_schedule').select('id, emi_no').eq('customer_id', customer_id).eq('status', 'UNPAID').lt('due_date', new Date().toISOString().split('T')[0]).order('emi_no').limit(1).single();
    if (oe) {
      await svc.from('emi_schedule').update({ fine_paid_amount: fine_amount, fine_paid_at: new Date().toISOString() }).eq('id', oe.id);
      await svc.from('fine_history').insert({ customer_id, emi_schedule_id: oe.id, emi_no: oe.emi_no, fine_type: 'PAID', fine_amount, cumulative_fine: fine_amount, fine_date: new Date().toISOString().split('T')[0], reason: 'Retailer collected fine via ' + mode }).catch(() => {});
    }
  }
  return NextResponse.json({ success: true, request_id: request.id });
}
