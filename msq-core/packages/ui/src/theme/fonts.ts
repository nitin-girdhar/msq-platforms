// Brand font registry — the ONLY fonts a tenant or user may pick. Declared once
// here so every app ships the same list and next/font self-hosts them.
//
// `preload: false` on everything except the platform default: each family's
// @font-face is in the CSS, but the browser downloads a file only when a
// rendered element actually uses that family — and only the chosen
// `--font-brand` is used. So offering seven fonts costs nothing until picked.
//
// Server-safe (no 'use client'): root layouts import `brandFontVariables` to
// put every family's CSS variable on <html>; <ThemeStyle> then points
// --font-brand at the chosen one.
import {
  Inter,
  Manrope,
  DM_Sans,
  IBM_Plex_Sans,
  Plus_Jakarta_Sans,
  Public_Sans,
  Outfit,
  JetBrains_Mono,
} from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap', preload: false });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', preload: false });
// IBM Plex Sans is not a variable font on Google Fonts — weights must be listed.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
  preload: false,
});
const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-plus-jakarta-sans', display: 'swap', preload: false });
const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans', display: 'swap', preload: false });
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap', preload: false });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap', preload: false });

/** Space-separated classes that define every family's CSS variable. Put on <html>. */
export const brandFontVariables = [
  inter,
  manrope,
  dmSans,
  ibmPlexSans,
  plusJakartaSans,
  publicSans,
  outfit,
  jetbrainsMono,
]
  .map((f) => f.variable)
  .join(' ');
