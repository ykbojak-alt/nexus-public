import styles from '../surfaces.module.css';

export function Divider({className,  orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return <hr className={[styles.divider, className].filter(Boolean).join(' ')} data-orientation={orientation} aria-orientation={orientation} />;
}
