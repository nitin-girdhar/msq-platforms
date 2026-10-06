'use client';

import { useEffect, useState } from 'react';
import Modal from '../components/Modal/Modal';
import ThemePicker from '../components/ThemePicker/ThemePicker';
import { applyThemePreview } from '../components/ThemePicker/preview';
import { appearance } from '../api/resources';
import { useBranding } from '../branding/BrandingProvider';
import { resolveTheme, type ThemeChoice } from '../theme/presets';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * The user's own Appearance override (UserMenu → Appearance). Shows the
 * company theme until the user picks something; "Use company theme" deletes
 * the override. While Super Admin has locked the tenant's theme, colour and
 * font are read-only and only the mode and text size remain personal (the server
 * enforces the same rule when it resolves the theme).
 *
 * Saved themes are rendered server-side (no flash), so a save reloads the
 * page; until then the choice is previewed live.
 */
export default function AppearanceModal({ open, onClose }: Props) {
  const branding = useBranding();
  const [draft, setDraft] = useState<ThemeChoice>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // draft holds ONLY what the user has chosen (their saved override, then
  // edits). Unchosen fields keep inheriting the company theme, so a user who
  // only flips the mode does not freeze today's company colours into their
  // account.
  useEffect(() => {
    if (!open) return;
    setDraft({ ...(branding.personal ?? {}) });
    setError(null);
  }, [open, branding.personal]);

  const company = branding.theme;
  // Locked: the company colours/font are what renders, whatever is stored.
  // Mode and text size are personal needs and stay editable under the lock.
  const personalOnly: ThemeChoice = { mode: draft.mode ?? null, font_size: draft.font_size ?? null };
  const shown = resolveTheme(company, branding.locked ? personalOnly : draft);
  const display: ThemeChoice = {
    preset: shown.preset,
    seed_hex: shown.preset ? null : shown.seed_hex,
    font: shown.font,
    mode: draft.mode ?? company.mode,
    font_size: shown.font_size,
  };
  const onPick = (next: ThemeChoice) => {
    setDraft((d) => {
      const out: ThemeChoice = { ...d };
      if (next.preset !== display.preset || next.seed_hex !== display.seed_hex) {
        out.preset = next.preset ?? null;
        out.seed_hex = next.seed_hex ?? null;
      }
      if (next.font !== display.font) out.font = next.font ?? null;
      if (next.mode !== display.mode) out.mode = next.mode ?? null;
      if (next.font_size !== display.font_size) out.font_size = next.font_size ?? null;
      return out;
    });
  };

  // Live preview of colour + font + text size; dropped on close. Under the lock
  // only the text size is previewed (colours/font are the company's).
  useEffect(() => {
    if (!open) return;
    applyThemePreview(resolveTheme(company, branding.locked ? { font_size: draft.font_size ?? null } : draft));
    return () => applyThemePreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- company is stable per page
  }, [open, draft, branding.locked]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Locked: only mode and text size can change here; the stored colour/font
      // are kept so unlocking later restores the user's own choice.
      await appearance.save(
        branding.locked
          ? { ...(branding.personal ?? {}), mode: draft.mode ?? null, font_size: draft.font_size ?? null }
          : draft,
      );
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your appearance settings.');
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError(null);
    try {
      await appearance.reset();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset your appearance settings.');
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title="Appearance"
      subtitle="Personalise colours, font and text size for your account on this platform."
      maxWidth="max-w-xl"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={reset}
            disabled={saving || !branding.personal}
            className="rounded-lg px-3 py-2 text-label-md text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use company theme
          </button>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-label-md text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              aria-busy={saving}
              className="rounded-lg bg-primary px-4 py-2 text-label-md font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ThemePicker
          value={display}
          onChange={onPick}
          locked={branding.locked}
          lockedReason="Your company's colours and font are set by the platform admin. You can still choose light or dark and your text size."
          showMode
          showFontSize
          modeHint="Dark mode is applied as each product finishes its dark theme."
          disabled={saving}
        />
        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
