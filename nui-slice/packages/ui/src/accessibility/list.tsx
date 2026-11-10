import type { HTMLAttributes, ReactNode } from 'react';

export interface ListProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export interface ListItemProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * Semantically grouped rows: `role="list"` container + `role="listitem"`
 * children. Fixes axe aria-required-children where a role=list container
 * carries buttons/switches/status nodes directly (plugins groupList NQ-095):
 * wrap each row in ListItem and non-row content keeps out of the list.
 * Pure semantics — no styles; visual styling stays with the caller.
 */
export function List({ children, ...rest }: ListProps) {
  return (
    <div role="list" {...rest}>
      {children}
    </div>
  );
}

export function ListItem({ children, ...rest }: ListItemProps) {
  return (
    <div role="listitem" {...rest}>
      {children}
    </div>
  );
}
