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
      className="fixed bottom-[4.25rem] left-3 right-3 z-40 sm:left-auto sm:right-6 sm:w-[420px] no-print pointer-events-none"
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
        <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">{message}</p>
      </div>
    </aside>
  );
}
