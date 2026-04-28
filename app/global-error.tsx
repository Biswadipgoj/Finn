'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error('Global error boundary caught:', error);

  return (
    <html lang="en">
      <body className="min-h-screen page-bg flex items-center justify-center p-6">
        <div className="card p-6 max-w-lg w-full text-center space-y-3">
          <h2 className="text-xl font-bold text-danger">Application Error</h2>
          <p className="text-sm text-ink-muted">A critical error occurred. Please refresh and try again.</p>
          <button onClick={reset} className="btn-primary">Reload section</button>
        </div>
      </body>
    </html>
  );
}
