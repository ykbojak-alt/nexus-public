'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArtPanel, Button, Modal } from '@nexus/ui';
import { greetingOf } from '../greeting';
import { createEmptyProfile, DEFAULT_OPERATOR_NAME } from '../profile/profile-types';
import { saveProfile, useProfile } from '../profile/profile-store';
import { AssistantHero } from './assistant-hero';
import styles from './screens.module.css';

// Статика: dev отдаёт /art/…, AI-2 хост монтирует бандл под /_nexus.
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

const ALICE_PORTRAIT = {
  src: '/art/alice-portrait-gold.webp',
  alt: 'Портрет ассистента AGENT-A — профиль с золотой нейронной короной',
};

/** Директива владельца 02.11: единственный ассистент среды — AGENT-A,
 *  экранов выбора персоны нет. /welcome — приветствие + всплывающее меню
 *  имени оператора (Modal); имя сохраняется в профиль с персоной alice,
 *  дальше — /runtime/alice. */
export function WelcomeScreen() {
  const router = useRouter();
  const { profile, persisted } = useProfile();
  const [name, setName] = useState(profile?.name ?? '');
  const [askName, setAskName] = useState(true);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  const operator = name.trim() || profile?.name?.trim() || DEFAULT_OPERATOR_NAME;

  const start = () => {
    const trimmed = name.trim() || DEFAULT_OPERATOR_NAME;
    saveProfile({
      ...createEmptyProfile(),
      ...(profile ?? {}),
      name: trimmed,
      agentId: 'alice',
      themeId: 'alice',
    });
    router.push('/runtime/alice');
  };

  return (
    <ArtPanel
      className={styles.welcomeRoot}
      art={{ src: `${ASSET_BASE}/art/welcome-backdrop.webp`, loading: 'lazy' }}
      scrim="bottom"
      data-state="ready"
      data-screen="welcome"
    >
      <div className={styles.welcome}>
        <AssistantHero
          assistant="alice"
          mode="AGENT-A"
          portrait={{
            variant: 'figure',
            src: `${ASSET_BASE}${ALICE_PORTRAIT.src}`,
            alt: ALICE_PORTRAIT.alt,
          }}
        >
          <p className={styles.welcomeGreeting} data-testid="welcome-greeting">
            {hour != null ? `${greetingOf(hour)}, ` : null}{operator}
          </p>
          <h1 className={styles.welcomeTitle}>NEXUS AiOS</h1>
          <p className={styles.welcomeSub}>Ваш ассистент и оркестратор — AGENT-A</p>
        </AssistantHero>
        {!askName && (
          <Button variant="primary" size="lg" onClick={() => setAskName(true)}>
            Начать
          </Button>
        )}
      </div>

      {/* Имя оператора — во всплывающем меню поверх приветствия. */}
      <Modal open={askName} onClose={() => setAskName(false)} title="Как вас зовут?">
        <form
          className={styles.welcomeAskForm}
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <p className={styles.emptyHint}>Ассистент по умолчанию — AGENT-A</p>
          <label className={styles.welcomeNameLabel}>
            Имя оператора
            <input
              className={styles.input}
              value={name}
              placeholder={DEFAULT_OPERATOR_NAME}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {!persisted && profile != null && (
            <p className={styles.emptyHint} role="status">
              Хранилище профиля недоступно — профиль живёт в памяти сессии и не сохранится после перезагрузки.
            </p>
          )}
          <Button type="submit" variant="primary" size="lg">
            Начать работу
          </Button>
        </form>
      </Modal>
    </ArtPanel>
  );
}
