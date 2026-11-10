// Read-only ratings panel. Renders a local snapshot by default; when the
// host has NEXUS_CORE_URL configured it performs a single read-only
// coreApiRead("ratings") call and switches to live data. No writes, no
// arbitrary endpoints — the resource is fixed by the host allowlist.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, coreApiRead } from "nx";

const SNAPSHOT_LABEL = "LOCAL SNAPSHOT 2026-11-08";
const LIVE_LABEL = "LIVE · /api/core/ratings";

// Fixture mirrors GET /api/core/ratings; it is local synthetic data, not live.
const MOCK_RATINGS_CORE_RESPONSE = {
  "ratings": {
    "spark": {
      "score": 9.3,
      "updated_ts": 1794096028,
      "history": [
        {
          "task": "coreApiRead seam + runbook + fixture",
          "score": 9.0,
          "ts": 1794092428,
          "note": "wave 11-08"
        },
        {
          "task": "mobile relay pipe/socket/corelock",
          "score": 9.5,
          "ts": 1794088828,
          "note": "NEO2 code-vet PASS"
        },
        {
          "task": "HiveBid drift check+fix docs",
          "score": 9.5,
          "ts": 1794094228,
          "note": "5 findings"
        },
        {
          "task": "NEXUSLINK surfaces + relay obs/conf/e2e",
          "score": 9.0,
          "ts": 1794095128,
          "note": "wave2"
        }
      ]
    },
    "neo2": {
      "score": 9.3,
      "updated_ts": 1794096028,
      "history": [
        {
          "task": "H-AUDIT P0 findings",
          "score": 9.5,
          "ts": 1794088028,
          "note": "drove wave"
        },
        {
          "task": "syntax blocker + provenance + baseline",
          "score": 9.5,
          "ts": 1794092028,
          "note": "NEO2 reviews"
        },
        {
          "task": "acceptance crosscheck 5/5 verified",
          "score": 9.0,
          "ts": 1794094028,
          "note": "self-correction"
        },
        {
          "task": "tick-patch vet",
          "score": 9.0,
          "ts": 1794095428,
          "note": "wave5"
        }
      ]
    },
    "forge": {
      "score": 9.1,
      "updated_ts": 1794096028,
      "history": [
        {
          "task": "AEGIS/HackWatch/HiveBid specs",
          "score": 9.0,
          "ts": 1794089028,
          "note": "readonly specs"
        },
        {
          "task": "acceptance matrix + owner brief",
          "score": 9.5,
          "ts": 1794093028,
          "note": "owner gates"
        },
        {
          "task": "doc waves 1-5 (15+ docs)",
          "score": 9.0,
          "ts": 1794095028,
          "note": "INDEX..MORNING_CHECKLIST"
        }
      ]
    },
    "codex": {
      "score": 8.7,
      "updated_ts": 1794096028,
      "history": [
        {
          "task": "ratings adapter R-NT1+R-NT2",
          "score": 9.0,
          "ts": 1794088528,
          "note": "normalize+docs"
        },
        {
          "task": "config audit+CONFIG blocks",
          "score": 8.5,
          "ts": 1794092528,
          "note": "NEO2 PASS"
        },
        {
          "task": "tick hardening + nl slots + sysmon",
          "score": 8.5,
          "ts": 1794095228,
          "note": "wave W3-W5"
        }
      ]
    },
    "ace": {
      "score": 8.1,
      "updated_ts": 1794096028,
      "history": [
        {
          "task": "nexustick fix + NAV-1 tabs + labels",
          "score": 8.5,
          "ts": 1794090028,
          "note": "NEO2 verified"
        },
        {
          "task": "A-MAP + VS-1 labels",
          "score": 8.0,
          "ts": 1794093528,
          "note": "report retry"
        },
        {
          "task": "A-WAVE W1-W5",
          "score": 8.0,
          "ts": 1794095528,
          "note": "in progress"
        }
      ]
    }
  }
};

