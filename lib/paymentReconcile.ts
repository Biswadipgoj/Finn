import { toNumber } from './formatters';

type Svc = any;

type RequestRow = {
  id: string;
  customer_id: string;
  submitted_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  mode?: string | null;
  utr?: string | null;
  fine_amount?: number | null;
  first_emi_charge_amount?: number | null;
  total_emi_amount?: number | null;
  selected_emi_nos?: number[] | null;
  fine_for_emi_no?: number | null;
  collected_by_role?: string | null;
  collected_by_user_id?: string | null;
};

type ItemRow = {
  id?: string;
  emi_schedule_id: string;
  emi_no: number;
  amount: number;
};

type EmiRow = {
  id: string;
  customer_id: string;
  emi_no: number;
  amount: number;
  status: string;
  due_date: string;
  paid_at?: string | null;
  mode?: string | null;
  utr?: string | null;
  approved_by?: string | null;
  collected_by_role?: string | null;
  collected_by_user_id?: string | null;
  partial_paid_amount?: number | null;
  partial_paid_at?: string | null;
  fine_paid_amount?: number | null;
  fine_paid_at?: string | null;
};

type ApprovedRequestRow = RequestRow & {
  status: string;
  notes?: string | null;
};

export async function resolvePaymentRequestItems(svc: Svc, request: RequestRow): Promise<ItemRow[]> {
  const { data: items } = await svc
    .from('payment_request_items')
    .select('id, emi_schedule_id, emi_no, amount')
    .eq('payment_request_id', request.id)
    .order('emi_no');

  if (items?.length) return items as ItemRow[];
  if (!request.selected_emi_nos?.length) return [];

  const { data: fallbackEmis } = await svc
    .from('emi_schedule')
    .select('id, emi_no, amount, partial_paid_amount')
    .eq('customer_id', request.customer_id)
    .in('emi_no', request.selected_emi_nos)
    .order('emi_no');

  if (!fallbackEmis?.length) return [];

  let remaining = Math.max(0, toNumber(request.total_emi_amount));
  const backfill = (fallbackEmis as Array<{ id: string; emi_no: number; amount: number; partial_paid_amount?: number }>).map((emi, idx, arr) => {
    const outstanding = Math.max(0, toNumber(emi.amount) - toNumber(emi.partial_paid_amount));
    const isLast = idx === arr.length - 1;
    const allocation = isLast ? remaining : Math.min(remaining, outstanding || remaining);
    const amount = Math.max(0, allocation);
    remaining = Math.max(0, remaining - amount);
    return {
      payment_request_id: request.id,
      emi_schedule_id: emi.id,
      emi_no: emi.emi_no,
      amount,
    };
  }).filter((row) => row.amount > 0);

  if (!backfill.length) return [];
  const { error: backfillErr } = await svc.from('payment_request_items').insert(backfill);
  if (backfillErr) {
    console.warn('payment_request_items backfill failed', backfillErr.message);
  }
  return backfill.map(({ emi_schedule_id, emi_no, amount }) => ({ emi_schedule_id, emi_no, amount }));
}

function getFineTargetEmiNo(request: ApprovedRequestRow, items: ItemRow[], firstEmiNo: number | null) {
  if (request.fine_for_emi_no) return request.fine_for_emi_no;
  if (items.length) return Math.min(...items.map((i) => i.emi_no));
  return firstEmiNo;
}

