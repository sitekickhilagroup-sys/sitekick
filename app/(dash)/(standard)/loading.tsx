// Instant paint on navigation — skeleton mirroring the dashboard rhythm.
export default function DashLoading() {
  return (
    <div className="animate-pulse space-y-8 pb-16" aria-busy>
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <div className="h-9 w-72 rounded-lg bg-inset" />
          <div className="h-4 w-52 rounded bg-inset" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-(--radius-card) border border-line bg-card" />
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-8 w-56 rounded-lg bg-inset" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-(--radius-card) border border-line bg-card" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-8 w-64 rounded-lg bg-inset" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-28 rounded-(--radius-card) border border-line bg-card" />
        ))}
      </div>
    </div>
  );
}
