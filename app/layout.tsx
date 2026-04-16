import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'TelePoint EMI Portal',
  description: 'Professional EMI collection and account management portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="overflow-x-hidden">
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: { borderRadius: '12px', background: '#0f172a', color: '#fff', fontSize: '14px' },
            success: { style: { background: '#166534', color: 'white' }, iconTheme: { primary: 'white', secondary: '#166534' } },
            error: { style: { background: '#b91c1c', color: 'white' }, iconTheme: { primary: 'white', secondary: '#b91c1c' } },
          }}
        />
      </body>
    </html>
  );
}
