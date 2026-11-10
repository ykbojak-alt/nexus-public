'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './models.module.css';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Группа для моделей без префикса провайдера (id без «provider/»). */
export const OTHER_PROVIDER_LABEL = 'без провайдера';

/** Модели OpenCode приходят с префиксом «oc:» (см. settings.tsx). */
export const OPENCODE_PREFIX = 'oc:';

export interface ModelPickerOption {
  id: string;
  label: string;
  /** Провайдер, если хост его сообщил; иначе берётся из префикса id. */
  provider?: string | null;
  /** true — :free-вариант; null — хост не сказал (честное «—»). */
  free?: boolean | null;
  /** Модель по умолчанию на сервере. */
  isDefault?: boolean;
  /** Доп. подпись (контекст, возможности) — показывается справа. */
  hint?: string | null;
}

export interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ModelPickerOption[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  title?: string;
  placeholder?: string;
  emptyText?: string;
  /** Куда писать выбранный id — 'null' означает «серверный дефолт». */
  onSelectDefault?: () => void;
}

/**
 * Провайдер модели. Явное поле важнее разбора id; в остальных случаях
 * провайдер берётся из префикса «provider/model» (формат OpenCode).
 */
export function modelProviderOf(id: string, explicit?: string | null): string {
  const p = explicit?.trim();
  if (p) return p;
  const raw = id.startsWith(OPENCODE_PREFIX) ? id.slice(OPENCODE_PREFIX.length) : id;
  const slash = raw.indexOf('/');
  if (slash > 0) return raw.slice(0, slash);
  return OTHER_PROVIDER_LABEL;
}

/** Модель из каталога OpenCode, а не хоста. */
export function isOpenCodeModel(id: string): boolean {
  return id.startsWith(OPENCODE_PREFIX);
}

