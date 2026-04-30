import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient, createServiceClient } from '@/lib/supabase/server';

type ExportType = 'running' | 'complete' | 'all';

type CustomerStatus = 'RUNNING' | 'COMPLETE';

interface CustomerRow {
  id: string;
  retailer_id?: string | null;
  customer_name?: string | null;
  father_name?: string | null;
  aadhaar?: string | null;
  address?: string | null;
  landmark?: string | null;
  mobile?: string | null;
  alternate_number_1?: string | null;
  alternate_number_2?: string | null;
  model_no?: string | null;
  imei?: string | null;
  purchase_value?: number | null;
  down_payment?: number | null;
  disburse_amount?: number | null;
  purchase_date?: string | null;
  emi_due_day?: number | null;
  emi_amount?: number | null;
  emi_tenure?: number | null;
  first_emi_charge_amount?: number | null;
  first_emi_charge_paid_at?: string | null;
  customer_photo_url?: string | null;
  aadhaar_front_url?: string | null;
  aadhaar_back_url?: string | null;
  bill_photo_url?: string | null;
  bill_url?: string | null;
  status?: string | null;
  completion_date?: string | null;
  completion_remark?: string | null;
  retailer?: { name?: string | null; mobile?: string | null } | null;
}

interface EmiRow {
  customer_id: string;
  emi_no: number;
  due_date?: string | null;
  amount?: number | null;
  status?: string | null;
  paid_at?: string | null;
  partial_paid_at?: string | null;
  partial_paid_amount?: number | null;
  fine_amount?: number | null;
  fine_paid_amount?: number | null;
  fine_paid_at?: string | null;
}

interface PaymentRequestRow {
  customer_id: string;
  total_emi_amount?: number | null;
  fine_amount?: number | null;
  first_emi_charge_amount?: number | null;
  approved_at?: string | null;
}

