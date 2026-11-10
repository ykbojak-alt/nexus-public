// HiveBid status/auction panel — native nx-app mod POC.
//
// MOCK FIXTURE by default — local/unfunded, NOT on-chain. No API/fetch/NEAR/
// signing/approve/deny, no actionable buttons. A static snapshot of a local
// auctioneer (docs/HIVEBID_ADAPTER_ENDPOINTS.md — local facade, backend
// "local", chain_submitted false) with AEGIS gating labels. When the host
// sets NEXUS_CORE_URL, an inert live-path performs one read-only
// coreApiRead("approvals") and lists real pending approvals/mutations;
// any failure keeps the fixture. Read-only either way — no chain calls.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, coreApiRead } from "nx";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function isApprovalsResponse(data) {
  return isRecord(data) && Array.isArray(data.approvals) && Array.isArray(data.mutations)
    && data.approvals.every(isRecord) && data.mutations.every(isRecord);
}

const MOCK = {
  label: "MOCK FIXTURE",
  source: "local/unfunded · not on-chain",
  generated_at: "2026-11-07",
  backend: { name: "local", chain_submitted: false },
  lots: [
    {
      id: "LOT-031", title: "Arbitrage agent — NEAR intent parsing", spec: "spec_ref 0x…9f1c",
      reserve: "2.0 NEAR (unfunded)", deadline_s: 2419200, bids: 3, status: "open",
      aegis: "post_lot: gate class TBD (owner W82) — not wired",
    },
    {
      id: "LOT-030", title: "On-chain audit dashboard", spec: "spec_ref 0x…b2a7",
      reserve: "1.5 NEAR (unfunded)", deadline_s: 1209600, bids: 5, status: "open",
      aegis: "post_lot: gate class TBD (owner W82) — not wired",
    },
    {
      id: "LOT-027", title: "Escrow UX research", spec: "spec_ref 0x…d4c3",
      reserve: "0.75 NEAR (unfunded)", deadline_s: 604800, bids: 2, status: "closed",
      aegis: "award: check_award() via gated_award() — local state only (no NEAR tx)",
      winner: "agent:codex", award: "local award enqueued — not chain-submitted",
    },
    {
      id: "LOT-025", title: "Reputation oracle prototype", spec: "spec_ref 0x…e0b9",
      reserve: "1.0 NEAR (unfunded)", deadline_s: 604800, bids: 1, status: "awarded",
      aegis: "release: check_release() via gated_release() — local only (accept_work NOT called)",
      winner: "agent:devin", release: "local settled — no NEAR accept_work",
    },
  ],
  summary: {
    open: 2, closed: 1, awarded: 1, released: 0,
    local_intents: 4, chain_submitted: 0,
  },
};

const STATUS = {
  open: { text: "open", color: t => t.working },
  closed: { text: "closed", color: t => t.dim },
  awarded: { text: "awarded", color: t => t.done },
  released: { text: "released", color: t => t.done },
  denied: { text: "denied", color: t => t.blocked },
};

export default class HiveBid extends View {
  init(_props, cx) {
    this.open = new Set();
    this.liveState = "loading";
    this.dataLabel = `${MOCK.label} · CHECKING CORE API`;
    this.live = null;
    cx.spawn(async (cx) => {
      try {
        const res = await coreApiRead("approvals");
        if (res.ok && res.status === 200 && isApprovalsResponse(res.data)) {
          this.live = res.data;
          const empty = res.data.approvals.length === 0 && res.data.mutations.length === 0;
          this.liveState = empty ? "empty" : "live";
          this.dataLabel = empty ? "LIVE · /api/core/approvals · EMPTY" : "LIVE · /api/core/approvals";
        } else if (res.disabled === true) {
          this.liveState = "disabled";
          this.dataLabel = `${MOCK.label} · API NOT CONFIGURED`;
        } else {
          this.liveState = "error";
          this.dataLabel = `${MOCK.label} · API ERROR`;
        }
      } catch (_) {
        this.liveState = "error";
        this.dataLabel = `${MOCK.label} · API ERROR`;
      }
      cx.notify();
    });
  }

  statusMessage() {
    if (this.liveState === "loading") return "Checking Core approvals · local auction fixture shown";
    if (this.liveState === "disabled") return "Core API not configured · local auction fixture shown";
    if (this.liveState === "error") return "Core read failed or returned an invalid response · local auction fixture shown";
    if (this.liveState === "empty") return "No approvals or mutations pending · auction fixture is not live chain state";
    return "Live AEGIS approvals read · not chain or auction state";
  }

