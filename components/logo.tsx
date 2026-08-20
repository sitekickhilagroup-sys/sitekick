// Sitekick mark: three stage stones climbing, the lead stone checked off.
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden focusable="false">
      <rect x="4" y="28" width="13" height="13" rx="4.5" fill="var(--sage-line)" />
      <rect x="17.5" y="17.5" width="13" height="13" rx="4.5" fill="var(--sage)" />
      <rect x="31" y="7" width="13" height="13" rx="4.5" fill="var(--apricot)" />
      <path
        d="M33.8 13.8l3.2 3.2 5.4-6"
        stroke="var(--card)"
        strokeWidth="2.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
