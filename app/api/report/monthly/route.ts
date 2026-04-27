export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { calculateSingleEmiFine } from '@/lib/fineCalc';
import { formatDateOnly } from '@/lib/formatters';
import { getISTDateString } from '@/lib/time';

interface RetailerRow {
  id: string;
  name: string;
}

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
  status?: string | null;
}

interface EmiRow {
  id: string;
  customer_id: string;
  emi_no: number;
  due_date: string;
  amount?: number | null;
  status?: string | null;
  fine_amount?: number | null;
  fine_paid_amount?: number | null;
}

interface PaymentRequestRow {
  customer_id: string;
  total_emi_amount?: number | null;
  fine_amount?: number | null;
  first_emi_charge_amount?: number | null;
  utr?: string | null;
  approved_at?: string | null;
}

const BORDER = {
  top: { style: 'thin', color: { rgb: 'D9E2F3' } },
  bottom: { style: 'thin', color: { rgb: 'D9E2F3' } },
  left: { style: 'thin', color: { rgb: 'D9E2F3' } },
  right: { style: 'thin', color: { rgb: 'D9E2F3' } },
};

const TITLE_STYLE = {
  font: { bold: true, sz: 14, color: { rgb: '1E293B' } },
  fill: { fgColor: { rgb: 'DBEAFE' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: BORDER,
};

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: '1E293B' } },
  fill: { fgColor: { rgb: 'E2E8F0' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

const RETAILER_ROW_STYLE = {
  font: { bold: true, sz: 12, color: { rgb: '0F172A' } },
  fill: { fgColor: { rgb: 'DCFCE7' } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: BORDER,
};

const DATA_STYLE = {
  alignment: { vertical: 'center', wrapText: true },
  border: BORDER,
};

const MONTHLY_HEADERS = [
  'IMEI NO',
  'SR NO.',
  'CUST NAME',
  'CUSTOMER NUMBER',
  'ALTARNET NUMBER',
  '1st EMI',
  'Date',
  'EMI Amount',
  '1st emi charge',
  'remarks',
  '', '', '', '', '', '',
];

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!['super_admin', 'retailer'].includes(profile?.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const svc = createServiceClient();
  let retailerScopeId: string | null = null;
  if (profile?.role === 'retailer') {
    const { data: ownRetailer } = await svc
      .from('retailers')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    if (!ownRetailer?.id) return NextResponse.json({ error: 'Retailer profile not found' }, { status: 403 });
    retailerScopeId = ownRetailer.id;
  }
  const { searchParams } = req.nextUrl;
  const todayIST = getISTDateString();
  const [todayYear, todayMonth] = todayIST.split('-').map(Number);
  const month = parseInt(searchParams.get('month') || String(todayMonth), 10);
  const year = parseInt(searchParams.get('year') || String(todayYear), 10);

  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthLabel = `${monthNames[month - 1]}'${String(year).slice(-2)}`;
  const monthStart = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+05:30`);
  const nextMonthStart = new Date(month === 12 ? `${year + 1}-01-01T00:00:00+05:30` : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+05:30`);

  let retailersQuery = svc
    .from('retailers')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  if (retailerScopeId) retailersQuery = retailersQuery.eq('id', retailerScopeId);
  const { data: retailers } = await retailersQuery;

  if (!retailers?.length) {
    return NextResponse.json({ error: 'No retailers found' }, { status: 404 });
  }

  const workbook = XLSX.utils.book_new();
  const rows: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const titleRows: number[] = [];
  const retailerRowStyles: Record<number, Record<string, unknown>> = {};
  const retailerRows: number[] = [];
  const headerRows: number[] = [];
  const dataRows: number[] = [];

  rows.push([`MONTHLY COLLECTION SHEET - ${monthLabel}`]);
  titleRows.push(0);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 15 } });
  rows.push([]);

  for (const retailer of (retailers ?? []) as RetailerRow[]) {
    const { data: customers } = await svc
      .from('customers')
      .select('id, customer_name, mobile, alternate_number_1, imei, emi_due_day, emi_amount, first_emi_charge_amount, first_emi_charge_paid_at, status')
      .eq('retailer_id', retailer.id)
      .eq('status', 'RUNNING')
      .order('emi_due_day')
      .order('customer_name');

    if (!customers?.length) {
      continue;
    }

    const customerRows = customers as CustomerRow[];
    const customerIds = customerRows.map((customer) => customer.id);

    const { data: allEmis } = await svc
      .from('emi_schedule')
      .select('id, customer_id, emi_no, due_date, amount, status, fine_amount, fine_paid_amount')
      .in('customer_id', customerIds)
      .order('emi_no');

    const { data: paymentRequests } = await svc
      .from('payment_requests')
      .select('customer_id, total_emi_amount, fine_amount, first_emi_charge_amount, utr, approved_at')
      .in('customer_id', customerIds)
      .eq('status', 'APPROVED')
      .gte('approved_at', monthStart.toISOString())
      .lt('approved_at', nextMonthStart.toISOString());

    rows.push([]);
    rows.push([retailer.name.toUpperCase()]);
    retailerRows.push(rows.length - 1);
    retailerRowStyles[rows.length - 1] = getRetailerRowStyle(retailerRows.length - 1);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 15 } });
    rows.push([...MONTHLY_HEADERS]);
    headerRows.push(rows.length - 1);

    const customersSorted = [...customerRows].sort((a, b) => {
      const aFirst = ((allEmis ?? []) as EmiRow[])
        .filter((emi) => emi.customer_id === a.id)
        .sort((left, right) => new Date(left.due_date).getTime() - new Date(right.due_date).getTime())[0];
      const bFirst = ((allEmis ?? []) as EmiRow[])
        .filter((emi) => emi.customer_id === b.id)
        .sort((left, right) => new Date(left.due_date).getTime() - new Date(right.due_date).getTime())[0];
      return new Date(aFirst?.due_date || '9999-12-31').getTime() - new Date(bFirst?.due_date || '9999-12-31').getTime();
    });

    let srNo = 0;
    for (const customer of customersSorted) {
      srNo += 1;
      const customerEmis = ((allEmis ?? []) as EmiRow[])
        .filter((emi) => emi.customer_id === customer.id)
        .sort((left, right) => new Date(left.due_date).getTime() - new Date(right.due_date).getTime());
      const firstEmi = customerEmis[0];
      const customerPayments = ((paymentRequests ?? []) as PaymentRequestRow[]).filter((payment) => payment.customer_id === customer.id);
      const maxEmiNo = customerEmis.length > 0 ? Math.max(...customerEmis.map((emi) => emi.emi_no)) : 0;
      const totalFineRemaining = customerEmis.reduce((sum, emi) => {
        const calculated = calculateSingleEmiFine(emi.due_date, emi.emi_no === maxEmiNo);
        const effectiveFine = Math.max(calculated, Number(emi.fine_amount || 0));
        return sum + Math.max(0, effectiveFine - Number(emi.fine_paid_amount || 0));
      }, 0);

      const remarks: string[] = [];
      for (const payment of customerPayments) {
        const approvedDate = payment.approved_at ? formatPaymentDate(payment.approved_at) : '';
        if (approvedDate) remarks.push(approvedDate);
        if (payment.utr) remarks.push(payment.utr);
        if ((payment.fine_amount ?? 0) > 0) remarks.push(`${payment.total_emi_amount ?? 0}+${payment.fine_amount}`);
        if ((payment.first_emi_charge_amount ?? 0) > 0) remarks.push(`${payment.first_emi_charge_amount}/-`);
      }
      if (totalFineRemaining > 0) {
        remarks.push(`Fine: ${totalFineRemaining}`);
      }

      rows.push([
        customer.imei ? `'${customer.imei}` : '',
        srNo,
        customer.customer_name ?? '',
        customer.mobile ?? '',
        customer.alternate_number_1 || '0',
        firstEmi ? formatDateOnly(firstEmi.due_date) : '',
        customer.emi_due_day ?? '',
        customer.emi_amount ?? '',
        customer.first_emi_charge_amount && !customer.first_emi_charge_paid_at ? customer.first_emi_charge_amount : '',
        remarks.join(' | '),
        '', '', '', '', '', '',
      ]);
      dataRows.push(rows.length - 1);
    }
  }

  if (dataRows.length === 0) {
    return NextResponse.json({ error: 'No running customers found for this month.' }, { status: 404 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!merges'] = merges;
  worksheet['!cols'] = [
    { wch: 18 },
    { wch: 8 },
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 8 },
    { wch: 12 },
    { wch: 14 },
    { wch: 36 },
    { wch: 4 },
    { wch: 4 },
    { wch: 4 },
    { wch: 4 },
    { wch: 4 },
    { wch: 4 },
  ];

  applyRowStyles(worksheet, titleRows, TITLE_STYLE);
  for (const rowIndex of retailerRows) {
    applyRowStyles(worksheet, [rowIndex], retailerRowStyles[rowIndex] || RETAILER_ROW_STYLE);
  }
  applyRowStyles(worksheet, headerRows, HEADER_STYLE);
  applyRowStyles(worksheet, dataRows, DATA_STYLE);

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Monthly Collection');

  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    cellStyles: true,
  });

  const filename = `TelePoint_Collection_${monthNames[month - 1]}_${year}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,

      'Cache-Control': 'no-store',
    },
  });
}

const RETAILER_COLORS = ['DCFCE7', 'DBEAFE', 'FEF3C7', 'FCE7F3', 'EDE9FE', 'CCFBF1'];

function getRetailerRowStyle(index: number): Record<string, unknown> {
  return {
    ...RETAILER_ROW_STYLE,
    fill: { fgColor: { rgb: RETAILER_COLORS[index % RETAILER_COLORS.length] } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
}

function applyRowStyles(worksheet: XLSX.WorkSheet, rowIndexes: number[], style: Record<string, unknown>) {
  for (const rowIndex of rowIndexes) {
    for (let columnIndex = 0; columnIndex < 16; columnIndex += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (!worksheet[cellRef]) continue;
      worksheet[cellRef].s = style;
    }
  }
}

function formatPaymentDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    })
      .format(new Date(dateStr))
      .replace(/\//g, '.');
  } catch {
    return '';
  }
}
