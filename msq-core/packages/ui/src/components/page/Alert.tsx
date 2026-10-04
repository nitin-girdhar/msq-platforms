interface Props {
  tone: 'success' | 'error';
  children: React.ReactNode;
}

const TONES = {
  success: 'border-status-success/30 bg-status-success-container text-on-status-success-container',
  error: 'border-error/30 bg-error-container text-on-error-container',
} as const;

// Inline page notice. Same shape in every product so the "Checked in." banner in
// HR and the "Failed to load tasks." banner in Tasks don't drift apart.
export default function Alert({ tone, children }: Props) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </div>
  );
}
