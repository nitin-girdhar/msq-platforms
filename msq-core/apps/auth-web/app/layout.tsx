import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ServiceWorkerRegistrar, pwaViewport, pwaAppleWebApp, pwaIcons, pwaAppleCapableMeta } from '@platform/ui-kit';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const viewport = pwaViewport;

export const metadata: Metadata = {
  title: 'Sign in · FitClass',
  description: 'Single sign-on for the FitClass platform',
  appleWebApp: pwaAppleWebApp,
  icons: pwaIcons,
  other: pwaAppleCapableMeta,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-[#F8FAFC]`} suppressHydrationWarning>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
