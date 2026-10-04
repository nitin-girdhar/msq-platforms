'use client';

export const PASSWORD_MIN_LENGTH = parseInt(process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH ?? '12', 10);

interface Rule {
  label: string;
  test: (v: string) => boolean;
}

// Mirrors createStrongPasswordSchema (@platform/validation) — the server is the
// gate; this list only explains it as the user types.
export const PASSWORD_RULES: Rule[] = [
  { label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'One number', test: (v) => /[0-9]/.test(v) },
];

export function passesRules(v: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(v));
}

// A coarse meter for feedback only: rules met, plus length beyond the minimum.
function strength(v: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!v) return { score: 0, label: '' };
  const met = PASSWORD_RULES.filter((r) => r.test(v)).length;
  if (met < PASSWORD_RULES.length) return { score: met >= 3 ? 2 : 1, label: 'Weak' };
  const extra = v.length - PASSWORD_MIN_LENGTH;
  const varied = /[^A-Za-z0-9]/.test(v);
  if (extra >= 4 && varied) return { score: 4, label: 'Strong' };
  if (extra >= 2 || varied) return { score: 3, label: 'Good' };
  return { score: 3, label: 'Fair' };
}

const BAR = ['bg-surface-container-high', 'bg-error', 'bg-status-due', 'bg-primary', 'bg-status-success'] as const;

export default function PasswordRules({ value }: { value: string }) {
  const s = strength(value);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= s.score ? BAR[s.score] : BAR[0]}`} />
          ))}
        </div>
        {s.label && (
          <p className="mt-1 text-label-sm text-on-surface-variant" aria-live="polite">
            Strength: <span className="font-semibold text-on-surface">{s.label}</span>
          </p>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-1.5 rounded-lg bg-surface-container-low p-3 sm:grid-cols-2">
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.label} className={`flex items-center gap-1.5 text-label-md ${ok ? 'text-on-status-success-container' : 'text-outline'}`}>
              <span aria-hidden>{ok ? '✓' : '○'}</span>
              {r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
