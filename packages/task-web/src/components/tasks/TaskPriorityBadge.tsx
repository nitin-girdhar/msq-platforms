import type { TaskPriorityName } from '../../lib/tasks/types';
import { TASK_PRIORITY_STYLES } from '../../lib/tasks/format';

interface Props {
  priority: TaskPriorityName;
  label?: string | null;
}

export default function TaskPriorityBadge({ priority, label }: Props) {
  const style = TASK_PRIORITY_STYLES[priority] ?? TASK_PRIORITY_STYLES.medium;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style.bg} ${style.fg}`}
    >
      {label ?? priority}
    </span>
  );
}
