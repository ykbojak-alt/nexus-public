// AEGIS approvals/guardrails panel — native nx-app mod POC.
//
// MOCK FIXTURE by default — no live API/chain calls, read-only UI, no
// approve/deny actions. Illustrative snapshots of an AEGIS gate state model
// (policy status, pending approvals, denied/approved audit examples).
// When the host sets NEXUS_CORE_URL, an inert live-path performs one
// read-only coreApiRead("audit-verify") and renders the verified scalars;
// any failure keeps the fixture. No writes, no approve/deny either way.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, coreApiRead, exec, shared, setShared } from "nx";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function isAuditVerifyResponse(data) {
  return isRecord(data) && typeof data.ok === "boolean" && Number.isFinite(data.verified)
    && isRecord(data.aegis) && typeof data.aegis.ok === "boolean" && Number.isFinite(data.aegis.records)
    && isRecord(data.gate_trail) && typeof data.gate_trail.ok === "boolean" && Number.isFinite(data.gate_trail.verified);
}

const MOCK = {
  label: "MOCK FIXTURE",
  source: "AEGIS gate model (illustrative)",
  generated_at: "2026-11-07",
  policy: {
    name: "AEGIS v2",
    status: "enforced",
    gates: 3,
    rules: "allow/deny/vote — payout paths & tool calls",
  },
  approvals: [
    {
      id: "appr-1042", kind: "payout", actor: "hivebid_market", target: "payout::claim (0x…a41f)",
      status: "pending", reason: "amount 1.25 NEAR > auto-approve threshold 1.0", ts: "2026-11-07 19:02", urgency: "normal",
    },
    {
      id: "appr-1043", kind: "tool", actor: "nexus_agent::codex", target: "exec: git push --force origin master",
      status: "pending", reason: "force-push to shared branch — requires human vote", ts: "2026-11-07 19:11", urgency: "blocked",
    },
    {
      id: "appr-1044", kind: "payout", actor: "hivebid_market", target: "payout::release (0x…8cf2)",
      status: "pending", reason: "new beneficiary — first payout on this route", ts: "2026-11-07 19:24", urgency: "normal",
    },
  ],
  audit: [
    { id: "appr-1011", kind: "payout", actor: "hivebid_market", target: "payout::claim (0x…b012)", status: "allowed", ts: "2026-11-07 17:41", method: "auto rule G-3" },
    { id: "appr-1012", kind: "tool", actor: "nexus_agent::devin", target: "exec: near deploy prod.wasm", status: "denied", ts: "2026-11-07 17:55", method: "hard gate 414" },
    { id: "appr-1013", kind: "payout", actor: "hivebid_market", target: "payout::claim (0x…c6e0)", status: "allowed", ts: "2026-11-07 18:09", method: "auto rule G-3" },
    { id: "appr-1014", kind: "tool", actor: "nexus_agent::codex", target: "exec: ssh vps deploy", status: "denied", ts: "2026-11-07 18:26", method: "hard gate 414" },
  ],
};

const KIND = {
  payout: { label: "payout", color: t => t.ansi3 },
  tool: { label: "tool", color: t => t.ansi4 },
};

// Read-only status chip: pending → working/amber, allowed → done/green,
// denied → blocked/red.
function statusChip(status, t) {
  if (status === "pending") return { text: "pending", color: t.working };
  if (status === "allowed") return { text: "allowed", color: t.done };
  if (status === "denied") return { text: "denied", color: t.blocked };
  return { text: status, color: t.dim };
}

