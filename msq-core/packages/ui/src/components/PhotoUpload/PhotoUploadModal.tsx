'use client';

// Product-agnostic profile-photo capture. Handles camera capture AND gallery
// upload, previews, compresses to a ~<500 KB JPEG data URL, and collects the
// DPDP consent checkbox. It knows nothing about identity- or hr-service: the
// consumer passes `onSubmit(dataUrl, consent)` and, optionally, a `gate` that
// locks capture when a change isn't currently allowed (e.g. HR cooldown).

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../Modal/Modal';
import Button from '../page/Button';

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

  // Stage-aware footer: capture/upload/retake are actions, so they live in the
  // pinned bar (not the scrolling body) — otherwise they can fall below the
  // fold on short viewports and the primary action becomes invisible.
  // Capture actions sit left, confirm actions right; they stack (confirm row on
  // top) only when the panel is too narrow for one row, so nothing half-wraps.
  const footer = locked ? (
    <div className="flex justify-end">
      <Button variant="secondary" size="md" onClick={onClose}>
        Close
      </Button>
    </div>
  ) : (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        {stage.status === 'streaming' ? (
          <Button variant="primary" size="md" onClick={capture}>
            Capture
          </Button>
        ) : (
          <>
            {cameraSupported && (
              <Button variant="primary" size="md" onClick={startCamera}>
                Use camera
              </Button>
            )}
            <Button variant="secondary" size="md" onClick={() => fileRef.current?.click()}>
              Upload from gallery
            </Button>
          </>
        )}
        {stage.status === 'captured' && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => (cameraSupported ? void startCamera() : setStage({ status: 'choose' }))}
          >
            Retake
          </Button>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={stage.status !== 'captured' || !consent || submitting}
          className="!bg-emerald-600 hover:!bg-emerald-700"
        >
          {submitting ? 'Saving…' : 'Save photo'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      locked={submitting}
      footer={footer}
      maxWidth="max-w-xl"
    >
      {locked ? (
        <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
          {gate?.message ?? 'You cannot change your photo right now.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Height is viewport-relative (not aspect-square) so the preview,
              consent checkbox and any error all fit between the pinned header
              and footer — the body never has to scroll. */}
          <div className="flex h-[min(46vh,20rem)] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
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

          <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={onFile} className="hidden" />

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
        </div>
      )}
    </Modal>
  );
}
