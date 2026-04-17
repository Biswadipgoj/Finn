'use client';

import { DueBreakdown } from '@/lib/types';
import { format, addDays, differenceInDays } from 'date-fns';
import { formatCurrency } from '@/lib/formatters';
const fmt = formatCurrency;

export default function DueBreakdownPanel({ breakdown }: { breakdown: DueBreakdown }) {
  if (!breakdown || !breakdown.next_emi_no) return null;

  const dueDate = breakdown.next_emi_due_date ? new Date(breakdown.next_emi_due_date) : null;
  const fineStartDate = dueDate ? addDays(dueDate, 1) : null;
  const overdueDays = dueDate && breakdown.is_overdue
    ? differenceInDays(new Date(), dueDate)
    : 0;

  return (
    <section className="card p-5 border border-surface-4 bg-white">
      <header className="mb-3.5">
        <h3 className="text-base font-bold text-ink">Next Payment Due</h3>
        <p className="text-xs text-ink-muted mt-0.5">Breakdown of the current payable amount</p>
      </header>

      <div className="space-y-2.5">
        {(breakdown.selected_emi_amount ?? breakdown.next_emi_amount ?? 0) > 0 && (
          <Row label={`EMI #${breakdown.next_emi_no}`} value={fmt(breakdown.selected_emi_amount ?? breakdown.next_emi_amount ?? 0)} />
        )}
        {breakdown.first_emi_charge_due > 0 && (
          <Row label="First EMI Charge" value={fmt(breakdown.first_emi_charge_due)} accent="warning" />
        )}
        {breakdown.fine_due > 0 && (
          <div>
            <Row label="Late Fine" value={fmt(breakdown.fine_due)} accent="danger" />
            {fineStartDate && (
              <p className="text-[11px] text-danger/70 mt-0.5 ml-0.5">
                Fine applied from {format(fineStartDate, 'd MMM yyyy')}
              </p>
            )}
          </div>
        )}
        <div className="h-px bg-surface-4 my-1" />
        <div className="flex justify-between items-center">
          <span className="font-semibold text-ink">Total Payable</span>
          <span className="num font-bold text-xl text-ink">{fmt(breakdown.total_payable)}</span>
        </div>
        {dueDate && (
          <div className="space-y-0.5">
            <p className={`text-xs ${breakdown.is_overdue ? 'text-danger font-medium' : 'text-ink-muted'}`}>
              Due Date: {format(dueDate, 'd MMMM yyyy')}
              {breakdown.is_overdue && ' (Overdue)'}
            </p>
            {overdueDays > 0 && (
              <p className="text-xs text-danger">
                Overdue by {overdueDays} day{overdueDays !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'warning' | 'danger' }) {
  const cls = accent === 'warning' ? 'text-warning' : accent === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="flex justify-between text-sm">
      <span className={accent ? cls : 'text-ink-muted'}>{label}</span>
      <span className={`num font-semibold ${cls}`}>{value}</span>
    </div>
  );
}
