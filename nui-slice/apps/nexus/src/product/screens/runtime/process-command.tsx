'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';

/** Вкладка «Процесс» — панель композитора (вложения, режим, микрофон,
 * контур, fs-регулятор, предпросмотр плана). Выделено из runtime.tsx без
 * смены поведения/testid. */
import { AttachmentList, ErrorState, GlassPanel, Tooltip } from '@nexus/ui';
import { updateProfile } from '../../profile/profile-store';
import { CHAT_COMPACTION_THRESHOLD_MESSAGES } from '../agent-chat-feed';
import { ContextUsageIndicator } from '../context-usage-indicator';
import { ModeSwitch } from '../copilot-widgets';
import { shortcutHint } from '../../keyboard-shortcuts';
import type { ProcessTabCtx } from './use-process-tab';
import styles from '../screens.module.css';
import hintStyles from './process-command-hints.module.css';

/** Пикер модели нужен только после клика по инвокеру — не тянем его
 *  в первый бандл /runtime. Пока чанк едет — скелетон подложки+панели,
 *  чтобы первый клик не выглядел мёртвым. */
const ModelPickerDialog = dynamic(
  () => import('../../model-picker-control').then((mod) => mod.ModelPickerDialog),
  {
    ssr: false,
    loading: () => (
      <div className={styles.pickerSkeletonBackdrop} aria-hidden="true">
        <div className={styles.pickerSkeletonDialog}>
          <div className={styles.pickerSkeletonBar} />
          <div className={styles.pickerSkeletonRow} />
          <div className={styles.pickerSkeletonRow} />
        </div>
      </div>
    ),
  },
);

