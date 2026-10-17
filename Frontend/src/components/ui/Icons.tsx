/** The 4 inline SVG icons from the prototype. stroke-width 1.5, currentColor. */
type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
});

export function CheckIcon({ size = 12, className }: P) {
  return (
    <svg aria-hidden="true" {...base(size)} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LockIcon({ size = 14, className }: P) {
  return (
    <svg aria-hidden="true" {...base(size)} className={className}>
      <rect x="5" y="11" width="14" height="9" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function PeopleIcon({ size = 16, className }: P) {
  return (
    <svg aria-hidden="true" {...base(size)} className={className}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M15.5 14.2c2.8 0 5 1.8 5 4.8" />
    </svg>
  );
}

export function CircleCheckIcon({ size = 26, className }: P) {
  return (
    <svg aria-hidden="true" {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M7.8 12.3l2.8 2.8 5.6-5.8" />
    </svg>
  );
}
