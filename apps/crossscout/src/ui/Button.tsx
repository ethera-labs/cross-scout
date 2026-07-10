import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'solid' | 'outline' | 'subtle' | 'ghost' | 'facet';
export type ButtonSize = 'sm' | 'md' | 'lg';

// Every button in the app is one of these. Radius comes from the shared
// --radius-control token so buttons never drift out of the scale again.
const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border ' +
  'font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent/45';

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-[13px] py-2.5 text-[13px]',
  lg: 'px-5 py-3 text-[13.5px]',
};

const VARIANTS: Record<ButtonVariant, string> = {
  solid: 'border-cs-line-2 bg-cs-bg-1 text-cs-fg hover:border-cs-accent',
  outline: 'border-cs-line bg-cs-bg-1 text-cs-dim hover:border-cs-accent hover:text-cs-fg',
  subtle: 'border-cs-line bg-transparent text-cs-dim hover:border-cs-line-2 hover:bg-cs-bg-1 hover:text-cs-fg',
  // Text-link style - no chrome, no padding, sized like inline copy.
  ghost: 'border-transparent bg-transparent p-0 text-[13px] text-cs-dim hover:text-cs-accent',
  // Attribute-filter dropdowns - dashed + recessive so they read as a different
  // kind of control from the solid status toggles beside them. Magenta accent
  // (the brand's second gradient stop) on hover, vs the toggles' purple.
  facet: 'border-dashed border-cs-line-2 bg-transparent text-cs-faint hover:border-cs-accent-2 hover:text-cs-fg',
};

// Selected / toggled state, shared by filters, tabs and pager.
const ACTIVE = 'border-cs-accent bg-cs-accent-soft text-cs-fg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'outline',
  size = 'md',
  active = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        BASE,
        variant !== 'ghost' && SIZES[size],
        active ? ACTIVE : VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
