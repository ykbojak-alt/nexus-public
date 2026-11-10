/**
 * Webhook contracts — /v1/webhooks[/id[/deliveries]].
 * created_at/finished_at/next_at arrive as ISO-8601 strings (server `iso()`),
 * unlike run/memory rows which use unix seconds.
 */

export interface Ai2Webhook {
  webhookId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

/** Only POST /v1/webhooks ever carries the signing secret. */
export interface Ai2CreatedWebhook extends Ai2Webhook {
  secret: string;
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
  /** ≥16 chars; absent → server generates. */
  secret?: string;
}

/** null-valued fields are rejected by the server (422) — omit instead. */
export interface PatchWebhookInput {
  url?: string;
  events?: string[];
  secret?: string;
  active?: boolean;
}

/** Row from GET /v1/webhooks/{id}/deliveries (timestamps ISO). */
export interface Ai2WebhookDelivery {
  deliveryId: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed' | string;
  attempts: number;
  nextAt?: string | null;
  lastCode?: number | null;
  lastError?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}
