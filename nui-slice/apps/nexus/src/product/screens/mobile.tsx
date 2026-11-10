'use client';

/**
 * НУЕ /mobile — отдельный мобильный шелл (не адаптив основного):
 * welcome → NUE-ключ → composer-first чат с AGENT-A + запуск задач,
 * bottom-nav вместо рейла (<420px). База — стабы D:\Temp\ace-nue-android
 * (touch-pass CSS, gap-спеки): 360px-база, hover-guards, тач-таргеты ≥44px.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAi2ApiKey, setAi2ApiKey } from '../nue-gateway';
import { useDataSource, getDataSourceKind } from '../data-source';
import { useRuntimeEcho } from './runtime-echo';
import styles from './mobile.module.css';

const NUE_KEY_PATTERN = /^nue_[a-f0-9]+$/i;

type MobileTab = 'dialog' | 'tasks' | 'desktop' | 'settings';

const TABS: { id: MobileTab; label: string; icon: string; disabled?: boolean; href?: string }[] = [
  { id: 'dialog', label: 'Диалог', icon: '✉', disabled: false },
  { id: 'tasks', label: 'Задачи', icon: '▶', disabled: true },
  { id: 'desktop', label: 'Десктоп', icon: '⛶', disabled: false, href: '/home' },
  { id: 'settings', label: 'Настройки', icon: '⚙', disabled: false, href: '/settings' },
];

export function MobileShell() {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'alice' | 'error'; text: string }[]>([]);
  const [activeTab, setActiveTab] = useState<MobileTab>('dialog');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const ds = useDataSource();
  const echo = useRuntimeEcho(ds);
  const installed = getAi2ApiKey() != null;
  const sourceKind = useSourceKindLabel();

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const addMessage = useCallback((m: { role: 'user' | 'alice' | 'error'; text: string }) => {
    setMessages((prev) => [...prev, m]);
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

  const disconnect = () => {
    setAi2ApiKey(null);
    setMessages([]);
    echo.close();
    setError(null);
  };

  const submit = async () => {
    const prompt = task.trim();
    if (!prompt || busy) return;
    addMessage({ role: 'user', text: prompt });
    setBusy(true);
    setError(null);
    try {
      const run = await ds.startRun({ task: prompt, config: 'baseline', model: null });
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
      <main className={styles.stage} data-screen="mobile-welcome">
        <form
          className={styles.card}
          onSubmit={(e) => { e.preventDefault(); saveKey(); }}
          data-testid="mobile-welcome"
        >
          <h1 className={styles.title}>AGENT-A</h1>
          <p className={styles.sub}>
            Мобильная панель: чат и запуск задач. Телефон — компаньон к вашему
            NUE Desktop, пейринг по NUE-ключу.
          </p>
          <label className={styles.label} htmlFor="mobile-nue-key">NUE-ключ клиента</label>
          <input
            id="mobile-nue-key"
            className={styles.input}
            type="password"
            inputMode="text"
            autoComplete="new-password"
            placeholder="nue_<hex>"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            data-testid="mobile-key-input"
          />
          <button type="submit" className={styles.primary} disabled={!draft.trim()} data-testid="mobile-key-submit">
            Подключиться
          </button>
          <p className={styles.hint}>Ключ нигде не отображается после сохранения.</p>
          {error != null && (
            <p className={styles.error} role="alert">{error}</p>
          )}
        </form>
        <nav className={styles.bottomNav} aria-label="Мобильная навигация" data-testid="mobile-nav">
          {TABS.map((t) => (
            <BottomNavItem key={t.id} tab={t} active={false} />
          ))}
        </nav>
      </main>
    );
  }

  return (
    <main className={styles.stage} data-screen="mobile-chat">
      <header className={styles.chatHeader} data-testid="mobile-pairing-status">
        <span className={styles.brand}>AGENT-A</span>
        <span
          className={styles.source}
          data-mock={sourceKind === 'mock' ? 'true' : undefined}
          role="status"
        >
          {sourceKind === 'mock' ? 'MOCK-данные' : 'LIVE'}
        </span>
        <button type="button" className={styles.disconnect} onClick={disconnect} data-testid="mobile-disconnect">
          Отключиться
        </button>
      </header>

      <ol className={styles.feed} ref={echo.feedRef} data-testid="mobile-chat">
        {messages.map((m, idx) => (
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

      <form className={styles.composer} data-testid="mobile-composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <textarea
          className={styles.textarea}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Опишите задачу…"
          rows={2}
          aria-label="Текст задачи"
          data-testid="mobile-composer-input"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
        />
        <button type="submit" className={styles.primary} disabled={!task.trim() || busy} data-testid="mobile-submit">
          {busy ? 'Запускаю…' : 'Запустить'}
        </button>
      </form>

      <nav className={styles.bottomNav} aria-label="Мобильная навигация" data-testid="mobile-nav">
        {TABS.map((t) => (
          <BottomNavItem key={t.id} tab={t} active={t.id === activeTab} />
        ))}
      </nav>
    </main>
  );
}

function BottomNavItem({ tab, active }: { tab: (typeof TABS)[number]; active: boolean }) {
  if (tab.disabled) {
    return (
      <button
        type="button"
        className={styles.navItem}
        data-tab={tab.id}
        aria-disabled="true"
        title="Появится в следующей волне"
      >
        <span aria-hidden="true">{tab.icon}</span>
        <span>{tab.label}</span>
      </button>
    );
  }
  if (tab.href != null) {
    return (
      <a className={styles.navItem} href={tab.href} data-tab={tab.id}>
        <span aria-hidden="true">{tab.icon}</span>
        <span>{tab.label}</span>
      </a>
    );
  }
  return (
    <button type="button" className={styles.navItem} data-tab={tab.id} aria-current={active ? 'page' : undefined}>
      <span aria-hidden="true">{tab.icon}</span>
      <span>{tab.label}</span>
    </button>
  );
}

function useSourceKindLabel(): 'mock' | 'live' {
  const [kind, setKind] = useState<'mock' | 'live'>('mock');
  useEffect(() => {
    setKind(getDataSourceKind());
  }, []);
  return kind;
}
