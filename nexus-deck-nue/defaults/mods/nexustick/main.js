// NexusTick — orchestration heartbeat: periodic `nx send <target> <msg>`.
// The two approved targets are defined once in CONFIG_LINES below.
// Lux-style panel: per-line countdown, progress, send-now/pause/interval, shared log.
//
// OWNER A-NT1: both lines start PAUSED; init/timer can never send on their own.
// Auto-send starts only via explicit user START; SEND is an explicit user action.
// Send goes through exec("nx", ["send", target, msg], {}) — argv, no shell.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup } from "gpui-base";
import { theme, exec, terminals, shared, setShared } from "nx";

const GOLD = "#d4af37";
const INTERVALS = [1, 5, 10, 15, 30, 60];
const MIN_SEND_INTERVAL_MS = 1000;
const SEND_DEDUP_WINDOW_MS = 10_000;

// CONFIG: override here until Deck provides a mod-specific config source.
// Current approved orchestration addresses (owner A-NT1 roster); local allowlist.
const CONFIG_LINES = Object.freeze([
  Object.freeze({ key: "orchestrator", name: "Orchestrator", icon: "◆", target: "local/agent1", defMsg: "[tick] continue orchestration" }),
  Object.freeze({ key: "opencode", name: "A.C.E.", icon: "♠", target: "t1r", defMsg: "продолжай" }),
]);

export default class NexusTick extends View {
  init(_props, cx) {
    this.lines = CONFIG_LINES.map((L) => {
      const line = {
        key: L.key, name: L.name, icon: L.icon, target: L.target, defMsg: L.defMsg,
        intervalMin: 10, elapsed: 0, paused: true, last: null, message: "", inputFocused: false, sending: false,
        input: InputState.new({ value: L.defMsg }),
      };
      line.input.on("change", (_e, cx) => { line.message = line.input.value(); cx.notify(); });
      line.input.on("focus", (_e, cx) => { line.inputFocused = true; cx.notify(); });
      line.input.on("blur", (_e, cx) => { line.inputFocused = false; cx.notify(); });
      return line;
    });
    this.sentCount = 0;
    this._lastSendAt = 0;
    this._recentSends = new Map();
    this.log = ["started — both lines paused (" + this.lines.map((line) => `${line.name} -> ${line.target}`).join(", ") + "); START enables"];
    const savedTargets = shared("nexustick.targets");
    if (savedTargets && typeof savedTargets === "object") {
      for (const line of this.lines) if (savedTargets[line.key]) line.target = savedTargets[line.key];
    }
    this.pickOpen = false;
    cx.timer.every(1000, (cx) => this.second(cx));
  }

  getMessage(line) {
    return (line.message || "").trim() || line.defMsg;
  }

  // Timer only advances state and notifies; it sends only for a line that is not paused
  // (i.e. only after an explicit user START) and whose interval elapsed.
  second(cx) {
    for (const line of this.lines) {
      if (line.paused) continue;
      line.elapsed++;
      if (line.elapsed >= line.intervalMin * 60) this.send(cx, line);
    }
    cx.notify();
  }

