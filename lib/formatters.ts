import { formatISTDateOnly, formatISTDateTime, toDateTimeLocalInputIST, fromDateTimeLocalInputIST } from './time';

export function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

export function formatCurrency(value: unknown): string {
  const num = toNumber(value, 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num).replace(/\s+/g, '');
}

export function formatDateOnly(value?: string | Date | null): string {
  return formatISTDateOnly(value);
}

export function formatDateTime(value?: string | Date | null): string {
  return formatISTDateTime(value);
}

export async function readJsonSafe<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text) as T; }
  catch {
    return { error: text.slice(0, 300) || 'Unexpected server response' } as T;
  }
}

export function toDateTimeLocalInput(value?: string | null): string {
  return toDateTimeLocalInputIST(value);
}

export function fromDateTimeLocalInput(value?: string | null): string | null {
  return fromDateTimeLocalInputIST(value);
}