const COLUMN_COUNT = 97;
const RUNNING_TEMPLATE: string[][] = [
  [
    "EMI RUNNING..",
    "",
    "",
    "",
    "",
    "",
    "",
    "Id - TELEPOINT",
    "https://emandate.binowin.in/",
    "",
    "",
    "",
    "Loan Amount",
    "Return Amt",
    "Market due",
    "BTD",
    "collection",
    "INV / DUE",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "Search link",
    "",
    "",
    "",
    "",
    "",
    "",
    "PWD - Tele@1982",
    "",
    "",
    "",
    "",
    "5275340",
    "6830866",
    "3413783",
    "1555526",
    "3417083",
    "1858257",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "Form Entry Link",
    "https://docs.google.com/forms/d/e/1FAIpQLSeddbZzClG6MEIyLgXpKqTsqCnuLZ0NcwRrkYXQL446-qMfug/viewform",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "EMI Calculator OLD V",
    "https://tinyurl.com/YOGICEMI",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "1027992",
    "527534",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "7691950",
    "2515910",
    "",
    "1066053",
    "1555526",
    "5275340",
    "6830866",
    "3413783",
    "3417083",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "110700",
    "9450",
    "977948",
    "10050",
    "711768",
    "10600",
    "569955",
    "6400",
    "465073",
    "5950",
    "358850",
    "2700",
    "199920",
    "500",
    "60895",
    "450",
    "26603",
    "450",
    "16483",
    "1315",
    "17488",
    "500",
    "3160",
    "0",
    "5990",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "89700",
    "21000",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "EMI DATE",
    "",
    "Handset",
    "",
    "",
    "",
    "",
    "",
    "Don’t Edit",
    "Don’t Edit",
    "Don’t Edit",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "1st EMI",
    "",
    "2nd EMI",
    "",
    "3rd EMI",
    "",
    "4th EMI",
    "",
    "5th EMI",
    "",
    "6th EMI",
    "",
    "7th EMI",
    "",
    "8th EMI",
    "",
    "9th EMI",
    "",
    "10th EMI",
    "",
    "11th EMI",
    "",
    "12th EMI",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Fine payment Date",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "IMEI NO",
    "SR NO.",
    "RETAIL NAME",
    "CUST NAME",
    "Father Name",
    "Aadhar No",
    "CUSTOMER NUMBER",
    "ALTARNET NUMBER",
    "HANDSET MODEL NO",
    "Purchase Date",
    "1st EMI",
    "Date",
    "Handset value",
    "Down Payment",
    "EMI Tenure",
    "EMI Amount",
    "PROFIT",
    "Loan Amount",
    "Total Payble Amount",
    "Total Due Amount",
    "Paid Amount",
    "FINE STATUS",
    "1st payment date",
    "2nd payment date",
    "3rd payment date",
    "4th payment date",
    "5th payment date",
    "6th payment date",
    "7th payment date",
    "8th payment date",
    "9th payment date",
    "10th payment date",
    "11th payment date",
    "12th payment date",
    "1st EMI Charge",
    "Late Fine- 1",
    "EMI - 1",
    "Late Fine- 2",
    "EMI - 2",
    "Late Fine- 3",
    "EMI - 3",
    "Late Fine- 4",
    "EMI - 4",
    "Late Fine- 5",
    "EMI - 5",
    "Late Fine- 6",
    "EMI - 6",
    "Late Fine- 7",
    "EMI - 7",
    "Late Fine- 8",
    "EMI - 8",
    "Late Fine- 9",
    "EMI - 9",
    "Late Fine- 10",
    "EMI - 10",
    "Late Fine- 11",
    "EMI - 11",
    "Late Fine- 12",
    "EMI - 12",
    "Adjust on Foreclose EMI",
    "Status",
    "1st payment date",
    "2nd payment date",
    "3rd payment date",
    "4th payment date",
    "5th payment date",
    "6th payment date",
    "7th payment date",
    "8th payment date",
    "9th payment date",
    "10th payment date",
    "11th payment date",
    "12th payment date",
    "FINE STATUS",
    "Remarks",
    "total fine collect",
    "DISBURSMENT VALUE",
    "1st",
    "2nd",
    "3rd",
    "4th",
    "5th",
    "6th",
    "7th",
    "8th",
    "9th",
    "10th",
    "11th",
    "12th",
    "1st EMI PAID",
    "1st EMI Due",
    "CUSTOMAR IMAGE",
    "AADHAR FONT",
    "AADHAR BACK",
    "BILL",
    "ADDRESS",
    "LANDMARK"
  ]
];
const COMPLETE_TEMPLATE: string[][] = [
  [
    "EMI COMPLETE",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "10347975",
    "3748260",
    "",
    "1451828",
    "1059666",
    "4289270",
    "8443336",
    "149105",
    "8294231",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "8100",
    "1508942",
    "10440",
    "1341003",
    "19810",
    "1292069",
    "17130",
    "1206518",
    "16130",
    "1150155",
    "19270",
    "1056120",
    "13080",
    "442515",
    "3150",
    "165151",
    "2250",
    "29243",
    "450",
    "19915",
    "450",
    "3830",
    "0",
    "3520",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "EMI DATE",
    "",
    "Handset",
    "",
    "",
    "",
    "",
    "Don’t Edit",
    "Don’t Edit",
    "Don’t Edit",
    "Don’t Edit",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "1st EMI",
    "",
    "2nd EMI",
    "",
    "3rd EMI",
    "",
    "4th EMI",
    "",
    "5th EMI",
    "",
    "6th EMI",
    "",
    "7th EMI",
    "",
    "8th EMI",
    "",
    "9th EMI",
    "",
    "10th EMI",
    "",
    "11th EMI",
    "",
    "12th EMI",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Fine payment Date",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "IMEI NO",
    "SR NO.",
    "RETAIL NAME",
    "CUST NAME",
    "Father Name",
    "Aadhar No",
    "CUSTOMER NUMBER",
    "ALTARNET NUMBER",
    "HANDSET MODEL NO",
    "Purchase Date",
    "1st EMI",
    "Date",
    "Handset value",
    "Down Payment",
    "EMI Tenure",
    "EMI Amount",
    "PROFIT",
    "Loan Amount",
    "Total Payble Amount",
    "Total Due Amount",
    "Paid Amount",
    "FINE STATUS",
    "1st payment date",
    "2nd payment date",
    "3rd payment date",
    "4th payment date",
    "5th payment date",
    "6th payment date",
    "7th payment date",
    "8th payment date",
    "9th payment date",
    "10th payment date",
    "11th payment date",
    "12th payment date",
    "1st EMI Charge",
    "Late Fine- 1",
    "EMI - 1",
    "Late Fine- 2",
    "EMI - 2",
    "Late Fine- 3",
    "EMI - 3",
    "Late Fine- 4",
    "EMI - 4",
    "Late Fine- 5",
    "EMI - 5",
    "Late Fine- 6",
    "EMI - 6",
    "Late Fine- 7",
    "EMI - 7",
    "Late Fine- 8",
    "EMI - 8",
    "Late Fine- 9",
    "EMI - 9",
    "Late Fine- 10",
    "EMI - 10",
    "Late Fine- 11",
    "EMI - 11",
    "Late Fine- 12",
    "EMI - 12",
    "Adjust on Foreclose EMI",
    "Status",
    "1st payment date",
    "2nd payment date",
    "3rd payment date",
    "4th payment date",
    "5th payment date",
    "6th payment date",
    "7th payment date",
    "8th payment date",
    "9th payment date",
    "10th payment date",
    "11th payment date",
    "12th payment date",
    "FINE STATUS",
    "Remarks",
    "total fine collect",
    "DISBURSMENT VALUE",
    "1st",
    "2nd",
    "3rd",
    "4th",
    "5th",
    "6th",
    "7th",
    "8th",
    "9th",
    "10th",
    "11th",
    "12th",
    "1st EMI PAID",
    "1st EMI Due",
    "CUSTOMAR IMAGE",
    "AADHAR FONT",
    "AADHAR BACK",
    "BILL",
    "ADDRESS",
    ""
  ]
];
const RUNNING_HEADERS = RUNNING_TEMPLATE[RUNNING_TEMPLATE.length - 1];
const COMPLETE_HEADERS = COMPLETE_TEMPLATE[COMPLETE_TEMPLATE.length - 1];

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateLong(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDate();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function formatDateDot(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${String(date.getUTCFullYear()).slice(-2)}`;
}

function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  if (Math.abs(num - Math.round(num)) < 1e-9) return String(Math.round(num));
  return num.toFixed(2).replace(/\.00$/, '');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cloneTemplate(template: string[][]): string[][] {
  return template.map((row) => [...row]);
}

function buildAltNumber(customer: CustomerRow): string {
  const parts = [customer.alternate_number_1, customer.alternate_number_2]
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  return [...new Set(parts)].join(' /  ');
}

function buildDataRow(
  customer: CustomerRow,
  serial: number,
  emis: EmiRow[],
  payments: PaymentRequestRow[],
): string[] {
  const row = Array.from({ length: COLUMN_COUNT }, () => '');
  const set = (column: number, value: string | number | null | undefined) => {
    row[column - 1] = value === null || value === undefined ? '' : String(value);
  };

  const emiMap = new Map<number, EmiRow>();
  for (const emi of emis) {
    if (emi.emi_no >= 1 && emi.emi_no <= 12) emiMap.set(emi.emi_no, emi);
  }
  const firstEmi = emiMap.get(1) ?? [...emis].sort((a, b) => (a.emi_no || 0) - (b.emi_no || 0))[0];

  const purchaseValue = toNum(customer.purchase_value);
  const downPayment = toNum(customer.down_payment);
  const disbursementValue = purchaseValue - downPayment;
  const loanAmount = toNum(customer.disburse_amount) || disbursementValue;
  const emiAmount = toNum(customer.emi_amount);
  const emiTenure = toNum(customer.emi_tenure);
  const totalPayableAmount = emiAmount * emiTenure;
  const totalEmiPaidFromSchedule = [...emiMap.values()].reduce((sum, emi) => sum + toNum(emi.partial_paid_amount), 0);
  const totalEmiPaidFromRequests = payments.reduce((sum, payment) => sum + toNum(payment.total_emi_amount), 0);
  const totalEmiPaid = Math.max(totalEmiPaidFromSchedule, totalEmiPaidFromRequests);
  const adjustOnForeclose = Math.max(0, totalEmiPaidFromRequests - totalEmiPaidFromSchedule);
  const totalDueAmount = Math.max(0, totalPayableAmount - totalEmiPaid);
  const totalFineCollected = [...emiMap.values()].reduce((sum, emi) => sum + toNum(emi.fine_paid_amount), 0);
  const fineDueCount = [...emiMap.values()].filter((emi) => toNum(emi.fine_amount) > toNum(emi.fine_paid_amount)).length;
  const profit = totalPayableAmount - loanAmount;
  const firstChargeAmount = toNum(customer.first_emi_charge_amount);
  const firstChargePaid = firstChargeAmount > 0 && customer.first_emi_charge_paid_at ? firstChargeAmount : 0;
  const firstChargeDue = firstChargeAmount > 0 && !customer.first_emi_charge_paid_at ? firstChargeAmount : 0;

  set(1, customer.imei ?? '');
  set(2, serial);
  set(3, customer.retailer?.name ?? '');
  set(4, customer.customer_name ?? '');
  set(5, customer.father_name ?? '');
  set(6, customer.aadhaar ?? '');
  set(7, customer.mobile ?? '');
  set(8, buildAltNumber(customer));
  set(9, customer.model_no ?? '');
  set(10, formatDateLong(customer.purchase_date));
  set(11, formatDateLong(firstEmi?.due_date ?? null));
  set(12, firstEmi?.due_date ? new Date(firstEmi.due_date).getUTCDate() : (customer.emi_due_day ?? ''));
  set(13, formatNumber(purchaseValue));
  set(14, formatNumber(downPayment));
  set(15, formatNumber(emiTenure));
  set(16, formatNumber(emiAmount));
  set(17, formatNumber(profit));
  set(18, formatNumber(loanAmount));
  set(19, formatNumber(totalPayableAmount));
  set(20, formatNumber(totalDueAmount));
  set(21, formatNumber(totalEmiPaid));
  set(22, formatNumber(fineDueCount));

  for (let emiNo = 1; emiNo <= 12; emiNo += 1) {
    const emi = emiMap.get(emiNo);
    const paymentDate = formatDateDot(emi?.paid_at ?? emi?.partial_paid_at ?? null);
    const finePaymentDate = formatDateDot(emi?.fine_paid_at ?? null);
    const emiPaidAmount = toNum(emi?.partial_paid_amount);
    const fineDue = Math.max(0, toNum(emi?.fine_amount) - toNum(emi?.fine_paid_amount));

    set(22 + emiNo, paymentDate);
    set(35 + ((emiNo - 1) * 2), fineDue > 0 ? 'DUE' : '');
    set(36 + ((emiNo - 1) * 2), emiPaidAmount > 0 ? formatNumber(emiPaidAmount) : '');
    set(61 + (emiNo - 1), paymentDate);
    set(77 + (emiNo - 1), finePaymentDate);
  }

  set(35, firstChargeAmount > 0 ? formatNumber(firstChargeAmount) : '0');
  set(60, adjustOnForeclose > 0 ? formatNumber(adjustOnForeclose) : '');
  set(61, customer.status === 'COMPLETE' ? 'Close' : 'EMI RUNNING');
  set(74, formatNumber(fineDueCount));
  set(75, customer.completion_remark ?? '');
  set(76, formatNumber(totalFineCollected));
  set(77, formatNumber(disbursementValue));
  set(90, firstChargePaid > 0 ? formatNumber(firstChargePaid) : '');
  set(91, firstChargeDue > 0 ? formatNumber(firstChargeDue) : '0');
  set(92, customer.customer_photo_url ?? '');
  set(93, customer.aadhaar_front_url ?? '');
  set(94, customer.aadhaar_back_url ?? '');
  set(95, customer.bill_photo_url ?? customer.bill_url ?? '');
  set(96, customer.address ?? '');
  set(97, customer.landmark ?? '');

  return row;
}

function aggregateRows(rows: string[][], columns: number[]): string[] {
  const out = Array.from({ length: COLUMN_COUNT }, () => '');
  for (const column of columns) {
    const total = rows.reduce((sum, row) => sum + toNum(row[column - 1]), 0);
    out[column - 1] = total ? formatNumber(total) : '';
  }
  return out;
}

function buildRunningPrefix(dataRows: string[][]): string[][] {
  const prefix = cloneTemplate(RUNNING_TEMPLATE);
  const totals = aggregateRows(dataRows, [13,14,15,16,17,18,19,20,21,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,76,77,90,91]);
  prefix[1][12] = totals[17] || '';
  prefix[1][13] = totals[18] || '';
  prefix[1][14] = totals[19] || '';
  prefix[1][15] = totals[13] || '';
  prefix[1][16] = totals[20] || '';
  prefix[1][17] = formatNumber(dataRows.length);
  prefix[3][16] = totals[89] || '';
  prefix[3][17] = totals[90] || '';
  prefix[4] = totals;
  return prefix;
}

function buildCompletePrefix(dataRows: string[][]): string[][] {
  const prefix = cloneTemplate(COMPLETE_TEMPLATE);
  prefix[0] = aggregateRows(dataRows, [13,14,16,17,18,19,20,21,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,76,77,90,91]);
  prefix[0][0] = 'EMI COMPLETE';
  return prefix;
}

function rowsToCsv(rows: string[][]): string {
  const bom = String.fromCharCode(0xfeff);
  return bom + rows.map((row) => row.map((cell) => escapeCsv(String(cell ?? ''))).join(',')).join('\r\n');
}

function rowsToSheet(rows: string[][]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = Array.from({ length: COLUMN_COUNT }, (_, index) => {
    if (index === 0) return { wch: 18 };
    if (index === 2 || index === 3 || index === 8) return { wch: 24 };
    if (index === 95 || index === 96) return { wch: 28 };
    return { wch: 14 };
  });
  return sheet;
}

async function fetchCustomers(
  serviceClient: ReturnType<typeof createServiceClient>,
  status: CustomerStatus,
  retailerId: string | null,
): Promise<CustomerRow[]> {
  let query = serviceClient
    .from('customers')
    .select(`
      id, retailer_id, customer_name, father_name, aadhaar, address, landmark, mobile,
      alternate_number_1, alternate_number_2, model_no, imei, purchase_value, down_payment,
      disburse_amount, purchase_date, emi_due_day, emi_amount, emi_tenure,
      first_emi_charge_amount, first_emi_charge_paid_at,
      customer_photo_url, aadhaar_front_url, aadhaar_back_url, bill_photo_url, bill_url,
      status, completion_date, completion_remark,
      retailer:retailers(name,mobile)
    `)
    .eq('status', status)
    .order('customer_name');

  if (retailerId) query = query.eq('retailer_id', retailerId);
  const { data } = await query;
  return (data ?? []) as CustomerRow[];
}

async function fetchEmis(
  serviceClient: ReturnType<typeof createServiceClient>,
  customerIds: string[],
): Promise<Record<string, EmiRow[]>> {
  if (customerIds.length === 0) return {};
  const { data } = await serviceClient
    .from('emi_schedule')
    .select('customer_id, emi_no, due_date, amount, status, paid_at, partial_paid_at, partial_paid_amount, fine_amount, fine_paid_amount, fine_paid_at')
    .in('customer_id', customerIds)
    .order('emi_no');

  const grouped: Record<string, EmiRow[]> = {};
  for (const row of (data ?? []) as EmiRow[]) {
    grouped[row.customer_id] ??= [];
    grouped[row.customer_id].push(row);
  }
  return grouped;
}

async function fetchPayments(
  serviceClient: ReturnType<typeof createServiceClient>,
  customerIds: string[],
): Promise<Record<string, PaymentRequestRow[]>> {
  if (customerIds.length === 0) return {};
  const { data } = await serviceClient
    .from('payment_requests')
    .select('customer_id, total_emi_amount, fine_amount, first_emi_charge_amount, approved_at')
    .in('customer_id', customerIds)
    .eq('status', 'APPROVED')
    .order('approved_at');

  const grouped: Record<string, PaymentRequestRow[]> = {};
  for (const row of (data ?? []) as PaymentRequestRow[]) {
    grouped[row.customer_id] ??= [];
    grouped[row.customer_id].push(row);
  }
  return grouped;
}

async function buildExportRows(
  serviceClient: ReturnType<typeof createServiceClient>,
  customers: CustomerRow[],
  type: CustomerStatus,
): Promise<string[][]> {
  const customerIds = customers.map((customer) => customer.id);
  const [emiMap, paymentMap] = await Promise.all([
    fetchEmis(serviceClient, customerIds),
    fetchPayments(serviceClient, customerIds),
  ]);

  const dataRows = customers.map((customer, index) => buildDataRow(
    customer,
    index + 1,
    emiMap[customer.id] ?? [],
    paymentMap[customer.id] ?? [],
  ));

  const prefix = type === 'RUNNING' ? buildRunningPrefix(dataRows) : buildCompletePrefix(dataRows);
  return [...prefix, ...dataRows];
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const isAdmin = profile?.role === 'super_admin';
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') ?? 'all') as ExportType;

  let retailerId: string | null = null;
  if (!isAdmin) {
    const { data: retailer } = await serviceClient
      .from('retailers')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!retailer) return NextResponse.json({ error: 'Retailer not found' }, { status: 403 });
    retailerId = retailer.id;
  }

  if (type === 'running') {
    const customers = await fetchCustomers(serviceClient, 'RUNNING', retailerId);
    const rows = await buildExportRows(serviceClient, customers, 'RUNNING');
    return new NextResponse(rowsToCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="Private Finance - Register book.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (type === 'complete') {
    const customers = await fetchCustomers(serviceClient, 'COMPLETE', retailerId);
    const rows = await buildExportRows(serviceClient, customers, 'COMPLETE');
    return new NextResponse(rowsToCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="Private Finance - EMI COMPLETE.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }

  const [runningCustomers, completeCustomers] = await Promise.all([
    fetchCustomers(serviceClient, 'RUNNING', retailerId),
    fetchCustomers(serviceClient, 'COMPLETE', retailerId),
  ]);
  const [runningRows, completeRows] = await Promise.all([
    buildExportRows(serviceClient, runningCustomers, 'RUNNING'),
    buildExportRows(serviceClient, completeCustomers, 'COMPLETE'),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, rowsToSheet(runningRows), 'EMI RUNNING');
  XLSX.utils.book_append_sheet(workbook, rowsToSheet(completeRows), 'EMI COMPLETE');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Private Finance - All Customers.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
