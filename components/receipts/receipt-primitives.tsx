/** Label/value line; money values keep LTR digits inside the RTL layout. */
export function Row({
  label,
  value,
  ltr = true,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0">{label}</span>
      {ltr ? (
        <span className="tabular-nums" dir="ltr">
          {value}
        </span>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

export function Dashes() {
  return <div className="my-1 border-t border-dashed border-black" />;
}