  // Live view: real approvals/mutations scalar fields only — no fabrication.
  liveView(t) {
    const d = this.live || {};
    const approvals = Array.isArray(d.approvals) ? d.approvals : [];
    const mutations = Array.isArray(d.mutations) ? d.mutations : [];
    const fields = (o) => Object.entries(o || {}).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
    const row = (o, i) => h_flex().gap(8).items_baseline().px(8).py(3).rounded(6).bg(t.surface)
      .children(fields(o).slice(0, 6).map(([k, v]) => h_flex().gap(4).flex_none()
        .child(div().text_size(10).text_color(t.muted).child(`${k}:`))
        .child(div().text_size(10).text_color(t.foreground).child(String(v)))));
    return v_flex().id("hivebid").size_full().min_h(0).bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).rounded(10).overflow_hidden()
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("HiveBid"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.working).child(this.dataLabel))
        .child(div().text_size(11).text_color(t.dim).child("READ-ONLY · LIVE coreApiRead"))
        .child(div().text_size(11).text_color(t.dim).child(`${approvals.length} pending · ${mutations.length} mutations`)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(4)
        .children([
          approvals.length ? div().px(8).pt(4).text_size(10).font_semibold().text_color(t.muted).child("PENDING APPROVALS") : null,
          ...approvals.slice(0, 20).map((a, i) => row(a, i)),
          mutations.length ? div().px(8).pt(6).text_size(10).font_semibold().text_color(t.muted).child("MUTATIONS") : null,
          ...mutations.slice(0, 20).map((m, i) => row(m, i)),
          approvals.length + mutations.length === 0 ? div().p(10).text_size(11).text_color(t.dim).child("No approvals or mutations.") : null,
        ].filter(Boolean)))
      .child(h_flex().flex_none().px(14).py(6).border_t(1).border_color(t.border)
        .child(div().text_size(10).text_color(t.dim).child(`READ-ONLY · ${this.statusMessage()} · no chain/signing/approve/deny.`)));
  }

  // Read-only status chip.
  chip(status, t) {
    const s = STATUS[status] || { text: status, color: () => t.dim };
    return div().flex_none().text_size(11).text_color(s.color(t)).child(s.text);
  }

  lotRow(l, t) {
    const expanded = this.open.has(l.id);
    const st = STATUS[l.status] || { text: l.status, color: () => t.dim };
    const main = v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(t.muted).child(l.id))
        .child(div().text_size(12).font_semibold().truncate().child(l.title))
        .child(div().flex_1())
        .child(this.chip(l.status, t)))
      .child(div().text_size(11).text_color(t.dim).truncate().child(`${l.reserve} · ${l.bids} bids · ${l.spec}`));
    const row = h_flex().gap(8).items_center().px(8).py(6).rounded(8).cursor_pointer()
      .hover(s => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (this.open.has(l.id)) this.open.delete(l.id); else this.open.add(l.id);
        cx.notify();
      })
      .child(main)
      .child(div().flex_none().text_size(10).text_color(t.dim).child(`dl ${Math.round(l.deadline_s / 86400)}d`));
    const detail = expanded
      ? v_flex().flex_none().px(8).pb(6).gap(3)
          .child(div().text_size(11).text_color(t.muted).child(`AEGIS: ${l.aegis}`))
          .when(Boolean(l.winner), el => el.child(div().text_size(11).text_color(t.foreground).child(`winner ${l.winner} — ${l.award}`)))
          .when(Boolean(l.release), el => el.child(div().text_size(11).text_color(t.foreground).child(l.release)))
          .child(div().text_size(10).text_color(t.dim).child("⚠ read-only display — no actionable buttons"))
      : null;
    return v_flex().flex_none().children(detail ? [row, detail] : [row]);
  }

  render(_cx) {
    const t = theme();
    if (this.liveState === "live" || this.liveState === "empty") return this.liveView(t);
    return v_flex().id("hivebid").size_full().min_h(0).bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).rounded(10).overflow_hidden()
      // Header
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("HiveBid"))
        .child(div().flex_1())
        .child(div().flex_none().items_center().gap(4))
          .child(div().text_size(11).text_color(t.working).child(this.dataLabel))
        .child(div().text_size(11).text_color(t.dim).child("READ-ONLY · LOCAL AUCTION FIXTURE"))
          .child(div().text_size(11).text_color(t.dim).child(MOCK.generated_at)))
      // Backend strip: local/unfunded, not on-chain
      .child(h_flex().flex_none().px(14).py(6).gap(6).items_center().bg(t.surface).border_b(1).border_color(t.border)
        .child(h_flex().flex_none().px(14).py(6).gap(6).items_center().bg(t.surface).border_b(1).border_color(t.border))
        .child(div().text_size(11).text_color(t.ansi4).child("local"))
        .child(div().text_size(11).text_color(t.dim).child("local/unfunded · not on-chain"))
        .child(div().text_size(11).text_color(t.blocked).child("chain_submitted: false"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(MOCK.source)))
      // Summary line
      .child(h_flex().flex_none().px(14).py(6).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).child(`${MOCK.summary.open} open · ${MOCK.summary.closed} closed · ${MOCK.summary.awarded} awarded · ${MOCK.summary.released} released`))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(`${MOCK.summary.local_intents} local intents · ${MOCK.summary.chain_submitted} chain-submitted`)))
      // Lots
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
        .children(MOCK.lots.map(l => this.lotRow(l, t))))
      // Footer
      .child(h_flex().flex_none().px(14).py(6).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().text_size(10).text_color(t.dim).child(`${MOCK.label}: ${MOCK.source} — READ-ONLY · ${this.statusMessage()} · no chain/signing.`)));
  }
}
