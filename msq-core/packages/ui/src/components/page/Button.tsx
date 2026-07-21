import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// One button scale for every product app. Sizes are pinned to the density the
// LMS chrome established (`sm` = the 30px toolbar control next to DownloadButton,
// `md` = the 36px form/primary action) so a "Check out" in HR and a "Download"
// in LMS read as the same system instead of three unrelated pill sizes.
const SIZES: Record<ButtonSize, string> = {
  sm: 'gap-1.5 rounded-lg px-3 py-1.5 text-xs',
  md: 'gap-2 rounded-lg px-4 py-2 text-sm',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[#0b6cbf] text-white shadow-sm hover:bg-[#095699] focus-visible:ring-[#0b6cbf]/30',
  secondary:
    'border border-[#E2E8F0] bg-white text-[#475569] shadow-sm hover:bg-[#F8FAFC] focus-visible:ring-[#0b6cbf]/20',
  ghost:
    'text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] focus-visible:ring-[#0b6cbf]/20',
  danger:
    'border border-[#E2E8F0] bg-white text-[#475569] shadow-sm hover:border-red-300 hover:text-red-600 focus-visible:ring-red-200',
};

export default function Button({
  variant = 'secondary',
  size = 'sm',
  className = '',
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={[
        'inline-flex shrink-0 items-center justify-center font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        SIZES[size],
        VARIANTS[variant],
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