export async function recomputeCustomerLedgerFromRequests(svc: Svc, customerId: string) {
  const { data: emisData } = await svc
    .from('emi_schedule')
    .select('id, customer_id, emi_no, amount, status, due_date, paid_at, mode, utr, approved_by, collected_by_role, collected_by_user_id, partial_paid_amount, partial_paid_at, fine_paid_amount, fine_paid_at')
    .eq('customer_id', customerId)
    .order('emi_no');

  const emis = (emisData || []) as EmiRow[];
  if (!emis.length) return;

  const emiById = new Map(emis.map((emi) => [emi.id, emi]));
  const emiByNo = new Map(emis.map((emi) => [emi.emi_no, emi]));
  const firstEmiNo = emis.length ? Math.min(...emis.map((emi) => emi.emi_no)) : null;

  const { data: approvedRequestsData } = await svc
    .from('payment_requests')
    .select('id, customer_id, submitted_by, approved_by, approved_at, mode, utr, fine_amount, first_emi_charge_amount, total_emi_amount, selected_emi_nos, fine_for_emi_no, collected_by_role, collected_by_user_id, status')
    .eq('customer_id', customerId)
    .eq('status', 'APPROVED')
    .order('approved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });

  const approvedRequests = (approvedRequestsData || []) as ApprovedRequestRow[];
  const approvedRequestIds = approvedRequests.map((r) => r.id);

  const { data: approvedItemsData } = approvedRequestIds.length
    ? await svc
        .from('payment_request_items')
        .select('payment_request_id, emi_schedule_id, emi_no, amount')
        .in('payment_request_id', approvedRequestIds)
    : { data: [] as any[] };

  const approvedItemsByRequest = new Map<string, ItemRow[]>();
  for (const item of (approvedItemsData || []) as Array<ItemRow & { payment_request_id: string }>) {
    const list = approvedItemsByRequest.get(item.payment_request_id) || [];
    list.push({ emi_schedule_id: item.emi_schedule_id, emi_no: item.emi_no, amount: toNumber(item.amount) });
    approvedItemsByRequest.set(item.payment_request_id, list);
  }

  const principalByEmiId = new Map<string, number>();
  const paymentTrailByEmiId = new Map<string, Array<{ paidAt: string | null; request: ApprovedRequestRow; amount: number }>>();
  const fineByEmiNo = new Map<number, { amount: number; paidAt: string | null }>();

  for (const request of approvedRequests) {
    let requestItems = approvedItemsByRequest.get(request.id) || [];
    if (!requestItems.length && request.selected_emi_nos?.length) {
      requestItems = await resolvePaymentRequestItems(svc, request);
    }

    for (const item of requestItems) {
      const emi = emiById.get(item.emi_schedule_id);
      if (!emi) continue;

      const amount = Math.max(0, toNumber(item.amount));
      if (!amount) continue;

      principalByEmiId.set(emi.id, toNumber(principalByEmiId.get(emi.id)) + amount);

      const trail = paymentTrailByEmiId.get(emi.id) || [];
      trail.push({ paidAt: request.approved_at ?? null, request, amount });
      paymentTrailByEmiId.set(emi.id, trail);
    }

    const fineAmount = Math.max(0, toNumber(request.fine_amount));
    if (fineAmount > 0) {
      const targetEmiNo = getFineTargetEmiNo(request, requestItems, firstEmiNo);
      if (targetEmiNo && emiByNo.has(targetEmiNo)) {
        const prev = fineByEmiNo.get(targetEmiNo) || { amount: 0, paidAt: null };
        fineByEmiNo.set(targetEmiNo, {
          amount: prev.amount + fineAmount,
          paidAt: request.approved_at ?? prev.paidAt,
        });
      }
    }
  }

  const { data: pendingItemsData } = await svc
    .from('payment_request_items')
    .select('emi_schedule_id, payment_request_id')
    .in(
      'payment_request_id',
      (
        await svc
          .from('payment_requests')
          .select('id')
          .eq('customer_id', customerId)
          .eq('status', 'PENDING')
      ).data?.map((r: { id: string }) => r.id) || ['00000000-0000-0000-0000-000000000000'],
    );

  const pendingEmiIdSet = new Set(((pendingItemsData || []) as Array<{ emi_schedule_id: string }>).map((row) => row.emi_schedule_id));

  for (const emi of emis) {
    const scheduledAmount = Math.max(0, toNumber(emi.amount));
    const paidPrincipalRaw = Math.max(0, toNumber(principalByEmiId.get(emi.id)));
    const paidPrincipal = Math.min(scheduledAmount, paidPrincipalRaw);
    const hasPartial = paidPrincipal > 0 && paidPrincipal < scheduledAmount;
    const isFull = scheduledAmount > 0 && paidPrincipal >= scheduledAmount;

    const trail = (paymentTrailByEmiId.get(emi.id) || []).filter((t) => t.amount > 0);

    let partialPaidAt: string | null = null;
    let paidAt: string | null = null;
    let mode: string | null = null;
    let utr: string | null = null;
    let approvedBy: string | null = null;
    let collectedByRole: string | null = null;
    let collectedByUserId: string | null = null;

    if (trail.length) {
      partialPaidAt = trail[trail.length - 1].paidAt || null;
      const latest = trail[trail.length - 1].request;

      if (isFull) {
        let running = 0;
        let finalRequest = latest;
        let fullPaidAt: string | null = null;

        for (const step of trail) {
          running += step.amount;
          if (running >= scheduledAmount) {
            finalRequest = step.request;
            fullPaidAt = step.paidAt || null;
            break;
          }
        }

        paidAt = fullPaidAt;
        mode = finalRequest.mode || null;
        utr = finalRequest.utr ?? null;
        approvedBy = finalRequest.approved_by || null;
        collectedByRole = finalRequest.collected_by_role || null;
        collectedByUserId = finalRequest.collected_by_user_id || finalRequest.submitted_by || null;
      } else {
        mode = latest.mode || null;
        utr = latest.utr ?? null;
        approvedBy = latest.approved_by || null;
        collectedByRole = latest.collected_by_role || null;
        collectedByUserId = latest.collected_by_user_id || latest.submitted_by || null;
      }
    }

    const fine = fineByEmiNo.get(emi.emi_no);
    const finePaidAmount = Math.max(0, toNumber(fine?.amount));

    let nextStatus: string;
    if (isFull) nextStatus = 'APPROVED';
    else if (hasPartial) nextStatus = 'PARTIALLY_PAID';
    else if (pendingEmiIdSet.has(emi.id)) nextStatus = 'PENDING_APPROVAL';
    else nextStatus = 'UNPAID';

    const update = {
      partial_paid_amount: paidPrincipal,
      partial_paid_at: paidPrincipal > 0 ? partialPaidAt : null,
      status: nextStatus,
      paid_at: isFull ? paidAt : null,
      mode: paidPrincipal > 0 ? mode : null,
      utr: paidPrincipal > 0 ? utr : null,
      approved_by: paidPrincipal > 0 ? approvedBy : null,
      collected_by_role: paidPrincipal > 0 ? collectedByRole : null,
      collected_by_user_id: paidPrincipal > 0 ? collectedByUserId : null,
      fine_paid_amount: finePaidAmount,
      fine_paid_at: finePaidAmount > 0 ? (fine?.paidAt || null) : null,
      updated_at: new Date().toISOString(),
    };

    await svc.from('emi_schedule').update(update).eq('id', emi.id);
  }

  const firstChargePaidRequest = approvedRequests
    .filter((r) => toNumber(r.first_emi_charge_amount) > 0)
    .at(-1);

  await svc.from('customers').update({
    first_emi_charge_paid_at: firstChargePaidRequest?.approved_at || null,
  }).eq('id', customerId);
}

export async function applyApprovedRequestEffects(svc: Svc, request: RequestRow) {
  await recomputeCustomerLedgerFromRequests(svc, request.customer_id);
}

export async function reverseApprovedRequestEffects(svc: Svc, request: RequestRow) {
  await recomputeCustomerLedgerFromRequests(svc, request.customer_id);
}

export async function recomputeCustomerCompletion(svc: Svc, customerId: string) {
  const { data: customer } = await svc.from('customers')
    .select('id, status, first_emi_charge_amount, first_emi_charge_paid_at')
    .eq('id', customerId)
    .maybeSingle();
  if (!customer) return;

  const { count: openEmiCount } = await svc.from('emi_schedule')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .in('status', ['UNPAID', 'PENDING_APPROVAL', 'PARTIALLY_PAID']);

  const { data: fineRows } = await svc.from('emi_schedule')
    .select('fine_amount, fine_paid_amount, fine_waived')
    .eq('customer_id', customerId);
  const finePending = (fineRows || []).some((row: any) => !row.fine_waived && toNumber(row.fine_amount) > toNumber(row.fine_paid_amount));
  const firstChargePending = toNumber(customer.first_emi_charge_amount) > 0 && !customer.first_emi_charge_paid_at;

  if ((openEmiCount || 0) === 0 && !finePending && !firstChargePending) {
    await svc.from('customers').update({ status: 'COMPLETE', completion_date: new Date().toISOString().split('T')[0] }).eq('id', customerId);
  } else if (customer.status === 'COMPLETE') {
    await svc.from('customers').update({ status: 'RUNNING', completion_date: null }).eq('id', customerId);
  }
}
