import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface CSVRow {
  customer_name?: string;
  father_name?: string;
  mobile?: string;
  aadhaar?: string;
  voter_id?: string;
  address?: string;
  landmark?: string;
  alternate_number_1?: string;
  alternate_number_2?: string;
  model_no?: string;
  imei?: string;
  box_no?: string;
  purchase_value?: string;
  down_payment?: string;
  disburse_amount?: string;
  purchase_date?: string;
  emi_due_day?: string;
  emi_amount?: string;
  emi_tenure?: string;
  first_emi_charge_amount?: string;
  retailer_username?: string;
  retailer_id?: string;
  // Aliases from actual CSVs
  retailer_name?: string;
  alt_mobile?: string;
  handset_model?: string;
  first_emi_date?: string;
  loan_amount?: string;
  total_payable?: string;
  customer_photo_url?: string;
  aadhaar_front_url?: string;
  aadhaar_back_url?: string;
  bill_url?: string;
  bill_photo_url?: string;
  customer_status?: string;
}

// Map common CSV column aliases to our expected names
function normalizeRow(raw: Record<string, string>): CSVRow {
  const row: CSVRow = {};
  for (const [key, val] of Object.entries(raw)) {
    const k = key.trim().toLowerCase().replace(/[\s-]+/g, '_');
    row[k as keyof CSVRow] = val;
  }
  // Map aliases
  if (!row.model_no && row.handset_model) row.model_no = row.handset_model;
  if (!row.alternate_number_1 && row.alt_mobile) row.alternate_number_1 = row.alt_mobile;
  if (!row.purchase_value && row.loan_amount) row.purchase_value = row.loan_amount;
  if (!row.bill_photo_url && row.bill_url) row.bill_photo_url = row.bill_url;
  // Derive emi_due_day from first_emi_date if not provided
  if (!row.emi_due_day && row.first_emi_date) {
    try {
      const d = parseFlexDate(row.first_emi_date);
      if (d) row.emi_due_day = String(d.getDate());
    } catch { /* ignore */ }
  }
  return row;
}

function parseFlexDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Try DD-Mon-YY, DD-Mon-YYYY, DD/MM/YYYY, YYYY-MM-DD
  const s = dateStr.trim();
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const yr = dmy[3].length === 2 ? 2000 + parseInt(dmy[3]) : parseInt(dmy[3]);
    return new Date(yr, parseInt(dmy[2]) - 1, parseInt(dmy[1]));
  }
  // DD-Mon-YY or DD-Mon-YYYY
  const months: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const dmy2 = s.match(/^(\d{1,2})[\/\-]([A-Za-z]{3})[\/\-](\d{2,4})$/);
  if (dmy2) {
    const mon = months[dmy2[2].toLowerCase()];
    if (mon !== undefined) {
      const yr = dmy2[3].length === 2 ? 2000 + parseInt(dmy2[3]) : parseInt(dmy2[3]);
      return new Date(yr, mon, parseInt(dmy2[1]));
    }
  }
  // Fallback
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateForDB(dateStr: string): string | null {
  const d = parseFlexDate(dateStr);
  if (!d) return null;
  return d.toISOString().split('T')[0];
}

