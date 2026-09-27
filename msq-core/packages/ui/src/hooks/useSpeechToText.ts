'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Browser-native dictation over the Web Speech API — no package, no backend.
// Chrome/Edge/Safari only (Firefox has no SpeechRecognition), and only on a
// secure origin (HTTPS or localhost). Starting recognition raises the browser's
// own microphone-permission prompt. Note: Chrome sends the audio to Google's
// speech service to transcribe it.

// Minimal local typings — lib.dom does not ship SpeechRecognition.
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}
interface SpeechErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone permission denied — allow it in the browser’s site settings.',
  'service-not-allowed': 'Microphone permission denied — allow it in the browser’s site settings.',
  'no-speech': 'No speech heard — try again.',
  'audio-capture': 'No microphone found.',
  network: 'Speech service unreachable — check your internet connection.',
  'language-not-supported': 'This language is not supported by your browser.',
};

export type DictationLang = 'en-IN' | 'hi-IN';

export interface UseSpeechToTextOptions {
  lang?: DictationLang;
  /** Called once per finalised phrase. */
  onFinalText: (text: string) => void;
}

export interface UseSpeechToTextReturn {
  supported: boolean;
  listening: boolean;
  /** Not-yet-final words, for a live preview. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useSpeechToText({ lang = 'en-IN', onFinalText }: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinalText);
  onFinalRef.current = onFinalText;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Detect after mount so SSR and first client render agree.
  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = langRef.current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const trimmed = text.trim();
          if (trimmed) onFinalRef.current(trimmed);
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };
    rec.onerror = (e) => {
      // 'aborted' is our own stop/abort — not a user-facing error.
      if (e.error !== 'aborted') setError(ERROR_MESSAGES[e.error] ?? 'Dictation failed — try again.');
    };
    rec.onend = () => {
      // A superseded instance (language switch) must not clobber the new one.
      if (recRef.current !== rec) return;
      recRef.current = null;
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError('Dictation failed — try again.');
    }
  }, []);

  // Switching language mid-dictation restarts recognition in the new language.
  useEffect(() => {
    const current = recRef.current;
    if (!current) return;
    recRef.current = null;
    current.abort();
    start();
  }, [lang, start]);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else start();
  }, [start, stop]);

  // Abort on unmount so the mic is released when a modal closes.
  useEffect(() => () => {
    const rec = recRef.current;
    recRef.current = null;
    rec?.abort();
  }, []);

  return { supported, listening, interim, error, start, stop, toggle };
}

const SENTENCE_END = /[.!?।]\s*$/;

/**
 * Append a dictated phrase to existing field text: single-space join, and
 * capitalise the phrase when it starts a sentence. `maxLength` truncates.
 */
export function appendDictation(prev: string, text: string, maxLength?: number): string {
  const phrase = text.trim();
  if (!phrase) return prev;
  const startsSentence = prev.trim() === '' || SENTENCE_END.test(prev);
  const cased = startsSentence ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  const sep = prev === '' || /\s$/.test(prev) ? '' : ' ';
  const next = prev + sep + cased;
  return maxLength !== undefined ? next.slice(0, maxLength) : next;
}
