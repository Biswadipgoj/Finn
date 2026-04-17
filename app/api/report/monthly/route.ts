import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

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
  const format = (searchParams.get('format') || 'csv').toLowerCase();

  // Get month name abbreviation
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthLabel = monthNames[month - 1] + "'" + String(year).slice(-2);

  // Calculate month range for filtering EMI payments
  const monthStartIso = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)).toISOString();
  const monthEndIso = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();

  if (format === 'xlsx') {
    return buildMonthlyCollectionXlsx(svc, month, year, monthStartIso, monthEndIso);
  }

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
      .gte('approved_at', monthStartIso)
      .lte('approved_at', monthEndIso);

    // Build retailer section header
    csvRows.push(',,,,,,,,,,,,,,,');
    csvRows.push(`${retailer.name.toUpperCase()} - EMI COLLECTION SHEET FOR THE MONTH OF ${monthLabel},,,,,,,,,,,,,,,`);
    csvRows.push('IMEI NO,SR NO.,CUST NAME,CUSTOMER NUMBER,ALTARNET NUMBER,1st EMI,Date,EMI Amount,1st emi charge,remarks,,,,,,');

    const customersSorted = [...customers].sort((a, b) => {
      const aFirst = (allEmis || []).filter(e => e.customer_id === a.id).sort((x, y) => new Date(x.due_date).getTime() - new Date(y.due_date).getTime())[0];
      const bFirst = (allEmis || []).filter(e => e.customer_id === b.id).sort((x, y) => new Date(x.due_date).getTime() - new Date(y.due_date).getTime())[0];
      return new Date(aFirst?.due_date || '9999-12-31').getTime() - new Date(bFirst?.due_date || '9999-12-31').getTime();
    });

    let srNo = 0;
    for (const cust of customersSorted) {
      srNo++;
      const custEmis = (allEmis || [])
        .filter(e => e.customer_id === cust.id)
        .sort((x, y) => new Date(x.due_date).getTime() - new Date(y.due_date).getTime());
      const firstEmi = custEmis[0];
      const custPayments = (paymentReqs || []).filter(p => p.customer_id === cust.id);

      // Find first EMI date
      const firstEmiDate = firstEmi ? formatDateShort(firstEmi.due_date) : '';
      const dueDay = cust.emi_due_day || '';

      // EMI amount
      const allPaid = custEmis.every(e => e.status === 'APPROVED');
      const hasUnpaidFine = custEmis.some(e => (e.fine_amount || 0) > 0 && (e.fine_paid_amount || 0) < (e.fine_amount || 0));
      let emiAmountStr = String(cust.emi_amount || '');
      if (cust.status === 'COMPLETE') emiAmountStr = 'CLOSE';
      const totalFineRemaining = custEmis.reduce((s, e) => s + Math.max(0, (e.fine_amount || 0) - (e.fine_paid_amount || 0)), 0);

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
        "'" + (cust.imei || ''),
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

      // SEPARATE FINE ROW if customer has unpaid fine
      if (hasUnpaidFine && totalFineRemaining > 0 && !allPaid) {
        const fineRow = [
          '', '', cust.customer_name + ' (FINE)', '', '',
          '', '', 'FINE: ' + totalFineRemaining, '',
          'Fine/Penalty', '', '', '', '', '', ''
        ].map(v => escapeCsv(String(v))).join(',');
        csvRows.push(fineRow);
      }
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

async function buildMonthlyCollectionXlsx(
  svc: ReturnType<typeof createServiceClient>,
  month: number,
  year: number,
  monthStartIso: string,
  monthEndIso: string,
) {
  const { data: rows, error } = await svc
    .from('payment_requests')
    .select(`
      id, approved_at, status, mode, utr, total_emi_amount, fine_amount, total_amount,
      retailer:retailers(id, name),
      customer:customers(customer_name, mobile)
    `)
    .eq('status', 'APPROVED')
    .gte('approved_at', monthStartIso)
    .lte('approved_at', monthEndIso)
    .order('approved_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to prepare monthly xlsx export' }, { status: 500 });
  }

  const mapped = ((rows || []) as Record<string, unknown>[]).map((row) => {
    const retailer = (row.retailer as { id?: string; name?: string } | null) || {};
    const customer = (row.customer as { customer_name?: string; mobile?: string } | null) || {};
    return {
      id: String(row.id || ''),
      retailerId: retailer.id || 'unknown',
      retailerName: retailer.name || 'Unknown Retailer',
      paymentDate: formatDateTimeIst((row.approved_at as string | null) || null),
      customerName: customer.customer_name || '-',
      mobile: customer.mobile || '-',
      emiPaid: formatInr(row.total_emi_amount || 0),
      finePaid: formatInr(row.fine_amount || 0),
      totalPaid: formatInr(row.total_amount || 0),
      mode: String(row.mode || '-'),
      utr: String(row.utr || ''),
      status: String(row.status || '-'),
    };
  });

  mapped.sort((a, b) => {
    const retailerOrder = a.retailerName.localeCompare(b.retailerName);
    if (retailerOrder !== 0) return retailerOrder;
    return a.paymentDate.localeCompare(b.paymentDate);
  });

  const headers = ['Payment Date (IST)', 'Customer Name', 'Mobile', 'EMI Paid', 'Fine Paid', 'Total Paid', 'Payment Mode', 'UTR', 'Status'];
  const aoa: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const palette = ['DCEAFE', 'DCFCE7', 'FEF3C7', 'EDE9FE', 'E2E8F0'];
  let rowIndex = 0;

  const groups = new Map<string, typeof mapped>();
  for (const row of mapped) {
    const key = `${row.retailerId}::${row.retailerName}`;
    const existing = groups.get(key) || [];
    existing.push(row);
    groups.set(key, existing);
  }

  const retailerColorMap = new Map<string, string>();
  for (const [groupKey] of groups.entries()) {
    retailerColorMap.set(groupKey, palette[Math.abs(hash(groupKey)) % palette.length]);
  }

  for (const [groupKey, groupRows] of groups.entries()) {
    const retailerName = groupKey.split('::')[1] || 'Unknown Retailer';
    aoa.push([`RETAILER: ${retailerName}`]);
    merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: headers.length - 1 } });
    rowIndex += 1;

    aoa.push(headers);
    rowIndex += 1;

    for (const row of groupRows) {
      aoa.push([
        row.paymentDate,
        row.customerName,
        row.mobile,
        row.emiPaid,
        row.finePaid,
        row.totalPaid,
        row.mode,
        row.utr || '-',
        row.status,
      ]);
      rowIndex += 1;
    }
    aoa.push([]);
    rowIndex += 1;
  }

  if (!aoa.length) aoa.push(['No approved monthly collection rows found']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 20 },
    { wch: 24 },
    { wch: 15 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 24 },
    { wch: 12 },
  ];

  let dataRowCursor = 0;
  for (const [groupKey, groupRows] of groups.entries()) {
    const color = retailerColorMap.get(groupKey) || 'E2E8F0';
    const groupCellRef = XLSX.utils.encode_cell({ r: dataRowCursor, c: 0 });
    const groupCell = ws[groupCellRef] || { t: 's', v: '' };
    groupCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, color: { rgb: '0F172A' } },
      fill: { patternType: 'solid', fgColor: { rgb: color } },
      border: {
        top: { style: 'thin', color: { rgb: '94A3B8' } },
        bottom: { style: 'thin', color: { rgb: '94A3B8' } },
        left: { style: 'thin', color: { rgb: '94A3B8' } },
        right: { style: 'thin', color: { rgb: '94A3B8' } },
      },
    };
    ws[groupCellRef] = groupCell;

    dataRowCursor += 1;
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSX.utils.encode_cell({ r: dataRowCursor, c });
      const cell = ws[ref];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: '334155' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } },
        };
      }
    }

    dataRowCursor += 1 + groupRows.length + 1;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Collection');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  const mn = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month - 1];
  const filename = `TelePoint_Monthly_Collection_${mn}_${year}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return h;
}

function formatDateTimeIst(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

function formatInr(value: unknown): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num).replace(/\s+/g, '');
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
