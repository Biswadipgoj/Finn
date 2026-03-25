import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const svc = createServiceClient();
  const m = parseInt(req.nextUrl.searchParams.get('month') || String(new Date().getMonth()+1));
  const y = parseInt(req.nextUrl.searchParams.get('year') || String(new Date().getFullYear()));
  const ms = new Date(y, m-1, 1).toISOString();
  const me = new Date(y, m, 0, 23, 59, 59).toISOString();
  const { data: retailers } = await svc.from('retailers').select('id, name').eq('is_active', true).order('name');
  const rows: string[][] = [['Retailer','Total Purchase Value','Total Down Payment','Total Disburse','Total EMI Collected','Total Fine Collected','Total 1st Charge','Total Revenue']];
  for (const r of retailers || []) {
    const { data: custs } = await svc.from('customers').select('purchase_value, down_payment, disburse_amount').eq('retailer_id', r.id);
    const { data: payments } = await svc.from('payment_requests').select('total_emi_amount, fine_amount, first_emi_charge_amount').eq('retailer_id', r.id).eq('status', 'APPROVED').gte('approved_at', ms).lte('approved_at', me);
    const c = custs || []; const p = payments || [];
    const pv = c.reduce((s,x) => s + (Number(x.purchase_value)||0), 0);
    const dp = c.reduce((s,x) => s + (Number(x.down_payment)||0), 0);
    const di = c.reduce((s,x) => s + (Number(x.disburse_amount)||0), 0);
    const emi = p.reduce((s,x) => s + (Number(x.total_emi_amount)||0), 0);
    const fine = p.reduce((s,x) => s + (Number(x.fine_amount)||0), 0);
    const charge = p.reduce((s,x) => s + (Number(x.first_emi_charge_amount)||0), 0);
    rows.push([r.name, String(pv), String(dp), String(di), String(emi), String(fine), String(charge), String(emi+fine+charge)]);
  }
  const csv = rows.map(r => r.join(',')).join('\r\n');
  const mn = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][m-1];
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="Retail_Monthly_Profit_${mn}_${y}.csv"` } });
}
