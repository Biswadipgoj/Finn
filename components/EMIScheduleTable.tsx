'use client';

import { useState } from 'react';
import { EMISchedule } from '@/lib/types';
import { format, differenceInDays, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { calculateSingleEmiFine } from '@/lib/fineCalc';
import { formatCurrency, readJsonSafe } from '@/lib/formatters';

interface Props {
  emis: EMISchedule[];
  isAdmin?: boolean;
  nextUnpaidNo?: number;
  onRefresh?: () => void;
  defaultFineAmount?: number;
}

type EditForm = {
  emi_no: string;
  due_date: string;
  amount: string;
  status: EMISchedule['status'];
  partial_paid_amount: string;
  partial_paid_at: string;
  paid_at: string;
  mode: '' | 'CASH' | 'UPI';
  utr: string;
  fine_amount: string;
  fine_paid_amount: string;
  fine_paid_at: string;
  fine_waived: boolean;
  collected_by_role: '' | 'admin' | 'retailer';
  collected_by_user_id: string;
};

const fmt = formatCurrency;

function statusBadge(status: EMISchedule['status'], isOverdue: boolean) {
  if (status === 'APPROVED') return <span className="badge-green">Paid</span>;
  if (status === 'PARTIALLY_PAID') return <span className="badge-yellow">Partially Paid</span>;
  if (status === 'PENDING_APPROVAL') return <span className="badge-yellow">Pending</span>;
  return <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>;
}

function cardTheme(emi: EMISchedule, isOverdue: boolean) {
  if (isOverdue) {
    return {
      wrapper: 'border-danger-border bg-danger-light/20',
      accent: 'bg-danger',
      value: 'text-danger',
    };
  }
  if (emi.status === 'APPROVED') {
    return {
      wrapper: 'border-success-border bg-success-light/40',
      accent: 'bg-success',
      value: 'text-success',
    };
  }
  if (emi.status === 'PARTIALLY_PAID' || emi.status === 'PENDING_APPROVAL') {
    return {
      wrapper: 'border-warning-border bg-warning-light/35',
      accent: 'bg-warning',
      value: 'text-warning',
    };
  }
  return {
    wrapper: 'border-brand-200 bg-brand-50/45',
    accent: 'bg-brand-500',
    value: 'text-brand-700',
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return format(new Date(value), 'dd MMM yyyy, hh:mm a');
}

function isoToLocalInput(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function KvRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <span className={`text-sm text-right num ${emphasize ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{value}</span>
    </div>
  );
}

function buildEditForm(emi: EMISchedule): EditForm {
  return {
    emi_no: String(emi.emi_no ?? ''),
    due_date: emi.due_date || '',
    amount: String(emi.amount ?? 0),
    status: emi.status,
    partial_paid_amount: String(emi.partial_paid_amount ?? 0),
    partial_paid_at: isoToLocalInput(emi.partial_paid_at),
    paid_at: isoToLocalInput(emi.paid_at),
    mode: (emi.mode || '') as EditForm['mode'],
    utr: emi.utr || '',
    fine_amount: String(emi.fine_amount ?? 0),
    fine_paid_amount: String(emi.fine_paid_amount ?? 0),
    fine_paid_at: isoToLocalInput(emi.fine_paid_at),
    fine_waived: !!emi.fine_waived,
    collected_by_role: (emi.collected_by_role || '') as EditForm['collected_by_role'],
    collected_by_user_id: emi.collected_by_user_id || '',
  };
}

export default function EMIScheduleTable({ emis, isAdmin, nextUnpaidNo, onRefresh, defaultFineAmount = 450 }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const sortedEmis = [...emis].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  const paidCount = sortedEmis.filter(e => e.status === 'APPROVED').length;

  function setField<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setEditForm((prev) => prev ? ({ ...prev, [key]: value }) : prev);
  }

  async function saveEdit(emi: EMISchedule) {
    if (!editForm) return;
    setSaving(true);
    try {
      const payload = {
        emi_no: Number(editForm.emi_no || emi.emi_no),
        due_date: editForm.due_date || emi.due_date,
        amount: Number(editForm.amount || emi.amount),
        status: editForm.status,
        partial_paid_amount: Number(editForm.partial_paid_amount || 0),
        partial_paid_at: editForm.partial_paid_at || null,
        paid_at: editForm.paid_at || null,
        mode: editForm.mode || null,
        utr: editForm.utr.trim() || null,
        fine_amount: Number(editForm.fine_amount || 0),
        fine_paid_amount: Number(editForm.fine_paid_amount || 0),
        fine_paid_at: editForm.fine_paid_at || null,
        fine_waived: editForm.fine_waived,
        collected_by_role: editForm.collected_by_role || null,
        collected_by_user_id: editForm.collected_by_user_id.trim() || null,
      };

      const res = await fetch(`/api/admin/emi/${emi.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await readJsonSafe<{ ok?: boolean; error?: string; message?: string }>(res);

      if (!res.ok || !json?.ok) {
        toast.error(json?.error || 'Failed to update EMI');
        return;
      }

      toast.success(json.message || 'EMI updated successfully');
      setEditingId(null);
      setEditForm(null);
      onRefresh?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update EMI');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4 border-b border-surface-4 bg-surface-2">
        <div>
          <h3 className="text-lg font-bold text-ink">EMI Schedule</h3>
          <p className="text-xs text-ink-muted mt-0.5">Installment-wise collection and fine status</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="badge-green">{paidCount} paid</span>
          <span className="badge-gray">{sortedEmis.length} total</span>
        </div>
      </header>

      <div className="p-3 sm:p-4">
        <div className="overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
          <div className="flex gap-3 sm:gap-4 snap-x snap-mandatory md:grid md:grid-cols-2 xl:grid-cols-3 md:overflow-visible md:snap-none">
        {sortedEmis.map((emi) => {
          const today = new Date();
          const dueDate = new Date(emi.due_date);
          const isOverdue = ['UNPAID', 'PARTIALLY_PAID'].includes(emi.status) && dueDate < today;
          const isNext = emi.emi_no === nextUnpaidNo;
          const editing = editingId === emi.id;
          const theme = cardTheme(emi, isOverdue);

          const maxEmiNo = sortedEmis.length > 0 ? Math.max(...sortedEmis.map((e) => e.emi_no)) : 0;
          const isLastEmi = emi.emi_no === maxEmiNo;
          const autoFine = isOverdue ? calculateSingleEmiFine(emi.due_date, isLastEmi, defaultFineAmount) : 0;
          const displayFine = Math.max(autoFine, emi.fine_amount || 0);

          const emiPaidAmount = Math.max(0, Number(emi.partial_paid_amount || 0));
          const emiRemaining = Math.max(0, Number(emi.amount || 0) - emiPaidAmount);
          const finePaidAmount = Math.max(0, Number(emi.fine_paid_amount || 0));
          const fineRemaining = Math.max(0, displayFine - finePaidAmount);

          const fineStartDate = addDays(dueDate, 1);
          const overdueDays = isOverdue ? differenceInDays(today, dueDate) : 0;

          return (
            <article
              key={emi.id}
              className={`relative min-w-[240px] sm:min-w-[260px] md:min-w-0 rounded-2xl border shadow-sm snap-start ${theme.wrapper}`}
            >
              <div className={`absolute left-0 top-0 h-full w-1.5 rounded-l-2xl ${theme.accent}`} />
              <div className="flex flex-wrap items-center justify-between gap-2 pl-5 pr-4 py-3 border-b border-black/5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-ink">EMI #{emi.emi_no}</p>
                  {statusBadge(emi.status, isOverdue)}
                  {isNext && <span className="badge-blue">Next Due</span>}
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-1.5">
                    {editing ? (
                      <>
                        <button onClick={() => saveEdit(emi)} disabled={saving} className="btn-success text-xs px-2 py-1">
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingId(null); setEditForm(null); }} className="btn-secondary text-xs px-2 py-1">Cancel</button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(emi.id);
                          setEditForm(buildEditForm(emi));
                        }}
                        className="btn-ghost text-xs px-2 py-1"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="pl-5 pr-4 py-3">
                {editing && editForm && (
                  <div className="mb-3 pb-3 border-b border-surface-4">
                    <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                      <p className="text-xs font-semibold text-brand-700">
                        Editing EMI #{emi.emi_no} for due date {format(dueDate, 'dd MMM yyyy')}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <input type="number" value={editForm.emi_no} onChange={e => setField('emi_no', e.target.value)} className="input py-2 text-sm" placeholder="EMI No" />
                    <input type="date" value={editForm.due_date} onChange={e => setField('due_date', e.target.value)} className="input py-2 text-sm" />
                    <input type="number" value={editForm.amount} onChange={e => setField('amount', e.target.value)} className="input py-2 text-sm" placeholder="EMI Amount" />
                    <select value={editForm.status} onChange={e => setField('status', e.target.value as EditForm['status'])} className="input py-2 text-sm">
                      <option value="UNPAID">UNPAID</option>
                      <option value="PARTIALLY_PAID">PARTIALLY_PAID</option>
                      <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
                      <option value="APPROVED">APPROVED</option>
                    </select>

                    <input type="number" value={editForm.partial_paid_amount} onChange={e => setField('partial_paid_amount', e.target.value)} className="input py-2 text-sm" placeholder="EMI Paid Amount" />
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">Partial Paid Date/Time</p>
                      <input type="datetime-local" value={editForm.partial_paid_at} onChange={e => setField('partial_paid_at', e.target.value)} className="input py-2 text-sm" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">Full Paid Date/Time</p>
                      <input type="datetime-local" value={editForm.paid_at} onChange={e => setField('paid_at', e.target.value)} className="input py-2 text-sm" />
                    </div>
                    <select value={editForm.mode} onChange={e => setField('mode', e.target.value as EditForm['mode'])} className="input py-2 text-sm">
                      <option value="">Payment Mode</option>
                      <option value="CASH">CASH</option>
                      <option value="UPI">UPI</option>
                    </select>

                    <input type="text" value={editForm.utr} onChange={e => setField('utr', e.target.value)} className="input py-2 text-sm" placeholder="UTR / Reference" />
                    <input type="number" value={Math.max(0, Number(editForm.amount || 0) - Number(editForm.partial_paid_amount || 0))} readOnly className="input py-2 text-sm bg-surface-2" placeholder="Remaining EMI" />
                    <input type="number" value={editForm.fine_amount} onChange={e => setField('fine_amount', e.target.value)} className="input py-2 text-sm" placeholder="Fine Amount" />
                    <input type="number" value={editForm.fine_paid_amount} onChange={e => setField('fine_paid_amount', e.target.value)} className="input py-2 text-sm" placeholder="Fine Paid" />
                    <input type="datetime-local" value={editForm.fine_paid_at} onChange={e => setField('fine_paid_at', e.target.value)} className="input py-2 text-sm" />
                    <input type="number" value={Math.max(0, Number(editForm.fine_amount || 0) - Number(editForm.fine_paid_amount || 0))} readOnly className="input py-2 text-sm bg-surface-2" placeholder="Remaining Fine" />

                    <select value={editForm.collected_by_role} onChange={e => setField('collected_by_role', e.target.value as EditForm['collected_by_role'])} className="input py-2 text-sm">
                      <option value="">Collected by role</option>
                      <option value="admin">admin</option>
                      <option value="retailer">retailer</option>
                    </select>
                    <input type="text" value={editForm.collected_by_user_id} onChange={e => setField('collected_by_user_id', e.target.value)} className="input py-2 text-sm" placeholder="Collected by user ID" />
                    <label className="inline-flex items-center gap-2 px-2 py-2 rounded-xl border border-surface-4 text-sm text-ink-muted">
                      <input type="checkbox" checked={editForm.fine_waived} onChange={e => setField('fine_waived', e.target.checked)} />
                      Fine Waived
                    </label>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="rounded-xl border border-black/5 bg-white/75 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-ink-muted">Installment Amount</p>
                    <p className={`text-lg font-bold num ${theme.value}`}>{fmt(emi.amount)}</p>
                  </div>

                  <div className="grid grid-cols-1 gap-y-0 divide-y divide-surface-3 rounded-xl border border-black/5 bg-white/70 px-3">
                    <KvRow label="Due Date" value={format(dueDate, 'dd MMM yyyy')} />
                    <KvRow label="EMI Paid Amount" value={fmt(emiPaidAmount)} />
                    <KvRow label="EMI Paid Date" value={emi.paid_at ? formatDateTime(emi.paid_at) : emi.partial_paid_at ? formatDateTime(emi.partial_paid_at) : '-'} />
                    <KvRow label="Remaining EMI" value={fmt(emiRemaining)} />
                    <KvRow label="Fine Amount" value={fmt(displayFine)} emphasize={displayFine > 0} />
                    <KvRow label="Fine Paid Amount" value={fmt(finePaidAmount)} />
                    <KvRow label="Fine Paid Date" value={formatDateTime(emi.fine_paid_at)} />
                    <KvRow label="Remaining Fine" value={fmt(fineRemaining)} />
                    <KvRow label="Mode" value={emi.mode || '-'} />
                  </div>
                </div>

                {isOverdue && (
                  <p className="text-xs text-danger mt-2.5">
                    Overdue by {overdueDays} day{overdueDays === 1 ? '' : 's'} · Fine from {format(fineStartDate, 'dd MMM yyyy')}
                  </p>
                )}
              </div>
            </article>
          );
        })}
          </div>
        </div>
      </div>
    </section>
  );
}
