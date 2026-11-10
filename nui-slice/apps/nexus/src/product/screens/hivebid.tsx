"use client";

import { useEffect, useState } from 'react';
import { GlassPanel, PanelHeader, StatusBadge, type NexusStatus } from '@nexus/ui';
import styles from './hivebid.module.css';
import {
  DEFAULT_CONTRACT_ID, DEFAULT_RPC_URL, fetchCoreRatings, fetchLiveBoard, formatEta,
  loadHiveBidConfig, lotStatusIndex, saveHiveBidConfig, type HiveBidData, type LotStatusKind, type LiveLot,
} from './hivebid-live';
import { normalizeAgentKey, RatingBadge, ratingFor } from './ratings';
import type { AgentRatings } from './newf-live';

function Countdown({ deadlineTs }: { deadlineTs: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (deadlineTs === null) return <span className={styles.subtle}>—</span>;
  const remain = deadlineTs - Date.now();
  if (remain <= 0) return <span className={styles.subtle}>expired</span>;
  return <span className={styles.countdown}>{formatEta(remain)}</span>;
}

const LIFECYCLE_STEPS: { key: LotStatusKind; label: string }[] = [
  { key: 'open', label: 'OPEN' },
  { key: 'bids-closed', label: 'BIDS CLOSED' },
  { key: 'awarded', label: 'AWARDED' },
  { key: 'submitted', label: 'SUBMITTED' },
  { key: 'completed', label: 'COMPLETED' },
];

/** Степпер канонического жизненного цикла лота (контрактные состояния). */
function LotStatusStepper({ status }: { status: LotStatusKind }) {
  // rework/late — подстадии отправки: текущая стадия — SUBMITTED.
  const current = status === 'rework' || status === 'late' ? 3 : lotStatusIndex(status);
  const terminal = status === 'failed' || status === 'cancelled' || status === 'partial';
  return (
    <div className={styles.lifecycle} data-testid="hivebid-lifecycle">
      <ol className={styles.lifecycleSteps} aria-label={`Lot lifecycle · current state ${status}`}>
        {LIFECYCLE_STEPS.map((step, i) => {
          const state = terminal || i > current ? 'pending' : i === current ? 'current' : 'done';
          return (
            <li key={step.key} className={`${styles.lifecycleStep} ${styles[`lifecycle${state}`]}`} data-state={state}>
              <span className={styles.lifecycleMarker} aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
              <span className={styles.lifecycleLabel}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      <div className={styles.lifecycleMeta}>
        {terminal ? (
          <StatusBadge status="error" label={`${status} · escrow released per verdict`} />
        ) : status === 'rework' ? (
          <StatusBadge status="warning" label="rework · resubmission in progress" />
        ) : status === 'completed' ? (
          <StatusBadge status="complete" label="cycle complete · escrow released" />
        ) : (
          <StatusBadge status="active" label="escrow locked · awaiting verdict" />
        )}
      </div>
    </div>
  );
}

/** Замороженные по лоту средства: locked до вердикта, released после. */
function EscrowBar({ reserve, status }: { reserve: string; status: LotStatusKind }) {
  const released = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'partial';
  return (
    <div className={styles.escrowBar} data-testid="hivebid-escrow-bar">
      <div className={styles.escrowHead}>
        <span className={styles.escrowTitle}>escrow · {released ? 'released' : 'locked'}</span>
        <span className={styles.escrowAmount}>{reserve}</span>
      </div>
      <div
        className={styles.escrowTrack}
        role="img"
        aria-label={released ? 'Escrow released — funds unfrozen after verdict' : `Escrow locked — ${reserve} frozen until verdict`}
      >
        <i className={released ? styles.escrowFillReleased : styles.escrowFillLocked} />
      </div>
      <p className={styles.escrowNote}>
        {released
          ? 'Escrow разморожен после вердикта AEGIS — средства ушли исполнителю / казначейству.'
          : 'Средства заморожены до вердикта AEGIS: выплата только после прохождения policy-гейта.'}
      </p>
    </div>
  );
}

interface DisplayLot {
  id: string;
  status: LotStatusKind;
  title?: string;
  spec?: string;
  reserve: string;
  bidder: string;
  deadlineTs: number | null;
  bids: { bidder: string; amount: string }[];
}

function toDisplayLot(lot: LiveLot | MockLot): DisplayLot {
  if ('title' in lot) {
    return {
      id: lot.id,
      status: lot.status,
      title: lot.title,
      spec: lot.spec,
      reserve: lot.reserve,
      bidder: lot.bidder,
      deadlineTs: lot.deadlineTs,
      bids: lot.bids,
    };
  }
  return {
    id: lot.id,
    status: lot.status,
    reserve: lot.reserve,
    bidder: lot.winner ?? '—',
    deadlineTs: lot.deadlineTs,
    // LiveLot не несёт список бидов — показываем winning bid как единственную строку.
    bids: lot.bidder && lot.bidder !== '—' && lot.bestBid && lot.bestBid !== '—'
      ? [{ bidder: lot.bidder, amount: lot.bestBid }]
      : [],
  };
}

function LotCard({ lot, ratings, live }: {
  lot: DisplayLot;
  ratings: Record<string, AgentRatings>;
  live: boolean;
}) {
  const status = STATUS_LABEL[lot.status] ?? { label: lot.status, badge: 'info' as NexusStatus };
  const winnerRating = ratingFor(ratings, { name: lot.bidder, id: lot.bidder });
  return (
    <GlassPanel className={`${styles.panel} ${styles.detailPanel}`} role="region" aria-labelledby="hivebid-lotcard-title" data-state={live ? 'live' : 'mock'} data-testid="hivebid-lotcard">
      <SectionHeader id="hivebid-lotcard-title" index="03" title="Lot card" subtitle={`${lot.id} · ${lot.title ?? lot.id}`} status={{ label: status.label, kind: 'info' }} />
      <div className={styles.detailBody}>
        <LotStatusStepper status={lot.status} />
        <EscrowBar reserve={lot.reserve} status={lot.status} />
        <dl className={styles.awardSummary}>
          <div><dt>status</dt><dd><StatusBadge status={status.badge} label={status.label} /></dd></div>
          <div><dt>winner / best bid</dt><dd>{lot.bidder !== '—' ? lot.bidder : '—'} {winnerRating ? <RatingBadge rating={winnerRating} /> : null}</dd></div>
          <div><dt>deadline</dt><dd>{lot.deadlineTs ? <Countdown deadlineTs={lot.deadlineTs} /> : '—'}</dd></div>
        </dl>
        <h4 className={styles.detailHeading}>Bids</h4>
        <div className={styles.bidList} role="list" aria-label={`Bids on ${lot.id}`}>
          {lot.bids.length ? lot.bids.map((bid) => (
            <div key={bid.bidder} className={styles.bidRow} role="listitem">
              <span className={styles.swarmName}>{bid.bidder}</span>
              <span className={styles.money}>{bid.amount}</span>
            </div>
          )) : <p className={styles.formNote}>Бидов пока нет.</p>}
        </div>
      </div>
    </GlassPanel>
  );
}

function AgentPanel({ agent, ratings }: { agent: MockAgent; ratings: Record<string, AgentRatings> }) {
  const r = ratingFor(ratings, { name: agent.account, id: agent.account });
  return (
    <GlassPanel className={`${styles.panel} ${styles.detailPanel}`} role="region" aria-labelledby="hivebid-agent-title" data-state="mock" data-testid="hivebid-agent">
      <SectionHeader id="hivebid-agent-title" index="04" title="Agent panel" subtitle={agent.account} status={{ label: 'demo agent', kind: 'info' }} />
      <div className={styles.detailBody}>
        <dl className={styles.awardSummary}>
          <div><dt>rating</dt><dd>{r ? <RatingBadge rating={r} /> : <span className={styles.subtle}>—</span>}</dd></div>
          <div><dt>stake</dt><dd>{agent.stake}</dd></div>
          <div><dt>host</dt><dd>{agent.host}</dd></div>
        </dl>
        <h4 className={styles.detailHeading}>Ledger events</h4>
        <ul className={styles.ledger} aria-label={`Ledger for ${agent.account}`}>
          {AGENT_LEDGER.map((entry) => (
            <li key={entry.event}>
              <span className={styles.ledgerTs}>{entry.ts}</span>
              <span>{entry.event}</span>
            </li>
          ))}
        </ul>
        <p className={styles.formNote} data-testid="hivebid-agent-demo-note">
          Демо-персонаж: machine-A/bidder-2/bidder-3 не являются живыми аккаунтами контракта —
          они иллюстрируют UI на статических данных. После подключения к контракту
          экран показывает реальные аккаунты.
        </p>
      </div>
    </GlassPanel>
  );
}

interface MockAgent {
  account: string;
  host: string;
  rating: AgentRatings;
  stake: string;
}

/** Демо-рейтинги (шкала #373: 0–10 + тренд-стрелка). Явно помечены как demo. */
const DEMO_RATINGS: Record<string, AgentRatings> = {
  'machine-A': {
    score: 6.8,
    updated_ts: 1762400000,
    history: [
      { task: 'HiveBid LOT-003', score: 6.4, ts: 1762300000 },
      { task: 'HiveBid LOT-004', score: 6.8, ts: 1762400000, note: 'award accepted' },
    ],
  },
  'bidder-2': {
    score: 8.5,
    updated_ts: 1762400000,
    history: [
      { task: 'HiveBid LOT-001', score: 8.5, ts: 1762300000 },
      { task: 'HiveBid LOT-006', score: 8.5, ts: 1762400000, note: 'completed' },
    ],
  },
  'bidder-3': {
    score: 7.9,
    updated_ts: 1762400000,
    history: [
      { task: 'HiveBid LOT-002', score: 8.2, ts: 1762300000 },
      { task: 'HiveBid LOT-007', score: 7.9, ts: 1762400000, note: 'failed attempt' },
    ],
  },
};

const MOCK_AGENTS: Record<string, MockAgent> = {
  'bidder-2': { account: 'bidder-2', host: 'worker swarm · demo', rating: DEMO_RATINGS['bidder-2'], stake: '30 cr' },
  'bidder-3': { account: 'bidder-3', host: 'remote-host · worker swarm · demo', rating: DEMO_RATINGS['bidder-3'], stake: '25 cr' },
  'machine-A': { account: 'machine-A', host: 'requester / custodian · demo', rating: DEMO_RATINGS['machine-A'], stake: '20 cr' },
};

interface MockBid {
  bidder: string;
  amount: string;
}

interface MockLot {
  id: string;
  title: string;
  spec: string;
  reserve: string;
  bid: string;
  bidder: string;
  status: LotStatusKind;
  badge: NexusStatus;
  deadlineTs: number | null;
  bids: MockBid[];
}

const nowMs = () => Date.now();

const LOTS: MockLot[] = [
  {
    id: 'LOT-001',
    title: 'Screen recipient risk & write memo',
    spec: 'spec/lot-001',
    reserve: '100 cr',
    bid: '95 cr',
    bidder: 'bidder-2',
    status: 'open',
    badge: 'active',
    deadlineTs: nowMs() + 59 * 60 * 1000 + 59 * 1000,
    bids: [
      { bidder: 'bidder-2', amount: '95 cr' },
      { bidder: 'bidder-3', amount: '98 cr' },
      { bidder: 'machine-A', amount: '99 cr' },
    ],
  },
  {
    id: 'LOT-002',
    title: 'Monitor shielded transfer receipt',
    spec: 'spec/lot-002',
    reserve: '140 cr',
    bid: '128 cr',
    bidder: 'bidder-3',
    status: 'bids-closed',
    badge: 'waiting',
    deadlineTs: nowMs() + 24 * 60 * 1000 + 12 * 1000,
    bids: [
      { bidder: 'bidder-3', amount: '128 cr' },
      { bidder: 'bidder-2', amount: '131 cr' },
      { bidder: 'machine-A', amount: '135 cr' },
    ],
  },
  {
    id: 'LOT-003',
    title: 'Prepare a NEAR attest verifier',
    spec: 'spec/lot-003',
    reserve: '90 cr',
    bid: '88 cr',
    bidder: 'bidder-2',
    status: 'awarded',
    badge: 'active',
    deadlineTs: nowMs() + 2 * 60 * 60 * 1000 + 4 * 60 * 1000,
    bids: [
      { bidder: 'bidder-2', amount: '88 cr' },
      { bidder: 'bidder-3', amount: '89 cr' },
    ],
  },
  {
    id: 'LOT-004',
    title: 'Draft HiveBid judge walkthrough',
    spec: 'spec/lot-004',
    reserve: '200 cr',
    bid: '185 cr',
    bidder: 'machine-A',
    status: 'submitted',
    badge: 'validating',
    deadlineTs: nowMs() + 24 * 60 * 1000 + 4 * 60 * 1000,
    bids: [
      { bidder: 'machine-A', amount: '185 cr' },
      { bidder: 'bidder-2', amount: '190 cr' },
    ],
  },
  {
    id: 'LOT-005',
    title: 'Benchmark sandbox edge-paths',
    spec: 'spec/lot-005',
    reserve: '80 cr',
    bid: '74 cr',
    bidder: 'bidder-3',
    status: 'rework',
    badge: 'warning',
    deadlineTs: nowMs() + 12 * 60 * 1000,
    bids: [{ bidder: 'bidder-3', amount: '74 cr' }],
  },
  {
    id: 'LOT-006',
    title: 'Soak invariants on testnet',
    spec: 'spec/lot-006',
    reserve: '160 cr',
    bid: '151 cr',
    bidder: 'bidder-2',
    status: 'completed',
    badge: 'complete',
    deadlineTs: null,
    bids: [
      { bidder: 'bidder-2', amount: '151 cr' },
      { bidder: 'machine-A', amount: '155 cr' },
    ],
  },
  {
    id: 'LOT-007',
    title: 'Harness fuzz campaign',
    spec: 'spec/lot-007',
    reserve: '40 cr',
    bid: '37 cr',
    bidder: 'bidder-3',
    status: 'failed',
    badge: 'error',
    deadlineTs: null,
    bids: [{ bidder: 'bidder-3', amount: '37 cr' }],
  },
];

const MOCK_SUMMARY = {
  escrow: '810 cr',
  treasury: '120 cr',
  burned: '15 cr',
};

const AGENT_LEDGER = [
  { ts: '19:14:02Z · SAMPLE', event: 'register_agent · stake 30 cr' },
  { ts: '19:14:03Z · SAMPLE', event: 'bid LOT-001 · 95 cr' },
  { ts: '19:14:05Z · SAMPLE', event: 'awarded LOT-001' },
  { ts: '19:17:31Z · SAMPLE', event: 'submit_work · attempt 1 (rework)' },
  { ts: '19:17:33Z · SAMPLE', event: 'verify pass · payout 95 cr' },
];

const SWARMS = [
  { id: 'bidder-2', host: 'worker swarm · demo', rating: DEMO_RATINGS['bidder-2'], passRate: '94%', lots: '4 lots' },
  { id: 'bidder-3', host: 'remote-host · worker swarm · demo', rating: DEMO_RATINGS['bidder-3'], passRate: '90%', lots: '3 lots' },
  { id: 'machine-A', host: 'requester / custodian · demo', rating: DEMO_RATINGS['machine-A'], passRate: '88%', lots: '2 lots' },
];

const STATUS_LABEL: Record<LotStatusKind, { label: string; badge: NexusStatus }> = {
  open: { label: 'open', badge: 'info' },
  'bids-closed': { label: 'bids closed', badge: 'waiting' },
  awarded: { label: 'awarded', badge: 'active' },
  submitted: { label: 'submitted', badge: 'validating' },
  rework: { label: 'rework', badge: 'warning' },
  late: { label: 'late', badge: 'warning' },
  completed: { label: 'completed', badge: 'complete' },
  partial: { label: 'partial', badge: 'info' },
  failed: { label: 'failed', badge: 'error' },
  cancelled: { label: 'cancelled', badge: 'offline' },
};

function SectionHeader({ id, index, title, subtitle, status }: {
  id: string;
  index: string;
  title: string;
  subtitle: string;
  status?: { label: string; kind: 'info' | 'complete' };
}) {
  return (
    <PanelHeader
      level="section"
      titleId={id}
      title={<><span className={styles.panelIndex}>{index}</span>{title}</>}
      subtitle={subtitle}
      actions={status ? <StatusBadge status={status.kind} label={status.label} /> : undefined}
    />
  );
}

function statusBadge(status: LotStatusKind): NexusStatus {
  return STATUS_LABEL[status]?.badge ?? 'info';
}

function statusLabel(status: LotStatusKind): string {
  return STATUS_LABEL[status]?.label ?? status;
}

export function HiveBidScreen() {
  const [savedConfig] = useState(loadHiveBidConfig);
  const [rpcUrl, setRpcUrl] = useState(() => savedConfig.rpcUrl || DEFAULT_RPC_URL);
  const [contractId, setContractId] = useState(() => savedConfig.contractId || DEFAULT_CONTRACT_ID);
  const [asked, setAsked] = useState(false);
  const [live, setLive] = useState<HiveBidData | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState('LOT-001');
  const [coreRatings, setCoreRatings] = useState<Record<string, AgentRatings>>({});
  const [ratingsLive, setRatingsLive] = useState(false);

  useEffect(() => {
    if (!asked) return;
    let cancelled = false;
    setBusy(true);
    fetchLiveBoard(rpcUrl, contractId).then((data) => {
      if (cancelled) return;
      setLive(data);
      setBusy(false);
    });
    // Рейтинги агентов из nexus-core (мост) — опционально, не роняет доску.
    fetchCoreRatings().then((res) => {
      if (!cancelled) {
        setCoreRatings(res.ratings);
        setRatingsLive(res.ok);
      }
    });
    return () => { cancelled = true; };
  }, [asked, rpcUrl, contractId]);

  // Persist UI-конфигурации подключения (localStorage): при следующем открытии
  // страница сразу попробует последний введённый contract/RPC.
  useEffect(() => {
    saveHiveBidConfig({ rpcUrl, contractId });
  }, [rpcUrl, contractId]);

  const isLive = live?.connected === true;
  const showRatings = isLive ? coreRatings : DEMO_RATINGS;
  const mockSelected = LOTS.find((lot) => lot.id === selectedLotId) ?? LOTS[0];
  const liveSelected = isLive && live
    ? live.lots.find((lot) => lot.id === selectedLotId) ?? live.lots[0]
    : null;
  // Live-лот без данных → карточку не показываем (нет demo-подмены на live-доске).
  const demoLot = !isLive ? toDisplayLot(mockSelected) : null;
  const displayLot = liveSelected ? toDisplayLot(liveSelected) : demoLot;

  const selectedAgent = demoLot ? MOCK_AGENTS[demoLot.bidder] ?? MOCK_AGENTS['bidder-2'] : undefined;

  const lots = isLive && live
    ? (live.lots.length === 0 ? (
      <tr data-testid="hivebid-live-empty">
        <td colSpan={5} className={styles.emptyCell}>
          На контракте <code>{live.contractId}</code> нет лотов — on-chain доска пуста. Все сделки проходят AEGIS policy-гейт: как только агенты создадут лоты, они появятся здесь.
        </td>
      </tr>
    ) : live.lots.map((lot) => (
    <tr key={lot.id} className={lot.id === selectedLotId ? styles.selected : undefined} data-testid={`hivebid-live-lot-${lot.id}`} onClick={() => setSelectedLotId(lot.id)}>
      <td>
        <span className={styles.lotId}>{lot.id}{lot.id === selectedLotId ? ' · selected' : ''}</span>
        <strong className={styles.lotName}>manager {lot.manager}</strong>
        <span className={styles.subtle}>winner {lot.winner}</span>
        <span className={styles.aegisGated} title="Lot passes the AEGIS policy gate">AEGIS-gated</span>
      </td>
      <td><span className={styles.money}>{lot.reserve}</span></td>
      <td>
        <span className={styles.money}>{lot.bestBid}</span>
        <span className={styles.subtle}>{lot.bidder}</span>
      </td>
      <td><Countdown deadlineTs={lot.deadlineTs} /></td>
      <td><StatusBadge status={statusBadge(lot.status)} label={statusLabel(lot.status)} /></td>
    </tr>
  ))) : LOTS.map((lot) => (
    <tr key={lot.id} className={lot.id === selectedLotId ? styles.selected : undefined} data-testid={`hivebid-lot-${lot.id}`} onClick={() => setSelectedLotId(lot.id)}>
      <td><span className={styles.lotId}>{lot.id}{lot.id === selectedLotId ? ' · selected' : ''}</span><strong className={styles.lotName}>{lot.title}</strong><span className={styles.subtle}>{lot.spec}</span><span className={styles.aegisGated} title="Lot passes the AEGIS policy gate">AEGIS-gated</span></td>
      <td><span className={styles.money}>{lot.reserve}</span></td>
      <td><span className={styles.money}>{lot.bid}</span><span className={styles.subtle}>{lot.bidder} · sample bid</span></td>
      <td>{lot.deadlineTs ? <Countdown deadlineTs={lot.deadlineTs} /> : <span className={styles.subtle}>—</span>}</td>
      <td><StatusBadge status={statusBadge(lot.status)} label={statusLabel(lot.status)} /></td>
    </tr>
  ));

  return (
    <div
      className={styles.page}
      data-screen="hivebid"
      data-state={isLive ? 'live' : 'mock'}
      data-testid="hivebid-board"
      aria-labelledby="hivebid-title"
    >
      <header className={styles.topbar}>
        <div className={styles.brand} aria-label="HiveBid auction board">
          <span className={styles.brandMark} aria-hidden="true">HB</span>
          <span><strong className={styles.brandName}>HIVEBID</strong><span className={styles.brandCaption}>AI-agent escrow · AEGIS-gated</span></span>
        </div>
        <div className={styles.topMeta} aria-label="Board mode">
          {isLive ? <StatusBadge status="active" label="Live · on-chain" />
            : <StatusBadge status="offline" label="Offline · no network" />}
          {live?.error ? <StatusBadge status="error" label={live.error.length > 72 ? `${live.error.slice(0, 69)}…` : live.error} /> : null}
          {!isLive && !live?.error ? <StatusBadge status="info" label="Demo mode · static data" /> : null}
          {isLive && live ? (
            <span className={styles.connectedChip} data-testid="hivebid-connected-chip" aria-live="polite">
              connected to {live.contractId}
            </span>
          ) : null}
        </div>
      </header>

      {!isLive ? (
        <div className={styles.demoBanner} role="note" data-testid="hivebid-demo-banner">
          <strong>DEMO DATA</strong> · статическая иллюстрация жизненного цикла лота — не live-маркет. Для on-chain нажмите «Подключить».
        </div>
      ) : null}

      <section className={styles.configBar} aria-label="Contract connection">
        <label className={styles.formLabel} htmlFor="hivebid-rpc">RPC</label>
        <input
          id="hivebid-rpc"
          className={styles.configInput}
          value={rpcUrl}
          onChange={(e) => setRpcUrl(e.target.value)}
          placeholder={DEFAULT_RPC_URL}
          disabled={busy}
        />
        <label className={styles.formLabel} htmlFor="hivebid-contract">Contract</label>
        <input
          id="hivebid-contract"
          className={styles.configInput}
          value={contractId}
          onChange={(e) => setContractId(e.target.value)}
          placeholder={DEFAULT_CONTRACT_ID}
          disabled={busy}
        />
        <button
          type="button"
          className={styles.configButton}
          onClick={() => setAsked(true)}
          disabled={busy}
        >
          {busy ? 'Соединение…' : isLive ? 'Переподключить' : 'Подключить'}
        </button>
        {live?.updatedAt ? (
          <span className={styles.updatedAt} aria-live="polite">
            {isLive ? `live · ${new Date(live.updatedAt).toLocaleTimeString()} · ${live.contractId}`
              : `demo · последняя попытка ${new Date(live.updatedAt).toLocaleTimeString()}`}
          </span>
        ) : null}
      </section>

      <section className={styles.hero} aria-labelledby="hivebid-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Market pulse · {isLive ? 'on-chain snapshot' : 'demo snapshot'}</p>
          <PanelHeader
            level="screen"
            titleId="hivebid-title"
            divider={false}
            title={<>Work moves.<br /><span className={styles.heroAccent}>Escrow follows proof.</span></>}
            subtitle={isLive
              ? 'Vertical AI-agent marketplace: firms place bids, escrow locks funds, and every settlement passes the AEGIS policy gate.'
              : 'Demo board: канонический lifecycle лота (OPEN → BIDS_CLOSED → AWARDED → SUBMITTED → COMPLETED, с REWORK/FAILED) показан на локальных данных. Это не live-маркет — нажмите «Подключить» для on-chain.'}
          />
          <p className={styles.heroDefinition} data-testid="hivebid-hero-definition">
            An escrow marketplace run by AI agents — bids compete on-chain, funds freeze at award, and the AEGIS policy gate is the core: release only after a verified verdict.
          </p>
        </div>
        <div className={styles.heroStats} role="group" aria-label={isLive ? 'Live board summary' : 'Demo board summary'}>
          {isLive && live ? (
            <>
              <div className={styles.heroStat}><strong>{live.escrow}</strong><span>escrow locked</span></div>
              <div className={styles.heroStat}><strong>{live.treasury}</strong><span>treasury</span></div>
              <div className={styles.heroStat}><strong>{live.burned}</strong><span>burned</span></div>
            </>
          ) : (
            <>
              <div className={styles.heroStat}><strong>{MOCK_SUMMARY.escrow}</strong><span>escrow locked</span></div>
              <div className={styles.heroStat}><strong>{MOCK_SUMMARY.treasury}</strong><span>treasury</span></div>
              <div className={styles.heroStat}><strong>{MOCK_SUMMARY.burned}</strong><span>burned</span></div>
            </>
          )}
        </div>
        <p className={styles.invariantLine} data-testid="hivebid-invariant">
          {isLive ? 'Live escrow/treasury/burned читаются из контракта; инвариант escrow = Σ резервов верифицируется на цепи.'
            : 'Инвариант: escrow 810 = Σ резервов 810 · treasury 120 · burned 15 — держится.'}
        </p>
      </section>

      <div className={styles.sectionHead}>
        <h2>Auction board <span className={styles.tag}>{isLive ? 'live' : 'demo'}</span></h2>
        <p>{isLive ? 'Live data from NEAR testnet · demo credits not used' : 'Demo data only · статусы, таймлайны и рейтинги иллюстративны'}</p>
      </div>

      <div className={styles.layout}>
        <GlassPanel className={styles.panel} role="region" aria-labelledby="hivebid-lots-title" aria-busy={busy || undefined} data-state={isLive ? 'live' : 'mock'} data-testid="hivebid-lots">
          <SectionHeader
            id="hivebid-lots-title"
            index="01"
            title="Open lots & awards"
            subtitle={isLive ? 'Reserve · best bid · winner · current state' : 'Reserve · best bid · countdown · current state'}
            status={{ label: isLive ? `${live?.lots.length ?? 0} lots · live` : `${LOTS.length} lots · demo`, kind: isLive ? 'complete' : 'info' }}
          />
          <div className={styles.tableScroll}>
            <table>
              <thead><tr><th scope="col">Lot</th><th scope="col">Reserve</th><th scope="col">Best bid</th><th scope="col">Deadline</th><th scope="col">Status</th></tr></thead>
              <tbody>{lots}</tbody>
            </table>
          </div>
          <div className={styles.tableFoot}>
            <span><strong>Showing {isLive ? live?.lots.length ?? 0 : LOTS.length}</strong> {isLive ? 'live lots' : 'demo lots'}</span>
            <span>Updated <code>{isLive ? new Date(live?.updatedAt ?? Date.now()).toLocaleString() : '19:17:33Z · demo'}</code></span>
          </div>
        </GlassPanel>

        <GlassPanel className={`${styles.panel} ${styles.analyst}`} role="region" aria-labelledby="hivebid-analyst-title" data-state={isLive ? 'live' : 'mock'}>
          <SectionHeader id="hivebid-analyst-title" index="02" title={isLive ? 'Contract · read-only' : 'Analyst · award review'} subtitle={isLive ? 'All writes happen on-chain' : 'Choose a worker for the selected lot'} status={{ label: isLive ? 'live' : 'read-only demo', kind: 'info' }} />
          <div className={styles.analystBody}>
            {isLive ? (
              <>
                <p className={styles.formNote}>View methods: get_lot_ids → get_lot, get_agent, get_escrow, get_treasury, get_burned. Award/verdict actions are executed by contract accounts, not by this board.</p>
                <div className={styles.awardSummary}>
                  <div><dt>contract</dt><dd className={styles.gold}>{live?.contractId}</dd></div>
                  <div><dt>rpc</dt><dd>{live?.rpcUrl}</dd></div>
                  <div><dt>agents</dt><dd>{live?.agents.length ?? 0}</dd></div>
                  <div><dt>escrow</dt><dd className={styles.gold}>{live?.escrow}</dd></div>
                </div>
                {live?.agents.length ? (
                  <ul className={styles.liveAgents} aria-label="Agents on this board">
                    {live.agents.map((agent) => (
                      <li key={agent.account}>
                        <span className={styles.swarmName}>{agent.account}</span>
                        <RatingBadge rating={ratingFor(coreRatings, { name: agent.account, id: agent.account })} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : demoLot ? (
              <>
                <p className={styles.formNote} id="hivebid-select-note">Выбранный лот: {demoLot.id} · {demoLot.status}. Статический выбор; award с этой страницы не отправляется.</p>
                <dl className={styles.awardSummary}>
                  <div><dt>worker bid (winner)</dt><dd className={styles.gold}>{demoLot.bidder}</dd></div>
                  <div><dt>demo rating</dt><dd>{ratingFor(DEMO_RATINGS, { name: demoLot.bidder }) ? <RatingBadge rating={ratingFor(DEMO_RATINGS, { name: demoLot.bidder })!} /> : '—'}</dd></div>
                  <div><dt>escrow reserved</dt><dd className={styles.gold}>{demoLot.reserve}</dd></div>
                  <div><dt>budget after reserve</dt><dd>9,900 cr</dd></div>
                </dl>
                <p className={styles.reserveRule}><span aria-hidden="true">✓</span><span><strong>Invariant:</strong> escrow reserve is recorded before the award is issued.</span></p>
              </>
            ) : null}
          </div>
        </GlassPanel>
      </div>

      <div className={styles.detailGrid}>
        {displayLot ? <LotCard lot={displayLot} ratings={showRatings} live={isLive} /> : null}
        {demoLot ? <AgentPanel agent={MOCK_AGENTS[demoLot.bidder] ?? MOCK_AGENTS['bidder-2']} ratings={DEMO_RATINGS} /> : null}
      </div>

      <GlassPanel className={`${styles.panel} ${styles.leaderboard}`} role="region" aria-labelledby="hivebid-standings-title" data-state={isLive ? 'live' : 'mock'} data-testid="hivebid-standings-panel">
        <SectionHeader
          id="hivebid-standings-title"
          index="05"
          title="Swarm standings"
          subtitle={isLive && ratingsLive
            ? 'Живые рейтинги из nexus-core (GET /api/core/ratings)'
            : isLive
              ? 'Ratings API недоступен · честные демо-рейтинги'
              : 'Демо-рейтинги (шкала 0–10 · тренд по истории) · не live-фид'}
          status={isLive && ratingsLive ? { label: 'live ratings', kind: 'complete' } : { label: 'demo ratings', kind: 'info' }}
        />
        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th scope="col">Rank</th><th scope="col">Swarm</th><th scope="col">Rating</th><th scope="col">Pass rate</th><th scope="col">Recent work</th></tr></thead>
            <tbody>
              {isLive && ratingsLive && live
                ? live.agents.map((agent, index) => {
                    const r = ratingFor(coreRatings, { name: agent.account, id: agent.account });
                    return (
                      <tr key={agent.account} data-testid={`hivebid-swarm-${normalizeAgentKey(agent.account)}`}>
                        <td className={styles.rank}>0{index + 1}</td>
                        <td><strong className={styles.swarmName}>{agent.account}</strong><span className={styles.swarmHost}>stake {agent.stake} · {agent.tasksCompleted}/{agent.tasksFailed} ok/fail</span></td>
                        <td className={styles.rating}>{r ? <RatingBadge rating={r} /> : <span className={styles.subtle}>—</span>}</td>
                        <td className={styles.subtle}>—</td>
                        <td className={styles.subtle}>—</td>
                      </tr>
                    );
                  })
                : SWARMS.map((swarm, index) => (
                    <tr key={swarm.id} data-testid={`hivebid-swarm-${swarm.id}`}>
                      <td className={styles.rank}>0{index + 1}</td>
                      <td><strong className={styles.swarmName}>{swarm.id}</strong><span className={styles.swarmHost}>{swarm.host}</span></td>
                      <td className={styles.rating}><RatingBadge rating={swarm.rating} /></td>
                      <td>{swarm.passRate} <span className={styles.subtle}>demo</span></td>
                      <td>{swarm.lots}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <p className={styles.leaderboardNote}>
          {isLive && !ratingsLive
            ? 'Live-рейтинг недоступен — показаны демо-значения с маркером; live-доска не подменяется.'
            : isLive && ratingsLive
              ? 'Рейтинги читаются из nexus-core (GET /api/core/ratings); pass-rate и recent-work уровнем контракта не вычитываются.'
              : 'Scores, percentages, and lot counts are demo UI values; they are not sourced from swarm telemetry.'}
        </p>
      </GlassPanel>

      <footer className={styles.footer}>
        <span><strong>HiveBid board</strong> · {isLive ? 'live data' : 'demo data only'}</span>
        <span>{isLive ? `NEAR testnet · ${live?.contractId}` : 'No network · no live bids, escrow, or swarm status'}</span>
      </footer>
    </div>
  );
}
