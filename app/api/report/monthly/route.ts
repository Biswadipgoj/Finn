import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const svc = createServiceClient();
  const { searchParams } = req.nextUrl;
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));

  // Get month name abbreviation
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthLabel = monthNames[month - 1] + "'" + String(year).slice(-2);

  // Calculate month range for filtering EMI payments
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month

  // Fetch all retailers
  const { data: retailers } = await svc.from('retailers').select('id, name').eq('is_active', true).order('name');
  if (!retailers?.length) return NextResponse.json({ error: 'No retailers found' }, { status: 404 });

  // For each retailer, fetch their customers with EMIs due this month
  const csvRows: string[] = [];

  for (const retailer of retailers) {
    // Get customers for this retailer
    const { data: customers } = await svc.from('customers')
      .select(`
        id, customer_name, mobile, alternate_number_1, imei, emi_due_day,
        emi_amount, first_emi_charge_amount, first_emi_charge_paid_at, status
      `)
      .eq('retailer_id', retailer.id)
      .in('status', ['RUNNING', 'COMPLETE', 'NPA'])
      .order('emi_due_day')
      .order('customer_name');

    if (!customers?.length) continue;

    // Get EMI schedules for all these customers
    const customerIds = customers.map(c => c.id);
    const { data: allEmis } = await svc.from('emi_schedule')
      .select('id, customer_id, emi_no, due_date, amount, status, paid_at, mode, utr, fine_amount, fine_paid_amount, fine_paid_at')
      .in('customer_id', customerIds)
      .order('emi_no');

    // Get payment requests for this month for remarks
    const { data: paymentReqs } = await svc.from('payment_requests')
      .select('customer_id, total_emi_amount, fine_amount, first_emi_charge_amount, mode, utr, approved_at, notes')
      .in('customer_id', customerIds)
      .eq('status', 'APPROVED')
      .gte('approved_at', monthStart.toISOString())
      .lte('approved_at', monthEnd.toISOString() + 'T23:59:59Z');

    // Build retailer section header
    csvRows.push(',,,,,,,,,,,,,,,');
    csvRows.push(`${retailer.name.toUpperCase()} - EMI COLLECTION SHEET FOR THE MONTH OF ${monthLabel},,,,,,,,,,,,,,,`);
    csvRows.push('IMEI NO,SR NO.,CUST NAME,CUSTOMER NUMBER,ALTARNET NUMBER,1st EMI,Date,EMI Amount,1st emi charge,remarks,,,,,,');

    let srNo = 0;
    for (const cust of customers) {
      srNo++;
      const custEmis = (allEmis || []).filter(e => e.customer_id === cust.id);
      const firstEmi = custEmis[0];
      const custPayments = (paymentReqs || []).filter(p => p.customer_id === cust.id);

      // Find first EMI date
      const firstEmiDate = firstEmi ? formatDateShort(firstEmi.due_date) : '';
      const dueDay = cust.emi_due_day || '';

      // EMI amount — check for FINE DUE status
      const allPaid = custEmis.every(e => e.status === 'APPROVED');
      const hasUnpaidFine = custEmis.some(e => (e.fine_amount || 0) > 0 && (e.fine_paid_amount || 0) < (e.fine_amount || 0));
      let emiAmountStr = String(cust.emi_amount || '');
      if (allPaid && hasUnpaidFine) emiAmountStr = 'FINE DUE';
      if (cust.status === 'COMPLETE') emiAmountStr = 'CLOSE';

      // 1st EMI charge
      const firstChargeStr = (cust.first_emi_charge_amount > 0 && !cust.first_emi_charge_paid_at)
        ? String(cust.first_emi_charge_amount) : '';

      // Remarks: payment date + mode/utr for this month
      const remarks: string[] = [];
      for (const pmt of custPayments) {
        const payDate = pmt.approved_at ? formatDateShort2(pmt.approved_at) : '';
        if (payDate) remarks.push(payDate);
        if (pmt.utr) remarks.push(pmt.utr);
        if (pmt.fine_amount > 0) remarks.push(`${pmt.total_emi_amount}+${pmt.fine_amount}`);
        if (pmt.first_emi_charge_amount > 0) remarks.push(`${pmt.first_emi_charge_amount}/-`);
      }

      // Check lock status for remarks
      // (we'd need is_locked field but keeping it simple)
      const remarkStr = remarks.join(',');

      // Build CSV row matching exact format
      const row = [
        cust.imei || '',
        srNo,
        cust.customer_name || '',
        cust.mobile || '',
        cust.alternate_number_1 || '0',
        firstEmiDate,
        dueDay,
        emiAmountStr,
        firstChargeStr,
        remarkStr,
        '', '', '', '', '', ''
      ].map(v => escapeCsv(String(v))).join(',');

      csvRows.push(row);
    }
  }

  // Add trailing empty row
  csvRows.push(',,,,,,,,,,,,,,,');

  const csvContent = csvRows.join('\r\n');
  const filename = `TelePoint_Collection_${monthNames[month-1]}_${year}.csv`;

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const yr = String(d.getFullYear()).slice(-2);
    return `${day}-${months[d.getMonth()]}-${yr}`;
  } catch { return dateStr; }
}

function formatDateShort2(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yr = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yr}`;
  } catch { return ''; }
}
