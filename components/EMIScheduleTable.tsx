'use client';

import { useState } from 'react';
import { EMISchedule } from '@/lib/types';
import { format, differenceInDays, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { calculateSingleEmiFine } from '@/lib/fineCalc';
import { formatCurrency, formatDateOnly, formatDateTime } from '@/lib/formatters';

interface Props {
  emis: EMISchedule[];
  isAdmin?: boolean;
  nextUnpaidNo?: number;
  onRefresh?: () => void;
  defaultFineAmount?: number;
}

type EditForm = {
  due_date: string;
  amount: string;
  status: 'UNPAID' | 'PENDING_APPROVAL' | 'APPROVED';
  paid_at: string;
  mode: '' | 'CASH' | 'UPI';
  utr: string;
  fine_amount: string;
  fine_paid_amount: string;
  fine_paid_at: string;
  fine_waived: boolean;
};


function toDateInput(value?: string | null) {
  if (!value) return '';
  return value.split('T')[0];
}

function toDateTimeInput(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeInput(value: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function makeEditForm(emi: EMISchedule): EditForm {
  return {
    due_date: toDateInput(emi.due_date),
    amount: String(emi.amount ?? 0),
    status: emi.status,
    paid_at: toDateTimeInput(emi.paid_at),
    mode: (emi.mode || '') as EditForm['mode'],
    utr: emi.utr || '',
    fine_amount: String(emi.fine_amount ?? 0),
    fine_paid_amount: String(emi.fine_paid_amount ?? 0),
    fine_paid_at: toDateTimeInput(emi.fine_paid_at),
    fine_waived: Boolean(emi.fine_waived),
  };
}

export default function EMIScheduleTable({ emis, isAdmin, nextUnpaidNo, onRefresh, defaultFineAmount = 450 }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const sortedEmis = [...emis].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  const paidCount = sortedEmis.filter(e => e.status === 'APPROVED').length;

  function startEdit(emi: EMISchedule) {
    setEditingId(emi.id);
    setEditForm(makeEditForm(emi));
  }

  async function saveEdit(emi: EMISchedule) {
    if (!editForm) return;
    setSaving(true);
    try {
      const paidAt = fromDateTimeInput(editForm.paid_at);
      const finePaidAt = fromDateTimeInput(editForm.fine_paid_at);
      const payload = {
        due_date: editForm.due_date,
        amount: Number(editForm.amount) || 0,
        status: editForm.status,
        paid_at: paidAt,
        mode: editForm.mode || null,
        utr: editForm.utr.trim() || null,
        fine_amount: Number(editForm.fine_amount) || 0,
        fine_paid_amount: Number(editForm.fine_paid_amount) || 0,
        fine_paid_at: finePaidAt,
        fine_waived: editForm.fine_waived,
      };

      // If super admin marks unpaid, force payment fields blank. This removes
      // old payment dates from customer portal and EMI summary immediately.
      if (payload.status === 'UNPAID') {
        payload.paid_at = null;
        payload.mode = null;
        payload.utr = null;
      }
      if (payload.fine_paid_amount <= 0) payload.fine_paid_at = null;

      const res = await fetch(`/api/admin/emi-schedule/${emi.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update EMI');
      toast.success('Payment updated successfully');
      setEditingId(null);
      setEditForm(null);
      onRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update EMI');
    } finally {
      setSaving(false);
    }
  }

  function renderEditPanel(emi: EMISchedule) {
    if (!editForm) return null;
    const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setEditForm(f => f ? ({ ...f, [k]: v }) : f);
    return (
      <div className="mt-3 p-3 rounded-xl border border-brand-200 bg-brand-50/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-left">
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">Due Date</label>
          <input type="date" value={editForm.due_date} onChange={e => set('due_date', e.target.value)} className="input py-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">EMI Amount</label>
          <input type="number" value={editForm.amount} onChange={e => set('amount', e.target.value)} className="input py-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">Status</label>
          <select value={editForm.status} onChange={e => set('status', e.target.value as EditForm['status'])} className="input py-2 text-xs">
            <option value="UNPAID">UNPAID</option>
            <option value="PENDING_APPROVAL">PENDING APPROVAL</option>
            <option value="APPROVED">APPROVED / PAID</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">Payment Mode</label>
          <select value={editForm.mode} onChange={e => set('mode', e.target.value as EditForm['mode'])} className="input py-2 text-xs">
            <option value="">—</option>
            <option value="CASH">CASH</option>
            <option value="UPI">UPI</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">Paid Date & Time</label>
          <input type="datetime-local" value={editForm.paid_at} onChange={e => set('paid_at', e.target.value)} className="input py-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">UTR</label>
          <input value={editForm.utr} onChange={e => set('utr', e.target.value)} className="input py-2 text-xs" placeholder="UPI UTR / Ref" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-danger">Fine Amount</label>
          <input type="number" value={editForm.fine_amount} onChange={e => set('fine_amount', e.target.value)} className="input py-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-success">Fine Paid Amount</label>
          <input type="number" value={editForm.fine_paid_amount} onChange={e => set('fine_paid_amount', e.target.value)} className="input py-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-ink-muted">Fine Paid Date & Time</label>
          <input type="datetime-local" value={editForm.fine_paid_at} onChange={e => set('fine_paid_at', e.target.value)} className="input py-2 text-xs" />
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-ink mt-5">
          <input type="checkbox" checked={editForm.fine_waived} onChange={e => set('fine_waived', e.target.checked)} />
          Fine waived
        </label>
        <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-2 pt-1">
          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="btn-secondary text-xs px-3 py-2">Cancel</button>
          <button onClick={() => saveEdit(emi)} disabled={saving} className="btn-success text-xs px-3 py-2">{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-4 bg-surface-2">
        <p className="text-sm font-semibold text-ink-muted">EMI Schedule</p>
        <div className="flex gap-2 text-xs">
          <span className="badge-green">{paidCount} paid</span>
          <span className="badge-gray">{sortedEmis.length} total</span>
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>EMI No.</th>
              <th>Due Date</th>
              <th className="text-right">EMI Amount</th>
              <th>EMI Status</th>
              <th>Paid Date</th>
              <th>Payment Mode</th>
              <th>UTR</th>
              <th className="text-right">Fine Amount</th>
              <th>Fine Paid</th>
              {isAdmin && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedEmis.map(emi => {
              const today = new Date();
              const dueDate = new Date(emi.due_date);
              const isOverdue = emi.status === 'UNPAID' && dueDate < today;
              const isNext = emi.emi_no === nextUnpaidNo;
              const editing = editingId === emi.id;
              const maxEmiNo = sortedEmis.length > 0 ? Math.max(...sortedEmis.map(e => e.emi_no)) : 0;
              const isLastEmi = emi.emi_no === maxEmiNo;
              const autoFine = isOverdue ? calculateSingleEmiFine(emi.due_date, isLastEmi, defaultFineAmount) : 0;
              const displayFine = emi.fine_waived ? 0 : Math.max(autoFine, emi.fine_amount || 0);
              const finePaid = emi.fine_paid_amount || 0;
              const fineRemaining = Math.max(0, displayFine - finePaid);
              const fineStartDate = addDays(dueDate, 1);
              const overdueDays = isOverdue ? differenceInDays(today, dueDate) : 0;

              return (
                <tr key={emi.id} className={isOverdue ? 'bg-danger-light/30' : isNext ? 'bg-brand-50/50' : ''}>
                  <td colSpan={isAdmin && editing ? 11 : 1} className={editing ? 'align-top' : undefined}>
                    {editing ? (
                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink">Editing EMI #{emi.emi_no}</p>
                            <p className="text-xs text-ink-muted">Changes will be applied after saving.</p>
                          </div>
                        </div>
                        {renderEditPanel(emi)}
                      </div>
                    ) : (
                      <>
                        <span className="font-semibold text-ink">#{emi.emi_no}</span>
                        {isNext && <span className="ml-1 text-[9px] bg-success-light text-success border border-success-border px-1 py-0.5 rounded-full">NEXT</span>}
                      </>
                    )}
                  </td>
                  {!editing && (
                    <>
                      <td>
                        <div>
                          <span className={`num text-sm ${isOverdue ? 'text-danger font-medium' : ''}`}>
                            {format(dueDate, 'd MMM yyyy')}{isOverdue && ' ⚠'}
                          </span>
                          {isOverdue && <p className="text-[10px] text-danger mt-0.5">Overdue by {overdueDays} day{overdueDays !== 1 ? 's' : ''}</p>}
                        </div>
                      </td>
                      <td>
                        {emi.status === 'APPROVED' && <span className="badge-blue">✓ Paid</span>}
                        {emi.status === 'PENDING_APPROVAL' && <span className="badge-yellow">⏳ Pending</span>}
                        {emi.status === 'UNPAID' && <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>}
                      </td>
                      <td className="num text-right font-medium">{fmt(emi.amount)}</td>
                      <td className="num text-xs text-ink-muted">{emi.paid_at ? format(new Date(emi.paid_at), 'd MMM yyyy, h:mm a') : '—'}</td>
                      <td className="text-xs text-ink-muted">{emi.mode || '—'}</td>
                      <td className="font-num text-xs text-ink-muted">{emi.utr || '—'}</td>
                      <td className="num text-right text-xs font-semibold">{displayFine > 0 ? fmt(displayFine) : emi.fine_waived ? 'Waived' : '—'}</td>
                      <td className="num text-xs text-ink-muted">{finePaid > 0 ? `${fmt(finePaid)}${emi.fine_paid_at ? ` (${format(new Date(emi.fine_paid_at), 'd MMM yyyy')})` : ''}` : '—'}</td>
                      {isAdmin && (
                        <td className="text-right">
                          <button onClick={() => startEdit(emi)} className="btn-ghost text-xs px-2 py-1">✏ Edit</button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="md:hidden divide-y divide-surface-3">
        {sortedEmis.map(emi => {
          const today = new Date();
          const dueDate = new Date(emi.due_date);
          const isOverdue = emi.status === 'UNPAID' && dueDate < today;
          const isNext = emi.emi_no === nextUnpaidNo;
          const editing = editingId === emi.id;
          const maxEmiNo = sortedEmis.length > 0 ? Math.max(...sortedEmis.map(e => e.emi_no)) : 0;
          const isLastEmi = emi.emi_no === maxEmiNo;
          const autoFine = isOverdue ? calculateSingleEmiFine(emi.due_date, isLastEmi, defaultFineAmount) : 0;
          const displayFine = emi.fine_waived ? 0 : Math.max(autoFine, emi.fine_amount || 0);
          return (
            <div key={emi.id} className={`p-4 space-y-2 ${isOverdue ? 'bg-danger-light/40' : isNext ? 'bg-brand-50/50' : ''}`}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-ink">EMI #{emi.emi_no}</p>
                {emi.status === 'APPROVED' && <span className="badge-blue">✓ Paid</span>}
                {emi.status === 'PENDING_APPROVAL' && <span className="badge-yellow">⏳ Pending</span>}
                {emi.status === 'UNPAID' && <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>}
              </div>
              {editing ? renderEditPanel(emi) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <p className="text-ink-muted">Due Date</p><p className="text-right num">{format(dueDate, 'd MMM yyyy')}</p>
                    <p className="text-ink-muted">EMI Amount</p><p className="text-right num">{fmt(emi.amount)}</p>
                    <p className="text-ink-muted">Status</p><p className="text-right">{emi.status === 'APPROVED' ? 'Paid' : emi.status === 'PENDING_APPROVAL' ? 'Pending Approval' : isOverdue ? 'Due (Overdue)' : 'Due'}</p>
                    <p className="text-ink-muted">Paid Date</p><p className="text-right num">{emi.paid_at ? format(new Date(emi.paid_at), 'd MMM yyyy, h:mm a') : '—'}</p>
                    <p className="text-ink-muted">Payment Mode</p><p className="text-right">{emi.mode || '—'}</p>
                    <p className="text-ink-muted">UTR</p><p className="text-right num">{emi.utr || '—'}</p>
                    <p className="text-ink-muted">Fine Amount</p><p className="text-right num">{displayFine > 0 ? fmt(displayFine) : emi.fine_waived ? 'Waived' : '—'}</p>
                    <p className="text-ink-muted">Fine Paid</p><p className="text-right num">{(emi.fine_paid_amount || 0) > 0 ? fmt(emi.fine_paid_amount || 0) : '—'}</p>
                  </div>
                  {isAdmin && <button onClick={() => startEdit(emi)} className="btn-ghost text-xs px-2 py-1 w-full">✏ Edit EMI / Fine</button>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
