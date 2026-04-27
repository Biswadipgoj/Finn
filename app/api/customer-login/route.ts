export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const CUSTOMER_SELECT = `
  id, retailer_id, customer_name, father_name, aadhaar, mobile,
  alternate_number_1, alternate_number_2,
  model_no, imei, purchase_value, down_payment, disburse_amount,
  purchase_date, emi_due_day, emi_amount, emi_tenure,
  first_emi_charge_amount, first_emi_charge_paid_at,
  customer_photo_url, status,
  retailer:retailers(name, mobile)
`;

function cleanDigits(value?: string) {
  return (value ?? '').replace(/\D/g, '');
}

function getLoginSecret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'finn-customer-login-secret';
}

function createSelectionToken(payload: { aadhaar?: string; mobile?: string }) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const encoded = Buffer.from(JSON.stringify({ ...payload, exp: expiresAt })).toString('base64url');
  const sig = crypto.createHmac('sha256', getLoginSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function validateSelectionToken(token: string, payload: { aadhaar?: string; mobile?: string }) {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return false;
  const expected = crypto.createHmac('sha256', getLoginSecret()).update(encoded).digest('base64url');
  if (sig !== expected) return false;

  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { aadhaar?: string; mobile?: string; exp?: number };
  if (!parsed.exp || parsed.exp < Date.now()) return false;
  if ((parsed.aadhaar || '') !== (payload.aadhaar || '')) return false;
  if ((parsed.mobile || '') !== (payload.mobile || '')) return false;
  return true;
}

async function buildCustomerPayload(serviceClient: ReturnType<typeof createServiceClient>, customer: { id: string; retailer_id: string }) {
  const { data: emis } = await serviceClient
    .from('emi_schedule')
    .select('id, emi_no, due_date, amount, status, paid_at, mode, partial_paid_amount, partial_paid_at, fine_amount, fine_waived, fine_paid_amount, fine_paid_at')
    .eq('customer_id', customer.id)
    .order('emi_no');

  const { data: breakdown } = await serviceClient.rpc('get_due_breakdown', {
    p_customer_id: customer.id,
  });

  const { data: broadcasts } = await serviceClient
    .from('broadcast_messages')
    .select('id, message, image_url, expires_at, sender_name, sender_role')
    .eq('target_retailer_id', customer.retailer_id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  return { customer, emis: emis || [], breakdown, broadcasts: broadcasts || [] };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { aadhaar, mobile, customer_id, selection_token } = body as { aadhaar?: string; mobile?: string; customer_id?: string; selection_token?: string };

  const serviceClient = createServiceClient();
  const cleanAadhaar = cleanDigits(aadhaar);
  const cleanMobile = cleanDigits(mobile);

  if (customer_id) {
    if (!cleanAadhaar && !cleanMobile) {
      return NextResponse.json({ error: 'Aadhaar or mobile is required to select this account' }, { status: 400 });
    }
    if (!selection_token || !validateSelectionToken(selection_token, { aadhaar: cleanAadhaar || undefined, mobile: cleanMobile || undefined })) {
      return NextResponse.json({ error: 'Session expired. Please login again to choose account.' }, { status: 401 });
    }

    let directQuery = serviceClient.from('customers').select(CUSTOMER_SELECT).eq('id', customer_id);
    if (cleanAadhaar) directQuery = directQuery.eq('aadhaar', cleanAadhaar);
    if (cleanMobile) directQuery = directQuery.eq('mobile', cleanMobile);

    const { data: customer } = await directQuery.single();
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found for the provided login details' }, { status: 401 });
    }

    return NextResponse.json(await buildCustomerPayload(serviceClient, customer));
  }

  if (!cleanAadhaar && !cleanMobile) {
    return NextResponse.json({ error: 'Provide Aadhaar or mobile number to login' }, { status: 400 });
  }
  if (cleanAadhaar && cleanAadhaar.length !== 12) {
    return NextResponse.json({ error: 'Aadhaar must be exactly 12 digits' }, { status: 400 });
  }
  if (cleanMobile && cleanMobile.length !== 10) {
    return NextResponse.json({ error: 'Mobile must be exactly 10 digits' }, { status: 400 });
  }

  let query = serviceClient.from('customers').select(CUSTOMER_SELECT);

  if (cleanAadhaar) {
    query = query.eq('aadhaar', cleanAadhaar);
    if (cleanMobile) query = query.eq('mobile', cleanMobile);
  } else {
    query = query.eq('mobile', cleanMobile);
  }

  const { data: customers, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!customers || customers.length === 0) {
    return NextResponse.json(
      { error: 'No matching customer found. Check your Aadhaar or Mobile number.' },
      { status: 401 }
    );
  }

  if (customers.length > 1) {
    return NextResponse.json({
      multi: true,
      selection_token: createSelectionToken({ aadhaar: cleanAadhaar || undefined, mobile: cleanMobile || undefined }),
      customers: customers.map((c) => ({
        id: c.id,
        customer_name: c.customer_name,
        imei: c.imei,
        model_no: c.model_no,
        mobile: c.mobile,
        status: c.status,
        emi_amount: c.emi_amount,
        retailer: c.retailer,
      })),
    });
  }

  return NextResponse.json(await buildCustomerPayload(serviceClient, customers[0]));
}