function validateRow(row: CSVRow, retailers: { id: string; username: string; name: string }[]): string | null {
  if (!row.customer_name?.trim()) return 'customer_name is required';
  if (!row.mobile || !/^\d{10}$/.test(row.mobile.replace(/\D/g, ''))) return 'mobile must be 10 digits';
  if (!row.imei || !/^\d{15}$/.test(row.imei.replace(/\D/g, ''))) return 'imei must be 15 digits';
  if (!row.purchase_value || isNaN(Number(row.purchase_value))) return 'purchase_value is required';
  if (!row.purchase_date && !row.first_emi_date) return 'purchase_date is required';
  if (!row.emi_amount || isNaN(Number(row.emi_amount))) return 'emi_amount is required';
  if (!row.emi_tenure || isNaN(Number(row.emi_tenure))) return 'emi_tenure is required';
  if (!row.emi_due_day || isNaN(Number(row.emi_due_day))) return 'emi_due_day is required (or provide first_emi_date)';

  const retailerId = row.retailer_id
    || retailers.find(r => r.username === row.retailer_username)?.id
    || retailers.find(r => r.name.toLowerCase() === (row.retailer_name || '').toLowerCase())?.id;
  if (!retailerId) return `retailer not found (name: ${row.retailer_name}, username: ${row.retailer_username})`;

  return null;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const body = await req.json();
  const rows: CSVRow[] = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Load all retailers for lookup
  const { data: retailers } = await serviceClient.from('retailers').select('id, username, name');
  const retailerList = retailers || [];

  const inserted: string[] = [];
  const skipped: { row: number; imei: string; reason: string }[] = [];
  const failed: { row: number; imei: string; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = normalizeRow(rows[i]);
    const imei = (row.imei || '').replace(/\D/g, '');
    const rowNum = i + 2; // 1-based with header

    // Validate
    const validErr = validateRow(row, retailerList);
    if (validErr) {
      failed.push({ row: rowNum, imei, reason: validErr });
      continue;
    }

    const retailerId = row.retailer_id
      || retailerList.find(r => r.username === row.retailer_username)?.id
      || retailerList.find(r => r.name.toLowerCase() === (row.retailer_name || '').toLowerCase())?.id;

    // Check IMEI uniqueness
    const { count } = await serviceClient
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('imei', imei);

    if (count && count > 0) {
      skipped.push({ row: rowNum, imei, reason: 'IMEI already exists — skipped' });
      continue;
    }

    const payload = {
      retailer_id: retailerId,
      customer_name: row.customer_name!.trim(),
      father_name: row.father_name?.trim() || null,
      mobile: row.mobile!.replace(/\D/g, ''),
      aadhaar: row.aadhaar?.replace(/\D/g, '') || null,
      voter_id: row.voter_id?.trim() || null,
      address: row.address?.trim() || null,
      landmark: row.landmark?.trim() || null,
      alternate_number_1: row.alternate_number_1?.replace(/\D/g, '').slice(0, 10) || null,
      alternate_number_2: row.alternate_number_2?.replace(/\D/g, '').slice(0, 10) || null,
      model_no: row.model_no?.trim() || null,
      imei,
      box_no: row.box_no?.trim() || null,
      purchase_value: Number(row.purchase_value),
      down_payment: Number(row.down_payment || 0),
      disburse_amount: row.disburse_amount ? Number(row.disburse_amount) : null,
      purchase_date: formatDateForDB(row.purchase_date || '') || formatDateForDB(row.first_emi_date || '') || row.purchase_date,
      emi_due_day: Number(row.emi_due_day),
      emi_amount: Number(row.emi_amount),
      emi_tenure: Number(row.emi_tenure),
      first_emi_charge_amount: Number(row.first_emi_charge_amount || 0),
      customer_photo_url: row.customer_photo_url?.trim() || null,
      aadhaar_front_url: row.aadhaar_front_url?.trim() || null,
      aadhaar_back_url: row.aadhaar_back_url?.trim() || null,
      bill_photo_url: row.bill_photo_url?.trim() || null,
      status: (row.customer_status?.toUpperCase() === 'COMPLETE' ? 'COMPLETE' : 'RUNNING'),
    };

    const { error: insErr } = await serviceClient.from('customers').insert(payload);
    if (insErr) {
      failed.push({ row: rowNum, imei, reason: insErr.message });
    } else {
      inserted.push(imei);
    }
  }

  return NextResponse.json({
    total: rows.length,
    inserted: inserted.length,
    skipped: skipped.length,
    failed: failed.length,
    inserted_imeis: inserted,
    skipped_list: skipped,
    failed_list: failed,
  });
}
