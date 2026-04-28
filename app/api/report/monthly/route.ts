import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { calculateSingleEmiFine } from '@/lib/fineCalc';
import { formatDateOnly } from '@/lib/formatters';
import { getISTDateString } from '@/lib/time';

interface RetailerRow { id: string; name: string; }
interface CustomerRow {
  id: string;
  customer_name?: string | null;
  mobile?: string | null;
  alternate_number_1?: string | null;
  imei?: string | null;
  emi_due_day?: number | null;
  emi_amount?: number | null;
  first_emi_charge_amount?: number | null;
  first_emi_charge_paid_at?: string | null;
}
interface EmiRow {
  customer_id: string;
  emi_no: number;
  due_date: string;
  fine_amount?: number | null;
  fine_paid_amount?: number | null;
}

function toCsv(rows: (string | number)[][]) {
  return rows.map(r => r.map(v => JSON.stringify(v ?? '')).join(',')).join('\r\n');
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (!['super_admin', 'retailer'].includes(profile?.role || '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = createServiceClient();
  let retailerScopeId: string | null = null;
  if (profile?.role === 'retailer') {
    const { data: ownRetailer } = await svc.from('retailers').select('id').eq('auth_user_id', user.id).single();
    if (!ownRetailer?.id) return NextResponse.json({ error: 'Retailer profile not found' }, { status: 403 });
    retailerScopeId = ownRetailer.id;
  }

  const { searchParams } = req.nextUrl;
  const todayIST = getISTDateString();
  const [todayYear, todayMonth] = todayIST.split('-').map(Number);
  const month = parseInt(searchParams.get('month') || String(todayMonth), 10);
  const year = parseInt(searchParams.get('year') || String(todayYear), 10);
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const monthStart = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+05:30`);
  const nextMonthStart = new Date(month === 12 ? `${year + 1}-01-01T00:00:00+05:30` : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+05:30`);

  let retailersQuery = svc.from('retailers').select('id, name').eq('is_active', true).order('name');
  if (retailerScopeId) retailersQuery = retailersQuery.eq('id', retailerScopeId);
  const { data: retailers } = await retailersQuery;
  if (!retailers?.length) return NextResponse.json({ error: 'No retailers found' }, { status: 404 });

  const rows: (string | number)[][] = [[
    'Retailer Name', 'IMEI NO', 'SR NO.', 'CUST NAME', 'CUSTOMER NUMBER', 'ALTARNET NUMBER',
    '1st EMI Date', 'EMI Due Day', 'EMI Amount', '1st EMI Charge', 'Current Due Fine', 'remarks',
  ]];

  for (const retailer of retailers as RetailerRow[]) {
    const { data: customers } = await svc
      .from('customers')
      .select('id, customer_name, mobile, alternate_number_1, imei, emi_due_day, emi_amount, first_emi_charge_amount, first_emi_charge_paid_at, status')
      .eq('retailer_id', retailer.id)
      .eq('status', 'RUNNING')
      .order('emi_due_day')
      .order('customer_name');
    if (!customers?.length) continue;

    const customerRows = customers as CustomerRow[];
    const customerIds = customerRows.map(c => c.id);
    const { data: allEmis } = await svc.from('emi_schedule').select('customer_id, emi_no, due_date, fine_amount, fine_paid_amount').in('customer_id', customerIds).order('emi_no');
    const { data: paymentRequests } = await svc
      .from('payment_requests')
      .select('customer_id, total_emi_amount, fine_amount, first_emi_charge_amount, utr, approved_at')
      .in('customer_id', customerIds)
      .eq('status', 'APPROVED')
      .gte('approved_at', monthStart.toISOString())
      .lt('approved_at', nextMonthStart.toISOString());

    let srNo = 0;
    for (const customer of customerRows) {
      srNo += 1;
      const customerEmis = ((allEmis || []) as EmiRow[]).filter(emi => emi.customer_id === customer.id).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
      const firstEmi = customerEmis[0];
      const maxEmiNo = customerEmis.length > 0 ? Math.max(...customerEmis.map(emi => emi.emi_no)) : 0;
      const currentDueFine = customerEmis.reduce((sum, emi) => {
        const calculated = calculateSingleEmiFine(emi.due_date, emi.emi_no === maxEmiNo);
        const accruedFine = Math.max(calculated, Number(emi.fine_amount || 0));
        return sum + Math.max(0, accruedFine - Number(emi.fine_paid_amount || 0));
      }, 0);

      const customerPayments = (paymentRequests || []).filter((p: { customer_id: string }) => p.customer_id === customer.id);
      const remarks = customerPayments.flatMap((payment: { approved_at?: string | null; utr?: string | null; total_emi_amount?: number | null; fine_amount?: number | null; first_emi_charge_amount?: number | null }) => [
        payment.approved_at ? formatDateOnly(payment.approved_at) : '',
        payment.utr || '',
        (payment.fine_amount || 0) > 0 ? `${payment.total_emi_amount || 0}+${payment.fine_amount}` : '',
        (payment.first_emi_charge_amount || 0) > 0 ? `${payment.first_emi_charge_amount}/-` : '',
      ].filter(Boolean)).join(' | ');

      rows.push([
        retailer.name,
        customer.imei || '',
        srNo,
        customer.customer_name || '',
        customer.mobile || '',
        customer.alternate_number_1 || '0',
        firstEmi ? formatDateOnly(firstEmi.due_date) : '',
        customer.emi_due_day || '',
        customer.emi_amount || '',
        customer.first_emi_charge_amount && !customer.first_emi_charge_paid_at ? customer.first_emi_charge_amount : '',
        currentDueFine,
        remarks,
      ]);
    }
  }

  if (rows.length <= 1) return NextResponse.json({ error: 'No running customers found for this month.' }, { status: 404 });

  const csv = toCsv(rows);
  const filename = `TelePoint_Collection_${monthNames[month - 1]}_${year}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
