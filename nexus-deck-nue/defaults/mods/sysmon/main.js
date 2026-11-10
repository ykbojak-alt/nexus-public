// System monitor: CPU, memory, GPU (nvidia-smi), disks, network.
// Samples every 3s via CIM perf classes (locale-independent) and nvidia-smi.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, exec, home, shared, setShared } from "nx";

const GOLD = "#d4af37";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const readJson = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const value = await response.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};
const PS = `
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$disk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk |
  Where-Object { $_.Name -ne '_Total' } |
  ForEach-Object { @{ n = $_.Name; v = [int]$_.PercentDiskTime } }
$net = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface |
  Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo|Bluetooth|WFP|Filter' } |
  Select-Object -First 6 |
  ForEach-Object { @{ n = $_.Name; v = [int64]$_.BytesTotalPersec } }
$cFree = (Get-PSDrive C).Free
@{ cpu = [int]$cpu; memT = [int64]$os.TotalVisibleMemorySize * 1kb; memF = [int64]$os.FreePhysicalMemory * 1kb; cFree = [int64]$cFree; d = @($disk); n = @($net) } | ConvertTo-Json -Compress -Depth 3
`;
const GPU = ["--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"];

const fmt = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${(b / 1e3).toFixed(0)} KB`;
const rate = (b) => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB/s` : `${b} B/s`;

// Remote machines: nx machines (ssh-registered) + optional
// ~/.config/nx/machines.json -> [{ "name": "db", "ssh": "root@host" }].
const CFG = `${home()}/.config/nx/machines.json`;
const PROBE =
  'timeout 10 printf "L=%s|M=%s|D=%s|U=%s|P=%s" ' +
  '"$(awk \'{print $1,$2,$3}\' /proc/loadavg)" ' +
  '"$(free -m|awk \'/Mem:/{printf "%d/%d",$3,$2}\')" ' +
  '"$(df -BG /|awk \'NR==2{print $4}\')" ' +
  '"$(uptime -p 2>/dev/null|sed \'s/^up //\')" ' +
  '"$(ps -eo pcpu,comm --sort=-pcpu|awk \'NR>1&&NR<5{printf "%s:%s ",$2,$1}\')"';

// CONFIG: override here until Deck provides a mod-specific config source.
// Health, metrics and sessions are read with GET from this configured service.
const NEXUS_CONFIG = Object.freeze({
  baseUrl: "https://backend.example.invalid",
  displayName: "remote",
});

