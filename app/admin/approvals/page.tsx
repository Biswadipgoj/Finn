'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { PaymentRequest } from '@/lib/types';
import NavBar from '@/components/NavBar';
import SearchInput from '@/components/SearchInput';
import { formatCurrency, formatDateTime } from '@/lib/formatters';

type StatusFilter = 'PENDING' | 'ALL';
type EditFeedback = { type: 'success' | 'error'; text: string } | null;

function customerName(req: PaymentRequest) {
  return (req.customer as Record<string, unknown> | undefined)?.customer_name as string || 'Customer';
}

function customerMobile(req: PaymentRequest) {
  return (req.customer as Record<string, unknown> | undefined)?.mobile as string || '—';
}

function customerImei(req: PaymentRequest) {
  return (req.customer as Record<string, unknown> | undefined)?.imei as string || '—';
}

function retailerName(req: PaymentRequest) {
  return (req.retailer as Record<string, unknown> | undefined)?.name as string || '—';
}

function statusBadge(status: PaymentRequest['status']) {
  if (status === 'APPROVED') return <span className="badge-approved">Approved</span>;
  if (status === 'REJECTED') return <span className="badge-rejected">Rejected</span>;
  return <span className="badge-pending">Pending</span>;
}

export default function ApprovalsPage() {
  const supabase = createClient();
  const supabaseRef = useRef(supabase);
  supabaseRef.current = supabase;

  const [searchQuery, setSearchQuery] = useState('');
  const [requests, setRequests] = useState<PaymentRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveRemark, setApproveRemark] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [editModal, setEditModal] = useState<PaymentRequest | null>(null);
  const [editForm, setEditForm] = useState({
    status: '',
    mode: '',
    total_emi_amount: '',
    fine_amount: '',
    first_emi_charge_amount: '',
    total_amount: '',
    notes: '',
    paid_at: '',
    collected_by_role: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editFeedback, setEditFeedback] = useState<EditFeedback>(null);

  const fetchRequests = useCallback(async (query?: string, filter?: StatusFilter) => {
    const sb = supabaseRef.current;
    setLoading(true);
    try {
      let qb = sb
        .from('payment_requests')
        .select(`
          *,
          customer:customers(id, customer_name, imei, mobile, first_emi_charge_amount, first_emi_charge_paid_at),
          retailer:retailers(id, name, username)
        `)
        .order('created_at', { ascending: false })
        .limit(75);

      const activeFilter = filter ?? statusFilter;
      if (activeFilter === 'PENDING') qb = qb.eq('status', 'PENDING');

      if (query && query.trim().length >= 3) {
        const q = query.trim();
        if (/^\d{15}$/.test(q)) {
          const { data: cust } = await sb.from('customers').select('id').eq('imei', q).maybeSingle();
          if (!cust) { setRequests([]); return; }
          qb = qb.eq('customer_id', cust.id);
        } else if (/^\d{12}$/.test(q)) {
          const { data: cust } = await sb.from('customers').select('id').eq('aadhaar', q).maybeSingle();
          if (!cust) { setRequests([]); return; }
          qb = qb.eq('customer_id', cust.id);
        } else {
          const { data: custs } = await sb.from('customers').select('id').ilike('customer_name', `%${q}%`);
          const ids = (custs || []).map(c => c.id);
          if (ids.length === 0) { setRequests([]); return; }
          qb = qb.in('customer_id', ids);
        }
      }

      const { data, error } = await qb;
      if (error) {
        toast.error('Unable to load payment requests.');
        setRequests([]);
        return;
      }
      setRequests((data as PaymentRequest[]) || []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query || query.trim().length < 3) {
      setRequests(null);
      return;
    }
    fetchRequests(query, statusFilter);
  }, [fetchRequests, statusFilter]);

  function loadPayments(filter = statusFilter) {
    setSearchQuery('');
    fetchRequests(undefined, filter);
  }

  function changeFilter(filter: StatusFilter) {
    setStatusFilter(filter);
    fetchRequests(searchQuery || undefined, filter);
  }

  function openEditModal(req: PaymentRequest) {
    setEditFeedback(null);
    setEditForm({
      status: req.status,
      mode: req.mode,
      total_emi_amount: String(req.total_emi_amount ?? 0),
      fine_amount: String(req.fine_amount ?? 0),
      first_emi_charge_amount: String(req.first_emi_charge_amount ?? 0),
      total_amount: String(req.total_amount ?? 0),
      notes: req.notes || '',
      paid_at: req.approved_at ? req.approved_at.slice(0, 16) : '',
      collected_by_role: '',
    });
    setEditModal(req);
  }

  async function savePaymentEdit() {
    if (!editModal) return;
    setEditSaving(true);
    setEditFeedback(null);
    const toastId = toast.loading('Saving payment changes...');
    try {
      const res = await fetch(`/api/admin/payments/${editModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editForm.status,
          mode: editForm.mode,
          total_emi_amount: Number(editForm.total_emi_amount) || 0,
          fine_amount: Number(editForm.fine_amount) || 0,
          first_emi_charge_amount: Number(editForm.first_emi_charge_amount) || 0,
          total_amount: Number(editForm.total_amount) || 0,
          notes: editForm.notes || null,
          paid_at: editForm.paid_at || null,
          collected_by_role: editForm.collected_by_role || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error || 'Unable to save payment changes.';
        setEditFeedback({ type: 'error', text: message });
        toast.error(message, { id: toastId });
        return;
      }

      setEditFeedback({ type: 'success', text: 'Payment updated successfully.' });
      toast.success('Payment updated successfully.', { id: toastId });
      await fetchRequests(searchQuery || undefined, statusFilter);
      window.setTimeout(() => setEditModal(null), 650);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save payment changes.';
      setEditFeedback({ type: 'error', text: message });
      toast.error(message, { id: toastId });
    } finally {
      setEditSaving(false);
    }
  }

  async function deletePaymentEdit() {
    if (!editModal) return;
    if (!window.confirm('Delete this payment and clear linked paid dates from summaries?')) return;
    setEditSaving(true);
    setEditFeedback(null);
    const toastId = toast.loading('Deleting payment...');
    try {
      const res = await fetch(`/api/admin/payments/${editModal.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error || 'Unable to delete payment.';
        setEditFeedback({ type: 'error', text: message });
        toast.error(message, { id: toastId });
        return;
      }
      setEditFeedback({ type: 'success', text: 'Payment deleted and linked dates cleared.' });
      toast.success('Payment deleted and linked dates cleared.', { id: toastId });
      await fetchRequests(searchQuery || undefined, statusFilter);
      window.setTimeout(() => setEditModal(null), 650);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete payment.';
      setEditFeedback({ type: 'error', text: message });
      toast.error(message, { id: toastId });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleApprove(requestId: string) {
    setActionLoading(requestId);
    const toastId = toast.loading('Approving payment...');
    try {
      const res = await fetch('/api/admin/approve-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, remark: approveRemark || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Approval failed. Please try again.', { id: toastId });
        return;
      }
      toast.success('Payment approved successfully.', { id: toastId });
      setApprovingId(null);
      setApproveRemark('');
      setRequests(prev => (prev ?? []).filter(r => r.id !== requestId));
      await fetchRequests(searchQuery || undefined, statusFilter);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Approval failed. Please try again.', { id: toastId });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject() {
    if (!rejectModal || !rejectReason.trim()) {
      toast.error('Rejection reason is required.');
      return;
    }
    setActionLoading(rejectModal.id);
    const toastId = toast.loading('Rejecting payment...');
    try {
      const res = await fetch('/api/payments/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: rejectModal.id, reason: rejectReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Unable to reject payment.', { id: toastId });
        return;
      }
      toast.success('Payment rejected.', { id: toastId });
      setRequests(prev => (prev ?? []).filter(r => r.id !== rejectModal.id));
      setRejectModal(null);
      setRejectReason('');
      await fetchRequests(searchQuery || undefined, statusFilter);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to reject payment.', { id: toastId });
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="min-h-screen page-bg">
      <NavBar role="admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 mobile-stack">
          <div className="space-y-3">
            <Link href="/admin" className="btn-ghost inline-flex w-fit text-sm">← Dashboard</Link>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">Payment Approvals</h1>
              <p className="text-ink-muted text-sm mt-1">Review, approve, edit, or reject retailer payment requests.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mobile-full sm:justify-end">
            <div className="grid grid-cols-2 gap-1 bg-surface-2 rounded-xl p-1 border border-surface-4 flex-1 sm:flex-none sm:w-auto">
              <button
                onClick={() => changeFilter('PENDING')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${statusFilter === 'PENDING' ? 'bg-brand-500 text-white shadow' : 'text-ink-muted hover:text-ink'}`}
              >Pending</button>
              <button
                onClick={() => changeFilter('ALL')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${statusFilter === 'ALL' ? 'bg-brand-500 text-white shadow' : 'text-ink-muted hover:text-ink'}`}
              >All</button>
            </div>
            <button onClick={() => loadPayments()} disabled={loading} className="btn-secondary shrink-0">
              {loading ? 'Loading...' : 'Load'}
            </button>
          </div>
        </div>

        <SearchInput
          onSearch={handleSearch}
          loading={loading}
          placeholder="Search by customer name, IMEI, or Aadhaar"
        />

        {requests === null && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-3xl bg-surface-2 border border-surface-4 flex items-center justify-center mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(37,99,235,0.35)" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
              </svg>
            </div>
            <p className="text-ink-muted text-lg">Search for payment requests or click Load.</p>
          </div>
        )}

        {requests !== null && requests.length === 0 && !loading && (
          <div className="card p-8 text-center text-ink-muted">No payment requests found.</div>
        )}

        {requests !== null && requests.length > 0 && (
          <div className="space-y-4">
            {requests.map(req => {
              const isActioning = actionLoading === req.id;
              return (
                <article key={req.id} className="card p-4 sm:p-5 animate-fade-in">
                  <div className="flex items-start justify-between gap-4 mobile-stack">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {statusBadge(req.status)}
                        <span className="badge-gray">{req.mode}</span>
                        {req.utr && <span className="badge-blue">UTR: {req.utr}</span>}
                      </div>
                      <h2 className="text-lg font-bold text-ink leading-snug">{customerName(req)}</h2>
                      <p className="text-sm text-ink-muted mt-1">{customerMobile(req)} · IMEI {customerImei(req)}</p>
                      <p className="text-xs text-ink-muted mt-1">Retailer: {retailerName(req)} · Created: {formatDateTime(req.created_at)}</p>
                    </div>
                    <div className="text-left sm:text-right mobile-full">
                      <p className="text-xs text-ink-muted">Total Amount</p>
                      <p className="text-2xl font-bold text-brand-600 num">{formatCurrency(req.total_amount)}</p>
                      <p className="text-xs text-ink-muted mt-1">
                        EMI {formatCurrency(req.total_emi_amount)} · Fine {formatCurrency(req.fine_amount)}
                      </p>
                    </div>
                  </div>

                  {req.notes && (
                    <div className="mt-4 rounded-xl bg-surface-2 border border-surface-4 p-3 text-sm text-ink-muted whitespace-pre-wrap">
                      {req.notes}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-4">
                    <button onClick={() => openEditModal(req)} className="btn-secondary flex-1 sm:flex-none">
                      Edit Payment
                    </button>

                    {req.status === 'PENDING' && approvingId !== req.id && (
                      <>
                        <button onClick={() => setApprovingId(req.id)} className="btn-success flex-1 sm:flex-none">
                          Approve
                        </button>
                        <button onClick={() => { setRejectModal({ id: req.id }); setRejectReason(''); }} className="btn-danger flex-1 sm:flex-none">
                          Reject
                        </button>
                      </>
                    )}
                  </div>

                  {req.status === 'PENDING' && approvingId === req.id && (
                    <div className="mt-4 rounded-xl border border-surface-4 bg-surface-2 p-3 space-y-3">
                      <label className="label" htmlFor={`approve-remark-${req.id}`}>Approval remark (optional)</label>
                      <input
                        id={`approve-remark-${req.id}`}
                        value={approveRemark}
                        onChange={e => setApproveRemark(e.target.value)}
                        placeholder="Optional note for audit log"
                        className="input"
                        autoFocus
                      />
                      <div className="mobile-action-row flex gap-2">
                        <button onClick={() => handleApprove(req.id)} disabled={isActioning} className="btn-primary flex-1">
                          {isActioning ? 'Approving...' : 'Confirm'}
                        </button>
                        <button onClick={() => { setApprovingId(null); setApproveRemark(''); }} className="btn-secondary flex-1">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      {rejectModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRejectModal(null)}>
          <div className="modal-panel sm:max-w-md p-5 sm:p-6 animate-slide-up">
            <h3 className="font-display text-xl font-bold text-danger mb-1">Reject Payment Request</h3>
            <p className="text-sm text-ink-muted mb-4">The request will be marked as rejected and the retailer can resubmit after correction.</p>
            <label className="label" htmlFor="reject-reason">Rejection Reason</label>
            <textarea
              id="reject-reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Example: Amount mismatch or incorrect payment reference"
              className="input resize-none"
              autoFocus
            />
            <div className="mobile-action-row flex gap-3 mt-5">
              <button onClick={() => setRejectModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleReject} disabled={actionLoading === rejectModal.id} className="btn-danger flex-1">
                {actionLoading === rejectModal.id ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && !editSaving && setEditModal(null)}>
          <div className="modal-panel flex flex-col h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-xl">
            <div className="sticky top-0 z-10 bg-white border-b border-surface-4 px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-xl font-bold text-ink leading-snug">Edit Payment Record</h3>
                <p className="text-sm text-ink-muted mt-1">{customerName(editModal)} · {customerImei(editModal)}</p>
              </div>
              <button aria-label="Close edit payment modal" onClick={() => setEditModal(null)} disabled={editSaving} className="btn-icon">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 pb-28">
              {editFeedback && (
                <div className={editFeedback.type === 'success' ? 'alert-success' : 'alert-danger'}>
                  <p className="text-sm font-semibold">{editFeedback.text}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Status</label>
                  <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className="input">
                    <option value="PENDING">Pending</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </div>
                <div>
                  <label className="label">Payment Mode</label>
                  <select value={editForm.mode} onChange={e => setEditForm(f => ({ ...f, mode: e.target.value }))} className="input">
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI / Online</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">EMI Amount Collected</label>
                  <input type="number" value={editForm.total_emi_amount} onChange={e => setEditForm(f => ({ ...f, total_emi_amount: e.target.value }))} className="input" inputMode="numeric" />
                </div>
                <div>
                  <label className="label">Fine Amount</label>
                  <input type="number" value={editForm.fine_amount} onChange={e => setEditForm(f => ({ ...f, fine_amount: e.target.value }))} className="input" inputMode="numeric" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">First EMI Charge</label>
                  <input type="number" value={editForm.first_emi_charge_amount} onChange={e => setEditForm(f => ({ ...f, first_emi_charge_amount: e.target.value }))} className="input" inputMode="numeric" />
                </div>
                <div>
                  <label className="label">Total Amount</label>
                  <input type="number" value={editForm.total_amount} onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))} className="input" inputMode="numeric" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Paid / Approved Date</label>
                  <input type="datetime-local" value={editForm.paid_at} onChange={e => setEditForm(f => ({ ...f, paid_at: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">Collected By Role</label>
                  <select value={editForm.collected_by_role} onChange={e => setEditForm(f => ({ ...f, collected_by_role: e.target.value }))} className="input">
                    <option value="">Keep current</option>
                    <option value="admin">Admin</option>
                    <option value="retailer">Retailer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Notes / Remark</label>
                <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="input resize-none" placeholder="Admin notes" />
              </div>

              <div className="rounded-xl bg-surface-2 border border-surface-4 p-3 text-xs text-ink-muted space-y-1">
                <p>EMIs: #{editModal.selected_emi_nos?.join(', #') || '—'}</p>
                <p>Retailer: {retailerName(editModal)}</p>
                <p>Created: {formatDateTime(editModal.created_at)}</p>
              </div>
            </div>

            <div className="sticky bottom-0 z-20 bg-white border-t border-surface-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] grid grid-cols-3 gap-3">
              <button onClick={deletePaymentEdit} disabled={editSaving} className="btn-danger">Delete</button>
              <button onClick={() => setEditModal(null)} disabled={editSaving} className="btn-secondary">Cancel</button>
              <button onClick={savePaymentEdit} disabled={editSaving} className="btn-primary">
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
