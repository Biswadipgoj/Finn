'use client';

import { useState } from 'react';
import { EMISchedule } from '@/lib/types';
import { format, differenceInDays, addDays } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import { calculateSingleEmiFine } from '@/lib/fineCalc';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';

interface Props {
  emis: EMISchedule[];
  isAdmin?: boolean;
  nextUnpaidNo?: number;
  onRefresh?: () => void;
  defaultFineAmount?: number;
  weeklyFineIncrement?: number;
}

const fmt = formatCurrency;

export default function EMIScheduleTable({ emis, isAdmin, nextUnpaidNo, onRefresh, defaultFineAmount = 450, weeklyFineIncrement = 25 }: Props) {
  const supabase = createClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    due_date: '',
    amount: '',
    fine_amount: '',
    status: 'UNPAID' as EMISchedule['status'],
    paid_at: '',
    mode: '' as '' | 'CASH' | 'UPI',
    utr: '',
    fine_paid_at: '',
  });
  const [saving, setSaving] = useState(false);
  const sortedEmis = [...emis].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  const paidCount = sortedEmis.filter(e => e.status === 'APPROVED').length;

  function startEdit(emi: EMISchedule) {
    setEditingId(emi.id);
    setEditForm({
      due_date: emi.due_date || '',
      amount: String(emi.amount || 0),
      fine_amount: String(emi.fine_amount || 0),
      status: emi.status,
      paid_at: emi.paid_at ? emi.paid_at.split('T')[0] : '',
      mode: emi.mode || '',
      utr: emi.utr || '',
      fine_paid_at: emi.fine_paid_at ? emi.fine_paid_at.split('T')[0] : '',
    });
  }

  async function saveEdit(emi: EMISchedule) {
    setSaving(true);
    const updates: Record<string, unknown> = {};

    if (editForm.due_date !== emi.due_date) updates.due_date = editForm.due_date;
    if (Number(editForm.amount || 0) !== Number(emi.amount || 0)) updates.amount = Number(editForm.amount || 0);
    if (Number(editForm.fine_amount || 0) !== Number(emi.fine_amount || 0)) updates.fine_amount = Number(editForm.fine_amount || 0);
    if (editForm.status !== emi.status) updates.status = editForm.status;

    const currentPaidAt = emi.paid_at ? emi.paid_at.split('T')[0] : '';
    if (editForm.paid_at !== currentPaidAt) updates.paid_at = editForm.paid_at || null;
    if ((editForm.mode || null) !== (emi.mode || null)) updates.mode = editForm.mode || null;
    if ((editForm.utr || null) !== (emi.utr || null)) updates.utr = editForm.utr.trim() || null;

    const currentFinePaidAt = emi.fine_paid_at ? emi.fine_paid_at.split('T')[0] : '';
    if (editForm.fine_paid_at !== currentFinePaidAt) updates.fine_paid_at = editForm.fine_paid_at || null;

    if (!Object.keys(updates).length) {
      toast.error('No changes to save');
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('emi_schedule').update(updates).eq('id', emi.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('EMI updated'); setEditingId(null); onRefresh?.(); }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-4 bg-surface-2">
        <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">EMI Schedule</p>
        <div className="flex gap-2 text-xs">
          <span className="badge-green">{paidCount} paid</span>
          <span className="badge-gray">{sortedEmis.length} total</span>
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Due Date</th>
              <th>Amount</th>
              <th>Fine</th>
              <th>Status</th>
              <th>Paid On</th>
              <th>Mode</th>
              <th>UTR</th>
              <th>Fine Paid On</th>
              {isAdmin && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedEmis.map(emi => {
              const today = new Date();
              const dueDate = new Date(emi.due_date);
              const isOverdue = ['UNPAID', 'PARTIALLY_PAID'].includes(emi.status) && dueDate < today;
              const isNext = emi.emi_no === nextUnpaidNo;
              const editing = editingId === emi.id;

              // Fine: show fine_amount if set, else default if overdue
              const maxEmiNo = sortedEmis.length > 0 ? Math.max(...sortedEmis.map(e => e.emi_no)) : 0;
              const isLastEmi = emi.emi_no === maxEmiNo; // position-based, not status-based
              const autoFine = isOverdue ? calculateSingleEmiFine(emi.due_date, isLastEmi, defaultFineAmount, weeklyFineIncrement) : 0;
              const displayFine = Math.max(autoFine, emi.fine_amount || 0);
              const emiPaidAmount = Math.max(0, Number(emi.partial_paid_amount || 0));
              const emiRemaining = Math.max(0, Number(emi.amount || 0) - emiPaidAmount);
              const finePaid = emi.fine_paid_amount || 0;
              const fineRemaining = Math.max(0, displayFine - finePaid);

              // Fine start date = due_date + 1 day
              const fineStartDate = addDays(dueDate, 1);
              const overdueDays = isOverdue ? differenceInDays(today, dueDate) : 0;

              return (
                <tr key={emi.id} className={isOverdue ? 'bg-danger-light/30' : isNext ? 'bg-brand-50/50' : ''}>
                  <td className="font-semibold text-ink">
                    #{emi.emi_no}
                    {isNext && <span className="ml-1 text-[9px] bg-success-light text-success border border-success-border px-1 py-0.5 rounded-full">NEXT</span>}
                  </td>
                  <td>
                    {editing ? (
                      <input type="date" value={editForm.due_date}
                        onChange={e => setEditForm((p) => ({ ...p, due_date: e.target.value }))}
                        className="input py-1 px-2 text-xs w-36" />
                    ) : (
                      <div>
                        <span className={`num text-sm ${isOverdue ? 'text-danger font-medium' : ''}`}>
                          {format(dueDate, 'd MMM yyyy')}
                          {isOverdue && ' \u26A0'}
                        </span>
                        {isOverdue && (
                          <p className="text-[10px] text-danger mt-0.5">
                            Overdue by {overdueDays} day{overdueDays !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num font-medium">
                    {editing ? (
                      <input type="number" value={editForm.amount} min={0}
                        onChange={e => setEditForm((p) => ({ ...p, amount: e.target.value }))}
                        className="input py-1 px-2 text-xs w-24" />
                    ) : <div>{fmt(emi.amount)}</div>}
                    {emi.status === 'PARTIALLY_PAID' && <div className="text-[10px] text-warning mt-0.5">Remaining: {fmt(emiRemaining)}</div>}
                  </td>
                  <td>
                    {editing ? (
                      <input type="number" value={editForm.fine_amount}
                        onChange={e => setEditForm((p) => ({ ...p, fine_amount: e.target.value }))}
                        placeholder={String(emi.fine_amount || 0)}
                        className="input py-1 px-2 text-xs w-24" />
                    ) : displayFine > 0 ? (
                      <div>
                        <span className="num text-xs font-semibold text-danger">{fmt(fineRemaining > 0 ? fineRemaining : displayFine)}</span>
                        {finePaid > 0 && <p className="text-[10px] text-success mt-0.5">Paid: {fmt(finePaid)}{emi.fine_paid_at ? ` (${formatDateOnly(emi.fine_paid_at)})` : ''}</p>}
                        {isOverdue && (
                          <p className="text-[10px] text-danger/70 mt-0.5">
                            From {format(fineStartDate, 'd MMM')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-muted text-xs">{'\u2014'}</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <select value={editForm.status} onChange={e => setEditForm((p) => ({ ...p, status: e.target.value as EMISchedule['status'] }))} className="input py-1 px-2 text-xs w-36">
                        <option value="UNPAID">Unpaid</option>
                        <option value="PENDING_APPROVAL">Pending</option>
                        <option value="PARTIALLY_PAID">Partial</option>
                        <option value="APPROVED">Paid</option>
                      </select>
                    ) : (
                      <>
                        {emi.status === 'APPROVED' && <span className="badge-blue">✓ Paid</span>}
                        {emi.status === 'PARTIALLY_PAID' && <span className="badge-yellow">Partial</span>}
                        {emi.status === 'PENDING_APPROVAL' && <span className="badge-yellow">⏳ Pending</span>}
                        {emi.status === 'UNPAID' && <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>}
                      </>
                    )}
                  </td>
                  <td className="num text-xs text-ink-muted">
                    {editing ? (
                      <input type="date" value={editForm.paid_at} onChange={e => setEditForm((p) => ({ ...p, paid_at: e.target.value }))} className="input py-1 px-2 text-xs w-32" />
                    ) : (
                      emi.paid_at ? formatDateOnly(emi.paid_at) : emi.partial_paid_at ? `${formatDateOnly(emi.partial_paid_at)} (partial)` : '—'
                    )}
                  </td>
                  <td className="text-xs text-ink-muted">
                    {editing ? (
                      <select value={editForm.mode} onChange={e => setEditForm((p) => ({ ...p, mode: e.target.value as '' | 'CASH' | 'UPI' }))} className="input py-1 px-2 text-xs w-24">
                        <option value="">—</option>
                        <option value="CASH">CASH</option>
                        <option value="UPI">UPI</option>
                      </select>
                    ) : (emi.mode || '\u2014')}
                  </td>
                  <td className="num text-xs text-ink-muted break-all">
                    {editing ? (
                      <input type="text" value={editForm.utr} onChange={e => setEditForm((p) => ({ ...p, utr: e.target.value }))} className="input py-1 px-2 text-xs w-32" placeholder="UTR" />
                    ) : (emi.utr || '\u2014')}
                  </td>
                  <td className="num text-xs text-ink-muted">
                    {editing ? (
                      <input type="date" value={editForm.fine_paid_at} onChange={e => setEditForm((p) => ({ ...p, fine_paid_at: e.target.value }))} className="input py-1 px-2 text-xs w-32" />
                    ) : (emi.fine_paid_at ? formatDateOnly(emi.fine_paid_at) : '\u2014')}
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      {editing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => saveEdit(emi)} disabled={saving} className="btn-success text-xs px-2 py-1">
                            {saving ? '\u2026' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-2 py-1">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => startEdit(emi)}
                            className="btn-ghost text-xs px-2 py-1"
                          >{'\u270F'}</button>
                        </div>
                      )}
                    </td>
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
          const isOverdue = ['UNPAID', 'PARTIALLY_PAID'].includes(emi.status) && dueDate < today;
          const isNext = emi.emi_no === nextUnpaidNo;
          const maxEmiNo = sortedEmis.length > 0 ? Math.max(...sortedEmis.map(e => e.emi_no)) : 0;
          const isLastEmi = emi.emi_no === maxEmiNo;
          const autoFine = isOverdue ? calculateSingleEmiFine(emi.due_date, isLastEmi, defaultFineAmount, weeklyFineIncrement) : 0;
          const displayFine = Math.max(autoFine, emi.fine_amount || 0);
          const emiPaidAmount = Math.max(0, Number(emi.partial_paid_amount || 0));
          const emiRemaining = Math.max(0, Number(emi.amount || 0) - emiPaidAmount);
          const fineRemaining = Math.max(0, displayFine - Number(emi.fine_paid_amount || 0));
          const finePaid = Number(emi.fine_paid_amount || 0);
          const fineStatus =
            finePaid > 0 && fineRemaining > 0 ? 'Partially Paid' :
            fineRemaining === 0 && displayFine > 0 ? 'Paid' :
            displayFine > 0 ? 'Due' : '—';
          const editing = editingId === emi.id;
          return (
            <div key={emi.id} className={`p-4 space-y-3 ${isOverdue ? 'bg-danger-light/40 border-l-4 border-danger' : isNext ? 'bg-brand-50/60 border-l-4 border-brand-500' : 'bg-white'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-ink">EMI #{emi.emi_no}</p>
                <div className="flex items-center gap-2">
                  {emi.status === 'APPROVED' && <span className="badge-blue">✓ Paid</span>}
                  {emi.status === 'PARTIALLY_PAID' && <span className="badge-yellow">Partial</span>}
                  {emi.status === 'PENDING_APPROVAL' && <span className="badge-yellow">⏳ Pending</span>}
                  {emi.status === 'UNPAID' && <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>}
                  {isAdmin && !editing && (
                    <button
                      onClick={() => startEdit(emi)}
                      className="btn-ghost text-xs px-2 py-1"
                    >
                      ✏ Edit
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <p className="text-ink-muted">Due Date</p>
                <p className="text-right num font-semibold">
                  {editing ? (
                    <input type="date" value={editForm.due_date} onChange={e => setEditForm((p) => ({ ...p, due_date: e.target.value }))} className="input py-1 px-2 text-xs w-full" />
                  ) : format(dueDate, 'd MMM yyyy')}
                </p>
                <p className="text-ink-muted">EMI Amount</p><p className="text-right num font-semibold text-brand-700">{editing ? <input type="number" value={editForm.amount} min={0} onChange={e => setEditForm((p) => ({ ...p, amount: e.target.value }))} className="input py-1 px-2 text-xs w-full" /> : fmt(emi.amount)}</p>
                {emi.status === 'PARTIALLY_PAID' && <><p className="text-ink-muted">EMI Paid</p><p className="text-right num text-success font-semibold">{fmt(emiPaidAmount)}</p><p className="text-ink-muted">EMI Remaining</p><p className="text-right num text-warning font-semibold">{fmt(emiRemaining)}</p></>}
                <p className="text-ink-muted">Remaining Fine</p>
                <p className="text-right num font-semibold text-danger">
                  {editing ? (
                    <input type="number" value={editForm.fine_amount} onChange={e => setEditForm((p) => ({ ...p, fine_amount: e.target.value }))} min={0} className="input py-1 px-2 text-xs w-full" />
                  ) : (displayFine > 0 ? fmt(fineRemaining > 0 ? fineRemaining : displayFine) : '—')}
                </p>
                <p className="text-ink-muted">Status</p><p className={`text-right font-semibold ${fineStatus === 'Paid' ? 'text-success' : fineStatus === 'Due' ? 'text-danger' : 'text-warning'}`}>{editing ? <select value={editForm.status} onChange={e => setEditForm((p) => ({ ...p, status: e.target.value as EMISchedule['status'] }))} className="input py-1 px-2 text-xs w-full"><option value="UNPAID">Unpaid</option><option value="PENDING_APPROVAL">Pending</option><option value="PARTIALLY_PAID">Partial</option><option value="APPROVED">Paid</option></select> : fineStatus}</p>
                <p className="text-ink-muted">Payment Date</p><p className="text-right num">{editing ? <input type="date" value={editForm.paid_at} onChange={e => setEditForm((p) => ({ ...p, paid_at: e.target.value }))} className="input py-1 px-2 text-xs w-full" /> : (emi.paid_at ? formatDateOnly(emi.paid_at) : emi.partial_paid_at ? `${formatDateOnly(emi.partial_paid_at)} (partial)` : '—')}</p>
                <p className="text-ink-muted">Payment Method</p><p className={`text-right font-semibold ${emi.mode === 'UPI' ? 'text-info' : emi.mode === 'CASH' ? 'text-success' : 'text-ink-muted'}`}>{editing ? <select value={editForm.mode} onChange={e => setEditForm((p) => ({ ...p, mode: e.target.value as '' | 'CASH' | 'UPI' }))} className="input py-1 px-2 text-xs w-full"><option value="">—</option><option value="CASH">CASH</option><option value="UPI">UPI</option></select> : (emi.mode || '—')}</p>
                <p className="text-ink-muted">Payment UTR</p><p className="text-right num break-all">{editing ? <input type="text" value={editForm.utr} onChange={e => setEditForm((p) => ({ ...p, utr: e.target.value }))} className="input py-1 px-2 text-xs w-full" placeholder="UTR" /> : (emi.utr || '—')}</p>
                <p className="text-ink-muted">Fine Paid Date</p><p className="text-right num">{editing ? <input type="date" value={editForm.fine_paid_at} onChange={e => setEditForm((p) => ({ ...p, fine_paid_at: e.target.value }))} className="input py-1 px-2 text-xs w-full" /> : (emi.fine_paid_at ? formatDateOnly(emi.fine_paid_at) : '—')}</p>
                <p className="text-ink-muted">Fine Method</p><p className={`text-right font-semibold ${finePaid > 0 && emi.mode === 'UPI' ? 'text-info' : finePaid > 0 && emi.mode === 'CASH' ? 'text-success' : 'text-ink-muted'}`}>{finePaid > 0 ? (emi.mode || '—') : '—'}</p>
                <p className="text-ink-muted">Fine UTR</p><p className="text-right num break-all">{finePaid > 0 ? (emi.utr || '—') : '—'}</p>
              </div>
              {isAdmin && editing && (
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(emi)} disabled={saving} className="btn-success text-xs px-3 py-2 flex-1">{saving ? '…' : 'Save'}</button>
                  <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-3 py-2 flex-1">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
