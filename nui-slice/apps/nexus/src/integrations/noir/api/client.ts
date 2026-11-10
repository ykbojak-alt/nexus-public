import type {
  NoirActiveTravel,
  NoirBootstrap,
  NoirChoiceResult,
  NoirContact,
  NoirDashboard,
  NoirEconomy,
  NoirEvidenceItem,
  NoirInventory,
  NoirKnowledgeItem,
  NoirLocation,
  NoirMap,
  NoirParty,
  NoirPurchase,
  NoirRoute,
  NoirScene,
  NoirSession,
  NoirSharedScene,
  NoirStore,
  NoirStoreItems,
  NoirStoryAccess,
  NoirStoryCurrent,
  NoirStoryStarted,
  NoirWorkStarted,
  NoirWorkState,
} from '../contracts/player';

/**
 * Typed client for the NOIR player HTTP surface (`/api/*`, app/web_player.py).
 * Same shape as the AI-2 client: same-origin `fetch` by default, snake_case
 * wire → camelCase public, injected `fetchImpl` in tests.
 *
 * Session: `session.create(initData)` returns the bearer token; pass it to
 * `withToken(token)` (or `config.sessionToken`) — /player/* then carries
 * `Authorization: Bearer`. The host resolves the player's worldline from the
 * token; the shell never sends identity fields.
 */

export class NoirApiError extends Error {
  constructor(
    public readonly status: number,
    /** Machine code from the wire `{error}` field (e.g. `invalid_session`). */
    public readonly code: string,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'NoirApiError';
  }
}

export class NoirNetworkError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'aborted' | 'offline',
    public readonly path: string,
    cause?: unknown,
  ) {
    super(`${kind}: ${path}`, { cause });
    this.name = 'NoirNetworkError';
  }
}

export interface NoirClientConfig {
  baseUrl?: string;
  sessionToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface NoirRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type Wire = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

function mapScene(w: unknown): NoirScene | undefined {
  if (w == null || typeof w !== 'object') return undefined;
  const s = w as Wire;
  const choices = ((s.choices as Wire[] | undefined) ?? [])
    .filter((c) => c != null && typeof c === 'object')
    .map((c) => ({
      label: String(c.label ?? ''),
      custom: Boolean(c.custom),
      choiceIndex: Number(c.choice_index ?? 0),
    }));
  return { title: String(s.title ?? ''), body: String(s.body ?? ''), choices };
}

function mapTravel(w: unknown): NoirActiveTravel | null {
  if (w == null || typeof w !== 'object') return null;
  const t = w as Wire;
  return {
    id: Number(t.id ?? 0),
    fromTitle: str(t.from_title),
    toTitle: str(t.to_title),
    arrivesAt: str(t.arrives_at),
    secondsLeft: Number(t.seconds_left ?? 0),
  };
}

function mapRoute(w: unknown): NoirRoute {
  const r = (w ?? {}) as Wire;
  return {
    toCode: str(r.to_code),
    toTitle: str(r.to_title),
    travelSeconds: Number(r.travel_seconds ?? 0),
    accessOk: Boolean(r.access_ok),
  };
}

function mapMap(w: Wire): NoirMap {
  return {
    currentLocationCode: str(w.current_location_code),
    currentLocationTitle: str(w.current_location_title),
    activeTravel: mapTravel(w.active_travel),
    routes: ((w.routes as unknown[]) ?? []).map(mapRoute),
  };
}

export interface NoirClient {
  /** POST /api/web/session — one credential per call, server-verified. */
  session: {
    /** Telegram Mini App initData path (Mini App contexts only). */
    create(initData: string, opts?: NoirRequestOptions): Promise<NoirSession>;
    /**
     * Desktop pairing path: one-time code from the bot's /link command —
     * `XXXX-XXXX`, 10 min TTL, burned on exchange (401 `invalid_link_code`).
     */
    createWithLinkCode(linkCode: string, opts?: NoirRequestOptions): Promise<NoirSession>;
  };
  /** A client bound to a session token — same transport, Bearer attached. */
  withToken(sessionToken: string): NoirClient;

