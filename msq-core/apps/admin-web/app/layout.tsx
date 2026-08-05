import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Team, API tokens, and HR admin for org and tenant admins',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} dashboard-shell bg-[#F8FAFC]`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
