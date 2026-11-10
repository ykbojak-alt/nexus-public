'use client';

/**
 * NUE-lite поверхность (NEXT_PUBLIC_NUE_SURFACE=lite): welcome → ввод
 * NUE-ключа → чат только с AGENT-A (composer + RuntimeEcho). Без рейла,
 * топбара и инструментов. Полный продукт остаётся на /home и глубже.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAi2ApiKey, setAi2ApiKey } from '../nue-gateway';
import { getDataSource } from '../data-source';
import { useRuntimeEcho } from '../screens/runtime-echo';
import styles from './lite-shell.module.css';

const NUE_KEY_PATTERN = /^nue_[a-f0-9]+$/i;
const OUT = 'docs/verification/evidence/wave-lite';

export function LiteShell() {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'alice' | 'error'; text: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const installed = getAi2ApiKey() != null;
  const ds = getDataSource();
  const echo = useRuntimeEcho(ds);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const addMessage = useCallback((m: { role: 'user' | 'alice' | 'error'; text: string }) => {
    setChatMessages((prev) => [...prev, m]);
    setTimeout(scrollToBottom, 0);
  }, [scrollToBottom]);

  const saveKey = () => {
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
  };

  const submit = async () => {
    const prompt = task.trim();
    if (!prompt || busy) return;
    addMessage({ role: 'user', text: prompt });
    setBusy(true);
    setError(null);
    try {
      const run = await ds.startRun({
        task: prompt,
        config: 'baseline',
        model: null,
      });
      echo.start(run.runId, run.status, prompt);
      setTask('');
    } catch (err) {
      addMessage({ role: 'error', text: err instanceof Error ? err.message : 'Не удалось запустить задачу.' });
    } finally {
      setBusy(false);
    }
  };

  if (!installed) {
    return (
      <main className={styles.stage} data-screen="lite-welcome">
        <form
          className={styles.card}
          onSubmit={(e) => { e.preventDefault(); saveKey(); }}
          data-testid="lite-welcome"
        >
          <h1 className={styles.title}>AGENT-A</h1>
          <p className={styles.sub}>Упрощённая поверхность: чат с AGENT-A без рейла и инструментов.</p>
          <label className={styles.label} htmlFor="lite-nue-key">NUE-ключ клиента</label>
          <input
            id="lite-nue-key"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            placeholder="nue_<hex>"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); }}}
          />
          <button type="submit" className={styles.primary} disabled={!draft.trim()}>
            Войти
          </button>
          <p className={styles.hint}>Ключ нигде не отображается после сохранения. Полный продукт — на /home.</p>
          {error != null && <p className={styles.error} role="alert">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className={styles.stage} data-screen="lite-chat">
      <div className={styles.chat} data-testid="lite-chat">
        <header className={styles.header}>
          <span className={styles.brand}>AGENT-A</span>
          <span className={styles.status}>{echo.live?.status === 'running' ? 'работаю над задачей' : 'готова помочь'}</span>
        </header>
        <ol className={styles.feed} ref={echo.feedRef}>
          {chatMessages.map((m, idx) => (
            <li key={idx} className={`${styles.bubble} ${m.role === 'user' ? styles.user : m.role === 'alice' ? styles.alice : styles.errorBubble}`}>
              {m.text}
            </li>
          ))}
          {echo.live != null && (
            <>
              {echo.question != null && (
                <li className={`${styles.bubble} ${styles.user}`}>{echo.question}</li>
              )}
              {echo.lines.map((line) => (
                <li key={line.id} className={`${styles.bubble} ${styles.alice}`}>
                  {line.text}
                  {line.count > 1 && <span className={styles.count}> ×{line.count}</span>}
                  {line.excerpt != null && <span className={styles.excerpt}>{line.excerpt}</span>}
                </li>
              ))}
              {echo.answer != null && (
                <li className={`${styles.bubble} ${styles.answer}`}>{echo.answer.body}</li>
              )}
            </>
          )}
          <div ref={chatEndRef} />
        </ol>
        <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <textarea
            className={styles.textarea}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="С чего начнём? Опишите задачу…"
            rows={2}
            aria-label="Текст задачи"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }}}
          />
          <button type="submit" className={styles.primary} disabled={!task.trim() || busy}>
            {busy ? 'Запускаю…' : 'Запустить задачу'}
          </button>
        </form>
      </div>
    </main>
  );
}
