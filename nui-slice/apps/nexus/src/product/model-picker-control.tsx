'use client';

/**
 * Обвязка пикера моделей для экранов продукта: единый источник опций
 * (каталог хоста + модели OpenCode) и кнопка-инвокер.
 *
 * Сам пикер — паттерн @nexus/patterns (ModelPicker): поиск, чипы провайдеров,
 * группировка по провайдеру, клавиатурная навигация (по образцу OpenCode).
 */
import { useMemo, useState } from 'react';
import { ModelPicker, type ModelPickerOption } from '@nexus/patterns';
import type { ModelInfo } from '@nexus/mock-data';

export interface OpenCodeModelLike {
  id: string;
  name: string;
  provider?: string;
}

/** Модели OpenCode получают префикс «oc:» — по нему их видно в общем списке. */
export const OPENCODE_MODEL_PREFIX = 'oc:';

/** Хост-модели + модели OpenCode → опции пикера. */
export function toModelPickerOptions(
  models: ModelInfo[] | null | undefined,
  ocModels: OpenCodeModelLike[] = [],
): ModelPickerOption[] {
  const host: ModelPickerOption[] = (models ?? []).map((m) => ({
    id: m.id,
    label: m.label,
    free: m.free,
    isDefault: m.isDefault,
  }));
  const opencode: ModelPickerOption[] = ocModels.map((m) => ({
    id: `${OPENCODE_MODEL_PREFIX}${m.id}`,
    label: m.provider ? `${m.name} · ${m.provider}` : m.name,
    provider: m.provider ?? null,
    free: null,
    isDefault: false,
  }));
  return [...host, ...opencode];
}

/** Только диалог пикера — когда инвокеров несколько (композер: чип + меню). */
export function ModelPickerDialog({
  open,
  onOpenChange,
  models,
  ocModels,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[] | null;
  ocModels?: OpenCodeModelLike[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const options = useMemo(() => toModelPickerOptions(models, ocModels), [models, ocModels]);
  return (
    <div>
      <ModelPicker
          open={open}
          onOpenChange={onOpenChange}
          options={options}
          selectedId={selectedId}
          onSelect={(id) => onSelect(id)}
          onSelectDefault={selectedId != null ? () => onSelect(null) : undefined}
        />
      </div>
  );
}

export interface ModelPickerControlProps {
  models: ModelInfo[] | null;
  ocModels?: OpenCodeModelLike[];
  /** null = серверный дефолт («default»). */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Класс кнопки-инвокера (стиль задаёт экран). */
  className?: string;
  /** Текст кнопки; по умолчанию — id выбранной модели. */
  label?: string;
  title?: string;
  disabled?: boolean;
  testId?: string;
  /** Управление открытием снаружи (если состояние живёт в экране). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Кнопка + диалог пикера. Если `open`/`onOpenChange` не заданы, состояние
 * держится внутри компонента.
 */
export function ModelPickerControl({
  models,
  ocModels,
  selectedId,
  onSelect,
  className,
  label,
  title,
  disabled,
  testId,
  open: openProp,
  onOpenChange,
}: ModelPickerControlProps) {
  const [openLocal, setOpenLocal] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openLocal;
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenLocal(next);
    onOpenChange?.(next);
  };
  const options = useMemo(() => toModelPickerOptions(models, ocModels), [models, ocModels]);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        data-model-hint
        data-testid={testId ?? 'model-picker-trigger'}
      >
        {label ?? selectedId ?? 'default (сервер)'}
      </button>
      {open && (
        <div data-testid="model-picker">
          <ModelPicker
            open={open}
            onOpenChange={setOpen}
            options={options}
            selectedId={selectedId}
            onSelect={(id) => onSelect(id)}
            onSelectDefault={selectedId != null ? () => onSelect(null) : undefined}
          />
        </div>
      )}
    </>
  );
}
