'use client';

import { useState } from 'react';
import type { TaskListView } from '../../lib/tasks/types';
import CreateListModal from './CreateListModal';

interface Props {
  lists: TaskListView[];
  activeListId: string | null;
  onSelect: (listId: string | null) => void;
  onListCreated: () => void;
}

export default function TaskListSidebar({ lists, activeListId, onSelect, onListCreated }: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <aside className="w-full shrink-0 space-y-2 sm:w-56">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">My lists</h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Create list"
          className="rounded-lg p-1 text-[#0b6cbf] hover:bg-[#EFF6FF]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      <nav className="space-y-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm ${
            activeListId === null ? 'bg-[#EFF6FF] font-semibold text-[#0b6cbf]' : 'text-[#475569] hover:bg-[#F8FAFC]'
          }`}
        >
          All tasks
        </button>
        {lists.map((list) => (
          <button
            key={list.id}
            type="button"
            onClick={() => onSelect(list.id)}
            className={`block w-full truncate rounded-lg px-3 py-1.5 text-left text-sm ${
              activeListId === list.id ? 'bg-[#EFF6FF] font-semibold text-[#0b6cbf]' : 'text-[#475569] hover:bg-[#F8FAFC]'
            }`}
            title={list.name}
          >
            {list.name}
          </button>
        ))}
        {lists.length === 0 && <p className="px-3 py-1.5 text-xs text-[#94A3B8]">No lists yet.</p>}
      </nav>

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onListCreated}
      />
    </aside>
  );
}
