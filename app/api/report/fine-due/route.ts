import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';

type ReportRow = {
  customer_id: string;
  name: string;
  imei: string;
  phone_model: string;
  retailer: string;
  fine_due: number;
  first_emi_charge_due: number;
  total_due: number;
  first_due_date: string | null;
};

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const serviceClient = createServiceClient();
  const byCustomer = new Map<string, ReportRow>();

  function upsertCustomer(customer: any, patch: Partial<ReportRow>) {
    if (!customer?.id || !customer?.imei) return;
    const key = customer.imei || customer.id;
    const current = byCustomer.get(key) || {
      customer_id: customer.id,
      name: customer.customer_name || '',
      imei: customer.imei || '',
      phone_model: customer.model_no || '',
      retailer: customer.retailer?.name || '',
      fine_due: 0,
      first_emi_charge_due: 0,
      total_due: 0,
      first_due_date: null,
    };

    const next = { ...current, ...patch };
    next.total_due = next.fine_due + next.first_emi_charge_due;
    byCustomer.set(key, next);
  }

  const { data: fineRows, error: fineErr } = await serviceClient
    .from('emi_schedule')
    .select(`
      customer_id,
      fine_amount,
      fine_paid_amount,
      due_date,
      customer:customers(id, customer_name, imei, model_no, retailer:retailers(name))
    `)
    .eq('fine_waived', false)
    .gt('fine_amount', 0)
    .order('due_date', { ascending: true });

  if (fineErr) return NextResponse.json({ error: fineErr.message }, { status: 400 });

  for (const row of fineRows || []) {
    const customer: any = (row as any).customer;
    const fineDue = Math.max(0, Number((row as any).fine_amount || 0) - Number((row as any).fine_paid_amount || 0));
    if (fineDue <= 0) continue;
    const key = customer?.imei || customer?.id;
    const current = key ? byCustomer.get(key) : null;
    upsertCustomer(customer, {
      fine_due: (current?.fine_due || 0) + fineDue,
      first_due_date: current?.first_due_date && current.first_due_date < (row as any).due_date
        ? current.first_due_date
        : (row as any).due_date,
    });
  }

  const { data: firstChargeRows, error: chargeErr } = await serviceClient
    .from('customers')
    .select('id, customer_name, imei, model_no, first_emi_charge_amount, retailer:retailers(name)')
    .gt('first_emi_charge_amount', 0)
    .is('first_emi_charge_paid_at', null)
    .eq('status', 'RUNNING');

  if (chargeErr) return NextResponse.json({ error: chargeErr.message }, { status: 400 });

  for (const customer of firstChargeRows || []) {
    const key = (customer as any).imei || (customer as any).id;
    const current = byCustomer.get(key);
    upsertCustomer(customer, {
      first_emi_charge_due: (current?.first_emi_charge_due || 0) + Number((customer as any).first_emi_charge_amount || 0),
    });
  }

  return NextResponse.json({ data: Array.from(byCustomer.values()).filter(r => r.total_due > 0) });
}
