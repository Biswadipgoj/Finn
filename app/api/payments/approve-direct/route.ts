import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json();
  const { customer_id, emi_ids, emi_nos, mode, utr, notes, total_emi_amount, scheduled_emi_amount, fine_amount, first_emi_charge_amount, total_amount, fine_for_emi_no, fine_due_date, collect_type } = body;
  const noEmi = collect_type === 'fine_only' || collect_type === 'first_charge_only';
  if (!customer_id || (!noEmi && !emi_ids?.length) || !mode) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (mode === 'UPI' && !utr?.trim()) return NextResponse.json({ error: 'UTR required' }, { status: 400 });

  const svc = createServiceClient();
  const { data: customer } = await svc.from('customers').select('*, retailers(*)').eq('id', customer_id).single();
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const now = new Date().toISOString();
  const emis = (!noEmi && emi_ids?.length) ? (await svc.from('emi_schedule').select('*').in('id', emi_ids).eq('customer_id', customer_id)).data || [] : [];

  const { data: request, error } = await svc.from('payment_requests').insert({
    customer_id, retailer_id: customer.retailer_id, submitted_by: user.id, status: 'APPROVED', mode,
    utr: utr || null, total_emi_amount: total_emi_amount || 0, scheduled_emi_amount: scheduled_emi_amount || 0,
    fine_amount: fine_amount || 0, first_emi_charge_amount: first_emi_charge_amount || 0, total_amount,
    notes: [notes, utr ? 'UTR: ' + utr : ''].filter(Boolean).join(' | ') || null,
    approved_by: user.id, approved_at: now, selected_emi_nos: emi_nos || [],
    fine_for_emi_no: fine_for_emi_no || null, fine_due_date: fine_due_date || null,
    collected_by_role: 'admin', collected_by_user_id: user.id,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (emis.length > 0) {
    await svc.from('payment_request_items').insert(emis.map((e: { id: string; emi_no: number; amount: number }) => ({ payment_request_id: request.id, emi_schedule_id: e.id, emi_no: e.emi_no, amount: e.amount })));
    await svc.from('emi_schedule').update({ status: 'APPROVED', paid_at: now, mode, utr: utr || null, approved_by: user.id, collected_by_role: 'admin', collected_by_user_id: user.id }).in('id', emi_ids);
  }

  if (fine_amount > 0) {
    let fid: string | null = null, fno: number | null = null;
    if (emis.length) { const ln = Math.min(...emis.map((e: { emi_no: number }) => e.emi_no)); fno = ln; fid = (emis.find((e: { emi_no: number }) => e.emi_no === ln) as { id: string })?.id; await svc.from('emi_schedule').update({ fine_paid_amount: fine_amount, fine_paid_at: now }).eq('customer_id', customer_id).eq('emi_no', ln); }
    else { const { data: oe } = await svc.from('emi_schedule').select('id,emi_no').eq('customer_id', customer_id).eq('status', 'UNPAID').lt('due_date', now.split('T')[0]).order('emi_no').limit(1).single(); if (oe) { fid = oe.id; fno = oe.emi_no; await svc.from('emi_schedule').update({ fine_paid_amount: fine_amount, fine_paid_at: now }).eq('id', oe.id); } }
    if (fid) await svc.from('fine_history').insert({ customer_id, emi_schedule_id: fid, emi_no: fno, fine_type: 'PAID', fine_amount, cumulative_fine: fine_amount, fine_date: now.split('T')[0], reason: 'Admin direct fine ' + fine_amount + ' via ' + mode }).catch(() => {});
  }

  if (first_emi_charge_amount > 0) await svc.from('customers').update({ first_emi_charge_paid_at: now }).eq('id', customer_id);

  // ── AUTO-COMPLETE: all EMIs paid + fines paid + first charge paid → COMPLETE ──
  const { count: unpaid } = await svc.from('emi_schedule').select('id', { count: 'exact', head: true }).eq('customer_id', customer_id).in('status', ['UNPAID', 'PENDING_APPROVAL']);
  const { count: fineUnpaid } = await svc.from('emi_schedule').select('id', { count: 'exact', head: true }).eq('customer_id', customer_id).gt('fine_amount', 0).or('fine_paid_amount.is.null,fine_paid_amount.lt.fine_amount');
  const firstChargePending = customer.first_emi_charge_amount > 0 && !customer.first_emi_charge_paid_at && !(first_emi_charge_amount > 0);
  if (unpaid === 0 && (fineUnpaid === 0 || fineUnpaid === null) && !firstChargePending) {
    await svc.from('customers').update({ status: 'COMPLETE', completion_date: now.split('T')[0] }).eq('id', customer_id).eq('status', 'RUNNING');
  }

  await svc.from('audit_log').insert({ actor_user_id: user.id, actor_role: 'super_admin', action: 'DIRECT_PAYMENT', table_name: 'payment_requests', record_id: request.id, after_data: { customer_id, total_amount, mode, emi_paid: total_emi_amount, fine_paid: fine_amount, first_charge_paid: first_emi_charge_amount } });
  return NextResponse.json({ request_id: request.id });
}
