interface Props {
  tone: 'success' | 'error';
  children: React.ReactNode;
}

const TONES = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
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
