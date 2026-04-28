'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Route error boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen page-bg flex items-center justify-center p-6">
      <div className="card p-6 max-w-lg w-full text-center space-y-3">
        <h2 className="text-xl font-bold text-danger">Client-side application error</h2>
        <p className="text-sm text-ink-muted">Something went wrong while rendering this page. Please retry.</p>
        <button onClick={reset} className="btn-primary">Try again</button>
      </div>
    </div>
  );
}
