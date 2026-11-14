// SPDX-License-Identifier: AGPL-3.0-or-later
// Empty and loading states.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children: ReactNode;
  /** The one action of the screen while it is empty. */
  action?: ReactNode;
  /** Heading level: 2 on a screen, 3 inside a titled card. */
  level?: 2 | 3;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  level = 2,
}: EmptyStateProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="sd-empty-state">
      <span className="sd-icon-tile">
        <Icon name={icon} />
      </span>
      <Heading className="heading">{title}</Heading>
      <div className="body sd-muted">{children}</div>
      {action}
    </div>
  );
}

interface SkeletonProps {
  /** Translated "Loading…", read by screen readers. */
  label: string;
  /** Shape: rows of a list, or a balance and rows. */
  variant?: 'rows' | 'page';
  rows?: number;
}

/** Grey blocks the shape of the content while it loads. */
export function Skeleton({ label, variant = 'rows', rows = 3 }: SkeletonProps) {
  return (
    <div className={`sd-skeleton sd-skeleton--${variant}`} role="status">
      <span className="sd-visually-hidden">{label}</span>
      {variant === 'page' && (
        <>
          <span className="sd-skeleton__block sd-skeleton__block--title" />
          <span className="sd-skeleton__block sd-skeleton__block--hero" />
        </>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sd-skeleton__block sd-skeleton__block--row" />
      ))}
    </div>
  );
}
