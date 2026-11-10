/**
 * Social media fixtures — deterministic data for development and tests.
 * Types are imported from './types' (CODEX adds them in parallel).
 * This file is the single source of truth for social mock data.
 */

import type {
  SocialNetworkId,
  SocialAccountState,
  SocialAccount,
  SocialPostStatus,
  SocialMediaKind,
  SocialPost,
  SocialAgentState,
  SocialHubState,
  YouTubeVideo,
  YouTubeCommentRow,
  XTweet,
  XMention,
} from './types';

export const socialAccounts: SocialAccount[] = [
  {
    network: 'telegram',
    handle: '@nexus_ops',
    state: 'connected',
    followers: 12_500,
    reason: null,
  },
  {
    network: 'instagram',
    handle: '@nexus.aios',
    state: 'connected',
    followers: 8_200,
    reason: null,
  },
  {
    network: 'youtube',
    handle: null,
    state: 'not-connected',
    followers: null,
    reason: 'OAuth не пройден',
  },
  {
    network: 'x',
    handle: '@nexus_aios',
    state: 'needs-review',
    followers: 3_400,
    reason: 'scope post.write ждёт app review',
  },
];

export const socialQueue: SocialPost[] = [
  {
    id: 'sp-001',
    network: 'x',
    text: 'Запускаем NEXUS AiOS v1.2 — новый Workflow-движок, BUS v2, AGENT-A-оператор соцсетей. Подробности в треде 🧵',
    media: 'text',
    status: 'draft',
    scheduledAt: null,
    authorAgent: 'forge',
  },
  {
    id: 'sp-002',
    network: 'telegram',
    text: '🚀 NEXUS AiOS v1.2 released! Workflow engine + BUS v2 + AGENT-A social operator. Читайте анонс 👇',
    media: 'image',
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    authorAgent: 'alice',
  },
  {
    id: 'sp-003',
    network: 'instagram',
    text: 'Behind the scenes: как AGENT-A генерирует контент-план на неделю 🎨\n#NEXUS #AIOS #AGENT-A',
    media: 'image',
    status: 'pending-approval',
    scheduledAt: null,
    authorAgent: 'forge',
  },
];

export const socialApprovals: SocialPost[] = [
  {
    id: 'sp-004',
    network: 'x',
    text: 'Hot take: AI agents should have social media presence. AGENT-A posts, replies, and engages 24/7. Thoughts?',
    media: 'text',
    status: 'pending-approval',
    scheduledAt: null,
    authorAgent: 'alice',
  },
  {
    id: 'sp-005',
    network: 'instagram',
    text: 'Behind the code: how AGENT-A writes posts, picks images, schedules slots. Swipe for process 📸✨',
    media: 'image',
    status: 'pending-approval',
    scheduledAt: null,
    authorAgent: 'forge',
  },
];

export const socialAgent: SocialAgentState = {
  operator: 'AGENT-A',
  state: 'drafting',
  currentTask: 'контент-план на неделю',
  subAgents: [
    { key: 'forge', task: 'генерация обложки для X' },
    { key: 'mech', task: 'подбор слотов публикации' },
    { key: 'codex', task: null },
    { key: 'arch', task: 'ретроспектива охвата' },
  ],
};

export const youtubeVideos = [
  {
    videoId: 'yt-vid-001',
    title: 'NEXUS AiOS v1.2 Release Walkthrough',
    publishedAt: '2026-10-20T14:00:00Z',
    views: 12_500,
    comments: 342,
  },
  {
    videoId: 'yt-vid-002',
    title: 'AGENT-A Social Operator — Behind the Scenes',
    publishedAt: '2026-10-25T10:00:00Z',
    views: 8_200,
    comments: 156,
  },
  {
    videoId: 'yt-vid-003',
    title: 'BUS v2 Architecture Deep Dive',
    publishedAt: '2026-10-28T16:00:00Z',
    views: 5_600,
    comments: 89,
  },
];

export const youtubeComments = [
  {
    commentId: 'yt-com-001',
    videoId: 'yt-vid-001',
    author: '@dev_user_1',
    text: 'Great walkthrough! When will v1.3 be ready?',
    ts: 1793200000,
  },
  {
    commentId: 'yt-com-002',
    videoId: 'yt-vid-001',
    author: '@ai_enthusiast',
    text: 'The workflow engine looks amazing. Can\'t wait to try BUS v2.',
    ts: 1793200500,
  },
  {
    commentId: 'yt-com-003',
    videoId: 'yt-vid-002',
    author: '@alice_fan',
    text: 'AGENT-A writing social posts? That\'s next level!',
    ts: 1793300000,
  },
  {
    commentId: 'yt-com-004',
    videoId: 'yt-vid-002',
    author: '@codex_dev',
    text: 'Forge generating images, Mech scheduling — beautiful agent orchestration.',
    ts: 1793300500,
  },
];

