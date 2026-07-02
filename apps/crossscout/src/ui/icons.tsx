export function LogoIcon() {
  return (
    <svg className="cs-logo-mark" width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="3.25" y="3.25" width="33.5" height="33.5" rx="12" fill="var(--accent-soft)" stroke="var(--line-2)" strokeWidth="1.5" />
      <path d="M11.1 22.7C15.6 14.8 24 15 29.2 8.8" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M11.1 17.3C15.6 25.2 24 25 29.2 31.2" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" opacity="0.82" />
      <circle cx="11.5" cy="20" r="4.2" fill="var(--bg-1)" stroke="var(--accent)" strokeWidth="1.9" />
      <circle cx="29.2" cy="8.8" r="3.2" fill="var(--accent)" />
      <circle cx="29.2" cy="31.2" r="3.2" fill="var(--accent-2)" />
      <circle cx="20" cy="20" r="2.2" fill="var(--fg)" opacity="0.9" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.3 6.3 0 0 0 20 14.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
