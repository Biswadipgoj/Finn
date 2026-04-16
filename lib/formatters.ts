import { format } from 'date-fns';

export function formatCurrency(value: unknown): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '₹0';
  const normalized = Object.is(num, -0) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(normalized);
}

export function formatDateOnly(value: unknown): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, 'd MMM yyyy');
}

export function formatDateTime(value: unknown): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, 'd MMM yyyy, hh:mm a');
}
