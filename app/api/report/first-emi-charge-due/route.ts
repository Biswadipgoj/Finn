import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

type CustomerRow = {
  id: string;
  customer_name: string | null;
  mobile: string | null;
  imei: string | null;
  first_emi_charge_amount: number | null;
  retailer?: { name?: string | null } | null;
};

type ChargePaymentRow = {
  customer_id: string | null;
  first_emi_charge_amount: number | null;
};

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const svc = createServiceClient();
    const { data: customers, error: customersError } = await svc
      .from('customers')
      .select('id, customer_name, mobile, imei, first_emi_charge_amount, retailer:retailers(name)')
      .gt('first_emi_charge_amount', 0)
      .eq('status', 'RUNNING');

    if (customersError) {
      return NextResponse.json({ ok: false, error: customersError.message }, { status: 500 });
    }

    const customerRows = (customers || []) as CustomerRow[];
    const customerIds = customerRows.map((c) => c.id);
    if (!customerIds.length) {
      return NextResponse.json({ ok: true, data: [] });
    }

    const { data: chargePayments, error: paymentsError } = await svc
      .from('payment_requests')
      .select('customer_id, first_emi_charge_amount')
      .in('customer_id', customerIds)
      .eq('status', 'APPROVED')
      .gt('first_emi_charge_amount', 0);

    if (paymentsError) {
      return NextResponse.json({ ok: false, error: paymentsError.message }, { status: 500 });
    }

    const paidByCustomer = new Map<string, number>();
    for (const payment of (chargePayments || []) as ChargePaymentRow[]) {
      if (!payment.customer_id) continue;
      const paid = Number(payment.first_emi_charge_amount || 0);
      paidByCustomer.set(payment.customer_id, (paidByCustomer.get(payment.customer_id) || 0) + paid);
    }

    const rows = customerRows
      .map((c) => {
        const amount = Number(c.first_emi_charge_amount || 0);
        const paid = Math.max(0, Number(paidByCustomer.get(c.id) || 0));
        const remaining = Math.max(0, amount - paid);

        return {
          id: c.id,
          customer_id: c.id,
          customer_name: c.customer_name || '-',
          mobile: c.mobile || '-',
          imei: c.imei || '-',
          retailer_name: c.retailer?.name || '-',
          first_emi_charge_amount: amount,
          first_emi_charge_paid: paid,
          first_emi_charge_remaining: remaining,
          due_date: null,
          status: remaining <= 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
        };
      })
      .filter((row) => row.first_emi_charge_remaining > 0);

    return NextResponse.json({ ok: true, data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
