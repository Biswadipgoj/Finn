export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, createClient } from '@/lib/supabase/server';

async function requireSuperAdmin() {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (profile?.role !== 'super_admin') {
    return { error: NextResponse.json({ error: 'Forbidden — super admin only' }, { status: 403 }) };
  }

  return { user };
}

function cleanMobile(mobile: unknown) {
  return String(mobile ?? '').replace(/\D/g, '');
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const { name, username, password, retail_pin } = body;
  const mobile = cleanMobile(body.mobile);

  if (!name || !username || !password) {
    return NextResponse.json({ error: 'name, username and password are required' }, { status: 400 });
  }
  if (mobile && !/^\d{10}$/.test(mobile)) {
    return NextResponse.json({ error: 'Mobile must be exactly 10 digits' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const normalizedUsername = String(username).trim().toLowerCase();
  const email = `${normalizedUsername}@tele.local`;

  const { data: existingRetailer } = await serviceClient
    .from('retailers')
    .select('id')
    .eq('username', normalizedUsername)
    .maybeSingle();
  if (existingRetailer) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
  }

  const { data: authUser, error: authErr } = await serviceClient.auth.admin.createUser({
    email,
    password: retail_pin || password,
    email_confirm: true,
  });

  if (authErr || !authUser?.user) {
    return NextResponse.json({ error: authErr?.message || 'Failed to create auth user' }, { status: 500 });
  }

  const { data: retailer, error: dbErr } = await serviceClient
    .from('retailers')
    .insert({
      auth_user_id: authUser.user.id,
      name: String(name).trim(),
      username: normalizedUsername,
      retail_pin: retail_pin || null,
      mobile: mobile || null,
      is_active: true,
    })
    .select()
    .single();

  if (dbErr) {
    await serviceClient.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  const { error: profileErr } = await serviceClient.from('profiles').insert({ user_id: authUser.user.id, role: 'retailer' });
  if (profileErr) {
    await serviceClient.from('retailers').delete().eq('id', retailer.id);
    await serviceClient.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  return NextResponse.json({ retailer });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const { id, name, password, retail_pin, is_active } = body;
  const mobile = body.mobile === undefined ? undefined : cleanMobile(body.mobile);
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (mobile && !/^\d{10}$/.test(mobile)) {
    return NextResponse.json({ error: 'Mobile must be exactly 10 digits' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: retailer } = await serviceClient.from('retailers').select('auth_user_id').eq('id', id).single();
  if (!retailer) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });

  if (password && retailer.auth_user_id) {
    const { error } = await serviceClient.auth.admin.updateUserById(retailer.auth_user_id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (retail_pin && !password && retailer.auth_user_id) {
    const { error } = await serviceClient.auth.admin.updateUserById(retailer.auth_user_id, { password: retail_pin });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = String(name).trim();
  if (retail_pin !== undefined) updates.retail_pin = retail_pin || null;
  if (is_active !== undefined) updates.is_active = Boolean(is_active);
  if (mobile !== undefined) updates.mobile = mobile || null;

  const { error: dbErr } = await serviceClient.from('retailers').update(updates).eq('id', id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if ('error' in auth) return auth.error;

  const serviceClient = createServiceClient();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { count } = await serviceClient.from('customers').select('*', { count: 'exact', head: true }).eq('retailer_id', id);
  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete: ${count} customer(s) assigned to this retailer.` }, { status: 409 });
  }

  const { data: r } = await serviceClient.from('retailers').select('auth_user_id').eq('id', id).single();
  const { error } = await serviceClient.from('retailers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (r?.auth_user_id) {
    await serviceClient.auth.admin.deleteUser(r.auth_user_id);
  }

  return NextResponse.json({ success: true });
}
