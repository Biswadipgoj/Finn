export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
    if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { request_id, remark } = body as { request_id?: string; remark?: string };
    if (!request_id) return NextResponse.json({ error: 'request_id is required' }, { status: 400 });

    const svc = createServiceClient();
    const { data, error } = await svc.rpc('approve_payment_request_v3', {
      p_request_id: request_id,
      p_admin_id: user.id,
      p_remark: remark || null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data && data.success === false) {
      return NextResponse.json({ error: data.error || 'Approval failed' }, { status: 409 });
    }

    return NextResponse.json(data || { success: true, request_id });
  } catch (error) {
    console.error('approve-request failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected server error' }, { status: 500 });
  }
}
