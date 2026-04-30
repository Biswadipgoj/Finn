/**
 * EMI penalty system.
 * Uses Asia/Kolkata date boundaries so server, DB, and UI agree on fine days.
 */

import { EMISchedule } from './types';
import { diffDateOnlyDays, getISTDateString } from './time';

const BASE = 450;
const WEEKLY = 25;
const GRACE = 30;

export function calculateSingleEmiFine(
  dueDate: string,
  isLastEmi: boolean = false,
  baseFine: number = BASE,
  weeklyIncrement: number = WEEKLY,
): number {
  const days = diffDateOnlyDays(dueDate, getISTDateString());
  if (days <= 0) return 0;

  if (isLastEmi) {
    const blocks = Math.ceil(days / GRACE);
    return blocks * baseFine;
  }

  if (days <= GRACE) return baseFine;
  const weeks = Math.floor((days - GRACE) / 7);
  return baseFine + (weeks * weeklyIncrement);
}

export function calculateTotalFineFromEmis(
  emis: EMISchedule[],
  baseFine: number = BASE,
  weeklyIncrement: number = WEEKLY,
): number {
  let total = 0;
  const maxEmiNo = emis.length > 0 ? Math.max(...emis.map(e => e.emi_no)) : 0;
  const todayIST = getISTDateString();

  for (const emi of emis) {
    if (emi.fine_waived) continue;

    const isOverdueUnpaid = ['UNPAID', 'PARTIALLY_PAID'].includes(emi.status) && diffDateOnlyDays(emi.due_date, todayIST) > 0;
    const hasFineUnpaid = (emi.fine_amount || 0) > 0 &&
                          (emi.fine_paid_amount || 0) < (emi.fine_amount || 0);

    if (!isOverdueUnpaid && !hasFineUnpaid) continue;

    const isLast = emi.emi_no === maxEmiNo;
    const calc = calculateSingleEmiFine(emi.due_date, isLast, baseFine, weeklyIncrement);
    const effective = Math.max(calc, emi.fine_amount || 0);
    const paid = emi.fine_paid_amount || 0;
    total += Math.max(0, effective - paid);
  }
  return total;
}

export function getPerEmiFineBreakdown(
  emis: EMISchedule[],
  baseFine: number = BASE,
  weeklyIncrement: number = WEEKLY,
) {
  const maxEmiNo = emis.length > 0 ? Math.max(...emis.map(e => e.emi_no)) : 0;
  const todayIST = getISTDateString();

  const result: Array<{
    emi_no: number; due_date: string; days: number; isLastEmi: boolean;
    baseFineTotal: number; weeklyFine: number; graceEnds: string;
    totalFine: number; paid: number; remaining: number;
  }> = [];

  for (const emi of emis) {
    if (emi.fine_waived) continue;

    const isOverdueUnpaid = ['UNPAID', 'PARTIALLY_PAID'].includes(emi.status) && diffDateOnlyDays(emi.due_date, todayIST) > 0;
    const hasFineUnpaid = (emi.fine_amount || 0) > 0 &&
                          (emi.fine_paid_amount || 0) < (emi.fine_amount || 0);
    if (!isOverdueUnpaid && !hasFineUnpaid) continue;

    const days = Math.max(0, diffDateOnlyDays(emi.due_date, todayIST));
    const [gy, gm, gd] = emi.due_date.split('-').map(Number);
    const graceEnd = new Date(Date.UTC(gy, (gm || 1) - 1, gd || 1));
    graceEnd.setUTCDate(graceEnd.getUTCDate() + GRACE);

    const isLast = emi.emi_no === maxEmiNo;
    const calc = calculateSingleEmiFine(emi.due_date, isLast, baseFine, weeklyIncrement);
    const effective = Math.max(calc, emi.fine_amount || 0);
    const paid = emi.fine_paid_amount || 0;

    const baseFineTotal = isLast ? Math.ceil(Math.max(1, days) / GRACE) * baseFine : baseFine;
    const weeklyFine = (!isLast && days > GRACE)
      ? Math.floor((days - GRACE) / 7) * weeklyIncrement
      : 0;

    result.push({
      emi_no: emi.emi_no,
      due_date: emi.due_date,
      days,
      isLastEmi: isLast,
      baseFineTotal,
      weeklyFine,
      graceEnds: graceEnd.toISOString().split('T')[0],
      totalFine: effective,
      paid,
      remaining: Math.max(0, effective - paid),
    });
  }
  return result;
}