export const xTweets = [
  {
    tweetId: 'x-twt-001',
    text: 'NEXUS AiOS v1.2 is live 🚀 Workflow engine, BUS v2, AGENT-A social operator. Thread 🧵',
    ts: 1793200000,
    likes: 1_200,
    reposts: 340,
  },
  {
    tweetId: 'x-twt-002',
    text: 'AGENT-A just posted her first Instagram draft. The agent that runs our socials is now live. 🤖📸',
    ts: 1793250000,
    likes: 890,
    reposts: 156,
  },
  {
    tweetId: 'x-twt-003',
    text: 'BUS v2 dispatcher + watcher = autonomous agent coordination. No more manual dispatching. 🤖',
    ts: 1793300000,
    likes: 650,
    reposts: 98,
  },
  {
    tweetId: 'x-twt-004',
    text: 'AGENT-A just approved a draft from Forge. The approval gate works. Human-in-the-loop preserved. ✅',
    ts: 1793350000,
    likes: 420,
    reposts: 67,
  },
  {
    tweetId: 'x-twt-005',
    text: 'Mech picked optimal posting slots for the week. AI scheduling > manual calendar. 📅',
    ts: 1793400000,
    likes: 380,
    reposts: 45,
  },
];

export const xMentions = [
  {
    mentionId: 'x-men-001',
    author: '@dev_rel',
    text: '@nexus_aios love the new workflow engine! Can we get a demo?',
    ts: 1793200500,
  },
  {
    mentionId: 'x-men-002',
    author: '@ai_news_daily',
    text: 'AGENT-A managing social media is a game changer for AI agents. @nexus_aios leading the pack.',
    ts: 1793250500,
  },
  {
    mentionId: 'x-men-003',
    author: '@codex_user',
    text: '@nexus_aios BUS v2 looks solid. Is the dispatcher open source?',
    ts: 1793300500,
  },
];

/**
 * Aggregated hub state for the SocialSource.getState() seam.
 */
export const socialHubState = {
  agent: {
    operator: 'AGENT-A',
    state: 'drafting',
    currentTask: 'контент-план на неделю',
    subAgents: [
      { key: 'forge', task: 'генерация обложки для X' },
      { key: 'mech', task: 'подбор слотов публикации' },
      { key: 'codex', task: null },
      { key: 'arch', task: 'ретроспектива охвата' },
    ],
  },
  accounts: [
    { network: 'telegram', handle: '@nexus_ops', state: 'connected', followers: 12500, reason: null },
    { network: 'instagram', handle: '@nexus.aios', state: 'connected', followers: 8200, reason: null },
    { network: 'youtube', handle: null, state: 'not-connected', followers: null, reason: 'OAuth не пройден' },
    { network: 'x', handle: '@nexus_aios', state: 'needs-review', followers: 3400, reason: 'scope post.write ждёт app review' },
  ],
};

export const socialSource = {
  getState: async () => socialHubState,
  listQueue: async () => socialQueue,
  listApprovals: async () => socialApprovals,
  respondApproval: async (id: string, decision: 'approve' | 'reject') => {
    const idx = socialApprovals.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const updated = { ...socialApprovals[idx], status: decision === 'approve' ? 'published' : 'rejected' as SocialPostStatus };
    socialApprovals[idx] = updated;
    return updated;
  },
  createDraft: async (input: { network: SocialNetworkId; text: string; media?: 'text' | 'image' | 'video'; scheduledAt?: string }) => {
    const newPost = {
      id: `sp-${String(socialQueue.length + 1).padStart(3, '0')}`,
      network: input.network,
      text: input.text,
      media: input.media ?? 'text',
      status: 'pending-approval' as SocialPostStatus,
      scheduledAt: input.scheduledAt ?? null,
      authorAgent: 'alice',
    };
    socialQueue.push(newPost);
    return newPost;
  },
  youtube: {
    listVideos: async () => youtubeVideos,
    listComments: async (videoId: string) => youtubeComments.filter((c) => c.videoId === videoId),
  },
  x: {
    listTweets: async () => xTweets,
    listMentions: async () => xMentions,
  },
};