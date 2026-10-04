import type { Metadata } from 'next';
import { ServiceWorkerRegistrar, pwaViewport, pwaAppleWebApp, pwaIcons, pwaAppleCapableMeta, pwaManifest } from '@platform/ui-kit';
import { getEffectiveBranding } from '@platform/ui-kit/server';
import { BrandingProvider } from '@platform/ui-kit/branding';
import { ThemeStyle, themeHtmlProps } from '@platform/ui-kit/theme';
import './globals.css';

export const viewport = pwaViewport;

export const metadata: Metadata = {
  title: 'Sign in · FitClass',
  description: 'Single sign-on for the FitClass platform',
  appleWebApp: pwaAppleWebApp,
  icons: pwaIcons,
  // Linked explicitly now that the manifest is a route handler (per-tenant ?b=).
  manifest: pwaManifest,
  other: pwaAppleCapableMeta,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tenant brand / user appearance → CSS variables (skills/react-typescript §6).
  // Dark mode stays off for this app until every screen is on theme tokens.
  const branding = await getEffectiveBranding();
  const theme = branding.theme;
  return (
    <html lang="en" suppressHydrationWarning {...themeHtmlProps(theme)}>
      <head>
        <ThemeStyle theme={theme} />
      </head>
      <body className="bg-background font-sans text-on-surface" suppressHydrationWarning>
        <ServiceWorkerRegistrar />
        <BrandingProvider value={branding}>{children}</BrandingProvider>
      </body>
    </html>
  );
}
