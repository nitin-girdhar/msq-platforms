'use client';

// Product-agnostic profile-photo capture. Handles camera capture AND gallery
// upload, previews, compresses to a ~<500 KB JPEG data URL, and collects the
// DPDP consent checkbox. It knows nothing about identity- or hr-service: the
// consumer passes `onSubmit(dataUrl, consent)` and, optionally, a `gate` that
// locks capture when a change isn't currently allowed (e.g. HR cooldown).

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../Modal/Modal';

const TARGET_MAX_BYTES = 500_000;

export interface PhotoUploadGate {
  /** When false, capture is disabled and `message` explains why. */
  canChange: boolean;
  message?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** DPDP line shown beside the consent checkbox. */
  consentLabel?: string;
  /** Locks capture when a change isn't allowed (cooldown). Null = allowed. */
  gate?: PhotoUploadGate | null;
  /** Receives the captured JPEG data URL + the consent flag. Throws to surface an error. */
  onSubmit: (dataUrl: string, consent: boolean) => Promise<void>;
}

type Stage =
  | { status: 'choose' }
  | { status: 'streaming' }
  | { status: 'captured'; dataUrl: string }
  | { status: 'error'; message: string };

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.ceil((base64.length * 3) / 4);
}

async function compressToJpeg(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  // Cap the longest edge at 1080px — plenty for face matching, keeps bytes down.
  const scale = Math.min(1, 1080 / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrlBytes(dataUrl) > TARGET_MAX_BYTES && quality > 0.3) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}

export default function PhotoUploadModal({
  open,
  onClose,
  title = 'Profile photo',
  consentLabel = 'I consent to my photo being stored and used to verify my attendance.',
  gate,
  onSubmit,
}: Props) {
  const [stage, setStage] = useState<Stage>({ status: 'choose' });
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cameraSupported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Reset everything whenever the modal opens/closes.
  useEffect(() => {
    if (open) {
      setStage({ status: 'choose' });
      setConsent(false);
      setError(null);
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [open, stopStream]);

  const locked = gate ? !gate.canChange : false;

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setStage({ status: 'streaming' });
      // Attach after render so videoRef exists.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setStage({ status: 'error', message: 'Camera unavailable — upload a photo instead.' });
    }
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const dataUrl = await compressToJpeg(video, video.videoWidth, video.videoHeight);
    stopStream();
    setStage({ status: 'captured', dataUrl });
  }, [stopStream]);

  const onFile = useCallback<React.ChangeEventHandler<HTMLInputElement>>(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const dataUrl = await compressToJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      setStage({ status: 'captured', dataUrl });
    } catch {
      setStage({ status: 'error', message: 'That file is not a readable image.' });
    } finally {
      e.target.value = '';
    }
  }, []);

  const submit = useCallback(async () => {
    if (stage.status !== 'captured' || !consent) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(stage.dataUrl, consent);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [stage, consent, onSubmit, onClose]);

  const btn =
    'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors';

  return (
    <Modal open={open} onClose={onClose} title={title} locked={submitting}>
      {locked ? (
        <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
          {gate?.message ?? 'You cannot change your photo right now.'}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
            {stage.status === 'streaming' && (
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            )}
            {stage.status === 'captured' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stage.dataUrl} alt="Preview" className="h-full w-full object-cover" />
            )}
            {(stage.status === 'choose' || stage.status === 'error') && (
              <span className="px-4 text-center text-sm text-slate-400">
                {stage.status === 'error' ? stage.message : 'Take a photo or upload one from your device.'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {stage.status === 'streaming' ? (
              <button type="button" onClick={capture} className={`${btn} bg-[#0b6cbf] text-white hover:bg-[#0a5da3]`}>
                Capture
              </button>
            ) : (
              cameraSupported && (
                <button type="button" onClick={startCamera} className={`${btn} bg-[#0b6cbf] text-white hover:bg-[#0a5da3]`}>
                  Use camera
                </button>
              )
            )}
            <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
              Upload from gallery
            </button>
            {stage.status === 'captured' && (
              <button
                type="button"
                onClick={() => (cameraSupported ? void startCamera() : setStage({ status: 'choose' }))}
                className={`${btn} text-slate-500 hover:bg-slate-50`}
              >
                Retake
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={onFile} className="hidden" />
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>{consentLabel}</span>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className={`${btn} text-slate-500 hover:bg-slate-50`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={stage.status !== 'captured' || !consent || submitting}
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {submitting ? 'Saving…' : 'Save photo'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
