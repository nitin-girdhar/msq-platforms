import Image from 'next/image';
import { DEFAULT_BRAND, type PublicBranding } from '@platform/ui-kit/branding';

/** Compact brand header for phone-width sign-in pages (the hero is lg-only). */
export default function MobileBrand({ brand, className = '' }: { brand: PublicBranding; className?: string }) {
  const name = brand.brandName ?? DEFAULT_BRAND.name;
  const logo = brand.assets.logo ?? brand.assets.mark;
  return (
    <div className={`flex items-center justify-center gap-2.5 ${className}`}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={name} className="h-10 max-w-[180px] object-contain" />
      ) : (
        <>
          <Image src={DEFAULT_BRAND.emblem} alt="" width={160} height={160} priority className="h-10 w-10 object-contain" />
          <span className="text-headline-sm font-bold text-on-surface">{name}</span>
        </>
      )}
    </div>
  );
}
