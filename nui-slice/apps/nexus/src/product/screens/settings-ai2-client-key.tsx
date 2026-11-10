'use client';

import { useState } from 'react';
import { getAi2ApiKey, setAi2ApiKey } from '../nue-gateway';
import styles from './screens.module.css';

const NUE_KEY_PATTERN = /^nue_[a-f0-9]+$/i;

/**
 * Settings-компонент: безопасный ввод scoped NUE-ключа (`nue_<hex>`).
 * - Ключ хранится в localStorage `nexus.ai2.apiKey` (через get/setAi2ApiKey).
 * - Никогда не отображается после сохранения (поле очищается).
 * - Валидация только `^nue_[a-f0-9]+$`.
 * - Никакого вывода ключа в DOM/логи/отчёт.
 */
export function Ai2ClientKeySettings() {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const installed = getAi2ApiKey() != null;

  const save = () => {
    const value = draft.trim();
    if (!value) {
      setError('Введите ключ в формате nue_<hex>');
      return;
    }
    if (!NUE_KEY_PATTERN.test(value)) {
      setError('Неверный формат: требуется nue_<hex> (латиница, цифры)');
      return;
    }
    setAi2ApiKey(value);
    setDraft('');
    setError(null);
    setJustSaved(true);
  };

  const remove = () => {
    setAi2ApiKey(null);
    setDraft('');
    setError(null);
    setJustSaved(false);
  };

  return (
    <div className={styles.prefRow} data-testid="settings-ai2-client-key">
      <label className={styles.prefLabel} htmlFor="ai2-client-key-input">Ключ клиента AI-2 (NUE)</label>
      <span className={styles.prefChoices}>
        <input
          id="ai2-client-key-input"
          className={styles.input}
          type="password"
          autoComplete="new-password"
          placeholder={installed ? 'Ключ установлен — введите новый для замены' : 'nue_<hex>'}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setJustSaved(false); }}
          aria-describedby="ai2-client-key-hint"
        />
        <button type="button" className={styles.prefChoice} onClick={save} disabled={!draft.trim()}>
          Сохранить
        </button>
        {installed && (
          <button type="button" className={styles.prefChoice} onClick={remove}>
            Удалить
          </button>
        )}
      </span>
      <p id="ai2-client-key-hint" className={styles.emptyHint}>
        {installed
          ? 'Статус: установлен (локально, в браузере).'
          : 'Статус: не задан.'}
        {' Ключ нигде не отображается после сохранения. Формат: nue_<hex>.'}
        {justSaved && !error && ' Сохранено.'}
        {error && <strong className={styles.error}> {error}</strong>}
      </p>
    </div>
  );
}
