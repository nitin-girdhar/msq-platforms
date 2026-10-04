import Image from 'next/image';
import type { PublicBranding } from '@platform/ui-kit/branding';

/** Compact brand header for phone-width sign-in pages (the hero is lg-only). */
export default function MobileBrand({ brand, className = '' }: { brand: PublicBranding; className?: string }) {
  const name = brand.brandName ?? 'FitClass';
  const logo = brand.assets.logo ?? brand.assets.mark;
  return (
    <div className={`flex items-center justify-center gap-2.5 ${className}`}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={name} className="h-10 max-w-[180px] object-contain" />
      ) : (
        <>
          <Image src="/fitclass-emblem.png" alt="" width={160} height={160} priority className="h-10 w-10 object-contain" />
          <span className="text-headline-sm font-bold text-on-surface">{name}</span>
        </>
      )}
    </div>
  );
}
