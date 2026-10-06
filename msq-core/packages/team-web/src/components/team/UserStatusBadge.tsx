interface Props {
  active: boolean;
}

export default function UserStatusBadge({ active }: Props) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success-container px-2 py-0.5 text-xs font-medium text-on-status-success-container">
      <span className="h-1.5 w-1.5 rounded-full bg-status-success shrink-0" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-on-surface-variant">
      <span className="h-1.5 w-1.5 rounded-full bg-outline-variant shrink-0" />
      Inactive
    </span>
  );
}