/** Поиск: все пробелы-токены должны найтись в id/label/провайдере. */
export function matchesModelQuery(opt: ModelPickerOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${opt.id} ${opt.label} ${opt.provider ?? ''} ${modelProviderOf(opt.id, opt.provider)}`.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

export interface ModelGroup {
  provider: string;
  options: ModelPickerOption[];
}

/** Группировка по провайдеру: провайдеры по алфавиту, «без провайдера» — в конец. */
export function groupModelsByProvider(options: ModelPickerOption[]): ModelGroup[] {
  const map = new Map<string, ModelPickerOption[]>();
  for (const opt of options) {
    const key = modelProviderOf(opt.id, opt.provider);
    const list = map.get(key);
    if (list) list.push(opt);
    else map.set(key, [opt]);
  }
  return [...map.entries()]
    .sort((a, b) => {
      if (a[0] === OTHER_PROVIDER_LABEL) return 1;
      if (b[0] === OTHER_PROVIDER_LABEL) return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([provider, list]) => ({ provider, options: list }));
}

/**
 * Model picker — выбор провайдера и модели в духе OpenCode: поиск, чипы
 * провайдеров, модели сгруппированы по провайдеру, клавиатурная навигация
 * (↑/↓/Home/End/Enter/Esc) и возвра�� фокуса на кнопку-инвокер.
 */
export function ModelPicker({
  open,
  onOpenChange,
  options,
  selectedId,
  onSelect,
  title = 'Модель',
  placeholder = 'Поиск модели…',
  emptyText = 'Модели не найдены',
  onSelectDefault,
}: ModelPickerProps) {
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const groups = useMemo(() => groupModelsByProvider(options), [options]);
  const providers = useMemo(() => groups.map((g) => g.provider), [groups]);

  const visible = useMemo(() => {
    const byProvider = new Map(groups.map((g) => [g.provider, g.options]));
    const out: ModelGroup[] = [];
    for (const g of groups) {
      if (providerFilter != null && g.provider !== providerFilter) continue;
      const filtered = g.options.filter((o) => matchesModelQuery(o, query));
      if (filtered.length > 0) out.push({ provider: g.provider, options: filtered });
    }
    return out;
  }, [groups, providerFilter, query]);

  // Плоский список для клавиатурной навигации (группы идут подряд).
  const flat = useMemo(() => visible.flatMap((g) => g.options), [visible]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    setQuery('');
    setProviderFilter(null);
    // Активной строкой сразу становится выбранная модель (если она в списке).
    const idx = selectedId != null ? flat.findIndex((o) => o.id === selectedId) : -1;
    setActive(idx >= 0 ? idx : 0);
    inputRef.current?.focus();
    const root = dialogRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { lastEl.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { firstEl.focus(); e.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);
    const restore = restoreRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      if (restore instanceof HTMLElement) restore.focus();
    };
    // flat/selectedId — только для стартовой позиции; при открытии окна они
    // актуальны, а внутри сессии позиция считается по текущему списку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const listId = 'nexus-model-picker-list';
  let cursor = -1;

  function pick(option: ModelPickerOption | undefined) {
    if (!option) return;
    onSelect(option.id);
    onOpenChange(false);
  }

  return (
    <div
      className={styles.pickerBackdrop}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div
        ref={dialogRef}
        className={styles.pickerDialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.pickerHead}>
          <span className={styles.pickerTitle}>{title}</span>
          <input
            ref={inputRef}
            className={styles.pickerInput}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${flat[active].id}` : undefined}
            aria-autocomplete="list"
            aria-label={placeholder}
            placeholder={placeholder}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
              else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, flat.length - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(flat[active]); }
            }}
          />
        </div>

        {providers.length > 1 && (
          <div className={styles.pickerProviders} role="group" aria-label="Провайдер">
            <button
              type="button"
              className={styles.pickerProvider}
              data-active={providerFilter == null || undefined}
              aria-pressed={providerFilter == null}
              onClick={() => { setProviderFilter(null); setActive(0); }}
            >
              все
            </button>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.pickerProvider}
                data-active={providerFilter === p || undefined}
                aria-pressed={providerFilter === p}
                onClick={() => { setProviderFilter(p); setActive(0); }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className={styles.pickerList} role="listbox" id={listId} aria-label={title}>
          {flat.length === 0 && <div className={styles.pickerEmpty}>{emptyText}</div>}
          {visible.map((g) => (
            <div key={g.provider} role="group" aria-label={g.provider} className={styles.pickerGroup}>
              <div className={styles.pickerGroupTitle}>{g.provider}</div>
              {g.options.map((o) => {
                cursor += 1;
                const i = cursor;
                const free = o.free;
                return (
                  <div
                    key={o.id}
                    id={`${listId}-${o.id}`}
                    role="option"
                    aria-selected={o.id === selectedId}
                    className={styles.pickerOption}
                    data-active={i === active || undefined}
                    data-selected={o.id === selectedId || undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  >
                    <span className={styles.pickerOptionMain}>
                      <span className={styles.pickerOptionName}>{o.label}</span>
                      <span className={styles.pickerOptionId}>{o.id}</span>
                    </span>
                    <span className={styles.pickerBadges}>
                      {isOpenCodeModel(o.id) && <span className={styles.pickerBadge}>opencode</span>}
                      {free === true && <span className={styles.pickerBadge} data-free="yes">free</span>}
                      {free === false && <span className={styles.pickerBadge}>платная</span>}
                      {o.isDefault && <span className={styles.pickerBadge}>default</span>}
                      {o.id === selectedId && <span className={styles.pickerBadge} data-current="true">текущая</span>}
                      {o.hint != null && o.hint !== '' && <span className={styles.pickerHint}>{o.hint}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {onSelectDefault && (
          <button
            type="button"
            className={styles.pickerDefault}
            onClick={() => { onSelectDefault(); onOpenChange(false); }}
          >
            Сбросить на серверный дефолт
          </button>
        )}
      </div>
    </div>
  );
}