export function ProcessCommandPanel({ c }: { c: ProcessTabCtx }) {
  const {
    task, setTask, start, onFormKey, attachments, setAttachments, attachInputRef, chat,
    chatCompactionStatus, chatCompactionConfig,
    profile, submitting, run, micState, waveCanvasRef, micReason, toggleMic,
    voiceError, speakText, latestAnswer, contourOpen, setContourOpen, contourRef,
    presets, presetsFailed, loadPresets, models, modelsFailed, loadModels,
    fetchPlan, plan, planFailed, startError, config, agent, router, ds,
    fsMode, fsRoots, fsAddOpen, setFsAddOpen, fsPath, setFsPath, fsAddErr,
    setFsAddErr, fsAddBusy, addFsRoot, fsOpen, setFsOpen, fsRef,
  } = c;
  // Пикер провайдера/модели (по образцу OpenCode) — один диалог на два
  // инвокера: чип в строке мета и кнопка в меню контура.
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const contourGearRef = useRef<HTMLButtonElement | null>(null);
  const selectedModelId = profile?.defaultModelId ?? null;
  const modelLabel = selectedModelId ?? 'default (сервер)';
  return (
    <GlassPanel className={`${styles.panel} ${styles.commandPanel}`}>
      <form className={styles.commandForm} onSubmit={start} onKeyDown={onFormKey}>
        {/* Вложения (NUE1): имена файлов verbatim → #path-упоминания
                в тексте задачи; снятие крестом до отправки. */}
        <AttachmentList
          items={attachments}
          onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />
        {/* Режим композитора agent|ask|plan (NUE1) — намерение
                пользователя в профиле; поля mode у RunIn хоста нет
                (разрыв W1 — записан в отчёте). */}
        <div className={styles.modeRow}>
          <ModeSwitch
            value={profile?.composerMode ?? 'agent'}
            disabled={submitting || run?.status === 'running'}
            onChange={(m) => updateProfile({ composerMode: m })}
          />
        </div>
        {/* Заполнение до порога компактизации: реальные токены хоста
                (compaction-status сессии + объявленный порог конфига), когда
                их отдаёт завершённый root-прогон; иначе — фактическое число
                сообщений ленты против локального keep-tail. Необъявленный
                хостом порог — честный unavailable, без выдуманного %.
                Токены считаются для сессии активного root — в ленте из
                нескольких независимых прогонов общей сессии нет. */}
        <ContextUsageIndicator
          used={chatCompactionStatus?.usedTokens ?? chat.length}
          total={chatCompactionStatus?.usedTokens != null
            ? chatCompactionStatus.thresholdTokens ?? chatCompactionConfig?.thresholdTokens ?? null
            : CHAT_COMPACTION_THRESHOLD_MESSAGES}
          unit={chatCompactionStatus?.usedTokens != null ? 'tokens' : 'messages'}
          usageMethod={chatCompactionStatus?.usageMethod}
          compacting={chatCompactionStatus?.compaction === 'triggered'}
        />
        <div className={styles.commandRow}>
          {micState === 'recording' ? (
            // Во время записи вместо поля ввода — линия звукозаписи с
            // реальным сигналом микрофона (AnalyserNode на MediaStream).
            <canvas
              ref={waveCanvasRef}
              className={`${styles.commandInput} ${styles.micWave}`}
              role="img"
              aria-label="Идёт запись — линия уровня микрофона"
            />
          ) : (
            <Tooltip className={hintStyles.commandInputHint} content="Вставить новую строку" kbd={shortcutHint('composer.newline')}>
              <textarea
                className={`${styles.textarea} ${styles.commandInput}`}
                placeholder={micState === 'transcribing' ? 'Распознаётся на хосте…' : 'Сообщение для AGENT-A — текст или голос…'}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={2}
                aria-label="Текст задачи"
              />
            </Tooltip>
          )}
          <div className={styles.commandActions}>
            <button
              type="button"
              className={styles.attachOrb}
              aria-label="Прикрепить файлы"
              title="Прикрепить файлы — имена уйдут в задачу как #упоминания"
              onClick={() => attachInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5.8a3 3 0 0 1 6 0v9.4a1.5 1.5 0 0 1-3 0V6.7h-1.2v8.5a2.7 2.7 0 0 0 5.4 0V5.8a4.2 4.2 0 0 0-8.4 0v10.7a5.7 5.7 0 0 0 11.4 0V6.5h-1.2Z" />
              </svg>
            </button>
            <input
              ref={attachInputRef}
              type="file"
              multiple
              hidden
              aria-label="Выбор файлов"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setAttachments((prev) => [
                  ...prev,
                  ...files.map((f, i) => ({
                    id: `${Date.now()}-${i}-${f.name}`,
                    name: f.name,
                    kind: f.type.startsWith('image/') ? 'image' : 'file',
                    meta: f.size > 0 ? `${Math.ceil(f.size / 1024)} КБ` : undefined,
                  })),
                ]);
                e.target.value = '';
              }}
            />
            <Tooltip className={hintStyles.commandSubmitHint} content="Запустить прогон" kbd="Enter">
              <button
                type="submit"
                className={styles.runOrb}
                data-busy={submitting || undefined}
                disabled={!task.trim() || submitting}
                aria-busy={submitting || undefined}
                aria-label="Запустить"
              >
                {submitting ? (
                  <span className={styles.runSpin} aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M8.6 5.9v12.2c0 .9 1 1.5 1.8 1l9.6-6.1a1.2 1.2 0 0 0 0-2l-9.6-6.1a1.2 1.2 0 0 0-1.8 1Z" />
                  </svg>
                )}
              </button>
            </Tooltip>
            <button
              type="button"
              className={styles.micOrb}
              data-state={micState}
              disabled={(micReason != null && micState === 'idle') || micState === 'transcribing'}
              aria-pressed={micState === 'recording'}
              data-recording={micState === 'recording' || undefined}
              aria-label={micState === 'recording' ? 'Стоп' : micState === 'transcribing' ? 'Распознаётся' : 'Голос'}
              title={micState === 'recording'
                ? 'Остановить запись — распознать и запустить прогон'
                : micReason ?? 'Голосовой ввод — распознать и сразу запустить прогон'}
              onClick={() => void toggleMic()}
            >
              {micState === 'recording' ? (
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                  <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" />
                </svg>
              ) : micState === 'transcribing' ? (
                <span className={styles.micSpin} aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M12 3a3 3 0 0 0-3 3v5.5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                  <path fill="currentColor" d="M17.8 11.5a5.8 5.8 0 0 1-11.6 0H4.8a7.2 7.2 0 0 0 6.4 7.1V21h1.6v-2.4a7.2 7.2 0 0 0 6.4-7.1h-1.4Z" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {(startError ?? voiceError) && <p className={styles.error} role="alert">{startError ?? voiceError}</p>}
        <div
          className={styles.planHint}
          data-state={
            ds.previewRunPlan == null
              ? 'unavailable'
              : planFailed
                ? 'error'
                : !task.trim()
                  ? 'empty'
                  : plan == null
                    ? 'loading'
                    : 'ready'
          }
          data-testid="plan-card"
        >
          {ds.previewRunPlan == null ? (
            <span className={styles.commandHint}>
              Предпросмотр плана недоступен — рантайм не предоставляет планировщик.
            </span>
          ) : planFailed ? (
            <ErrorState
              variant="inline"
              title="Не удалось получить план от рантайма."
              onRetry={() => fetchPlan(task.trim())}
              retryLabel="Повторить"
            />
          ) : plan != null ? (
            <span className={styles.commandHint}>
              план: {plan.stages.map((s) => `${s.label}${s.agent ? ` · ${s.agent}` : ''}`).join(' → ')}
              {' · инструменты: '}{plan.tools.length > 0 ? plan.tools.join(' · ') : 'назначит рантайм'}
              {' · '}{plan.limits.maxCostUsd != null ? `≤ $${plan.limits.maxCostUsd.toFixed(2)}` : 'лимит стоимости не задан'}
              {plan.limits.maxDurationS != null ? ` · ≤ ${Math.round(plan.limits.maxDurationS / 60)} мин` : ''}
              {plan.approvalsPlanned ? ' · заявленные инструменты потребуют подтверждений' : ''}
            </span>
          ) : task.trim() ? (
            <span className={styles.commandHint}>Формируется план…</span>
          ) : null}
        </div>
        <div className={styles.listenRow}>
          <button
            type="button"
            className={styles.prefChoice}
            title="Добавить в конец задачи инструкцию делегирования субагентам (spawn_agent/wait_agent)"
            aria-label="Вставить шаблон делегирования субагентам"
            onClick={() => setTask((t) => `${t}${t.trim() === '' ? '' : '\n'}Разбей задачу на подзадачи; каждую поручи субагенту через spawn_agent; собери ответы через wait_agent и сведи итог.`)}
          >
            ⧉ субагентам
          </button>
          {latestAnswer != null && (
            <button
              type="button"
              className={styles.prefChoice}
              disabled={ds.voice == null}
              title={ds.voice == null
                ? 'Голосовой seam недоступен в этом источнике данных'
                : 'Озвучить последний ответ AGENT-A (голос — в Настройках → Runtime)'}
              aria-label="Прослушать последний ответ голосом"
              onClick={() => void speakText(latestAnswer.text, latestAnswer.id)}
            >
              ▶ Слушать ответ
            </button>
          )}
        </div>
        <div className={styles.commandMeta}>
          <span
            className={styles.metaStrip}
            title="Дефолты прогона задаются в Настройках → Runtime"
          >
            <span className={styles.metaField}>
              <span className={styles.metaLabel}>контур</span>
              <span className={styles.metaValue}>{config}</span>
            </span>
            <span className={styles.metaSep} aria-hidden="true" />
            <span className={styles.metaField}>
              <span className={styles.metaLabel}>агент</span>
              <span className={styles.metaValue}>{agent || 'авто'}</span>
            </span>
            <span className={styles.metaSep} aria-hidden="true" />
            <span className={styles.metaField}>
              <span className={styles.metaLabel}>модель</span>
              <button
                type="button"
                className={styles.metaValueModel}
                onClick={() => {
                  if (models == null && !modelsFailed) loadModels();
                  setModelPickerOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={modelPickerOpen}
                title="Выбрать провайдера и модель"
                data-testid="composer-model-trigger"
              >
                {modelLabel}
              </button>
            </span>
          </span>
          {/* fs-access — кнопка в стиле шестерёнки: цвет по режиму
                (off/ro/rw), живая анимация пока доступ открыт. Выпадающее
                меню несёт радио-режим и список корней — режим и корни
                уезжают в fs_policy прогона; без ds.fs-шва добавление
                корня честно недоступно. */}
          <div
            className={styles.fsPick}
            ref={fsRef}
            data-testid="fs-regulator"
            data-state={ds.fs == null ? 'unavailable' : 'ready'}
          >
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.fsBtn}`}
              data-access={fsRoots.length === 0 ? 'off' : fsMode === 'read_write' ? 'rw' : 'ro'}
              aria-label="Доступ AGENT-A к файлам — корни и режим"
              aria-haspopup="dialog"
              aria-expanded={fsOpen}
              title={
                fsRoots.length === 0
                  ? 'Доступ к файлам закрыт — корней нет'
                  : `${fsMode === 'read_write' ? 'Чтение + запись' : 'Только чтение'} · корней: ${fsRoots.length} — нажмите для настройки`
              }
              onClick={() => setFsOpen((o) => !o)}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.1l1.7 2h7.7A2.5 2.5 0 0 1 21 9v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5V8.2c0-.44.18-.86.5-1.2Z"
                  opacity="0.9"
                />
                <path
                  className={styles.fsLock}
                  fill="currentColor"
                  d="M15.2 12.1a2 2 0 0 0-2 2v.9h-.4a.8.8 0 0 0-.8.8v2.6c0 .44.36.8.8.8h4.8a.8.8 0 0 0 .8-.8v-2.6a.8.8 0 0 0-.8-.8h-.4v-.9a2 2 0 0 0-2-2Zm-1.2 2.9v-.9a1.2 1.2 0 1 1 2.4 0v.9Z"
                />
              </svg>
            </button>
            {fsOpen && (
              <div className={`${styles.contourMenu} ${styles.fsMenu}`} role="group" aria-label="Полномочия доступа к файлам">
                <div className={styles.contourMenuTitle}>Доступ к файлам</div>
                <div role="radiogroup" aria-label="Доступ AGENT-A к файлам" className={styles.fsModeList}>
                  <button
                    type="button"
                    role="radio"
                    aria-label="только чтение"
                    aria-checked={fsMode === 'read_only'}
                    className={styles.contourItem}
                    data-active={fsMode === 'read_only'}
                    onClick={() => updateProfile({ fsMode: 'read_only' })}
                  >
                    <span className={styles.contourItemName}>только чтение</span>
                    <span className={styles.contourItemFlags}>запись — через заявки на одобрение</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-label="чтение+запись"
                    aria-checked={fsMode === 'read_write'}
                    className={styles.contourItem}
                    data-active={fsMode === 'read_write'}
                    onClick={() => updateProfile({ fsMode: 'read_write' })}
                  >
                    <span className={styles.contourItemName}>чтение+запись</span>
                    <span className={styles.contourItemFlags}>прямая запись в перечисленные корни</span>
                  </button>
                </div>
                <div className={styles.contourMenuTitle}>Корни</div>
                <div className={styles.fsMenuRoots}>
                  <span
                    className={styles.fsRoots}
                    title={fsRoots.length > 0 ? fsRoots.map((r) => r.path).join('\n') : 'корни доступа не заданы'}
                  >
                    корней: {fsRoots.length}
                  </span>
                  {fsRoots.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={styles.fsRootChip}
                      title={`${r.path} — убрать из списка`}
                      aria-label={`Убрать корень ${r.id}`}
                      onClick={() => updateProfile({ fsRoots: fsRoots.filter((x) => x.id !== r.id) })}
                    >
                      {r.id} ×
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.prefChoice}
                    disabled={ds.fs == null}
                    title={ds.fs == null
                      ? 'Проверка пути недоступна — источник данных без fs-контура'
                      : 'Добавить корень доступа (путь проверяется хостом)'}
                    onClick={() => { setFsAddOpen((o) => !o); setFsAddErr(null); }}
                  >
                    + папка
                  </button>
                  {fsRoots.length > 0 && (
                    <button
                      type="button"
                      className={styles.prefChoice}
                      title="Убрать все корни — прогон уйдёт без fs_policy, доступ закрыт"
                      onClick={() => updateProfile({ fsRoots: [] })}
                    >
                      закрыть доступ
                    </button>
                  )}
                </div>
                {fsAddOpen && ds.fs != null && (
                  <span className={styles.fsAdd}>
                    <input
                      className={styles.fsPath}
                      value={fsPath}
                      onChange={(e) => setFsPath(e.target.value)}
                      placeholder="D:/path/to/root"
                      aria-label="Путь корня доступа"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void addFsRoot(); }
                      }}
                    />
                    <button
                      type="button"
                      className={styles.prefChoice}
                      disabled={fsAddBusy || !fsPath.trim()}
                      onClick={() => void addFsRoot()}
                    >
                      {fsAddBusy ? 'Проверка…' : 'Добавить'}
                    </button>
                  </span>
                )}
                {ds.fs == null && (
                  <span className={styles.fsHint}>fs-контур недоступен в этом источнике — корни сохранятся для live-рантайма</span>
                )}
                {fsAddErr && <span className={styles.error} role="alert">{fsAddErr}</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.voiceToggle}`}
            data-on={profile?.voiceAutoSpeak === true}
            aria-pressed={profile?.voiceAutoSpeak === true}
            aria-label={profile?.voiceAutoSpeak === true ? 'Выключить авто-озвучку ответов' : 'Включить авто-озвучку ответов'}
            disabled={ds.voice == null}
            title={ds.voice == null
              ? 'Голосовой seam недоступен в этом источнике данных'
              : 'Авто-озвучка ответа завершённого прогона (голос — в Настройках → Runtime)'}
            onClick={() => updateProfile({ voiceAutoSpeak: profile?.voiceAutoSpeak !== true })}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3Z" />
              <path className={styles.spkWave1} fill="currentColor" d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Z" />
              <path className={styles.spkWave2} fill="currentColor" d="M14 3.2v2.1c2.9.9 5 3.6 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8Z" />
              <line className={styles.spkMute} x1="4.5" y1="3.5" x2="21" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <div className={styles.contourPick} ref={contourRef}>
              <button
              ref={contourGearRef}
              type="button"
              className={`${styles.iconBtn} ${styles.settingsGear}`}
              aria-label="Быстрый выбор контура и модели прогона"
              aria-haspopup="dialog"
              aria-expanded={contourOpen}
              title="Контур и модель — быстрый выбор; все дефолты — в Настройках → Runtime"
              onClick={() => {
                const next = !contourOpen;
                setContourOpen(next);
                if (next && presets == null && !presetsFailed) loadPresets();
                if (next && models == null && !modelsFailed) loadModels();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                setContourOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
                />
              </svg>
            </button>
            {contourOpen && (
              // Два независимых столбца: выбор в одном не закрывает меню —
              // контур и модель подбираются за одно открытие.
              <div
              className={styles.contourMenu}
              role="group"
              aria-label="Контур и модель прогона"
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                setContourOpen(false);
                contourGearRef.current?.focus();
              }}
            >
                <div className={styles.contourCols}>
                  <div className={styles.contourCol} role="listbox" aria-label="Контур прогона" data-preset-strip>
                    <div className={styles.contourMenuTitle}>Контур</div>
                    {presets == null && !presetsFailed && (
                      <div className={styles.contourNote}>Загрузка контуров с хоста…</div>
                    )}
                    {presetsFailed && (
                      <button type="button" className={styles.contourRetry} onClick={loadPresets}>
                        Список не загрузился — повторить
                      </button>
                    )}
                    {presets?.map((p) => {
                      const flags = Object.keys(p.flags).filter((k) => p.flags[k]);
                      return (
                        <button
                          key={p.name}
                          type="button"
                          role="option"
                          aria-selected={config === p.name}
                          className={styles.contourItem}
                          data-active={config === p.name}
                          onClick={() => updateProfile({ defaultPreset: p.name })}
                        >
                          <span className={styles.contourItemName}>{p.name}</span>
                          <span className={styles.contourItemFlags}>
                            {p.description ?? (flags.length > 0 ? flags.join(' · ') : 'базовый контур')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.contourCol} aria-label="Модель прогона">
                    <div className={styles.contourMenuTitle}>Модель</div>
                    {models == null && !modelsFailed && (
                      <div className={styles.contourNote}>Загрузка моделей с хоста…</div>
                    )}
                    {modelsFailed && (
                      <button type="button" className={styles.contourRetry} onClick={loadModels}>
                        Список не загрузился — повторить
                      </button>
                    )}
                    {/* Выбор провайдера и модели — общий пикер (по образцу
                            OpenCode): поиск, группировка по провайдеру. */}
                    <button
                      type="button"
                      className={styles.contourItem}
                      onClick={() => setModelPickerOpen(true)}
                      aria-haspopup="dialog"
                      aria-expanded={modelPickerOpen}
                      data-testid="contour-model-trigger"
                    >
                      <span className={styles.contourItemName}>{modelLabel}</span>
                      <span className={styles.contourItemFlags}>провайдер и модель…</span>
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.contourSettings}
                  onClick={() => {
                    setContourOpen(false);
                    router.push('/settings');
                  }}
                >
                  Все настройки рантайма…
                </button>
              </div>
            )}
          </div>
          <span className={styles.commandHint}>Enter — запуск · Ctrl+Enter — новая строка · Esc — отмена</span>
        </div>
      </form>
      {/* Пикер провайдера/модели — вне попапа контура, чтобы не резался
              overflow меню. Монтируется только по открытию: чанк качается
              в момент клика (скелетон виден лишь там), без SSR-вспышки. */}
      {modelPickerOpen ? (
        <ModelPickerDialog
          open={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          models={models}
          selectedId={selectedModelId}
          onSelect={(id) => updateProfile({ defaultModelId: id })}
        />
      ) : null}
    </GlassPanel>
  );
}
