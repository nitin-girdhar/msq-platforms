'use client';

import { useState } from 'react';
import { Modal } from '@platform/ui-kit';
import { taskLists as taskListsApi } from '../../lib/api/client';
import { TASK_VISIBILITY_OPTIONS } from '../../lib/tasks/format';
import type { TaskVisibility } from '../../lib/tasks/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateListModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<TaskVisibility>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setVisibility('private');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await taskListsApi.create({
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create list.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="New list" locked={saving}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#475569]">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q3 onboarding"
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-[#475569]">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold text-[#475569]">Who can see this list?</label>
          <div className="space-y-2">
            {TASK_VISIBILITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                  visibility === opt.value ? 'border-[#0b6cbf] bg-[#EFF6FF]' : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={opt.value}
                  checked={visibility === opt.value}
                  onChange={() => setVisibility(opt.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-[#0F172A]">{opt.label}</span>
                  <span className="block text-xs text-[#64748B]">{opt.help}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create list'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
