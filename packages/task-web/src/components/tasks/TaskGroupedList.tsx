'use client';

import type { TaskView } from '../../lib/tasks/types';
import { DUE_BUCKET_LABELS, DUE_BUCKET_ORDER, dueBucket } from '../../lib/tasks/format';
import TaskRow from './TaskRow';

interface Props {
  tasks: TaskView[];
  onOpen: (task: TaskView) => void;
  onStatusChange: (task: TaskView, status: string) => void;
}

export default function TaskGroupedList({ tasks, onOpen, onStatusChange }: Props) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#E2E8F0] bg-white px-4 py-8 text-center text-sm text-[#94A3B8]">
        No tasks found.
      </p>
    );
  }

  const groups = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const bucket = dueBucket(task.due_at);
    const arr = groups.get(bucket) ?? [];
    arr.push(task);
    groups.set(bucket, arr);
  }

  return (
    <div className="space-y-5">
      {DUE_BUCKET_ORDER.filter((b) => groups.has(b)).map((bucket) => (
        <section key={bucket} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0b6cbf]">
            {DUE_BUCKET_LABELS[bucket]} ({groups.get(bucket)!.length})
          </h3>
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
            {groups.get(bucket)!.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={onOpen} onStatusChange={onStatusChange} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