const AGENT_DISPLAY_NAMES = Object.freeze({
  alice: "AGENT-A",
  spark: "S.P.A.R.K.",
  forge: "AGENT-B",
  codex: "AGENT-C",
  ace: "A.C.E.",
  neo2: "AGENT-D",
  qoder: "AGENT-E",
  arch: "A.R.C.H.",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 10;
}

function normalizeRatings(response) {
  if (!isRecord(response) || !isRecord(response.ratings)) return null;

  const entries = Object.entries(response.ratings);
  if (entries.some(([agentId, rating]) =>
    !agentId || !isRecord(rating) || !isValidScore(rating.score))) return null;

  return entries.map(([agentId, rating]) => {

    const history = Array.isArray(rating.history)
      ? rating.history.flatMap((item) => {
          if (!isRecord(item) || typeof item.task !== "string" || !isValidScore(item.score)) return [];
          const normalized = { task: item.task, score: item.score, ts: Number.isFinite(item.ts) ? item.ts : null };
          if (typeof item.note === "string") normalized.note = item.note;
          return [normalized];
        })
      : [];

    return {
      id: agentId,
      name: Object.prototype.hasOwnProperty.call(AGENT_DISPLAY_NAMES, agentId)
        ? AGENT_DISPLAY_NAMES[agentId]
        : agentId,
      score: rating.score,
      history,
    };
  });
}

const MOCK_RATINGS = normalizeRatings(MOCK_RATINGS_CORE_RESPONSE);

function scoreTone(t, score) {
  if (score >= 8) return t.done;
  if (score >= 5) return t.working;
  return t.blocked;
}

function meter(t, score) {
  const width = Math.round(96 * Math.max(0, Math.min(10, score)) / 10);
  return h_flex()
    .w(96)
    .h(6)
    .flex_none()
    .rounded(3)
    .bg(t.border)
    .child(div().w(width).h(6).rounded(3).bg(scoreTone(t, score)));
}

function historyRow(t, record, history, index) {
  return h_flex()
    .id(`ratings-${record.id}-history-${index}`)
    .h(24)
    .gap(8)
    .items_center()
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(11.5)
        .text_color(t.muted)
        .child(history.task),
    )
    .child(
      div()
        .flex_none()
        .text_size(11)
        .font_medium()
        .text_color(scoreTone(t, history.score))
        .child(history.score.toFixed(1)),
    );
}

function ratingCard(t, record) {
  const history = record.history ?? [];
  return v_flex()
    .id(`ratings-${record.id}`)
    .flex_none()
    .p(10)
    .gap(8)
    .rounded(9)
    .bg(t.surface)
    .border_1()
    .border_color(t.border)
    .child(
      h_flex()
        .gap(9)
        .items_center()
        .child(
          div()
            .size(30)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(8)
            .bg(t.raised)
            .text_size(11)
            .font_semibold()
            .text_color(t.accent)
            .child(record.name.slice(0, 1)),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(
              div()
                .truncate()
                .text_size(13)
                .font_semibold()
                .text_color(t.foreground)
                .child(record.name),
            )
            .child(
              div()
                .truncate()
                .text_size(10)
                .text_color(t.dim)
                .child(record.id),
            ),
        )
        .child(
          v_flex()
            .flex_none()
            .items_end()
            .gap(1)
            .child(
              div()
                .text_size(16)
                .font_semibold()
                .text_color(scoreTone(t, record.score))
                .child(record.score.toFixed(1)),
            )
            .child(div().text_size(9.5).text_color(t.dim).child("out of 10")),
        ),
    )
    .child(h_flex().items_center().justify_between().child(meter(t, record.score)).child(div().text_size(10).text_color(t.dim).child(`${history.length} samples`)))
    .child(
      v_flex()
        .gap(1)
        .children(history.map((item, index) => historyRow(t, record, item, index))),
    );
}

