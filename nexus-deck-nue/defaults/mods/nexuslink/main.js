// NexusLink gateway status: health, providers, per-key metrics, blacklist.
// Polls the configured gateway status endpoint every 5s.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, exec } from "nx";

// CONFIG: override here until Deck provides a mod-specific config source.
const CONFIG = Object.freeze({
  gatewayBaseUrl: "https://gateway.example.invalid",
});
const HOST = CONFIG.gatewayBaseUrl.replace(/^https?:\/\//, "");
// Static inventory provided for this source-only panel; it is not fetched live.
const SLOT_MODELS = Object.freeze([
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);
const GOLD = "#d4af37";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
const dur = (s) => !Number.isFinite(s) ? "—" : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
const ms = (v) => !Number.isFinite(v) ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;

export default class NexusLink extends View {
  init(_props, cx) {
    this.st = null;
    this.gatewayState = "loading";
    this.gatewayError = null;
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
  }

  // В рантайме модов нет setTimeout/AbortController — ограничиваем висячий
  // fetch по тикам (5с): 3 пропуска ≈ 15с максимум, затем ticket отсекает
  // поздний ответ. Один висячий сокет не плодит новые (single-flight) и не
  // залипает статус навсегда.
  refresh(cx) {
    if (this._pending) {
      this._missed = (this._missed || 0) + 1;
      if (this._missed < 3) return;
      this._pending = false;
      this._missed = 0;
      this.gatewayState = "error";
      this.gatewayError = "No response for 15s; retrying every 5s.";
      cx.notify();
    }
    this._pending = true;
    const ticket = (this._ticket = {});
    cx.spawn(async (cx) => {
      const finish = () => {
        this._pending = false;
        this._missed = 0;
        cx.notify();
      };
      let h;
      try {
        h = await fetch(CONFIG.gatewayBaseUrl + "/api/status");
      } catch {
        if (this._ticket !== ticket) return;
        this.st = null;
        this.gatewayState = "unreachable";
        this.gatewayError = "Gateway could not be reached; retrying every 5s.";
        finish();
        return;
      }
      if (this._ticket !== ticket) return;
      if (!h.ok) {
        this.st = null;
        this.gatewayState = "error";
        this.gatewayError = `Gateway returned HTTP ${h.status}.`;
        finish();
        return;
      }
      try {
        const data = await h.json();
        if (this._ticket !== ticket) return;
        if (!isRecord(data) || data.ok !== true) {
          this.st = isRecord(data) ? data : null;
          this.gatewayState = "error";
          this.gatewayError = isRecord(data) && data.ok === false
            ? "Gateway reports not ready."
            : "Gateway returned an invalid status payload.";
        } else {
          this.st = {
            ...data,
            metrics: Array.isArray(data.metrics) ? data.metrics.filter(isRecord) : [],
            blacklist: Array.isArray(data.blacklist) ? data.blacklist : [],
          };
          this.gatewayState = "online";
          this.gatewayError = null;
        }
      } catch {
        if (this._ticket !== ticket) return;
        this.st = null;
        this.gatewayState = "error";
        this.gatewayError = "Gateway returned invalid JSON.";
      }
      finish();
    });
  }

  open(cx) {
    cx.spawn(async () => { try { await exec("cmd", ["/c", "start", CONFIG.gatewayBaseUrl], {}); } catch {} });
  }

  stat(t, label, value) {
    return v_flex().flex_1().gap(1)
      .child(div().text_size(9).text_color(t.dim).child(label))
      .child(div().text_size(12).font_semibold().child(String(value)));
  }

  slotCatalog(t, up) {
    const gatewayState = up ? "gateway online"
      : this.gatewayState === "loading" ? "checking gateway"
      : this.gatewayState === "unreachable" ? "gateway unreachable"
      : "gateway error";
    const rows = [];
    for (let i = 0; i < SLOT_MODELS.length; i += 2) {
      rows.push(h_flex().gap(8)
        .child(div().flex_1().min_w(0).truncate().text_size(9).text_color(t.muted).child(SLOT_MODELS[i]))
        .child(div().flex_1().min_w(0).truncate().text_size(9).text_color(t.muted).child(SLOT_MODELS[i + 1])));
    }
    return v_flex().flex_none().px(12).py(6).gap(3).border_b(1).border_color(t.border)
      .child(h_flex().items_center()
        .child(div().text_size(9).font_semibold().text_color(t.dim).child("SLOT CATALOG · STATIC / NOT LIVE"))
        .child(div().flex_1())
        .child(div().text_size(9).text_color(up ? t.ansi2 : this.gatewayState === "loading" ? t.dim : t.ansi1).child(gatewayState)))
      .children(rows);
  }

  keyRow(t, m, i) {
    const [provider, model, key] = (typeof m.scope === "string" ? m.scope : "").split("|");
    const ok = count(m.ok), fail = count(m.fail);
    const total = ok + fail;
    const rate = total ? Math.round(100 * ok / total) : 100;
    const bad = fail > 0 && rate < 90;
    return v_flex().id(`nl-k-${i}`).px(8).py(4).rounded(5).gap(2)
      .hover((s) => s.bg(t.hover))
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().min_w(0).truncate().text_size(11).child(`${provider} · ${model}`))
        .child(div().flex_1())
        .child(div().flex_none().text_size(10).text_color(t.dim).child(key || "")))
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(10).text_color(rate >= 90 ? t.ansi2 : t.ansi1).child(`${ok}ok ${fail}err ${rate}%`))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(t.muted).child(`avg ${ms(m.avg_ms)}`))
        .child(div().text_size(10).text_color(t.dim).child(`last ${ms(m.last_ms)}`)))
      .when(typeof m.note === "string" && m.note, (e) => e.child(div().text_size(9).text_color(t.blocked).truncate().child(m.note)));
  }

  render(cx) {
    const t = theme(), s = this.st;
    const up = s?.ok === true && this.gatewayState === "online";
    const metrics = Array.isArray(s?.metrics) ? s.metrics.filter(isRecord) : [];
    const totals = metrics.reduce((a, m) => ({ ok: a.ok + count(m.ok), fail: a.fail + count(m.fail) }), { ok: 0, fail: 0 });
    const badge = this.gatewayState === "loading" ? "loading"
      : this.gatewayState === "online" ? "online"
      : this.gatewayState === "unreachable" ? "unreachable" : "error";
    const badgeColor = this.gatewayState === "online" ? t.ansi2
      : this.gatewayState === "loading" ? t.dim : t.ansi1;
    return v_flex().id("nexuslink").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().w(8).h(8).flex_none().rounded(4).bg(badgeColor))
        .child(div().font_semibold().text_color(GOLD).child("NexusLink"))
        .when(s?.version, (e) => e.child(div().text_size(10).text_color(t.dim).child(`v${s.version}`)))
        .child(div().flex_1())
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10)
          .text_color(badgeColor).child(badge)))
      .child(h_flex().h(30).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).truncate().child(HOST))
        .child(div().flex_1())
        .child(h_flex().px(8).h(22).rounded(6).items_center().cursor_pointer().bg(t.hover).border_1().border_color(t.border)
          .hover((x) => x.bg(t.selected))
          .on_click((_e, cx) => this.open(cx))
          .child(div().text_size(11).child("Open panel"))))
      .child(this.slotCatalog(t, up))
      .when(up, (e) => e
        .child(h_flex().flex_none().px(14).py(8).gap(10).border_b(1).border_color(t.border)
          .child(this.stat(t, "PROVIDERS", s.providers ?? 0))
          .child(this.stat(t, "SLOTS", s.slots ?? 0))
          .child(this.stat(t, "REQUESTS", totals.ok + totals.fail))
          .child(this.stat(t, "UPTIME", dur(s.uptime_s ?? 0))))
        .child(v_flex().id("nl-keys").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
          .when(!metrics.length, (x) => x.child(div().p(8).text_size(11).text_color(t.dim)
            .child("No traffic yet — counters appear after the first request.")))
          .children(metrics.map((m, i) => this.keyRow(t, m, i))))
        .when(Array.isArray(s.blacklist) && s.blacklist.length > 0, (x) => x.child(
          v_flex().flex_none().px(10).py(6).gap(3).border_t(1).border_color(t.border)
            .child(div().text_size(10).text_color(t.blocked).child(`blacklist: ${s.blacklist.length}`))
            .children(s.blacklist.slice(0, 5).map((b, i) =>
              div().id(`nl-bl-${i}`).text_size(10).text_color(t.dim).truncate().child(typeof b === "string" ? b : JSON.stringify(b)))))))
      .when(!up, (e) => e.child(div().p(10).text_size(11).text_color(this.gatewayState === "loading" ? t.dim : t.ansi1)
        .child(this.gatewayError ?? "Checking the configured gateway; retrying every 5s.")));
  }
}