  send(cx, line) {
    const msg = this.getMessage(line);
    const now = Date.now();
    const dedupKey = JSON.stringify([line.target, msg]);
    for (const [key, sentAt] of this._recentSends) {
      if (now - sentAt >= SEND_DEDUP_WINDOW_MS) this._recentSends.delete(key);
    }
    const previousSendAt = this._recentSends.get(dedupKey);
    if (previousSendAt != null && now - previousSendAt < SEND_DEDUP_WINDOW_MS) {
      this.pushLog("[" + new Date(now).toTimeString().slice(0, 8) + "] -> " + line.target + " duplicate suppressed");
      cx.notify();
      return;
    }
    const sinceLastSend = Math.max(0, now - this._lastSendAt);
    if (line.sending || sinceLastSend < MIN_SEND_INTERVAL_MS) {
      const reason = line.sending ? "send in flight" : `rate limit ${MIN_SEND_INTERVAL_MS}ms`;
      this.pushLog("[" + new Date(now).toTimeString().slice(0, 8) + "] -> " + line.target + " suppressed (" + reason + ")");
      cx.notify();
      return;
    }

    line.sending = true;
    this._lastSendAt = now;
    line.elapsed = 0;
    const ts = new Date(now).toTimeString().slice(0, 8);
    cx.spawn(async (cx) => {
      let res = "ok";
      try {
        const r = await exec("nx", ["send", line.target, msg], { timeout: 20000 });
        if (r.code !== 0) res = "exit " + r.code + (r.stderr ? " · " + r.stderr : "");
        else {
          this.sentCount++;
          this._recentSends.set(dedupKey, Date.now());
        }
      } catch (e) { res = "err"; }
      line.sending = false;
      line.last = { ts, res };
      this.pushLog("[" + ts + "] -> " + line.target + " (" + line.name + ")  " + res);
      cx.notify();
    });
  }

  togglePause(cx, line) {
    line.paused = !line.paused;
    this.pushLog(line.target + " (" + line.name + ") " + (line.paused ? "paused" : "resumed"));
    cx.notify();
  }

  cycleInterval(cx, line) {
    const i = INTERVALS.indexOf(line.intervalMin);
    line.intervalMin = INTERVALS[(i + 1) % INTERVALS.length];
    line.elapsed = 0;
    this.pushLog(line.target + " (" + line.name + ") interval -> " + line.intervalMin + " min");
    cx.notify();
  }

  pickTarget(cx, line, address) {
    line.target = address;
    const saved = shared("nexustick.targets");
    setShared("nexustick.targets", { ...(saved && typeof saved === "object" ? saved : {}), [line.key]: address });
    this.pickOpen = false;
    this.pushLog(line.name + " target -> " + address);
    cx.notify();
  }

  targetOptions() {
    let list;
    try { list = terminals(); } catch (e) { list = []; }
    return (list || []).filter((t) => t && t.state === "live" && t.address);
  }

  targetPicker(t, line) {
    if (line.key !== "opencode") return div().text_size(10).text_color(t.dim).child("-> " + line.target);
    const trigger = div().id("nt-pick-" + line.key).text_size(10).cursor_pointer()
      .text_color(this.pickOpen ? GOLD : t.dim)
      .child("-> " + line.target + " ▾")
      .on_click((_e, cx) => { this.pickOpen = !this.pickOpen; cx.notify(); });
    const opts = this.targetOptions();
    if (line.target && !opts.some((o) => o.address === line.target)) {
      opts.unshift({ address: line.target, where: "saved", agent: null, status: "missing" });
    }
    const list = v_flex().w(360).max_h(240).overflow_y_scroll().p(4).gap(1)
      .bg(t.raised).border_1().border_color(t.border).rounded(8)
      .children(opts.length
        ? opts.map((o) => this.targetOption(t, line, o))
        : [div().px(10).py(6).text_size(11).text_color(t.dim).child("no live terminals")]);
    return Popup.new("nt-pick-pop", trigger)
      .anchor("bottom_left")
      .when(this.pickOpen, (el) => el.content(list));
  }

