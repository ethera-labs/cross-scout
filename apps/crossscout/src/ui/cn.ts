export type ClassValue = string | false | null | undefined;

/**
 * Minimal, dependency-free className joiner. Drops falsy values so callers can
 * write `cn(base, active && activeClass, className)` without ternary noise.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
