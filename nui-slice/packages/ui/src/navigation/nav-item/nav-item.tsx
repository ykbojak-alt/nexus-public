import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { NexusIcon, type NexusIconName } from '@nexus/icons';
import styles from '../navigation.module.css';

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  label: string;
  icon?: NexusIconName;
  active?: boolean;
  badge?: ReactNode;
}

export function NavItem({ label, icon, active, badge, className, ...rest }: NavItemProps) {
  return (
    <a
      className={[styles.navItem, className].filter(Boolean).join(' ')}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      data-testid="nav-item"
      {...rest}
    >
      {icon != null && <NexusIcon name={icon} size="var(--nexus-icon-slot-tab)" />}
      <span style={{ flex: 1 }}>{label}</span>
      {badge}
    </a>
  );
}
