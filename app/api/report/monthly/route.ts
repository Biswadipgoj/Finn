import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient, createServiceClient } from '@/lib/supabase/server';

type CustomerRow = {
  customer_name: string;
  mobile: string;
  alternate_number_1?: string | null;
  imei?: string | null;
  emi_due_day?: number | null;
  emi_amount?: number | null;
  first_emi_charge_amount?: number | null;
  first_emi_charge_paid_at?: string | null;
};

type EmiRow = {
  customer_id: string;
  emi_no: number;
  due_date: string;
  amount: number;
  status: 'UNPAID' | 'PENDING_APPROVAL' | 'APPROVED';
};

type CollectionExportRow = {
  imei: string;
  srNo: number | string;
  customerName: string;
  customerNumber: string;
  alternateNumber: string;
  firstEmiDate: string;
  dueDay: string | number;
  emiAmount: string | number;
  collectionType: string;
  firstEmiCharge: string | number;
  remarks: string;
};

const COLUMNS = [
  'IMEI NO',
  'SR NO.',
  'CUST NAME',
  'CUSTOMER NUMBER',
  'ALTARNET NUMBER',
  '1st EMI',
  'Date',
  'EMI Amount',
  '1st emi charge',
  'Collection Type',
  '1st emi charge',
  'Remarks',
] as const;

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

  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthLabel = monthNames[month - 1] + "'" + String(year).slice(-2);

  const { data: retailers } = await svc.from('retailers').select('id, name').eq('is_active', true).order('name');
  if (!retailers?.length) return NextResponse.json({ error: 'No retailers found' }, { status: 404 });

  const wb = XLSX.utils.book_new();
  const sheetRows: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const titleRowIndexes: number[] = [];

  for (const retailer of retailers) {
    const { data: customers } = await svc.from('customers')
      .select(`
        id, customer_name, mobile, alternate_number_1, imei, emi_due_day,
        emi_amount, first_emi_charge_amount, first_emi_charge_paid_at, status
      `)
      .eq('retailer_id', retailer.id)
      .neq('status', 'COMPLETE')
      .order('customer_name');

    if (!customers?.length) continue;

    const customerIds = customers.map((customer) => customer.id);
    const { data: allEmis } = await svc.from('emi_schedule')
      .select('customer_id, emi_no, due_date, amount, status')
    const customerIds = customers.map(c => c.id);
    const { data: allEmis } = await svc.from('emi_schedule')
      .select('customer_id, emi_no, due_date, amount, status, fine_amount, fine_paid_amount')
      .in('customer_id', customerIds)
      .order('emi_no');

    if (sheetRows.length > 0) sheetRows.push(Array(COLUMNS.length).fill(''));

    const titleRowIndex = sheetRows.length;
    titleRowIndexes.push(titleRowIndex);
    sheetRows.push([`${retailer.name.toUpperCase()} - EMI COLLECTION SHEET FOR THE MONTH OF ${monthLabel}`, ...Array(COLUMNS.length - 1).fill('')]);
    merges.push({ s: { r: titleRowIndex, c: 0 }, e: { r: titleRowIndex, c: COLUMNS.length - 1 } });
    sheetRows.push([`${retailer.name.toUpperCase()} - EMI COLLECTION SHEET FOR THE MONTH OF ${monthLabel}`, ...Array(COLUMNS.length - 1).fill('')]);
    merges.push({ s: { r: titleRowIndex, c: 0 }, e: { r: titleRowIndex, c: COLUMNS.length - 1 } });

    sheetRows.push([...COLUMNS]);

    let srNo = 0;
    for (const cust of customers) {
      srNo += 1;
      const custEmis = (allEmis || []).filter((emi) => emi.customer_id === cust.id);
      const row = buildCollectionRow(cust, custEmis, srNo);
      sheetRows.push([
        row.imei,
        row.srNo,
        row.customerName,
        row.customerNumber,
        row.alternateNumber,
        row.firstEmiDate,
        row.dueDay,
        row.emiAmount,
        row.firstEmiCharge,
      ]);
      const exportRows = buildCollectionRows(cust, custEmis, srNo);
      exportRows.forEach((row) => {
        sheetRows.push([
          row.imei,
          row.srNo,
          row.customerName,
          row.customerNumber,
          row.alternateNumber,
          row.firstEmiDate,
          row.dueDay,
          row.emiAmount,
          row.collectionType,
          row.firstEmiCharge,
          row.remarks,
        ]);
      });
    }
  }

  if (sheetRows.length === 0) {
    return NextResponse.json({ error: 'No running customers found for active retailers' }, { status: 404 });
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!merges'] = merges;
  ws['!cols'] = buildColumnWidths(sheetRows);

  forceImeiColumnToText(ws, sheetRows);
  styleRetailerHeaders(ws, titleRowIndexes);

  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Collection');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `TelePoint_Collection_${monthNames[month - 1]}_${year}.xlsx`;


  forceImeiColumnToText(ws, sheetRows);

  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Collection');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `TelePoint_Collection_${monthNames[month - 1]}_${year}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function buildCollectionRow(cust: CustomerRow & { id: string }, custEmis: EmiRow[], srNo: number): CollectionExportRow {
  const sortedEmis = [...custEmis].sort((a, b) => a.emi_no - b.emi_no);
  const firstEmi = sortedEmis[0];
  const nextDueEmi = sortedEmis.find((emi) => emi.status !== 'APPROVED');

  return {
function buildCollectionRows(cust: CustomerRow & { id: string }, custEmis: EmiRow[], srNo: number): CollectionExportRow[] {
  const sortedEmis = [...custEmis].sort((a, b) => a.emi_no - b.emi_no);
  const firstEmi = sortedEmis[0];
  const firstEmiDate = firstEmi ? formatDateShort(firstEmi.due_date) : '';
  const dueDay = cust.emi_due_day || '';
  const nextDueEmi = sortedEmis.find((emi) => emi.status !== 'APPROVED');
  const emiDueAmount = nextDueEmi?.amount ?? cust.emi_amount ?? '';

  const fineDue = sortedEmis.reduce((sum, emi) => {
    const fineAmount = emi.fine_amount || 0;
    const finePaid = emi.fine_paid_amount || 0;
    return sum + Math.max(fineAmount - finePaid, 0);
  }, 0);
  const hasFine = fineDue > 0;

  const firstChargeStr = (cust.first_emi_charge_amount && cust.first_emi_charge_amount > 0 && !cust.first_emi_charge_paid_at)
    ? cust.first_emi_charge_amount
    : '';

  const baseRow: Omit<CollectionExportRow, 'emiAmount' | 'collectionType' | 'remarks'> = {
    imei: normalizeImei(cust.imei),
    srNo,
    customerName: cust.customer_name || '',
    customerNumber: cust.mobile || '',
    alternateNumber: cust.alternate_number_1 || '0',
    firstEmiDate: firstEmi ? formatDateShort(firstEmi.due_date) : '',
    dueDay: cust.emi_due_day || '',
    emiAmount: nextDueEmi?.amount ?? cust.emi_amount ?? '',
    firstEmiCharge: (cust.first_emi_charge_amount && cust.first_emi_charge_amount > 0 && !cust.first_emi_charge_paid_at)
      ? cust.first_emi_charge_amount
      : '',
  };
}

function buildColumnWidths(rows: (string | number)[][]): XLSX.ColInfo[] {
  return COLUMNS.map((_, columnIndex) => {
    const maxLength = rows.reduce((max, row) => {
      const value = row[columnIndex] ?? '';
      return Math.max(max, String(value).length);
    }, String(COLUMNS[columnIndex]).length);

    if (columnIndex === 0) return { wch: Math.max(18, maxLength + 2) };
    return { wch: Math.min(Math.max(maxLength + 2, 12), 40) };
  });
}

function forceImeiColumnToText(ws: XLSX.WorkSheet, rows: (string | number)[][]) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
    const cell = ws[cellAddress];
    if (!cell || rows[rowIndex][0] === COLUMNS[0] || rows[rowIndex].every((value) => value === '')) continue;
    cell.t = 's';
    cell.z = '@';
  }
}

