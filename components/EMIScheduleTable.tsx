'use client';

import { useState } from 'react';
import { EMISchedule } from '@/lib/types';
import { format, differenceInDays, addDays } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import { calculateSingleEmiFine } from '@/lib/fineCalc';
import { formatCurrency } from '@/lib/formatters';

interface Props {
  emis: EMISchedule[];
  isAdmin?: boolean;
  nextUnpaidNo?: number;
  onRefresh?: () => void;
  defaultFineAmount?: number;
}

const fmt = formatCurrency;

function statusBadge(status: EMISchedule['status'], isOverdue: boolean) {
  if (status === 'APPROVED') return <span className="badge-green">Paid</span>;
  if (status === 'PARTIALLY_PAID') return <span className="badge-yellow">Partially Paid</span>;
  if (status === 'PENDING_APPROVAL') return <span className="badge-yellow">Pending</span>;
  return <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return format(new Date(value), 'dd MMM yyyy, hh:mm a');
}

function KvRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <span className={`text-sm text-right num ${emphasize ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{value}</span>
    </div>
  );
}

export default function EMIScheduleTable({ emis, isAdmin, nextUnpaidNo, onRefresh, defaultFineAmount = 450 }: Props) {
  const supabase = createClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fineOverride, setFineOverride] = useState('');
  const [dateOverride, setDateOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const sortedEmis = [...emis].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  const paidCount = sortedEmis.filter(e => e.status === 'APPROVED').length;

  async function saveEdit(emi: EMISchedule) {
    setSaving(true);
    const updates: Record<string, unknown> = {};
    if (fineOverride !== '') updates.fine_amount = parseFloat(fineOverride) || 0;
    if (dateOverride !== '') updates.due_date = dateOverride;
    const { error } = await supabase.from('emi_schedule').update(updates).eq('id', emi.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success('EMI updated');
      setEditingId(null);
      onRefresh?.();
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

      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
        {sortedEmis.map((emi) => {
          const today = new Date();
          const dueDate = new Date(emi.due_date);
          const isOverdue = ['UNPAID', 'PARTIALLY_PAID'].includes(emi.status) && dueDate < today;
          const isNext = emi.emi_no === nextUnpaidNo;
          const editing = editingId === emi.id;

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
              className={`rounded-xl border ${isOverdue ? 'border-danger-border bg-danger-light/20' : 'border-surface-4 bg-white'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-surface-4">
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
                        <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-2 py-1">Cancel</button>
                      </>
                    ) : (
                      emi.status === 'UNPAID' && (
                        <button
                          onClick={() => {
                            setEditingId(emi.id);
                            setFineOverride('');
                            setDateOverride('');
                          }}
                          className="btn-ghost text-xs px-2 py-1"
                        >
                          Edit
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="px-4 py-3">
                {editing && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 pb-3 border-b border-surface-4">
                    <input
                      type="date"
                      value={dateOverride || emi.due_date}
                      onChange={e => setDateOverride(e.target.value)}
                      className="input py-2 text-sm"
                    />
                    <input
                      type="number"
                      value={fineOverride}
                      onChange={e => setFineOverride(e.target.value)}
                      placeholder={String(emi.fine_amount || 0)}
                      className="input py-2 text-sm"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-8 gap-y-0 divide-y md:divide-y-0 divide-surface-3">
                  <div className="space-y-0">
                    <KvRow label="EMI Amount" value={fmt(emi.amount)} emphasize />
                    <KvRow label="Due Date" value={format(dueDate, 'dd MMM yyyy')} />
                    <KvRow label="EMI Paid Amount" value={fmt(emiPaidAmount)} />
                    <KvRow label="EMI Paid Date" value={emi.paid_at ? formatDateTime(emi.paid_at) : emi.partial_paid_at ? formatDateTime(emi.partial_paid_at) : '-'} />
                    <KvRow label="Remaining EMI" value={fmt(emiRemaining)} />
                  </div>
                  <div className="space-y-0 md:border-l md:border-surface-3 md:pl-8">
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
    </section>
  );
}
