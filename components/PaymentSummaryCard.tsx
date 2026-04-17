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

type PaymentSummaryDebug = {
  totalEmiPrincipal: number;
  totalEmiPrincipalPaid: number;
  totalFinePaid: number;
  totalFineDue: number;
  firstChargePaid: number;
  totalPaid: number;
  paidEmis: number;
  nextOutstandingEmi: EMISchedule | null;
};

function buildPaymentSummaryDebug(emis: EMISchedule[], customer: Customer) {
  // Guard against accidental duplicate EMI rows from mixed/joined sources.
  const uniqueEmis = Array.from(new Map(emis.map((emi) => [emi.id, emi])).values()).sort((a, b) => a.emi_no - b.emi_no);
  const emiAmount = toNumber(customer.emi_amount);

  const totalEmiPrincipal = uniqueEmis.reduce((acc, emi) => acc + toNumber(emi.amount, emiAmount), 0);
  const totalEmiPrincipalPaid = uniqueEmis.reduce(
    (acc, emi) => acc + Math.min(toNumber(emi.amount, emiAmount), emiPrincipalPaidForRow(emi, emiAmount)),
    0,
  );

  const totalFinePaid = uniqueEmis.reduce((acc, emi) => acc + Math.max(0, toNumber(emi.fine_paid_amount)), 0);
  const totalFineDue = uniqueEmis.reduce((acc, emi) => {
    if (emi.fine_waived) return acc;
    const fineOutstanding = Math.max(0, toNumber(emi.fine_amount) - toNumber(emi.fine_paid_amount));
    return acc + fineOutstanding;
  }, 0);

  const firstChargePaid = customer.first_emi_charge_paid_at ? Math.max(0, toNumber(customer.first_emi_charge_amount)) : 0;
  const totalPaid = totalEmiPrincipalPaid + totalFinePaid + firstChargePaid;

  const paidEmis = uniqueEmis.filter((emi) => {
    const scheduled = toNumber(emi.amount, emiAmount);
    const principalPaid = Math.min(scheduled, emiPrincipalPaidForRow(emi, emiAmount));
    return scheduled > 0 && principalPaid >= scheduled;
  }).length;

  // Earliest outstanding EMI principal row only.
  const nextOutstandingEmi = uniqueEmis.find((emi) => {
    const scheduled = toNumber(emi.amount, emiAmount);
    const principalPaid = Math.min(scheduled, emiPrincipalPaidForRow(emi, emiAmount));
    const remaining = Math.max(0, scheduled - principalPaid);
    return remaining > 0 && ['UNPAID', 'PARTIALLY_PAID', 'PENDING_APPROVAL'].includes(emi.status);
  }) || null;

  return {
    totalEmiPrincipal,
    totalEmiPrincipalPaid,
    totalFinePaid,
    totalFineDue,
    firstChargePaid,
    totalPaid,
    paidEmis,
    nextOutstandingEmi,
  } as PaymentSummaryDebug;
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
  const debugSummary = buildPaymentSummaryDebug(sorted, customer);
  const totalEmis = toNumber(customer.emi_tenure, sorted.length);
  const paidEmis = debugSummary.paidEmis;

  const loanAmount = toNumber(
    customer.disburse_amount,
    toNumber(customer.purchase_value) - toNumber(customer.down_payment),
  );
  const emiAmount = toNumber(customer.emi_amount);
  const emiRemaining = Math.max(0, debugSummary.totalEmiPrincipal - debugSummary.totalEmiPrincipalPaid);
  const finePaid = debugSummary.totalFinePaid;
  const effectiveFineDue = Math.max(0, debugSummary.totalFineDue);
  const totalPaid = debugSummary.totalPaid;
  const totalRemaining = emiRemaining + effectiveFineDue;
  const nextEmi = debugSummary.nextOutstandingEmi;
  const nextEmiDue = nextEmi
    ? Math.max(
        0,
        toNumber(nextEmi.amount, emiAmount) - Math.min(toNumber(nextEmi.amount, emiAmount), emiPrincipalPaidForRow(nextEmi, emiAmount)),
      )
    : 0;
  const nextDueDate = nextEmi?.due_date ?? breakdown?.next_emi_due_date ?? null;

  const rows = [
    { label: 'Loan Amount', value: formatCurrency(loanAmount), tone: 'neutral' },
    { label: 'EMI Amount', value: formatCurrency(emiAmount), tone: 'neutral' },
    { label: 'Total EMIs', value: String(totalEmis || 0), tone: 'neutral' },
    { label: 'Paid EMIs', value: String(paidEmis || 0), tone: 'success' },
    { label: 'Total Paid', value: formatCurrency(totalPaid), tone: 'success' },
    { label: 'EMI Remaining', value: formatCurrency(emiRemaining), tone: emiRemaining > 0 ? 'info' : 'success' },
    { label: 'Fine Paid', value: formatCurrency(finePaid), tone: finePaid > 0 ? 'success' : 'neutral' },
    { label: 'Fine Due', value: formatCurrency(effectiveFineDue), tone: effectiveFineDue > 0 ? 'danger' : 'success' },
    { label: 'Total Remaining', value: formatCurrency(totalRemaining), tone: totalRemaining > 0 ? 'info' : 'success' },
    { label: 'Next EMI Due', value: formatCurrency(nextEmi ? nextEmiDue : (breakdown?.next_emi_amount ?? 0)), tone: 'info' },
    { label: 'Next Due Date', value: formatDateOnly(nextDueDate), tone: 'neutral' },
    { label: 'Status', value: statusLabel(customer), tone: 'neutral' },
  ];

  const toneClasses: Record<string, string> = {
    neutral: 'border-surface-4 bg-white text-ink',
    success: 'border-success-border bg-success-light/40 text-success',
    danger: 'border-danger-border bg-danger-light/35 text-danger',
    info: 'border-brand-200 bg-brand-50/45 text-brand-700',
  };

  return (
    <section className="card overflow-hidden">
      <header className="px-5 py-4 border-b border-surface-4 bg-surface-2">
        <h3 className="text-lg font-bold text-ink">Payment Summary</h3>
        <p className="text-xs text-ink-muted mt-0.5">Live reconciled totals</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 p-4">
        {rows.map((row, idx) => (
          <div
            key={row.label}
            className={`rounded-xl border px-3.5 py-3 shadow-sm ${toneClasses[row.tone]} ${idx === 8 ? 'sm:col-span-2 xl:col-span-1' : ''}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{row.label}</p>
            <p className="text-base font-bold text-right num mt-1">{row.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
