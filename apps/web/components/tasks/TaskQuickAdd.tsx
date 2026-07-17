'use client';

import { useState } from 'react';

interface Props {
  onCreate: (title: string) => Promise<void>;
}

export default function TaskQuickAdd({ onCreate }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onCreate(title);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 shadow-sm">
      <svg className="h-4 w-4 shrink-0 text-[#94A3B8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        disabled={busy}
        placeholder="Quick-add a task and press Enter…"
        className="w-full border-none bg-transparent text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none"
      />
    </div>
  );
}
