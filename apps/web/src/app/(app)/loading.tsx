/** Shown instantly while a staff page loads, so navigation never feels stuck. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid animate-pulse gap-5">
      <div className="h-24 rounded-xl bg-navy-800/80" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}
