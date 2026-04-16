'use client';

interface Props {
  message: string;
  hidden?: boolean;
}

export default function RetailerBottomNotice({ message, hidden = false }: Props) {
  if (hidden) return null;

  return (
    <aside
      aria-live="polite"
      className="no-print"
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
        <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">{message}</p>
      </div>
    </aside>
  );
}
