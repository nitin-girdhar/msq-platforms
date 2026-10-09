// The stat tile the Meta console screens share (Page Mapping, Campaign Mapping,
// Lead Review Inbox). One definition so a spacing / type-scale change lands once.
export default function KpiTile({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-on-surface">{value}</p>
      {note ? <p className="text-[0.6875rem] text-on-surface-variant">{note}</p> : null}
    </div>
  );
}