function styleRetailerHeaders(ws: XLSX.WorkSheet, titleRowIndexes: number[]) {
  titleRowIndexes.forEach((rowIndex) => {
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
    if (!ws[cellAddress]) return;

    ws[cellAddress].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { fgColor: { rgb: '1F4E78' } },
    };
  });
}

    firstEmiDate,
    dueDay,
    firstEmiCharge: firstChargeStr,
  };

  const rows: CollectionExportRow[] = [];

  if (emiDueAmount !== '') {
    rows.push({
      ...baseRow,
      emiAmount: emiDueAmount,
      collectionType: 'EMI',
      remarks: nextDueEmi ? `EMI #${nextDueEmi.emi_no}` : '',
    });
  }

  if (hasFine) {
    rows.push({
      ...baseRow,
      srNo: '',
      emiAmount: fineDue,
      collectionType: 'Fine/Penalty',
      remarks: 'Additional fine due',
    });
  }

  if (!rows.length) {
    rows.push({
      ...baseRow,
      emiAmount: '',
      collectionType: 'EMI',
      remarks: '',
    });
  }

  return rows;
}

function buildColumnWidths(rows: (string | number)[][]): XLSX.ColInfo[] {
  return COLUMNS.map((_, columnIndex) => {
    const maxLength = rows.reduce((max, row) => {
      const value = row[columnIndex] ?? '';
      return Math.max(max, String(value).length);
    }, String(COLUMNS[columnIndex]).length);

    if (columnIndex === 0) return { wch: Math.max(18, maxLength + 2) };
    return { wch: Math.min(Math.max(maxLength + 2, 12), 40) };
  });
}

function forceImeiColumnToText(ws: XLSX.WorkSheet, rows: (string | number)[][]) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
    const cell = ws[cellAddress];
    if (!cell || rowIndex === 0 || rows[rowIndex][0] === COLUMNS[0] || rows[rowIndex].every((value) => value === '')) continue;
    cell.t = 's';
    cell.z = '@';
  }
}

function normalizeImei(imei?: string | null): string {
  return imei ? String(imei).trim() : '';
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;

  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${months[d.getMonth()]}-${yr}`;
}
