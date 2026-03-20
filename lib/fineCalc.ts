/**
 * EMI PENALTY SYSTEM — exact business logic
 *
 * 1. Base Fine: ₹450 applied day after EMI due date (one-time per EMI)
 * 2. No duplicate monthly fine: same EMI does NOT get another ₹450 next month
 * 3. 30-day grace: from fine date, NO weekly penalty for 30 days
 * 4. After 30 days: ₹25/week until fine is fully paid
 * 5. EMI paid but fine unpaid: fine stays active, weekly keeps growing
 * 6. LAST EMI exception: ₹450 repeats every 30 days if EMI itself unpaid
 * 7. Each EMI penalty is independent
 *
 * Example (EMI #3 due 4 March, NOT last EMI):
 *   5 Mar  → ₹450  (base fine applied)
 *   4 Apr  → ₹450  (still in 30-day grace)
 *   5 Apr  → ₹450  (grace just ended, 0 full weeks after)
 *   12 Apr → ₹475  (+₹25, 1 week past grace)
 *   19 Apr → ₹500  (+₹50, 2 weeks)
 *
 * Example (LAST EMI due 4 March, unpaid):
 *   5 Mar  → ₹450  (1st base)
 *   5 Apr  → ₹900  (2nd ₹450 since last EMI + 0 weekly yet on 2nd)
 *   12 Apr → ₹925  (₹900 + 1 week on 1st fine block)
 */

import { EMISchedule } from './types';

const BASE = 450;
const WEEKLY = 25;
const GRACE_DAYS = 30;

export function calculateSingleEmiFine(
  dueDate: string,
  isLastEmi: boolean = false,
  baseFine: number = BASE,
  weeklyIncrement: number = WEEKLY,
): number {
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  if (today <= due) return 0;

  const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (daysOverdue <= 0) return 0;

  if (!isLastEmi) {
    // Normal EMI: one-time ₹450, 30-day grace, then ₹25/week
    if (daysOverdue <= GRACE_DAYS) return baseFine;
    const weeks = Math.floor((daysOverdue - GRACE_DAYS) / 7);
    return baseFine + (weeks * weeklyIncrement);
  } else {
    // Last EMI: ₹450 repeats every 30 days + weekly on older blocks
    const blocks = Math.ceil(daysOverdue / GRACE_DAYS);
    let total = 0;
    for (let b = 0; b < blocks; b++) {
      const blockGraceEnd = (b + 1) * GRACE_DAYS;
      total += baseFine;
      if (daysOverdue > blockGraceEnd) {
        total += Math.floor((daysOverdue - blockGraceEnd) / 7) * weeklyIncrement;
      }
    }
    return total;
  }
}

export function calculateTotalFineFromEmis(
  emis: EMISchedule[],
  baseFine: number = BASE,
  weeklyIncrement: number = WEEKLY,
): number {
  let total = 0;
  const maxEmiNo = emis.length > 0 ? Math.max(...emis.map(e => e.emi_no)) : 0;
  for (const emi of emis) {
    if (emi.fine_waived) continue;
    const isOverdue = emi.status === 'UNPAID' && new Date(emi.due_date) < new Date();
    const hasFineUnpaid = (emi.fine_amount || 0) > 0 && (emi.fine_paid_amount || 0) < (emi.fine_amount || 0);
    if (!isOverdue && !hasFineUnpaid) continue;
    const isLast = emi.emi_no === maxEmiNo && emi.status === 'UNPAID';
    const calc = calculateSingleEmiFine(emi.due_date, isLast, baseFine, weeklyIncrement);
    const effective = Math.max(calc, emi.fine_amount || 0);
    total += Math.max(0, effective - (emi.fine_paid_amount || 0));
  }
  return total;
}

export function getPerEmiFineBreakdown(
  emis: EMISchedule[],
  baseFine: number = BASE,
  weeklyIncrement: number = WEEKLY,
) {
  const maxEmiNo = emis.length > 0 ? Math.max(...emis.map(e => e.emi_no)) : 0;
  const result: Array<{
    emi_no: number; due_date: string; days: number; isLastEmi: boolean;
    baseFineTotal: number; weeklyFine: number; graceEnds: string;
    totalFine: number; paid: number; remaining: number;
  }> = [];

  for (const emi of emis) {
    if (emi.fine_waived) continue;
    const isOverdue = emi.status === 'UNPAID' && new Date(emi.due_date) < new Date();
    const hasFineUnpaid = (emi.fine_amount || 0) > 0 && (emi.fine_paid_amount || 0) < (emi.fine_amount || 0);
    if (!isOverdue && !hasFineUnpaid) continue;

    const due = new Date(emi.due_date); const today = new Date();
    today.setHours(0, 0, 0, 0); due.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
    const graceEnd = new Date(due); graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

    const isLast = emi.emi_no === maxEmiNo && emi.status === 'UNPAID';
    const calc = calculateSingleEmiFine(emi.due_date, isLast, baseFine, weeklyIncrement);
    const effective = Math.max(calc, emi.fine_amount || 0);
    const paid = emi.fine_paid_amount || 0;

    const baseFineTotal = isLast ? Math.ceil(days / GRACE_DAYS) * baseFine : baseFine;
    const weeklyFine = days > GRACE_DAYS ? Math.floor((days - GRACE_DAYS) / 7) * weeklyIncrement : 0;

    result.push({
      emi_no: emi.emi_no, due_date: emi.due_date, days, isLastEmi: isLast,
      baseFineTotal, weeklyFine,
      graceEnds: graceEnd.toISOString().split('T')[0],
      totalFine: effective, paid, remaining: Math.max(0, effective - paid),
    });
  }
  return result;
}
