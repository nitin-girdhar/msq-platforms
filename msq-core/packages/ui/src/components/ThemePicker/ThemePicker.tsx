'use client';

import { useId } from 'react';
import {
  BRAND_FONTS,
  HEX_COLOR_RE,
  THEME_PRESETS,
  type BrandFontId,
  type ThemeChoice,
  type ThemeMode,
  type ThemePresetId,
} from '../../theme/presets';
import { seedContrast } from './preview';

export interface ThemePickerProps {
  /** The choice being edited. preset / seed_hex null → inherits. */
  value: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
  /** Colour + font read-only (e.g. "Locked by platform admin"). */
  locked?: boolean;
  /** Why it is locked — shown above the disabled controls. */
  lockedReason?: string;
  /** Show the Light / Dark / Follow device control. */
  showMode?: boolean;
  /** Label for the mode control (user: "Mode", tenant: "Default mode"). */
  modeLabel?: string;
  /** Note under the mode control (e.g. dark mode not yet enabled). */
  modeHint?: string;
  disabled?: boolean;
}

const MODES: ReadonlyArray<{ id: ThemeMode; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Follow device' },
];

const MIN_CONTRAST = 4.5;

/**
 * Colour palette (8 presets + custom seed), font and mode controls shared by
 * the user Appearance panel and both Branding pages. Controlled and stateless:
 * the host owns the value, the preview and the save. Every option comes from
 * the fixed lists in theme/presets.ts — the same lists the API validates.
 */
export default function ThemePicker({
  value,
  onChange,
  locked = false,
  lockedReason,
  showMode = false,
  modeLabel = 'Mode',
  modeHint,
  disabled = false,
}: ThemePickerProps) {
  const uid = useId();
  const colourOff = disabled || locked;
  const custom = value.seed_hex && HEX_COLOR_RE.test(value.seed_hex) ? value.seed_hex.toLowerCase() : null;
  const contrast = custom ? seedContrast(custom) : 21;

  const pickPreset = (id: ThemePresetId) => onChange({ ...value, preset: id, seed_hex: null });
  const pickCustom = (hex: string) => {
    if (HEX_COLOR_RE.test(hex)) onChange({ ...value, seed_hex: hex.toLowerCase(), preset: null });
  };

  return (
    <div className="flex flex-col gap-5">
      {locked && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-container px-3 py-2 text-body-sm text-on-surface-variant">
          <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
              clipRule="evenodd"
            />
          </svg>
          {lockedReason ?? 'Colours and font are managed by your platform admin.'}
        </p>
      )}

      <fieldset disabled={colourOff} className="flex flex-col gap-2">
        <legend className="mb-2 text-label-md font-semibold text-on-surface">Colour palette</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_PRESETS.map((p) => {
            const active = !custom && value.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickPreset(p.id)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-label-md transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? 'border-primary bg-primary-fixed/40 text-on-surface'
                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {/* The swatch IS the data: its colour is the preset's seed. */}
                <span className="h-5 w-5 shrink-0 rounded-full ring-1 ring-outline-variant" style={{ background: p.seed }} aria-hidden />
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label htmlFor={`${uid}-hex`} className="text-label-md text-on-surface-variant">
            Custom colour
          </label>
          <input
            type="color"
            aria-label="Pick a custom colour"
            value={custom ?? '#4f46e5'}
            onChange={(e) => pickCustom(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-outline-variant bg-surface-container-lowest p-0.5 disabled:cursor-not-allowed"
          />
          <input
            id={`${uid}-hex`}
            type="text"
            inputMode="text"
            spellCheck={false}
            maxLength={7}
            placeholder="#rrggbb"
            defaultValue={custom ?? ''}
            key={custom ?? 'none'}
            onBlur={(e) => pickCustom(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') pickCustom((e.target as HTMLInputElement).value.trim());
            }}
            className="h-8 w-28 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 font-mono text-body-sm text-on-surface focus:border-primary focus:outline-none"
          />
          {custom && contrast < MIN_CONTRAST && (
            <span role="status" className="text-body-sm text-on-status-due-container">
              Low contrast ({contrast.toFixed(1)}:1) — text on buttons may be hard to read.
            </span>
          )}
        </div>
      </fieldset>

      <fieldset disabled={colourOff} className="flex flex-col gap-2">
        <legend className="mb-2 text-label-md font-semibold text-on-surface">Font</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BRAND_FONTS.map((f) => {
            const active = (value.font ?? null) === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onChange({ ...value, font: f.id as BrandFontId })}
                aria-pressed={active}
                style={{ fontFamily: `var(${f.cssVar})` }}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-body-md transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? 'border-primary bg-primary-fixed/40 text-on-surface'
                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <span>{f.label}</span>
                <span className="text-label-sm text-outline">Aa 123</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {showMode && (
        <fieldset disabled={disabled} className="flex flex-col gap-2">
          <legend className="mb-2 text-label-md font-semibold text-on-surface">{modeLabel}</legend>
          <div role="radiogroup" className="inline-flex w-full rounded-lg bg-surface-container p-1 sm:w-auto">
            {MODES.map((m) => {
              const active = (value.mode ?? 'light') === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, mode: m.id })}
                  className={`flex-1 rounded-md px-3 py-1.5 text-label-md transition-colors sm:flex-none disabled:cursor-not-allowed disabled:opacity-60 ${
                    active ? 'bg-surface-container-lowest font-semibold text-primary shadow-card' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {modeHint && <p className="text-body-sm text-outline">{modeHint}</p>}
        </fieldset>
      )}
    </div>
  );
}
