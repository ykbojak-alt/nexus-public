/**
 * NOIR player contract — the live `/api/*` surface of the noir_bot host
 * (app/web_player.py + app/web_player_actions.py). Wire keys are snake_case;
 * the client maps them to this camelCase shape — same rule as integrations/ai2.
 *
 * Server truth rules honoured here:
 *  - All /player/* calls are Bearer-session-scoped; the server resolves
 *    tg_user_id → worldline_id itself — the shell never sends a worldline id.
 *  - Session via POST /web/session accepts TWO credentials, exactly one:
 *    `init_data` — Telegram Mini App payload (HMAC-verified, Redis TTL), or
 *    `link_code` — a one-time pairing code the player gets from the bot's
 *    /link command (10 min TTL, burned on exchange). Desktop NEXUS uses the
 *    link code; it cannot mint initData.
 *  - Choice submission is irreversible server-side (first accepted choice
 *    wins); custom text ≤ 2000 chars.
 */

/** POST /api/web/session → 200. initData is the Telegram Mini App payload. */
export interface NoirSession {
  sessionToken: string;
  expiresAt: string; // ISO-8601
}

/** GET /api/player/dashboard. */
export interface NoirDashboard {
  identity: { id: number; name: string; alias: string | null; role: string | null; gender: string | null };
  worldline: { id: number; eraId: number; baseCanonVersion: number | null };
  runtime: {
    state: string; // e.g. OFFLINE / FREE / WORK / STORY
    locationCode: string | null;
    gameStartedAt: string | null;
    gameStartGeneration: number | null;
    activeStoryRunId: number | null;
    activeWorkShiftId: number | null;
  };
  wallet: { credits: number };
  character: { humanity: number; eraHeat: number };
  employment: NoirEmployment | null;
  activeStory: { id: number; storyCode: string; status: string } | null;
  activeWorkShift: { id: number; estimatedEnd: string | null } | null;
  launch: { state: string; systemModelVersion: string | null; isActive: boolean };
  isGm: boolean;
}

export interface NoirEmployment {
  id: number;
  employerCode: string | null;
  professionCode: string | null;
  rankLevel: number | null;
  scheduleKind: string | null;
  shiftStart: string | null;
  shiftHours: number | null;
  salaryCredits: number | null;
  strikes: number | null;
  lifetimeStrikes: number | null;
  careerProgress: number | null;
}

/** GET /api/player/location. */
export interface NoirLocation {
  locationName: string | null;
  movementState: string | null;
  /** Observed entities — server-shaped rows, passed through. */
  entities: Array<Record<string, unknown>>;
  /** District dossier visual file when the location has one. */
  visualFile: string | null;
}

export interface NoirKnowledgeItem {
  subjectLabel: string | null;
  epistemicState: string | null;
  confidence: number | null;
  valueText: string | null;
  learnedAt: string | null;
}

export interface NoirInventory {
  items: Array<{ name: string; quantity: number; category: string; rarity: string }>;
  implants: Array<{ itemCode: string; slotCode: string; installedAt: string | null }>;
}

export interface NoirEvidenceItem {
  title: string | null;
  integrityState: string | null;
  access: string | null;
  unitType: string | null;
  isPublic: boolean | null;
}

export interface NoirEconomy {
  balance: number;
  earned: number;
  spent: number;
  recent: Array<{ delta: number; txType: string | null; createdAt: string | null }>;
}

export interface NoirContact { name: string | null; relation: string | null }

/** GET /api/player/stories item — `access_state` verbatim (AVAILABLE/LOCKED/…). */
export interface NoirStoryAccess {
  code: string | null;
  title: string | null;
  status: string | null;
  activeRunId: number | null;
}

/** POST /api/player/bootstrap_game → 200. */
export interface NoirBootstrap {
  ok: boolean;
  alreadyStarted: boolean;
  locationCode?: string;
  availableStories?: number;
}

/** POST /api/player/story/start → 201. `mode` supports SOLO only (501 otherwise). */
export interface NoirStoryStarted {
  ok: boolean;
  runId: number;
  storyCode: string;
  deadlineAt: string | null;
}

export interface NoirSceneChoice {
  label: string;
  /** True for the free-form variant — submit with `customText`. */
  custom: boolean;
  /** Authored index — submit this verbatim; never reorder. */
  choiceIndex: number;
}

export interface NoirScene {
  title: string;
  body: string;
  choices: NoirSceneChoice[];
}

/** GET /api/player/story/current — `active:false` when no run is active. */
export interface NoirStoryCurrent {
  active: boolean;
  runId?: number;
  storyCode?: string;
  status?: string; // ACTIVE | STUCK | …
  scene?: NoirScene | null;
}

/** POST /api/player/story/choice → 200. */
export interface NoirChoiceResult {
  completed: boolean;
  waiting: boolean;
  deadlock: boolean;
  votesCast?: number;
  votesRequired?: number;
  creditReceipt?: Record<string, unknown>;
  creditReceipts?: Array<Record<string, unknown>>;
  scene?: NoirScene; // the next scene when the run advanced
}

export interface NoirRoute {
  toCode: string | null;
  toTitle: string | null;
  travelSeconds: number;
  accessOk: boolean;
}

export interface NoirActiveTravel {
  id: number;
  fromTitle: string | null;
  toTitle: string | null;
  arrivesAt: string | null;
  secondsLeft: number;
}

/** GET /api/player/map and POST /api/player/travel share this snapshot. */
export interface NoirMap {
  currentLocationCode: string | null;
  currentLocationTitle: string | null;
  activeTravel: NoirActiveTravel | null;
  routes: NoirRoute[];
}

export interface NoirWorkState {
  employment: {
    employerCode: string | null;
    professionCode: string | null;
    rankTitle: string | null;
    scheduleKind: string | null;
    shiftStart: string | null;
    shiftHours: number | null;
    salaryCredits: number | null;
    strikes: number | null;
    lifetimeStrikes: number | null;
    careerProgress: number | null;
  } | null;
  nextShift: { id: number; plannedStart: string | null; status: string | null } | null;
  workSite: {
    locationTitle: string | null;
    locationOk: boolean | null;
    accessOk: boolean | null;
    workClosed: boolean | null;
    ok: boolean | null;
  } | null;
  achievementsCount: number;
}

/** POST /api/player/work/start → 200. */
export interface NoirWorkStarted {
  shift: { id: number; plannedEnd: string | null };
  state: string; // "WORK"
}

export interface NoirParty {
  id: number | null;
  storyCode: string | null;
  status: string | null;
  mode: string | null;
  totalSize: number | null;
  maxParty: number | null;
  scheduledFor: string | null;
}

/** GET /api/player/scene — shared scene (co-presence), `active:false` when none. */
export interface NoirSharedScene {
  active: boolean;
  sceneId?: number | null;
  locationName?: string | null;
  participants?: Array<{ label: string | null; self: boolean }>;
  events?: Array<{ text: string | null; eventType: string | null }>;
}

export interface NoirStore { id: number; name: string | null; storeType: string | null }

export interface NoirStoreItems {
  store: { id: number; name: string | null; storeType: string | null };
  items: Array<{
    code: string; name: string | null; category: string | null;
    rarity: string | null; price: number; quantity: number;
  }>;
  balance: number;
}

/** POST /api/player/store/{id}/buy → 200. */
export interface NoirPurchase {
  orderId: number;
  totalPrice: number;
  balanceAfter: number;
  item: { code: string; name: string | null };
}