export default class Aegis extends View {
  init(_props, cx) {
    this.open = new Set();
    this.liveState = "loading";
    this.dataLabel = `${MOCK.label} · CHECKING CORE API`;
    this.live = null;
    const saved = shared("aegis.reaper");
    this.reaper = {
      state: "idle",
      result: saved && saved.result ? saved.result : null,
      auto: !(saved && saved.auto === false),
      lastRun: saved && saved.lastRun ? saved.lastRun : null,
    };
    cx.spawn(async (cx) => {
      try {
        const res = await coreApiRead("audit-verify");
        if (res.ok && res.status === 200 && isAuditVerifyResponse(res.data)) {
          this.live = res.data;
          const empty = res.data.aegis.records === 0 && res.data.gate_trail.verified === 0;
          this.liveState = empty ? "empty" : "live";
          this.dataLabel = empty ? "LIVE · /api/core/audit/verify · EMPTY" : "LIVE · /api/core/audit/verify";
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
    // Autonomous reaper: first pass 90s after open, then every 15 min.
    // autoReap itself checks this.reaper.auto — toggle flips the flag only.
    cx.timer.after(90_000, (cx) => this.autoReap(cx));
    cx.timer.every(15 * 60_000, (cx) => this.autoReap(cx));
  }

  statusMessage() {
    if (this.liveState === "loading") return "Checking Core audit verification · local fixture shown";
    if (this.liveState === "disabled") return "Core API not configured · local fixture shown";
    if (this.liveState === "error") return "Core read failed or returned an invalid response · local fixture shown";
    if (this.liveState === "empty") return "No audit records yet · live verification response is valid";
    return "Live read-only audit verification";
  }

  // Live view: only real scalar fields from audit-verify, nothing fabricated.
  liveView(t) {
    const d = this.live || {};
    const gt = d.gate_trail || {};
    const ag = d.aegis || {};
    const rows = [
      ["ok", d.ok], ["verified", d.verified], ["broken_at", d.broken_at],
      ["detail", d.detail], ["aegis.ok", ag.ok],
      ["gate_trail.ok", gt.ok], ["gate_trail.verified", gt.verified],
      ["gate_trail.broken_at", gt.broken_at], ["gate_trail.detail", gt.detail],
    ];
    return v_flex().id("aegis").size_full().min_h(0).bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).rounded(10).overflow_hidden()
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("AEGIS"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.working).child(this.dataLabel))
        .child(div().text_size(11).text_color(t.dim).child("READ-ONLY · LIVE coreApiRead")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(4)
        .children([
          ...rows.map(([k, v]) => h_flex().gap(8).items_baseline()
          .child(div().flex_none().w(160).text_size(11).text_color(t.muted).child(k))
          .child(div().flex_1().min_w(0).text_size(11).text_color(v === true ? t.done : v === false ? t.blocked : t.foreground)
            .child(v === null || v === undefined ? "—" : String(v)))),
          ...(this.liveState === "empty" ? [div().p(8).text_size(11).text_color(t.dim).child("No AEGIS or gate-trail records have been verified yet.")] : []),
        ]))
      .child(this.reaperRow(t))
      .child(h_flex().flex_none().px(14).py(6).border_t(1).border_color(t.border)
        .child(div().text_size(10).text_color(t.dim).child(`READ-ONLY · ${this.statusMessage()} · no approve/deny; reaper = local maintenance action.`)));
  }

  header(title, t) {
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child(title))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.working).child(this.dataLabel))
        .child(div().text_size(11).text_color(t.dim).child("READ-ONLY · MOCK FIXTURE"))
      .child(div().text_size(11).text_color(t.dim).child(MOCK.generated_at));
  }

  // Policy summary strip.
  policyStrip(t) {
    const p = MOCK.policy;
    const st = statusChip(p.status, t);
    return v_flex().flex_none().px(14).py(8).gap(6).bg(t.surface).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12).font_semibold().child(p.name))
        .child(div().text_size(11).text_color(st.color).child(st.text))
        .child(div().text_size(11).text_color(t.dim).child("MOCK policy snapshot — not live enforcement"))
        .child(div().flex_1()))
      .child(div().text_size(11).text_color(t.dim).child(`${p.gates} gates · ${p.rules}`));
  }

  // One approval row (read-only): kind chip, id, target, reason, pending badge.
  approvalRow(a, t) {
    const k = KIND[a.kind] || { label: a.kind, color: () => t.dim };
    const st = statusChip(a.status, t);
    const expanded = this.open.has(a.id);
    const main = v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(k.color(t)).child(k.label))
        .child(div().text_size(12).font_semibold().truncate().child(a.id))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(st.color).child(st.text)))
      .child(div().text_size(11).text_color(t.foreground).truncate().child(a.target))
      .child(div().text_size(10).text_color(t.dim).child(a.reason));
    const row = h_flex().gap(8).items_center().px(8).py(6).rounded(8).cursor_pointer()
      .hover(s => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (this.open.has(a.id)) this.open.delete(a.id); else this.open.add(a.id);
        cx.notify();
      })
      .child(main)
      .child(div().flex_none().text_size(10).text_color(t.dim).child(a.ts));
    const detail = expanded
      ? h_flex().px(8).pb(6).gap(6).items_center()
          .child(div().text_size(10).text_color(t.dim).child(`urgency: ${a.urgency}`))
          .child(div().text_size(10).text_color(t.dim).child(`actor: ${a.actor}`))
          .child(div().flex_1())
          .child(div().text_size(10).text_color(t.muted).child("⚠ read-only — no approve/deny"))
      : null;
    return v_flex().flex_none().children(detail ? [row, detail] : [row]);
  }

  // One audit row (read-only): kind chip, id, target, allowed/denied chip.
  auditRow(a, t) {
    const k = KIND[a.kind] || { label: a.kind, color: () => t.dim };
    const st = statusChip(a.status, t);
    return h_flex().flex_none().px(8).py(5).gap(8).items_center().rounded(8)
      .child(div().flex_none().text_size(11).text_color(k.color(t)).child(k.label))
      .child(div().flex_none().text_size(11).text_color(t.muted).child(a.id))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground).child(a.target))
      .child(div().flex_none().text_size(11).text_color(st.color).child(st.text))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(a.method));
  }

  sectionTitle(text, count, t) {
    return h_flex().flex_none().h(30).px(14).gap(8).items_center()
      .child(div().text_size(12).font_semibold().child(text))
      .child(div().text_size(11).text_color(t.dim).child(String(count)));
  }

  // Maintenance action (not part of the read-only API view): zombie reaper.
  // Tier1 kills stale one-shot MSYS utils (>30m); tier2 kills orphaned
  // bash/sh (>4h, dead parent, non-infra cmdline). Runs manually and on a
  // 15-min timer while this.reaper.auto is on.
  async runReaperScript(cx, scan = false) {
    const primary = "D:\\nexus\\tools\\zombie-reaper.ps1";
    const legacy = "D:\\Temp\\zombie-reap-once.ps1";
    const extra = scan ? ["-Scan"] : [];
    let res = await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", primary, ...extra], { timeout: 60000 });
    if (res.code !== 0 && /cannot find path|not recognized/i.test((res.stderr || "") + (res.stdout || ""))) {
      res = await exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", legacy, ...extra], { timeout: 30000 });
    }
    return ((res.stdout || "") + (res.stderr || "")).trim().slice(0, 400) || `exit ${res.code}`;
  }

  persistReaper() {
    setShared("aegis.reaper", { auto: this.reaper.auto, result: this.reaper.result, lastRun: this.reaper.lastRun });
  }

  runReaper(cx) {
    if (this.reaper.state === "running") return;
    this.reaper.state = "running";
    this.reaper.result = null;
    cx.spawn(async (cx) => {
      try {
        this.reaper.result = await this.runReaperScript(cx);
        this.reaper.state = "done";
      } catch (e) {
        this.reaper.state = "error";
        this.reaper.result = String(e).slice(0, 200);
      }
      this.reaper.lastRun = new Date().toISOString();
      this.persistReaper();
      cx.notify();
    });
  }

  autoReap(cx) {
    if (!this.reaper.auto || this.reaper.state === "running") return;
    this.runReaper(cx);
  }

  // Dry-run: lists candidates without killing; doesn't touch lastRun/state history.
  runScan(cx) {
    if (this.reaper.state === "running") return;
    this.reaper.state = "running";
    this.reaper.result = null;
    cx.spawn(async (cx) => {
      try {
        this.reaper.result = await this.runReaperScript(cx, true);
        this.reaper.state = "idle";
      } catch (e) {
        this.reaper.state = "error";
        this.reaper.result = String(e).slice(0, 200);
      }
      cx.notify();
    });
  }

  toggleAuto(cx) {
    this.reaper.auto = !this.reaper.auto;
    this.persistReaper();
    cx.notify();
  }

  reaperRow(t) {
    const r = this.reaper;
    const label = r.state === "running" ? "REAPER: RUNNING…" : r.state === "done" ? "REAPER: DONE" : r.state === "error" ? "REAPER: ERROR" : "REAPER";
    const autoChip = h_flex().px(6).py(2).rounded(5).border_1().cursor_pointer()
      .border_color(r.auto ? t.done : t.border)
      .hover(s => s.bg(t.hover))
      .text_size(9).text_color(r.auto ? t.done : t.dim)
      .child(`AUTO:${r.auto ? "15m" : "OFF"}`)
      .on_click((_e, cx) => this.toggleAuto(cx));
    return h_flex().flex_none().px(14).py(4).gap(8).items_center().border_t(1).border_color(t.border)
      .child(div().text_size(10).text_color(t.muted).child("MAINTENANCE:"))
      .child(div().px(8).py(3).rounded(6).border_1().border_color(t.border).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .text_size(10).text_color(r.state === "running" ? t.working : r.state === "error" ? t.blocked : t.foreground)
        .child(label)
        .on_click((_e, cx) => this.runReaper(cx)))
      .child(autoChip)
      .child(div().px(6).py(2).rounded(5).border_1().border_color(t.border).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .text_size(9).text_color(t.dim)
        .child("SCAN")
        .on_click((_e, cx) => this.runScan(cx)))
      .child(div().flex_1().min_w(0).text_size(10).text_color(t.dim).child(r.result || "tier1: MSYS utils >30m · tier2: orphaned shells >4h · t3: orphan cpu-hog · auto 15m"))
      .child(div().text_size(9).text_color(t.muted).child("ACTION — not part of read-only API view"));
  }

  render(_cx) {
    const t = theme();
    if (this.liveState === "live" || this.liveState === "empty") return this.liveView(t);
    return v_flex().id("aegis").size_full().min_h(0).bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).rounded(10).overflow_hidden()
      .child(this.header("AEGIS", t))
      .child(this.policyStrip(t))
      // Pending approvals (read-only list)
      .child(this.sectionTitle("Pending approvals", MOCK.approvals.length, t))
      .child(v_flex().flex_none().px(6).gap(2)
        .children(MOCK.approvals.map(a => this.approvalRow(a, t))))
      // Audit trail (deny/allow examples)
      .child(this.sectionTitle("Audit (examples)", MOCK.audit.length, t))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(6).gap(2)
        .children(MOCK.audit.map(a => this.auditRow(a, t))))
      .child(this.reaperRow(t))
      // Footer
      .child(h_flex().flex_none().px(14).py(6).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().text_size(10).text_color(t.dim).child(`${MOCK.label}: ${MOCK.source} — READ-ONLY · ${this.statusMessage()} · no approve/deny; reaper = local maintenance action.`)));
  }
}
