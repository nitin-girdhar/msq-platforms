import type { ResolvedCapability } from '@platform/rbac';
import type { CapabilityRow } from '@/src/lib/api/client';
import { KIND_LABEL, TONE_CLASS, stateView } from '@/src/lib/capability-tree';

export function StateChip({ node }: { node: ResolvedCapability | undefined }) {
  const v = stateView(node);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${TONE_CLASS[v.tone]}`}>{v.label}</span>
  );
}

export function StagedChip() {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${TONE_CLASS.blocked}`}>Staged</span>
  );
}

interface GrantButtonsProps {
  node: ResolvedCapability | undefined;
  label: string;
  disabled: boolean;
  onSet: (granted: boolean) => void;
}

// Grant / Deny, resolved against the state you are about to save. There is no
// "clear" button: the grant API only accepts true/false, and a rowless page
// already reads as inherited — ticking it back to its saved state drops the
// staged change instead.
export function GrantButtons({ node, label, disabled, onSet }: GrantButtonsProps) {
  const granted = !!node?.granted;
  const base =
    'flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label={`${label} access`}>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={granted}
        aria-label={`Grant ${label}`}
        onClick={() => onSet(true)}
        className={`${base} ${granted ? 'border-status-success bg-status-success-container text-on-status-success-container' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'}`}
      >
        ✓
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!granted}
        aria-label={`Deny ${label}`}
        onClick={() => onSet(false)}
        className={`${base} ${!granted ? 'border-error bg-error-container text-on-error-container' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'}`}
      >
        ✕
      </button>
    </div>
  );
}

interface OpRowProps {
  cap: CapabilityRow;
  node: ResolvedCapability | undefined;
  staged: boolean;
  inert: boolean;
  baseDepth: number;
  onSet: (granted: boolean) => void;
}

// One capability in column 3 (and in the phone accordion).
export function OpRow({ cap, node, staged, inert, baseDepth, onSet }: OpRowProps) {
  const depth = Math.max(0, (node?.depth ?? 0) - baseDepth);
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
        staged ? 'border-status-due bg-status-due-container/40' : 'border-outline-variant bg-surface-container-lowest'
      } ${inert ? 'opacity-60' : ''}`}
      style={{ marginLeft: `${Math.min(depth, 3) * 0.75}rem` }}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-on-surface">
          <span className="truncate">{cap.label}</span>
          <span className="rounded bg-surface-container px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-on-surface-variant">
            {KIND_LABEL[cap.kind]}
          </span>
          {staged && <StagedChip />}
        </p>
        <p className="truncate font-mono text-[0.6875rem] text-on-surface-variant">{cap.key}</p>
        {cap.description && <p className="truncate text-[0.6875rem] text-on-surface-variant">{cap.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StateChip node={node} />
        <GrantButtons node={node} label={cap.label} disabled={inert} onSet={onSet} />
      </div>
    </li>
  );
}
