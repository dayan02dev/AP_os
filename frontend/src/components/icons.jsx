// Inline Lucide icons (https://lucide.dev — ISC licensed).
// The brand guidelines specify the Lucide icon set; we inline the few we need
// as React components rather than pulling the whole package, keeping the bundle
// lean. Each icon inherits `currentColor` so it tints with surrounding text.

function LucideIcon({ size = 18, strokeWidth = 2, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ArrowLeft(props) {
  return (
    <LucideIcon {...props}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </LucideIcon>
  );
}

export function ArrowRight(props) {
  return (
    <LucideIcon {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </LucideIcon>
  );
}

export function Download(props) {
  return (
    <LucideIcon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </LucideIcon>
  );
}
