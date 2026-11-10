// HackWatch dashboard — native nx-app mod POC.
//
// MOCK FIXTURE by default — no live API/chain calls. These rows are a static
// snapshot of the HackWatch ranking model (D:\hackwatch\hackwatch.json),
// taken 2026-11-07, showing the layout only. When the host sets
// NEXUS_CORE_URL, an inert live-path performs one read-only
// coreApiRead("audit") and lists real audit entries; any failure keeps the
// fixture. Read-only either way — no live API/chain calls from the mod.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, coreApiRead } from "nx";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function isAuditResponse(data) {
  return isRecord(data) && Array.isArray(data.entries) && Number.isFinite(data.total)
    && data.entries.every(isRecord);
}

const MOCK = {
  label: "MOCK FIXTURE",
  source: "D:\\hackwatch\\hackwatch.json",
  generated_at: "2026-11-07",
  our_project: { rank: 28, name: "NEXUS AiOS", win_prob: 6.9 },
  // top 6 by rank (snapshot; full model has 111 rows)
  rows: [
    {
      rank: 1, project_name: "Veto: on-chain spending firewall for AI agents on NEAR",
      tracks: ["security", "agents"],
      demo: { url: "https://x.com/tarantinbv/status/2116528585829720403", live: true, http: 200, assessment: "real_demo" },
      win_prob: 8.6, strength: 7, maturity: 7,
      rationale: "Solid implementation with real contract usage and live demo.",
      verdict: "Strong security agent track fit with practical on-chain control.",
    },
    {
      rank: 2, project_name: "Tollgate",
      tracks: ["agents", "realworld"],
      demo: { url: "https://x.com/TensorustAI/status/2116926310991716394", live: true, http: 200, assessment: "real_demo" },
      win_prob: 8.2, strength: 7, maturity: 6,
      rationale: "Live site, functional agent, concrete NEAR usage, strong track fit.",
      verdict: "Polished real-world agent leveraging NEAR; promising hackathon entry.",
    },
    {
      rank: 3, project_name: "Tollgate",
      tracks: ["security", "agents"],
      demo: { url: "https://x.com/smartkdy7/status/2116830600229478794", live: true, http: 200, assessment: "real_demo" },
      win_prob: 8.1, strength: 7, maturity: 6,
      rationale: "Solid implementation with real NEAR integration and clear security/agent use case.",
      verdict: "Competitive submission with practical security application on NEAR.",
    },
    {
      rank: 4, project_name: "AgentEscrow",
      tracks: ["security", "agents"],
      demo: { url: "https://x.com/dele_dave/status/2117911300516823327", live: true, http: 200, assessment: "real_demo" },
      win_prob: 7.9, strength: 6, maturity: 6,
      rationale: "Working escrow for agents on NEAR",
      verdict: "Solid security-agent integration, demo works",
    },
    {
      rank: 5, project_name: "x402-near",
      tracks: ["security", "agents", "realworld"],
      demo: { url: "https://x.com/dahlinomine/status/2117355110842142727", live: true, http: 200, assessment: "real_demo" },
      win_prob: 7.9, strength: 6, maturity: 6,
      rationale: "Working demo and clear NEAR tie, but depth unknown.",
      verdict: "Promising continuation, needs more technical depth.",
    },
    {
      rank: 6, project_name: "AgentGuard",
      tracks: ["privacy", "business", "security", "agents"],
      demo: { url: "https://x.com/MyCryptoWallet/status/2116833046041416166?a=uMtKktqYxtIvcmKmBxM&s=20", live: true, http: 200, assessment: "real_demo" },
      win_prob: 7.8, strength: 6, maturity: 6,
      rationale: "Implementation appears real with live site, but depth unverified.",
      verdict: "Promising agent security concept on NEAR.",
    },
  ],
};

// Fixture statuses are historical snapshot data, not a current live check.
function demoBadge(r, t) {
  const d = r.demo;
  if (d.live) {
    const ok = d.http === 200;
    return { text: ok ? "snapshot: live" : `snapshot: http ${d.http}`, color: ok ? t.ansi2 : t.ansi1 };
  }
  return { text: "snapshot: no demo", color: t.dim };
}

