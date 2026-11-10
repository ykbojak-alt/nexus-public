import type { NoirClient } from './client';
import { NoirApiError } from './client';
import type {
  NoirMap,
  NoirScene,
  NoirStoryAccess,
} from '../contracts/player';

/**
 * Deterministic NOIR world for mock mode (INT-24). Not a stub of the wire —
 * a small in-memory model with the real semantics: choices advance/complete
 * the run irreversibly, travel moves the location, purchases decrement a
 * finite balance, session tokens are issued per binding. Errors reuse the
 * server's codes verbatim.
 *
 * Auth: `session.create` accepts any non-empty initData string and issues a
 * fixed token; /player/* and /actions/* on a binding without/with an unknown
 * token answer 401 `invalid_session` exactly like the host.
 */

const T0 = 1_800_000_000; // fixed epoch — deterministic timestamps
const TOKEN = 'mock-session-token';
const ISO = (s: number) => new Date((T0 + s) * 1000).toISOString();

const STORY_SCENES: NoirScene[] = [
  {
    title: 'Неоновая миля, 02:14',
    body: 'Дождь смыл с асфальта всё, кроме запаха озона. Контакт ждёт у ларька с лапшой.',
    choices: [
      { label: 'Подойти к ларьку', custom: false, choiceIndex: 0 },
      { label: 'Пройти мимо и слушать', custom: false, choiceIndex: 1 },
      { label: 'Свой вариант', custom: true, choiceIndex: 2 },
    ],
  },
  {
    title: 'Ларек с лапшой',
    body: 'Контакт не поднимает головы: «Ты пришёл за пакетом. Цена выросла».',
    choices: [
      { label: 'Заплатить 40 кредитов', custom: false, choiceIndex: 0 },
      { label: 'Отказаться и уйти', custom: false, choiceIndex: 1 },
    ],
  },
];

