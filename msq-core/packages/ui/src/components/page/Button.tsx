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
    'bg-primary text-on-primary shadow-sm hover:bg-primary/90 focus-visible:ring-primary/30',
  secondary:
    'border border-outline-variant bg-surface-container-lowest text-on-surface-variant shadow-sm hover:bg-surface-container-low focus-visible:ring-primary/20',
  ghost:
    'text-on-surface-variant hover:bg-surface-container hover:text-on-surface focus-visible:ring-primary/20',
  danger:
    'border border-outline-variant bg-surface-container-lowest text-on-surface-variant shadow-sm hover:border-error/50 hover:text-error focus-visible:ring-error/30',
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
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold transition-colors',
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