const parseProbe = (out) => {
  const m = {};
  for (const kv of (out || "").trim().split("|")) {
    const i = kv.indexOf("=");
    if (i > 0) m[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const load = (m.L || "").split(/\s+/)[0];
  const mem = (m.M || "").split("/");
  const memU = parseFloat(mem[0]), memT = parseFloat(mem[1]);
  if (!isFinite(parseFloat(load)) || !isFinite(memU) || !isFinite(memT) || memT <= 0)
    return null;
  return { load: m.L, memU, memT, disk: m.D || "—", up: m.U || "—",
           procs: (m.P || "").trim() };
};

export default class Sysmon extends View {
  init(_props, cx) {
    this.m = null;
    this.sampleState = "sampling";
    this.sampleError = null;
    this.gpu = null;
    this.gpuState = "sampling";
    this.machines = [];
    this.refresh(cx);
    cx.timer.every(3000, (cx) => this.refresh(cx));
    this.refreshMachines(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    this.nexus = null;
    this.nexusState = "checking";
    this.nexusDaemonState = "checking";
    const saved = shared("sysmon.reaper");
    this.reaper = {
      state: "idle",
      result: saved && saved.result ? saved.result : null,
      auto: !(saved && saved.auto === false),
      lastRun: saved && saved.lastRun ? saved.lastRun : null,
    };
    this.refreshNexus(cx);
    cx.timer.every(10000, (cx) => this.refreshNexus(cx));
    // Autonomous zombie reaper: first pass 90s after open, then every 15 min.
    cx.timer.after(90_000, (cx) => this.autoReap(cx));
    cx.timer.every(15 * 60_000, (cx) => this.autoReap(cx));
  }

  refreshNexus(cx) {
    if (this._nxBusy) return;
    this._nxBusy = true;
    this.nexusState = "checking";
    this.nexusDaemonState = "checking";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const [h, m, s] = await Promise.all([
          readJson(NEXUS_CONFIG.baseUrl + "/api/rae/health"),
          readJson(NEXUS_CONFIG.baseUrl + "/v1/metrics"),
          readJson(NEXUS_CONFIG.baseUrl + "/api/rae/sessions"),
        ]);
        this.nexus = { health: h, metrics: m, sessions: s };
        this.nexusState = h == null && m == null && s == null ? "unreachable" : "reachable";
        this.nexusDaemonState = h == null ? "unavailable" : "online";
      } catch {
        this.nexus = null;
        this.nexusState = "unreachable";
        this.nexusDaemonState = "unavailable";
      } finally {
        this._nxBusy = false;
        cx.notify();
      }
    });
  }

  refresh(cx) {
    if (this._sampleBusy) return;
    this._sampleBusy = true;
    this.sampleState = "sampling";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("powershell", ["-NoProfile", "-Command", PS], {});
        const sample = JSON.parse((r.stdout || "").trim());
        if (!isRecord(sample) || !Number.isFinite(sample.cpu) ||
            !Number.isFinite(sample.memT) || !Number.isFinite(sample.memF) || sample.memT <= 0 ||
            !Number.isFinite(sample.cFree) || !Array.isArray(sample.d) || !Array.isArray(sample.n)) {
          throw new Error("invalid local system sample");
        }
        this.m = sample;
        this.sampleState = "live";
        this.sampleError = null;
      } catch {
        this.sampleState = this.m ? "stale" : "offline";
        this.sampleError = this.m
          ? "Latest local sample failed; showing the last successful readings."
          : "Local system sampler is unavailable; no fixture values are shown.";
      }
      try {
        const g = await exec("nvidia-smi", GPU, {});
        const p = (g.stdout || "").split(",").map((s) => parseFloat(s.trim()));
        if (p.length >= 4 && p.every(Number.isFinite) && p[3] > 0)
          this.gpu = { util: p[0], temp: p[1], mem: p[2], memT: p[3] };
        else this.gpu = null;
        this.gpuState = this.gpu ? "live" : "unavailable";
      } catch {
        this.gpu = null;
        this.gpuState = "unavailable";
      } finally {
        this._sampleBusy = false;
        cx.notify();
      }
    });
  }

  async discover() {
    const out = [];
    try {
      const r = await exec("nx", ["machine", "ls", "--json"], {});
      const j = JSON.parse(r.stdout || "{}");
      for (const m of j.machines || j || [])
        out.push({ name: m.name, via: "nx", state: m.state });
    } catch (e) { this.machinesErr = "nx machine ls failed"; }
    try {
      const r = await exec("powershell", ["-NoProfile", "-Command",
        `if(Test-Path '${CFG}'){Get-Content '${CFG}' -Raw}`], {});
      const extra = JSON.parse((r.stdout || "[]").trim() || "[]");
      for (const e of Array.isArray(extra) ? extra : [])
        if (e && e.ssh && !out.find((x) => x.name === e.name))
          out.push({ name: e.name || e.ssh, via: "ssh", state: "?", ssh: e.ssh });
    } catch (e) { if (this.machinesErr) this.machinesErr += "; bad machines.json"; }
    return out;
  }

  refreshMachines(cx) {
    if (this._machBusy) return;          // single-flight: медленный probe не накапливает spawn
    this._machBusy = true;
    cx.spawn(async (cx) => {
      try {
        this.machinesErr = null;
        let targets;
        try { targets = await this.discover(); } catch { targets = []; }
        const next = [];
        for (const t of targets) {
          const row = { name: t.name, via: t.via, state: t.state, s: null, err: null };
          try {
            const r = t.via === "ssh"
              ? await exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
                                   "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
                                   t.ssh, PROBE], {})
              : await exec("nx", ["exec", "--on", t.name, PROBE], {});
            row.s = parseProbe(r.stdout);
            if (!row.s) row.err = "no data";
          } catch { row.err = "unreachable"; }
          next.push(row);
        }
        this.machines = next;
      } finally {
        this._machBusy = false;
        cx.notify();
      }
    });
  }

  // Zombie reaper: tier1 kills stale one-shot MSYS utils (>30m), tier2 kills
  // orphaned bash/sh (>4h, dead parent, non-infra cmdline). Manual + 15-min auto.
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
    setShared("sysmon.reaper", { auto: this.reaper.auto, result: this.reaper.result, lastRun: this.reaper.lastRun });
  }

  runReaper(cx) {
    if (this.reaper.state === "running") return;
    this.reaper.state = "running";
    this.reaper.result = null;
    cx.notify();
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

  // Dry-run: lists candidates without killing.
  runScan(cx) {
    if (this.reaper.state === "running") return;
    this.reaper.state = "running";
    this.reaper.result = null;
    cx.notify();
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

  reaperBtn(t) {
    const r = this.reaper;
    const label = r.state === "running" ? "REAPER:…" : r.state === "done" ? "REAPER:OK" : r.state === "error" ? "REAPER:ERR" : "Reaper";
    const color = r.state === "running" ? t.working : r.state === "error" ? t.blocked : r.state === "done" ? t.done : t.foreground;
    return h_flex().gap(4).items_center()
      .child(div().px(8).py(3).rounded(6).text_size(10).font_semibold()
        .border_1().border_color(r.state === "running" ? t.ansi1 : t.border)
        .bg(t.surface).text_color(color)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.runReaper(cx))
        .child(label))
      .child(div().px(5).py(3).rounded(6).text_size(9)
        .border_1().border_color(r.auto ? t.done : t.border)
        .text_color(r.auto ? t.done : t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.toggleAuto(cx))
        .child(r.auto ? "15m" : "off"))
      .child(div().px(5).py(3).rounded(6).text_size(9)
        .border_1().border_color(t.border)
        .text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.runScan(cx))
        .child("scan"));
  }

  machine(t, m) {
    const on = !!m.s;
    const head = h_flex().px(12).pt(6).gap(8).items_center()
      .child(div().text_color(on ? t.ansi2 : t.ansi1).child("●"))
      .child(div().font_semibold().text_size(11).child(m.name))
      .child(div().flex_1())
      .child(div().text_size(9).text_color(t.dim)
        .child(m.via === "ssh" ? "ssh" : (m.state || "nx")));
    if (!on)
      return v_flex().flex_none().child(head)
        .child(h_flex().px(12).pb(2).child(
          div().text_size(10).text_color(t.ansi1).child(m.err || "down")));
    const memPct = Math.round(100 * m.s.memU / m.s.memT);
    return v_flex().flex_none().child(head)
      .child(h_flex().px(12).py(2).gap(8).items_center()
        .child(this.bar(t, memPct))
        .child(div().text_size(10).text_color(t.dim).w(86)
          .child(`mem ${(m.s.memU / 1024).toFixed(1)}/${(m.s.memT / 1024).toFixed(0)}G`)))
      .child(h_flex().px(12).pb(2).gap(10)
        .child(div().text_size(10).text_color(t.dim).child(`load ${m.s.load}`))
        .child(div().text_size(10).text_color(t.dim).child(`/ ${m.s.disk}`))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(t.dim).child(m.s.up)))
      .when(m.s.procs, (x) => x.child(
        h_flex().px(12).pb(4).gap(6).items_center()
          .child(div().text_size(9).text_color(t.dim).child("ps"))
          .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.ansi6)
            .child(m.s.procs))));
  }

  nexusBlock(t) {
    const nx = this.nexus;
    const hostUp = this.nexusState === "reachable";
    const daemonUp = this.nexusDaemonState === "online";
    const nets = Array.isArray(nx?.health?.state) ? nx.health.state.filter(isRecord) : [];
    const conn = nets.filter((n) => n.state === "connected");
    const m = isRecord(nx?.metrics) ? nx.metrics : null;
    const sessCount = Array.isArray(nx?.sessions) ? nx.sessions.length
      : Array.isArray(nx?.sessions?.sessions) ? nx.sessions.sessions.length : null;
    return v_flex().flex_none()
      .child(div().h(6).flex_none())
      .child(h_flex().px(12).pb(3).items_center()
        .child(div().text_size(9).text_color(t.dim).child("NEXUS HOST"))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(this.nexusState === "checking" ? t.dim : hostUp ? t.ansi2 : t.ansi1)
          .child(`${NEXUS_CONFIG.displayName} · ${this.nexusState}`)))
      .child(h_flex().px(12).pb(2).gap(6).items_center()
        .child(div().text_color(daemonUp ? t.ansi2 : this.nexusDaemonState === "checking" ? t.dim : t.ansi1).child("●"))
        .child(div().text_size(10).child(`RAE daemon · ${this.nexusDaemonState}`))
        .child(div().flex_1())
        .child(div().text_size(9).text_color(t.dim)
          .child(`${conn.length}/${nets.length} nets`)))
      .children(nets.map((n) =>
        h_flex().px(12).pb(1).gap(6).items_center()
          .child(div().text_size(10).text_color(
            n.state === "connected" ? t.ansi2 : t.muted).child("·"))
          .child(div().flex_1().min_w(0).truncate().text_size(10)
            .text_color(n.state === "connected" ? t.foreground : t.dim)
            .child(`${n.network} · ${n.state}`))
          .child(div().text_size(9).text_color(t.dim).child(n.mode || ""))))
      .when(m, (x) => x
        .child(this.row(t, "CPU", m.cpuPct ?? 0, `${m.cpuPct ?? "—"}%`))
        .child(this.row(t, "RAM", m.ramPct ?? 0, `${m.ramPct ?? "—"}%`))
        .child(this.row(t, "Disk", m.diskPct ?? 0, `${m.diskPct ?? "—"}%`)))
      .when(sessCount != null, (x) => x.child(
        h_flex().px(12).pt(1).pb(4)
          .child(div().text_size(9).text_color(t.dim)
            .child(`sessions: ${sessCount}`))));
  }

  bar(t, pct, warn = 80) {
    const p = Math.max(0, Math.min(1, (pct || 0) / 100));
    const c = p * 100 >= warn ? t.ansi1 : p * 100 >= warn - 25 ? GOLD : t.ansi2;
    return h_flex().h(5).flex_1().rounded(3).bg(t.hover).overflow_hidden()
      .child(div().h(5).flex_grow(Math.max(p, 0.001)).bg(c))
      .child(div().flex_grow(Math.max(1 - p, 0.001)));
  }

  row(t, label, pct, right, warn) {
    return v_flex().flex_none().px(12).py(6).gap(4)
      .child(h_flex().items_center().gap(8)
        .child(div().w(46).flex_none().text_size(10).text_color(t.dim).child(label))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).child(right)))
      .child(this.bar(t, pct, warn));
  }

  render(cx) {
    const t = theme(), m = this.m, g = this.gpu;
    const memPct = m ? Math.round(100 * (1 - m.memF / m.memT)) : 0;
    const sampleLabel = this.sampleState === "sampling" ? "sampling"
      : this.sampleState === "live" ? "live"
      : this.sampleState === "stale" ? "stale" : "offline";
    const sampleColor = this.sampleState === "live" ? t.ansi2
      : this.sampleState === "sampling" ? t.dim : t.ansi1;
    return v_flex().id("sysmon").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_color(GOLD).child("System"))
        .child(this.reaperBtn(t))
        .child(div().flex_1())
        .child(div().text_size(9).text_color(sampleColor).child(sampleLabel.toUpperCase())))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().py(4)
        .when(!m, (e) => e.child(div().p(10).text_size(11).text_color(sampleColor)
          .child(this.sampleState === "sampling" ? "Sampling local system metrics…" : this.sampleError)))
        .when(m, (e) => e
          .when(this.sampleState === "sampling", (x) => x.child(
            div().px(12).pb(4).text_size(10).text_color(t.dim)
              .child("Refreshing local sample; showing the last successful readings.")))
          .when(this.sampleState === "stale", (x) => x.child(
            div().px(12).pb(4).text_size(10).text_color(t.ansi1).child(this.sampleError)))
          .child(this.row(t, "CPU", m.cpu, `${m.cpu}%`))
          .child(this.row(t, "Memory", memPct, `${fmt(m.memT - m.memF)} / ${fmt(m.memT)}`))
          .when(g, (x) => x.child(this.row(t, "GPU", g.util, `${g.util}% · ${g.temp}°C`))
            .child(this.row(t, "VRAM", Math.round(100 * g.mem / g.memT), `${fmt(g.mem * 1e6)} / ${fmt(g.memT * 1e6)}`)))
          .when(!g, (x) => x.child(div().px(12).pb(4).text_size(10).text_color(t.dim)
            .child(this.gpuState === "sampling" ? "GPU sampling…" : "GPU unavailable · nvidia-smi")))
          .child(div().h(6).flex_none())
          .child(h_flex().px(12).pb(3).items_center()
            .child(div().text_size(9).text_color(t.dim).child("DISKS"))
            .child(div().flex_1())
            .child(div().text_size(11).text_color(m.cFree != null && m.cFree < 5e9 ? t.ansi1 : t.ansi2)
              .child(m.cFree != null ? `C: free ${fmt(m.cFree)}` : "")))
          .children((m.d || []).map((d, i) => this.row(t, `D${i}`, Math.max(0, d.v), `${d.n} · ${Math.max(0, Math.min(100, d.v))}%`, 95)))
          .child(div().h(6).flex_none())
          .child(div().px(12).pb(2).text_size(9).text_color(t.dim).child("NETWORK"))
          .children((m.n || []).map((n, i) =>
            h_flex().id(`nl-net-${i}`).px(12).py(3).gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(10).child(n.n))
              .child(div().flex_none().text_size(10).text_color(t.ansi6).child(rate(n.v)))))
        .when(this.machines.length || this.machinesErr, (e) => e
          .child(div().h(6).flex_none())
          .child(h_flex().px(12).pb(3).items_center()
            .child(div().text_size(9).text_color(t.dim).child("MACHINES"))
            .child(div().flex_1())
            .child(div().text_size(9).text_color(t.dim)
              .child(`${this.machines.filter((x) => x.s).length}/${this.machines.length} up`)))
          .when(this.machinesErr, (x) => x.child(
            h_flex().px(12).pb(3).child(div().text_size(10).text_color(t.ansi1)
              .child(this.machinesErr))))
          .children(this.machines.map((x) => this.machine(t, x)))))
        .child(this.nexusBlock(t)));
  }
}
