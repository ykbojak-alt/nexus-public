import { Fragment } from 'react';
import styles from '../navigation.module.css';

export interface Breadcrumb { label: string; href?: string }

export function Breadcrumbs({ className, items }: { className?: string; items: Breadcrumb[] }) {
  return (
    <nav aria-label="Breadcrumbs" className={[styles.breadcrumbs, className].filter(Boolean).join(' ')}>
      <ol style={{ display: 'contents', listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              <li>
                {last || item.href == null
                  ? <span className={styles.crumb} aria-current={last ? 'page' : undefined}>{item.label}</span>
                  : <a className={styles.crumb} href={item.href}>{item.label}</a>}
              </li>
              {!last && <li className={styles.sep} aria-hidden="true">/</li>}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
