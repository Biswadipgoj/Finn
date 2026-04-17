import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNullableDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return { error: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, role: profile.role as 'super_admin' | 'admin' };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;

    const customerId = params.id;
    const svc = createServiceClient();
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const payload: Record<string, unknown> = {
      customer_name: String(body.customer_name || '').trim(),
      father_name: body.father_name ? String(body.father_name).trim() : null,
      aadhaar: body.aadhaar ? String(body.aadhaar).replace(/\D/g, '') : null,
      voter_id: body.voter_id ? String(body.voter_id).trim() : null,
      address: body.address ? String(body.address).trim() : null,
      landmark: body.landmark ? String(body.landmark).trim() : null,
      mobile: String(body.mobile || '').replace(/\D/g, ''),
      alternate_number_1: body.alternate_number_1 ? String(body.alternate_number_1).replace(/\D/g, '') : null,
      alternate_number_2: body.alternate_number_2 ? String(body.alternate_number_2).replace(/\D/g, '') : null,
      model_no: body.model_no ? String(body.model_no).trim() : null,
      imei: String(body.imei || '').replace(/\D/g, ''),
      box_no: body.box_no ? String(body.box_no).trim() : null,
      purchase_value: asNumber(body.purchase_value),
      down_payment: asNumber(body.down_payment),
      disburse_amount: body.disburse_amount === null || body.disburse_amount === '' ? null : asNumber(body.disburse_amount),
      purchase_date: body.purchase_date || null,
      emi_start_date: body.emi_start_date || null,
      emi_due_day: asNumber(body.emi_due_day),
      emi_amount: asNumber(body.emi_amount),
      emi_tenure: asNumber(body.emi_tenure),
      first_emi_charge_amount: asNumber(body.first_emi_charge_amount),
      first_emi_charge_paid_at: asNullableDate(body.first_emi_charge_paid_at),
      customer_photo_url: body.customer_photo_url ? String(body.customer_photo_url).trim() : null,
      aadhaar_front_url: body.aadhaar_front_url ? String(body.aadhaar_front_url).trim() : null,
      aadhaar_back_url: body.aadhaar_back_url ? String(body.aadhaar_back_url).trim() : null,
      bill_photo_url: body.bill_photo_url ? String(body.bill_photo_url).trim() : null,
      emi_card_photo_url: body.emi_card_photo_url ? String(body.emi_card_photo_url).trim() : null,
      lock_provider: body.lock_provider ? String(body.lock_provider) : null,
      lock_device_id: body.lock_device_id ? String(body.lock_device_id).trim() : null,
      google_drive_docs: body.google_drive_docs ? String(body.google_drive_docs).trim() : null,
      retailer_id: body.retailer_id || null,
      status: body.status || 'RUNNING',
      is_locked: !!body.is_locked,
      completion_remark: body.completion_remark ? String(body.completion_remark).trim() : null,
      completion_date: body.completion_date || null,
      settlement_amount: body.settlement_amount === null || body.settlement_amount === '' ? null : asNumber(body.settlement_amount),
      settlement_date: body.settlement_date || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await svc
      .from('customers')
      .update(payload)
      .eq('id', customerId)
      .select('*, retailer:retailers(*)')
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, message: 'Customer updated successfully', customer: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
