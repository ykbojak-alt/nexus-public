import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import styles from '../surfaces.module.css';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Accessible name — required: every data table must be labelled. */
  label: string;
  /** Render the label as a visible <caption> above the table. */
  showCaption?: boolean;
}

/** Shared data table (W2-08): tokenized borders/typography; consumers keep
 *  their own row model — compose with TableHead/TableBody/TableRow/TableCell.
 *  Empty/loading/error are panel-level concerns — use the StateHints family. */
export function Table({ className, label, showCaption, children, ...rest }: TableProps) {
  return (
    <table className={[styles.dataTable, className].filter(Boolean).join(' ')}
      aria-label={showCaption ? undefined : label} {...rest}>
      {showCaption === true && <caption className={styles.dataTableCaption}>{label}</caption>}
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className={styles.dataTableHead}>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
}

export function TableRow({ className, selected, children, ...rest }: TableRowProps) {
  return (
    <tr className={className} data-selected={selected === true ? '' : undefined} {...rest}>
      {children}
    </tr>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Renders <th scope="row"> — row header (first cell of a data row). */
  rowHeader?: boolean;
  /** Numeric cell: tabular-nums + end-aligned for column comparison. */
  numeric?: boolean;
}

export function TableCell({ className, rowHeader, numeric, children, ...rest }: TableCellProps) {
  const cls = [styles.dataCell, numeric === true ? styles.dataCellNumeric : undefined, className]
    .filter(Boolean).join(' ');
  if (rowHeader === true) {
    return <th scope="row" className={cls} {...(rest as ThHTMLAttributes<HTMLTableCellElement>)}>{children}</th>;
  }
  return <td className={cls} {...rest}>{children}</td>;
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TableHeaderCell({ className, numeric, children, ...rest }: TableHeaderCellProps) {
  return (
    <th scope="col"
      className={[styles.dataHeadCell, numeric === true ? styles.dataCellNumeric : undefined, className].filter(Boolean).join(' ')}
      {...rest}>
      {children}
    </th>
  );
}
