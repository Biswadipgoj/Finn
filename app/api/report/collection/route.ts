import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function csvCell(value: unknown) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden — super admin only' }, { status: 403 });

  const svc = createServiceClient();
  const m = parseInt(req.nextUrl.searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const y = parseInt(req.nextUrl.searchParams.get('year') || String(new Date().getFullYear()), 10);
  const ms = new Date(y, m - 1, 1).toISOString();
  const me = new Date(y, m, 0, 23, 59, 59).toISOString();

  const { data: retailers } = await svc.from('retailers').select('id, name').eq('is_active', true).order('name');
  const rows: string[][] = [];

  for (const retailer of retailers || []) {
    const { data: payments } = await svc
      .from('payment_requests')
      .select('customer_id, total_emi_amount, fine_amount, first_emi_charge_amount, total_amount, customer:customers(customer_name, mobile, loan_no)')
      .eq('retailer_id', retailer.id)
      .eq('status', 'APPROVED')
      .gte('approved_at', ms)
      .lte('approved_at', me)
      .order('approved_at', { ascending: true });

    if (!payments?.length) continue;

    rows.push([`#Retailer: ${retailer.name}`]);
    rows.push(['Customer Name', 'Phone', 'Loan ID', 'EMI', 'Fine', '1st Charge', 'Total']);

    for (const p of payments) {
      const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer;
      rows.push([
        String(customer?.customer_name || 'Unknown'),
        String(customer?.mobile || ''),
        String(customer?.loan_no || ''),
        String(Number(p.total_emi_amount || 0)),
        String(Number(p.fine_amount || 0)),
        String(Number(p.first_emi_charge_amount || 0)),
        String(Number(p.total_amount || 0)),
      ]);
    }

    rows.push([]);
  }

  if (rows.length === 0) rows.push(['No approved collections found for selected month.']);

  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const mn = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1];
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="Retailer_Collection_${mn}_${y}.csv"`,
    },
  });
}