  player: {
    dashboard(opts?: NoirRequestOptions): Promise<NoirDashboard>;
    location(opts?: NoirRequestOptions): Promise<NoirLocation>;
    knowledge(opts?: NoirRequestOptions): Promise<{ items: NoirKnowledgeItem[] }>;
    inventory(opts?: NoirRequestOptions): Promise<NoirInventory>;
    evidence(opts?: NoirRequestOptions): Promise<{ items: NoirEvidenceItem[] }>;
    economy(opts?: NoirRequestOptions): Promise<NoirEconomy>;
    contacts(opts?: NoirRequestOptions): Promise<{ items: NoirContact[] }>;
    stories(opts?: NoirRequestOptions): Promise<{ items: NoirStoryAccess[] }>;
    /** GET /api/player/story/current — `active:false` when no run is active. */
    storyCurrent(opts?: NoirRequestOptions): Promise<NoirStoryCurrent>;
    map(opts?: NoirRequestOptions): Promise<NoirMap>;
    work(opts?: NoirRequestOptions): Promise<NoirWorkState>;
    party(opts?: NoirRequestOptions): Promise<{ party: NoirParty | null }>;
    scene(opts?: NoirRequestOptions): Promise<NoirSharedScene>;
    stores(opts?: NoirRequestOptions): Promise<{ stores: NoirStore[] }>;
    storeItems(storeId: number, opts?: NoirRequestOptions): Promise<NoirStoreItems>;
  };

  actions: {
    /** POST /api/player/bootstrap_game — first game start (idempotent server-side). */
    bootstrapGame(opts?: NoirRequestOptions): Promise<NoirBootstrap>;
    /** POST /api/player/story/start — SOLO mode only today (501 otherwise). */
    storyStart(storyCode: string, opts?: NoirRequestOptions): Promise<NoirStoryStarted>;
    /**
     * POST /api/player/story/choice — irreversible server-side; pass the
     * authored `choiceIndex` verbatim, `customText` ≤ 2000 for custom choices.
     */
    storyChoice(input: { runId: number; choiceIndex: number; customText?: string },
      opts?: NoirRequestOptions): Promise<NoirChoiceResult>;
    /** POST /api/player/travel — destination code; map errors surface verbatim. */
    travel(destinationCode: string, opts?: NoirRequestOptions): Promise<NoirMap>;
    /** POST /api/player/work/start — by scheduled shift id. */
    workStart(shiftId: number, opts?: NoirRequestOptions): Promise<NoirWorkStarted>;
    /** POST /api/player/store/{id}/buy — finite stock enforced server-side. */
    buy(storeId: number, input: { itemCode: string; quantity?: number },
      opts?: NoirRequestOptions): Promise<NoirPurchase>;
  };
}

export function createNoirClient(config: NoirClientConfig = {}): NoirClient {
  const baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
  const fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);

