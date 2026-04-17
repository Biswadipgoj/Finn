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

function emiPrincipalPaidForRow(emi: EMISchedule, defaultEmiAmount: number) {
  const scheduledAmount = toNumber(emi.amount, defaultEmiAmount);
  const partialPaid = Math.max(0, toNumber(emi.partial_paid_amount));

  if (emi.status === 'APPROVED') {
    // In some migrated rows, partial_paid_amount may carry the paid principal
    // while amount can be stale/zero. Use the highest reliable principal value.
    return Math.max(scheduledAmount, partialPaid, defaultEmiAmount);
  }

  if (emi.status === 'PARTIALLY_PAID') {
    return Math.min(scheduledAmount || defaultEmiAmount, partialPaid);
  }

  return 0;
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

  const totalEmis = toNumber(customer.emi_tenure, sorted.length);
  const paidEmis = sorted.filter((e) => e.status === 'APPROVED').length;

  const loanAmount = toNumber(
    customer.disburse_amount,
    toNumber(customer.purchase_value) - toNumber(customer.down_payment),
  );
  const emiAmount = toNumber(customer.emi_amount);

  const emiPrincipalPaid = sorted.reduce(
    (acc, emi) => acc + emiPrincipalPaidForRow(emi, emiAmount),
    0,
  );

  // Principal remaining is independent from fine/charges.
  const emiRemaining = Math.max(0, loanAmount - Math.min(loanAmount, emiPrincipalPaid));

  const finePaid = sorted.reduce((acc, emi) => acc + Math.max(0, toNumber(emi.fine_paid_amount)), 0);
  const fineDueFromSchedule = sorted.reduce((acc, emi) => {
    if (emi.fine_waived) return acc;
    const due = Math.max(0, toNumber(emi.fine_amount) - toNumber(emi.fine_paid_amount));
    return acc + due;
  }, 0);

  const fineDue = Math.max(0, toNumber(breakdown?.fine_due, fineDueFromSchedule));
  const totalRemaining = emiRemaining + fineDue;

  const firstChargePaid = customer.first_emi_charge_paid_at ? toNumber(customer.first_emi_charge_amount) : 0;
  const totalPaid = emiPrincipalPaid + finePaid + firstChargePaid;

  const nextEmi = sorted.find((e) => e.status === 'UNPAID' || e.status === 'PARTIALLY_PAID');
  const nextEmiBase = toNumber(nextEmi?.amount, emiAmount);
  const nextEmiDue = Math.max(0, nextEmiBase - toNumber(nextEmi?.partial_paid_amount));

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Loan Amount', value: formatCurrency(loanAmount), mono: true },
    { label: 'EMI Amount', value: formatCurrency(emiAmount), mono: true },
    { label: 'Total EMIs', value: String(totalEmis), mono: true },
    { label: 'Paid EMIs', value: String(paidEmis), mono: true },
    { label: 'Total Paid', value: formatCurrency(totalPaid), mono: true },
    { label: 'EMI Remaining', value: formatCurrency(emiRemaining), mono: true },
    { label: 'Fine Paid', value: formatCurrency(finePaid), mono: true },
    { label: 'Fine Due', value: formatCurrency(fineDue), mono: true },
    { label: 'Total Remaining', value: formatCurrency(totalRemaining), mono: true },
    { label: 'Next EMI Due', value: formatCurrency(breakdown?.next_emi_amount ?? nextEmiDue), mono: true },
    { label: 'Next Due Date', value: formatDateOnly(breakdown?.next_emi_due_date ?? nextEmi?.due_date ?? null) },
    { label: 'Status', value: statusLabel(customer) },
  ];

  return (
    <section className="border border-surface-4 rounded-lg bg-white">
      <header className="px-4 sm:px-5 py-3 border-b border-surface-4">
        <h3 className="text-base sm:text-lg font-bold text-ink">Payment Summary</h3>
      </header>

      <div className="px-4 sm:px-5">
        <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-8">
          {rows.map((row, idx) => (
            <div
              key={row.label}
              className={`flex items-center justify-between gap-3 py-2.5 ${idx !== rows.length - 1 ? 'border-b border-surface-4' : ''}`}
            >
              <p className="text-sm font-medium text-ink-muted">{row.label}</p>
              <p className={`text-sm sm:text-[15px] font-bold text-ink text-right ${row.mono ? 'num' : ''}`}>
                {row.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