  targetOption(t, line, o) {
    const sel = o.address === line.target;
    const where = o.where || "";
    let meta = [o.agent, o.status].filter(Boolean).join(" · ");
    if (meta.length > 30) meta = meta.slice(0, 30) + "…";
    return div().px(10).py(5).rounded(6).cursor_pointer()
      .when(sel, (el) => el.bg(t.selected))
      .on_click((_e, cx) => this.pickTarget(cx, line, o.address))
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(11).font_semibold().flex_none().text_color(sel ? GOLD : t.foreground).child(o.address))
        .child(div().flex_1().min_w_0().text_size(10).text_color(t.muted).overflow_hidden().child(where))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(meta))
        .when(sel, (el) => el.child(div().flex_none().text_size(10).text_color(GOLD).child("✓"))));
  }

  pushLog(s) {
    this.log.push(s);
    if (this.log.length > 30) this.log.shift();
  }

  btn(t, label, gold, onClick) {
    return div().px(8).py(3).rounded(6).cursor_pointer().text_size(10).font_semibold()
      .border_1().border_color(gold ? GOLD : t.border)
      .bg(gold ? GOLD : t.hover)
      .text_color(gold ? "#0b0d11" : t.foreground)
      .child(label)
      .on_click((_e, cx) => onClick(cx));
  }

  lineView(cx, t, line) {
    const left = Math.max(0, line.intervalMin * 60 - line.elapsed);
    const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
    const frac = line.intervalMin * 60 > 0 ? 1 - left / (line.intervalMin * 60) : 0;
    const stColor = line.last && line.last.res !== "ok" ? t.ansi1 : line.paused ? t.muted : t.ansi2;

    const msgInput = div().px(10).py(4).border_1().border_color(line.inputFocused ? GOLD : t.input).bg(t.background).rounded(7)
      .child(Input.new(line.input).h(26).px(8).gap(6).items_center().rounded(7)
        .border_1().border_color(line.inputFocused ? GOLD : t.input)
        .bg(t.background).text_size(11).text_color(t.foreground));

    return v_flex().flex_none().px(14).py(8).gap(5).border_b(1).border_color(t.border)
      .child(h_flex().gap(9).items_center()
        .child(div().flex_none().px(10).py(6).rounded(8).border_1().border_color(GOLD)
          .bg(t.hover).text_size(20).text_color(GOLD).child(line.icon))
        .child(div().font_semibold().text_size(12).text_color(t.foreground).child(line.name))
        .child(this.targetPicker(t, line)))
      .child(h_flex().gap(8).items_center()
        .child(div().w(6).h(6).flex_none().rounded(3).bg(stColor))
        .child(div().font_semibold().text_size(18).text_color(GOLD).child(mm + ":" + ss))
        .child(div().flex_1())
        .child(h_flex().h(3).rounded(2).bg(t.hover).overflow_hidden()
          .child(div().h(3).flex_grow(Math.max(frac, 0.001)).bg(GOLD))
          .child(div().flex_grow(Math.max(1 - frac, 0.001)))))
      .child(h_flex().gap(6).items_center()
        .child(this.btn(t, "SEND", true, (ecx) => this.send(ecx, line)))
        .child(this.btn(t, line.paused ? "START" : "PAUSE", false, (ecx) => this.togglePause(ecx, line)))
        .child(this.btn(t, line.intervalMin + "m", false, (ecx) => this.cycleInterval(ecx, line)))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(t.dim)
          .child(line.last ? line.last.ts + " " + line.last.res : "—")))
      .child(msgInput);
  }

  render(cx) {
    const t = theme();
    const anyErr = this.lines.some((l) => l.last && l.last.res !== "ok");
    const anyRun = this.lines.some((l) => !l.paused);
    const stColor = anyErr ? t.ansi1 : !anyRun ? t.muted : t.ansi2;
    const stText = anyErr ? "error" : !anyRun ? "paused" : "running";

    return v_flex().id("nexustick").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(38).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().w(8).h(8).flex_none().rounded(4).bg(stColor))
        .child(div().font_semibold().text_color(GOLD).child("NexusTick"))
        .child(div().flex_1())
        .child(div().text_size(9).text_color(t.dim).child("sent " + this.sentCount))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10)
          .text_color(stColor).child(stText)))
      .children(this.lines.map((l) => this.lineView(cx, t, l)))
      .child(v_flex().flex_1().min_h(0).px(14).py(6).gap(2).overflow_y_scroll()
        .children(this.log.map((l) => div().text_size(10).text_color(t.muted).child(l))));
  }
}
