'use client';

import { Customer, DueBreakdown, EMISchedule } from '@/lib/types';
import { formatCurrency, formatDateOnly, toNumber } from '@/lib/formatters';

function statusLabel(customer: Customer) {
  if (customer.is_locked) return 'Locked';
  if (customer.status === 'RUNNING') return 'Active';
  if (customer.status === 'COMPLETE') return 'Completed';
  if (customer.status === 'SETTLED') return 'Settled';
  if (customer.status === 'NPA') return 'NPA';
  return customer.status || '-';
}

export default function PaymentSummaryCard({
  customer,
  emis,
  breakdown,
}: {
  customer: Customer;
  emis: EMISchedule[];
  breakdown?: DueBreakdown | null;
}) {
  const sorted = [...emis].sort((a, b) => a.emi_no - b.emi_no);
  const totalEmis = toNumber(customer.emi_tenure);
  const paidEmis = sorted.filter(e => e.status === 'APPROVED').length;
  const loanAmount = toNumber(customer.disburse_amount, toNumber(customer.purchase_value) - toNumber(customer.down_payment));
  const emiAmount = toNumber(customer.emi_amount);
  const firstChargePaid = customer.first_emi_charge_paid_at ? toNumber(customer.first_emi_charge_amount) : 0;

  const totalPaidFromEmi = sorted.reduce((acc, emi) => acc + toNumber(emi.partial_paid_amount), 0);
  const totalPaid = totalPaidFromEmi + firstChargePaid;

  const remainingRows = sorted.filter(e => e.status !== 'APPROVED');
  const emiRemaining = remainingRows.reduce((acc, emi) => {
    const due = Math.max(0, toNumber(emi.amount) - toNumber(emi.partial_paid_amount));
    return acc + due;
  }, 0);

  const finePaid = sorted.reduce((acc, emi) => acc + toNumber(emi.fine_paid_amount), 0);
  const fineDue = sorted.reduce((acc, emi) => {
    if (emi.fine_waived) return acc;
    const due = Math.max(0, toNumber(emi.fine_amount) - toNumber(emi.fine_paid_amount));
    return acc + due;
  }, 0);

  const totalRemaining = emiRemaining + fineDue;
  const nextEmi = sorted.find(e => e.status === 'UNPAID' || e.status === 'PARTIALLY_PAID');
  const nextEmiDue = Math.max(0, toNumber(nextEmi?.amount) - toNumber(nextEmi?.partial_paid_amount));

  const rows = [
    { label: 'Loan Amount', value: formatCurrency(loanAmount) },
    { label: 'EMI Amount', value: formatCurrency(emiAmount) },
    { label: 'Total EMIs', value: String(totalEmis || 0) },
    { label: 'Paid EMIs', value: String(paidEmis || 0) },
    { label: 'Total Paid', value: formatCurrency(totalPaid) },
    { label: 'EMI Remaining', value: formatCurrency(emiRemaining) },
    { label: 'Fine Paid', value: formatCurrency(finePaid) },
    { label: 'Fine Due', value: formatCurrency(breakdown?.fine_due ?? fineDue) },
    { label: 'Total Remaining', value: formatCurrency(totalRemaining) },
    { label: 'Next EMI Due', value: formatCurrency(breakdown?.next_emi_amount ?? nextEmiDue) },
    { label: 'Next Due Date', value: formatDateOnly(breakdown?.next_emi_due_date ?? nextEmi?.due_date ?? null) },
    { label: 'Status', value: statusLabel(customer) },
  ];

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg font-bold text-ink">Payment Summary</h3>
        <span className="text-xs font-semibold text-ink-muted">Live snapshot</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
        {rows.map(row => (
          <div key={row.label} className="rounded-xl border border-surface-4 bg-surface-2 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-ink-muted">{row.label}</p>
            <p className="text-sm sm:text-base font-bold text-ink mt-0.5">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
