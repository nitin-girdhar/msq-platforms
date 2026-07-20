import type { TaskStatusName } from '../../lib/tasks/types';
import { TASK_STATUS_STYLES } from '../../lib/tasks/format';

interface Props {
  status: TaskStatusName;
  label?: string;
}

export default function TaskStatusChip({ status, label }: Props) {
  const style = TASK_STATUS_STYLES[status] ?? TASK_STATUS_STYLES.todo;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style.bg} ${style.fg}`}
    >
      {label ?? status}
    </span>
  );
}
