export const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

function partsFor(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return parts;
}

export function getISTDateString(date = new Date()): string {
  const p = partsFor(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function getISTDateTimeLocal(date = new Date()): string {
  const p = partsFor(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function toDateTimeLocalInputIST(value?: string | Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return getISTDateTimeLocal(d);
}

export function fromDateTimeLocalInputIST(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00${IST_OFFSET}` : `${value}${IST_OFFSET}`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatISTDateTime(value?: string | Date | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

export function formatISTDateOnly(value?: string | Date | null): string {
  if (!value) return '-';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIME_ZONE,
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d, 0, 0, 0)));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
}

export function dateOnlyToUtcMs(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  return Date.UTC(year, month - 1, day);
}

export function diffDateOnlyDays(fromDate: string, toDate: string): number {
  const from = dateOnlyToUtcMs(fromDate);
  const to = dateOnlyToUtcMs(toDate);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / 86400000);
}
