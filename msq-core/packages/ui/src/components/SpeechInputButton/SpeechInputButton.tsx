'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSpeechToText, type DictationLang } from '../../hooks/useSpeechToText';

// Mic + EN/HI toggle placed beside a notes/reason/comment field. Dictated
// phrases are handed to `onText`; the caller appends them to its controlled
// value (usually via `appendDictation`). Renders nothing where the browser has
// no Web Speech API (Firefox), so the field keeps working as plain text.

const LANG_KEY = 'msq.dictation.lang';
const LANG_EVENT = 'msq:dictation-lang';

function readLang(): DictationLang {
  try {
    return window.localStorage.getItem(LANG_KEY) === 'hi-IN' ? 'hi-IN' : 'en-IN';
  } catch {
    return 'en-IN';
  }
}

// One language choice per user, shared by every mic on the page.
function useDictationLang(): [DictationLang, (lang: DictationLang) => void] {
  const [lang, setLangState] = useState<DictationLang>('en-IN');

  useEffect(() => {
    setLangState(readLang());
    const sync = () => setLangState(readLang());
    window.addEventListener(LANG_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LANG_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setLang = useCallback((next: DictationLang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // Private mode / blocked storage — choice lasts for this page only.
    }
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);

  return [lang, setLang];
}

interface Props {
  /** Receives each finalised phrase. */
  onText: (text: string) => void;
  disabled?: boolean;
  /**
   * For single-line inputs sharing a row: the listening/error line floats
   * under the button instead of taking row width from the input.
   */
  compact?: boolean;
  className?: string;
}

export default function SpeechInputButton({ onText, disabled = false, compact = false, className = '' }: Props) {
  const [lang, setLang] = useDictationLang();
  const { supported, listening, interim, error, toggle, stop } = useSpeechToText({ lang, onFinalText: onText });

  // Stop when the host form locks (e.g. submit in flight).
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  if (!supported) return null;

  const status = error ?? (listening ? interim || 'Listening…' : '');

  return (
    <span className={`relative inline-flex min-w-0 items-center gap-1.5 ${compact ? 'shrink-0' : ''} ${className}`}>
      {status && (
        <span
          role="status"
          className={`truncate text-[0.6875rem] ${error ? 'text-error' : 'italic text-on-surface-variant'} ${
            compact
              ? 'absolute right-0 top-full z-10 mt-1 max-w-[16rem] rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1 shadow-sm'
              : 'min-w-0 max-w-[14rem]'
          }`}
          title={status}
        >
          {status}
        </span>
      )}
      <span className="inline-flex shrink-0 overflow-hidden rounded-md border border-outline-variant text-[0.625rem] font-semibold">
        {(['en-IN', 'hi-IN'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            disabled={disabled}
            aria-pressed={lang === code}
            aria-label={code === 'en-IN' ? 'Dictate in English' : 'Dictate in Hindi'}
            className={`px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              lang === code ? 'bg-on-surface text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {code === 'en-IN' ? 'EN' : 'HI'}
          </button>
        ))}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? 'Stop dictation' : 'Start dictation'}
        title={listening ? 'Stop dictation' : 'Speak to type'}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          listening
            ? 'animate-pulse bg-error text-on-primary hover:bg-on-error-container'
            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
      </button>
    </span>
  );
}