export default class Ratings extends View {
  init(_props, cx) {
    // Keep the local snapshot visible during loading and on any unusable read.
    this.ratings = MOCK_RATINGS;
    this.dataLabel = `${SNAPSHOT_LABEL} · CHECKING CORE API`;
    this.liveState = "loading";
    cx.spawn(async (cx) => {
      try {
        const res = await coreApiRead("ratings");
        if (res.ok && res.status === 200) {
          const live = normalizeRatings(res.data);
          if (live !== null) {
            this.ratings = live;
            this.liveState = live.length > 0 ? "live" : "empty";
            this.dataLabel = live.length > 0 ? LIVE_LABEL : `${LIVE_LABEL} · EMPTY`;
          } else {
            this.liveState = "error";
            this.dataLabel = `${SNAPSHOT_LABEL} · INVALID API RESPONSE`;
          }
        } else if (res.disabled === true) {
          this.liveState = "disabled";
          this.dataLabel = `${SNAPSHOT_LABEL} · API NOT CONFIGURED`;
        } else {
          this.liveState = "error";
          this.dataLabel = `${SNAPSHOT_LABEL} · API ERROR`;
        }
      } catch (_) {
        this.liveState = "error";
        this.dataLabel = `${SNAPSHOT_LABEL} · API ERROR`;
      }
      cx.notify();
    });
  }

  stateMessage() {
    if (this.liveState === "loading") return "Checking Core read API · local snapshot shown";
    if (this.liveState === "disabled") return "Core API not configured · local snapshot shown";
    if (this.liveState === "error") return "Core read failed or returned invalid data · local snapshot shown";
    if (this.liveState === "empty") return "Core returned a valid ratings response with no agents";
    return "From Core read API";
  }

  render() {
    const t = theme();
    // The displayed per-agent score is copied from the response; this aggregate
    // is only the existing fixture summary and is never fed back into a rating.
    const average = this.ratings.length
      ? this.ratings.reduce((sum, item) => sum + item.score, 0) / this.ratings.length
      : null;
    const live = this.liveState === "live" || this.liveState === "empty";
    return v_flex()
      .id("ratings-root")
      .size_full()
      .min_h(0)
      .gap(10)
      .p(12)
      .bg(t.chrome)
      .text_color(t.foreground)
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .justify_between()
          .pb(8)
          .border_b(1)
          .border_color(t.border)
          .child(
            v_flex()
              .gap(2)
              .child(div().text_size(15).font_semibold().child("Agent ratings"))
              .child(div().text_size(10).text_color(t.dim).child(`${this.ratings.length} sample agents`)),
          )
          .child(
            div()
              .px(8)
              .py(4)
              .rounded(5)
              .bg(t.raised)
              .text_size(9.5)
              .font_semibold()
              .text_color(t.accent)
              .child(this.dataLabel),
          ),
      )
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .justify_between()
          .p(10)
          .rounded(8)
          .bg(t.surface)
          .border_1()
          .border_color(t.border)
          .child(
            v_flex()
              .gap(2)
              .child(div().text_size(10).text_color(t.muted).child(live ? "LIVE AVERAGE" : "SNAPSHOT AVERAGE"))
              .child(div().text_size(12).text_color(t.foreground).child(this.stateMessage())),
          )
          .child(
            div()
              .text_size(22)
              .font_semibold()
              .text_color(average === null ? t.dim : scoreTone(t, average))
              .child(average === null ? "— / 10" : `${average.toFixed(1)} / 10`),
          ),
      )
      .child(
        v_flex()
          .id("ratings-list")
          .flex_1()
          .min_h(0)
          .gap(8)
          .overflow_y_scrollbar()
          .children(this.ratings.length
            ? this.ratings.map((record) => ratingCard(t, record))
            : [div().p(10).text_size(11).text_color(t.dim).child(live ? "No ratings recorded yet." : "No local snapshot rows available.")]),
      )
      .child(
        div()
          .flex_none()
          .pt(6)
          .border_t(1)
          .border_color(t.border)
          .text_size(10)
          .text_color(t.dim)
          .child(live ? "READ-ONLY · LIVE coreApiRead" : `READ-ONLY · LOCAL SNAPSHOT · ${this.liveState.toUpperCase()}`),
      );
  }
}