export function createNoirMockClient(): NoirClient {
  const issuedTokens = new Set<string>();
  const usedLinkCodes = new Set<string>();
  let gameStarted = false;
  let location = 'NEON_MILE';
  let balance = 120;
  let runId: number | null = null;
  let sceneIdx = 0;
  let orderSeq = 0;

  const storyItems: NoirStoryAccess[] = [
    { code: 'NEON_DELIVERY', title: 'Неоновая доставка', status: 'AVAILABLE', activeRunId: null },
    { code: 'STATIC', title: 'Статика', status: 'LOCKED', activeRunId: null },
  ];
  const map = (): NoirMap => ({
    currentLocationCode: location,
    currentLocationTitle: location === 'NEON_MILE' ? 'Неоновая миля' : 'Старый порт',
    activeTravel: null,
    routes: [
      { toCode: 'OLD_PORT', toTitle: 'Старый порт', travelSeconds: 300, accessOk: true },
      { toCode: 'CROWN', toTitle: 'Корона', travelSeconds: 600, accessOk: false },
    ].filter((r) => r.toCode !== location),
  });

  const client = (bound: string | null): NoirClient => {
    const auth = () => {
      if (bound == null || !issuedTokens.has(bound)) {
        throw new NoirApiError(401, 'invalid_session');
      }
    };

    return {
      session: {
        create: async (initData) => {
          if (!initData.trim()) throw new NoirApiError(401, 'invalid_init_data');
          issuedTokens.add(TOKEN);
          return { sessionToken: TOKEN, expiresAt: ISO(86400) };
        },
        createWithLinkCode: async (linkCode) => {
          // Mock honors the real pairing contract: code must normalize to
          // XXXX-XXXX on the no-0/O/1/I alphabet and burn after one exchange.
          const norm = linkCode.trim().toUpperCase().replace(/[-\s]/g, '');
          const ok = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(norm);
          const canon = `${norm.slice(0, 4)}-${norm.slice(4)}`;
          if (!ok || usedLinkCodes.has(canon)) {
            throw new NoirApiError(401, 'invalid_link_code');
          }
          usedLinkCodes.add(canon);
          issuedTokens.add(TOKEN);
          return { sessionToken: TOKEN, expiresAt: ISO(86400) };
        },
      },
      withToken: (sessionToken) => client(sessionToken),

      player: {
        dashboard: async () => {
          auth();
          return {
            identity: { id: 7, name: 'Вертоль', alias: 'VER', role: 'player', gender: 'm' },
            worldline: { id: 101, eraId: 1, baseCanonVersion: 3 },
            runtime: {
              state: runId != null ? 'STORY' : 'FREE',
              locationCode: location,
              gameStartedAt: gameStarted ? ISO(0) : null,
              gameStartGeneration: gameStarted ? 1 : null,
              activeStoryRunId: runId,
              activeWorkShiftId: null,
            },
            wallet: { credits: balance },
            character: { humanity: 92, eraHeat: 1 },
            employment: null,
            activeStory: runId != null
              ? { id: runId, storyCode: 'NEON_DELIVERY', status: 'ACTIVE' }
              : null,
            activeWorkShift: null,
            launch: { state: 'LIVE', systemModelVersion: '1.0', isActive: true },
            isGm: false,
          };
        },
        location: async () => {
          auth();
          return {
            locationName: map().currentLocationTitle,
            movementState: 'IDLE',
            entities: [{ label: 'Ларек с лапшой', kind: 'POI' }],
            visualFile: null,
          };
        },
        knowledge: async () => (auth(), {
          items: [
            { subjectLabel: 'Контакт «Сорока»', epistemicState: 'KNOWN', confidence: 0.8, valueText: 'Торгует информацией на миле', learnedAt: ISO(-3600) },
          ],
        }),
        inventory: async () => (auth(), {
          items: [
            { name: 'Терминал «Гадюка»', quantity: 1, category: 'tool', rarity: 'blue' },
          ],
          implants: [],
        }),
        evidence: async () => (auth(), {
          items: [
            { title: 'Запись переговоров порта', integrityState: 'INTACT', access: 'OWNER', unitType: 'AUDIO', isPublic: false },
          ],
        }),
        economy: async () => (auth(), {
          balance, earned: 240, spent: 240 - balance,
          recent: [{ delta: -40, txType: 'purchase', createdAt: ISO(-300) }],
        }),
        contacts: async () => (auth(), {
          items: [{ name: 'Сорока', relation: 'информатор' }],
        }),
        stories: async () => (auth(), {
          items: storyItems.map((s) => ({
            ...s, activeRunId: s.code === 'NEON_DELIVERY' ? runId : null,
          })),
        }),
        storyCurrent: async () => {
          auth();
          if (runId == null) return { active: false };
          return {
            active: true, runId, storyCode: 'NEON_DELIVERY', status: 'ACTIVE',
            scene: STORY_SCENES[sceneIdx] ?? null,
          };
        },
        map: async () => (auth(), map()),
        work: async () => (auth(), {
          employment: null, nextShift: null, workSite: null, achievementsCount: 0,
        }),
        party: async () => (auth(), { party: null }),
        scene: async () => (auth(), { active: false }),
        stores: async () => (auth(), {
          stores: [{ id: 9, name: 'Ларек «У Сороки»', storeType: 'KIOSK' }],
        }),
        storeItems: async (storeId) => {
          auth();
          if (storeId !== 9) throw new NoirApiError(403, 'store_unavailable');
          return {
            store: { id: 9, name: 'Ларек «У Сороки»', storeType: 'KIOSK' },
            items: [
              { code: 'INFO_PACKET', name: 'Пакет данных', category: 'intel', rarity: 'white', price: 40, quantity: 3 },
            ],
            balance,
          };
        },
      },

      actions: {
        bootstrapGame: async () => {
          auth();
          const already = gameStarted;
          gameStarted = true;
          return { ok: true, alreadyStarted: already, locationCode: 'NEON_MILE', availableStories: 1 };
        },
        storyStart: async (storyCode) => {
          auth();
          if (!gameStarted) throw new NoirApiError(409, 'game_not_started');
          if (runId != null) throw new NoirApiError(409, 'story_already_active');
          const story = storyItems.find((s) => s.code === storyCode);
          if (!story || story.status !== 'AVAILABLE') throw new NoirApiError(403, 'story_locked');
          runId = 1;
          sceneIdx = 0;
          return { ok: true, runId, storyCode, deadlineAt: ISO(86400) };
        },
        storyChoice: async (input) => {
          auth();
          if (runId == null || input.runId !== runId) throw new NoirApiError(409, 'run_not_active');
          const scene = STORY_SCENES[sceneIdx];
          const choice = scene.choices[input.choiceIndex];
          if (!choice) throw new NoirApiError(400, 'invalid_choice');
          if (choice.custom && (input.customText == null || !input.customText.trim())) {
            throw new NoirApiError(400, 'invalid_request');
          }
          sceneIdx += 1;
          if (sceneIdx >= STORY_SCENES.length) {
            runId = null;
            return { completed: true, waiting: false, deadlock: false };
          }
          return { completed: false, waiting: false, deadlock: false, scene: STORY_SCENES[sceneIdx] };
        },
        travel: async (destinationCode) => {
          auth();
          const route = map().routes.find((r) => r.toCode === destinationCode);
          if (route == null) throw new NoirApiError(404, 'route_not_found');
          if (!route.accessOk) throw new NoirApiError(403, 'access_denied');
          location = destinationCode;
          return map();
        },
        workStart: async () => {
          auth();
          throw new NoirApiError(404, 'shift_not_found'); // мок не планирует смены
        },
        buy: async (storeId, input) => {
          auth();
          if (storeId !== 9) throw new NoirApiError(403, 'store_unavailable');
          if (input.itemCode !== 'INFO_PACKET') throw new NoirApiError(404, 'item_not_found');
          const price = 40 * (input.quantity ?? 1);
          if (price > balance) throw new NoirApiError(409, 'insufficient_credits');
          balance -= price;
          orderSeq += 1;
          return {
            orderId: orderSeq, totalPrice: price, balanceAfter: balance,
            item: { code: 'INFO_PACKET', name: 'Пакет данных' },
          };
        },
      },
    };
  };

  return client(null);
}