export default class HackWatch extends View {
  init(_props, cx) {
    this.open = new Set();
    this.liveState = "loading";
    this.dataLabel = `${MOCK.label} · CHECKING CORE API`;
    this.live = null;
    cx.spawn(async (cx) => {
      try {
        const res = await coreApiRead("audit");
        if (res.ok && res.status === 200 && isAuditResponse(res.data)) {
          this.live = res.data;
          const empty = res.data.entries.length === 0;
          this.liveState = empty ? "empty" : "live";
          this.dataLabel = empty ? "LIVE · /api/core/audit · EMPTY" : "LIVE · /api/core/audit";
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
    if (this.liveState === "loading") return "Checking Core audit read · ranking snapshot shown";
    if (this.liveState === "disabled") return "Core API not configured · ranking snapshot shown";
    if (this.liveState === "error") return "Core read failed or returned an invalid response · ranking snapshot shown";
    if (this.liveState === "empty") return "No audit entries yet · ranking snapshot is not live data";
    return "Live audit trail · not the ranking model";
  }

  // Live view: real audit entries only — ts/action/subject/decision, no fabrication.
  liveView(t) {
    const d = this.live || {};
    const entries = Array.isArray(d.entries) ? d.entries : [];
    return v_flex().id("hackwatch").size_full().min_h(0).bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).rounded(10).overflow_hidden()
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("HackWatch"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.working).child(this.dataLabel))
        .child(div().text_size(11).text_color(t.dim).child("READ-ONLY · LIVE coreApiRead"))
        .child(div().text_size(11).text_color(t.dim).child(`${d.total ?? entries.length} entries`)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
        .children([...entries.slice(0, 50).map((e, i) => h_flex().gap(8).items_center().px(8).py(3).rounded(6).bg(t.surface)
          .child(div().flex_none().w(52).text_size(10).text_color(e.decision === "deny" ? t.blocked : e.decision === "allow" ? t.done : t.working).child(String(e.decision || "—")))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground).child(String(e.action || "—")))
          .child(div().flex_none().max_w(180).truncate().text_size(10).text_color(t.muted).child(String(e.subject || "—")))
          .child(div().flex_none().text_size(10).text_color(t.dim).child(e.ts ? new Date(e.ts > 1e12 ? e.ts : e.ts * 1000).toISOString().slice(0, 19) : "—"))),
          ...(entries.length === 0 ? [div().p(10).text_size(11).text_color(t.dim).child("No audit entries.")] : [])]))
      .child(h_flex().flex_none().px(14).py(6).border_t(1).border_color(t.border)
      .child(div().text_size(10).text_color(t.dim).child(`READ-ONLY · ${this.statusMessage()}.`)));
  }

  row(r, t) {
    const expanded = this.open.has(r.rank);
    const badge = demoBadge(r, t);
    const p = div().flex_1().min_w(0)
      .child(h_flex().gap(6).items_center()
        .child(div().truncate().font_semibold().child(`${r.rank}. ${r.project_name}`))
        .child(div().flex_none().text_size(11).text_color(badge.color).child(badge.text)))
      .child(div().text_size(11).text_color(t.dim).truncate().child(r.tracks.join(" · ")));
    const score = div().flex_none().text_right()
      .child(div().text_size(14).font_semibold().text_color(t.accent).child(r.win_prob.toFixed(1)))
      .child(div().text_size(10).text_color(t.dim).child(`strength ${r.strength} · mat ${r.maturity}`));
    const head = h_flex().id(`hw-${r.rank}`).w(28).flex_none().rounded(6).items_center()
      .child(div().size_full().text_center().text_size(11).text_color(expanded ? t.accent : t.muted).child(String(r.rank)));
    const main = h_flex().h(52).flex_none().gap(8).items_center().px(8).rounded(8).cursor_pointer()
      .hover(s => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (this.open.has(r.rank)) this.open.delete(r.rank); else this.open.add(r.rank);
        cx.notify();
      })
      .child(head).child(p).child(score);
    const detail = expanded ? h_flex().flex_none().px(8).pb(8).gap(8).items_start()
      .child(div().w(28).flex_none())
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(11).text_color(t.muted).child(`snapshot · ${r.demo.assessment} — ${r.demo.url}`))
        .child(div().text_size(12).text_color(t.foreground).child(r.verdict))
        .child(div().text_size(11).text_color(t.dim).child(r.rationale)))
      : null;
    return v_flex().flex_none().children(detail ? [main, detail] : [main]);
  }

  render(_cx) {
    const t = theme();
    if (this.liveState === "live" || this.liveState === "empty") return this.liveView(t);
    return v_flex().id("hackwatch").size_full().min_h(0).bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).rounded(10).overflow_hidden()
      // header
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("HackWatch"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.working).child(this.dataLabel))
        .child(div().text_size(11).text_color(t.dim).child("READ-ONLY · MOCK RANKING"))
        .child(div().text_size(11).text_color(t.dim).child(MOCK.generated_at)))
      // our project strip
      .child(h_flex().flex_none().px(14).py(6).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.muted).child("our project"))
        .child(div().text_size(12).font_semibold().child(MOCK.our_project.name))
        .child(div().flex_1())
        .child(div().text_size(12).text_color(t.accent).child(`#${MOCK.our_project.rank}`))
        .child(div().text_size(12).text_color(t.accent).child(MOCK.our_project.win_prob.toFixed(1))))
      // rows
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
        .children(MOCK.rows.map(r => this.row(r, t))))
      // footer
      .child(h_flex().flex_none().px(14).py(6).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().text_size(10).text_color(t.dim).child(`${MOCK.label}: static snapshot of ${MOCK.source} — READ-ONLY · ${this.statusMessage()}.`)));
  }
}