  async function request<T>(path: string, init: RequestInit = {}, opts: NoirRequestOptions = {}): Promise<T> {
    const url = new URL(`${baseUrl}${path}`, baseUrl ? undefined : globalThis.location?.href);
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (config.sessionToken) headers.set('authorization', `Bearer ${config.sessionToken}`);
    const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? 0;
    const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const signal = timeoutSignal && opts.signal ? AbortSignal.any([timeoutSignal, opts.signal])
      : (timeoutSignal ?? opts.signal);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, headers, signal });
    } catch (err) {
      if (timeoutSignal?.aborted) throw new NoirNetworkError('timeout', path, err);
      if (opts.signal?.aborted) throw new NoirNetworkError('aborted', path, err);
      if (err instanceof TypeError) throw new NoirNetworkError('offline', path, err);
      throw err;
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok) {
      const err = (body as Wire | undefined)?.error;
      throw new NoirApiError(res.status, typeof err === 'string' ? err : `http_${res.status}`);
    }
    return body as T;
  }

  const post = (body?: unknown): RequestInit =>
    body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) };

  return {
    session: {
      create: async (initData, opts) => {
        const w = await request<Wire>('/api/web/session', post({ init_data: initData }), opts);
        return { sessionToken: String(w.session_token ?? ''), expiresAt: String(w.expires_at ?? '') };
      },
      createWithLinkCode: async (linkCode, opts) => {
        const w = await request<Wire>('/api/web/session', post({ link_code: linkCode }), opts);
        return { sessionToken: String(w.session_token ?? ''), expiresAt: String(w.expires_at ?? '') };
      },
    },
    withToken: (sessionToken) => createNoirClient({ ...config, sessionToken }),

    player: {
      dashboard: async (opts) => {
        const w = await request<Wire>('/api/player/dashboard', {}, opts);
        const id = (w.identity as Wire) ?? {};
        const wl = (w.worldline as Wire) ?? {};
        const rt = (w.runtime as Wire) ?? {};
        const wa = (w.wallet as Wire) ?? {};
        const ch = (w.character as Wire) ?? {};
        const em = w.employment as Wire | null | undefined;
        const as_ = w.active_story as Wire | null | undefined;
        const aws = w.active_work_shift as Wire | null | undefined;
        const la = (w.launch as Wire) ?? {};
        return {
          identity: {
            id: Number(id.id ?? 0), name: String(id.name ?? ''),
            alias: str(id.alias), role: str(id.role), gender: str(id.gender),
          },
          worldline: {
            id: Number(wl.id ?? 0), eraId: Number(wl.era_id ?? 0),
            baseCanonVersion: num(wl.base_canon_version),
          },
          runtime: {
            state: String(rt.state ?? ''),
            locationCode: str(rt.location_code),
            gameStartedAt: str(rt.game_started_at),
            gameStartGeneration: num(rt.game_start_generation),
            activeStoryRunId: num(rt.active_story_run_id),
            activeWorkShiftId: num(rt.active_work_shift_id),
          },
          wallet: { credits: Number(wa.credits ?? 0) },
          character: { humanity: Number(ch.humanity ?? 0), eraHeat: Number(ch.era_heat ?? 0) },
          employment: em == null ? null : {
            id: Number(em.id ?? 0),
            employerCode: str(em.employer_code), professionCode: str(em.profession_code),
            rankLevel: num(em.rank_level), scheduleKind: str(em.schedule_kind),
            shiftStart: str(em.shift_start), shiftHours: num(em.shift_hours),
            salaryCredits: num(em.salary_credits), strikes: num(em.strikes),
            lifetimeStrikes: num(em.lifetime_strikes), careerProgress: num(em.career_progress),
          },
          activeStory: as_ == null ? null : {
            id: Number(as_.id ?? 0), storyCode: String(as_.story_code ?? ''), status: String(as_.status ?? ''),
          },
          activeWorkShift: aws == null ? null : {
            id: Number(aws.id ?? 0), estimatedEnd: str(aws.estimated_end),
          },
          launch: {
            state: String(la.state ?? ''), systemModelVersion: str(la.system_model_version),
            isActive: Boolean(la.is_active),
          },
          isGm: Boolean(w.is_gm),
        };
      },
      location: async (opts) => {
        const w = await request<Wire>('/api/player/location', {}, opts);
        return {
          locationName: str(w.location_name),
          movementState: str(w.movement_state),
          entities: ((w.entities as unknown[]) ?? []).map((e) => (e ?? {}) as Wire),
          visualFile: str(w.visual_file),
        };
      },
      knowledge: async (opts) => {
        const w = await request<Wire>('/api/player/knowledge', {}, opts);
        return {
          items: ((w.items as Wire[] | undefined) ?? []).map((i) => ({
            subjectLabel: str(i.subject_label), epistemicState: str(i.epistemic_state),
            confidence: num(i.confidence), valueText: str(i.value_text), learnedAt: str(i.learned_at),
          })),
        };
      },
      inventory: async (opts) => {
        const w = await request<Wire>('/api/player/inventory', {}, opts);
        return {
          items: ((w.items as Wire[] | undefined) ?? []).map((i) => ({
            name: String(i.name ?? ''), quantity: Number(i.quantity ?? 0),
            category: String(i.category ?? ''), rarity: String(i.rarity ?? ''),
          })),
          implants: ((w.implants as Wire[] | undefined) ?? []).map((i) => ({
            itemCode: String(i.item_code ?? ''), slotCode: String(i.slot_code ?? ''),
            installedAt: str(i.installed_at),
          })),
        };
      },
      evidence: async (opts) => {
        const w = await request<Wire>('/api/player/evidence', {}, opts);
        return {
          items: ((w.items as Wire[] | undefined) ?? []).map((i) => ({
            title: str(i.title), integrityState: str(i.integrity_state),
            access: str(i.access), unitType: str(i.unit_type),
            isPublic: i.is_public == null ? null : Boolean(i.is_public),
          })),
        };
      },
      economy: async (opts) => {
        const w = await request<Wire>('/api/player/economy', {}, opts);
        return {
          balance: Number(w.balance ?? 0), earned: Number(w.earned ?? 0), spent: Number(w.spent ?? 0),
          recent: ((w.recent as Wire[] | undefined) ?? []).map((t) => ({
            delta: Number(t.delta ?? 0), txType: str(t.tx_type), createdAt: str(t.created_at),
          })),
        };
      },
      contacts: async (opts) => {
        const w = await request<Wire>('/api/player/contacts', {}, opts);
        return {
          items: ((w.items as Wire[] | undefined) ?? []).map((i) => ({
            name: str(i.name), relation: str(i.relation),
          })),
        };
      },
      stories: async (opts) => {
        const w = await request<Wire>('/api/player/stories', {}, opts);
        return {
          items: ((w.items as Wire[] | undefined) ?? []).map((i) => ({
            code: str(i.code), title: str(i.title),
            status: str(i.status), activeRunId: num(i.active_run_id),
          })),
        };
      },
      storyCurrent: async (opts) => {
        const w = await request<Wire>('/api/player/story/current', {}, opts);
        if (!w.active) return { active: false };
        return {
          active: true,
          runId: num(w.run_id) ?? undefined,
          storyCode: str(w.story_code) ?? undefined,
          status: str(w.status) ?? undefined,
          scene: mapScene(w.scene) ?? null,
        };
      },
      map: async (opts) => mapMap(await request<Wire>('/api/player/map', {}, opts)),
      work: async (opts) => {
        const w = await request<Wire>('/api/player/work', {}, opts);
        const em = w.employment as Wire | null | undefined;
        const ns = w.next_shift as Wire | null | undefined;
        const ws = w.work_site as Wire | null | undefined;
        return {
          employment: em == null ? null : {
            employerCode: str(em.employer_code), professionCode: str(em.profession_code),
            rankTitle: str(em.rank_title), scheduleKind: str(em.schedule_kind),
            shiftStart: str(em.shift_start), shiftHours: num(em.shift_hours),
            salaryCredits: num(em.salary_credits), strikes: num(em.strikes),
            lifetimeStrikes: num(em.lifetime_strikes), careerProgress: num(em.career_progress),
          },
          nextShift: ns == null ? null : {
            id: Number(ns.id ?? 0), plannedStart: str(ns.planned_start), status: str(ns.status),
          },
          workSite: ws == null ? null : {
            locationTitle: str(ws.location_title),
            locationOk: ws.location_ok == null ? null : Boolean(ws.location_ok),
            accessOk: ws.access_ok == null ? null : Boolean(ws.access_ok),
            workClosed: ws.work_closed == null ? null : Boolean(ws.work_closed),
            ok: ws.ok == null ? null : Boolean(ws.ok),
          },
          achievementsCount: Number(w.achievements_count ?? 0),
        };
      },
      party: async (opts) => {
        const w = await request<Wire>('/api/player/party', {}, opts);
        const p = w.party as Wire | null | undefined;
        return {
          party: p == null ? null : {
            id: num(p.id), storyCode: str(p.story_code), status: str(p.status),
            mode: str(p.mode), totalSize: num(p.total_size),
            maxParty: num(p.max_party), scheduledFor: str(p.scheduled_for),
          },
        };
      },
      scene: async (opts) => {
        const w = await request<Wire>('/api/player/scene', {}, opts);
        if (!w.active) return { active: false };
        return {
          active: true,
          sceneId: num(w.scene_id),
          locationName: str(w.location_name),
          participants: ((w.participants as Wire[] | undefined) ?? []).map((p) => ({
            label: str(p.label), self: Boolean(p.self),
          })),
          events: ((w.events as Wire[] | undefined) ?? []).map((e) => ({
            text: str(e.text), eventType: str(e.event_type),
          })),
        };
      },
      stores: async (opts) => {
        const w = await request<Wire>('/api/player/stores', {}, opts);
        return {
          stores: ((w.stores as Wire[] | undefined) ?? []).map((s) => ({
            id: Number(s.id ?? 0), name: str(s.name), storeType: str(s.store_type),
          })),
        };
      },
      storeItems: async (storeId, opts) => {
        const w = await request<Wire>(`/api/player/store/${storeId}/items`, {}, opts);
        const st = (w.store as Wire) ?? {};
        return {
          store: { id: Number(st.id ?? storeId), name: str(st.name), storeType: str(st.store_type) },
          items: ((w.items as Wire[] | undefined) ?? []).map((i) => ({
            code: String(i.code ?? ''), name: str(i.name), category: str(i.category),
            rarity: str(i.rarity), price: Number(i.price ?? 0), quantity: Number(i.quantity ?? 0),
          })),
          balance: Number(w.balance ?? 0),
        };
      },
    },

    actions: {
      bootstrapGame: async (opts) => {
        const w = await request<Wire>('/api/player/bootstrap_game', post(), opts);
        return {
          ok: Boolean(w.ok), alreadyStarted: Boolean(w.already_started),
          locationCode: str(w.location_code) ?? undefined,
          availableStories: num(w.available_stories) ?? undefined,
        };
      },
      storyStart: async (storyCode, opts) => {
        const w = await request<Wire>('/api/player/story/start',
          post({ story_code: storyCode, mode: 'SOLO' }), opts);
        return {
          ok: Boolean(w.ok), runId: Number(w.run_id ?? 0),
          storyCode: String(w.story_code ?? storyCode), deadlineAt: str(w.deadline_at),
        };
      },
      storyChoice: async (input, opts) => {
        const wire: Wire = { run_id: input.runId, choice_index: input.choiceIndex };
        if (input.customText !== undefined) wire.custom_text = input.customText;
        const w = await request<Wire>('/api/player/story/choice', post(wire), opts);
        return {
          completed: Boolean(w.completed), waiting: Boolean(w.waiting), deadlock: Boolean(w.deadlock),
          votesCast: num(w.votes_cast) ?? undefined,
          votesRequired: num(w.votes_required) ?? undefined,
          creditReceipt: (w.credit_receipt as Wire | undefined) ?? undefined,
          creditReceipts: (w.credit_receipts as Wire[] | undefined) ?? undefined,
          scene: mapScene(w.scene),
        };
      },
      travel: async (destinationCode, opts) =>
        mapMap(await request<Wire>('/api/player/travel', post({ destination_code: destinationCode }), opts)),
      workStart: async (shiftId, opts) => {
        const w = await request<Wire>('/api/player/work/start', post({ shift_id: shiftId }), opts);
        const sh = (w.shift as Wire) ?? {};
        return { shift: { id: Number(sh.id ?? shiftId), plannedEnd: str(sh.planned_end) }, state: String(w.state ?? '') };
      },
      buy: async (storeId, input, opts) => {
        const w = await request<Wire>(`/api/player/store/${storeId}/buy`,
          post({ item_code: input.itemCode, quantity: input.quantity ?? 1 }), opts);
        const it = (w.item as Wire) ?? {};
        return {
          orderId: Number(w.order_id ?? 0), totalPrice: Number(w.total_price ?? 0),
          balanceAfter: Number(w.balance_after ?? 0),
          item: { code: String(it.code ?? input.itemCode), name: str(it.name) },
        };
      },
    },
  };
}
