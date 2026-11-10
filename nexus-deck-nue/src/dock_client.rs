//! App-side client for the core's `dock.*` RPCs (external window embed).
//!
//! Spec: docs/DOCK_INTEGRATION_WIRING.md. The core owns the embed: it creates
//! a host-anchor HWND per docked window, reparents the child under it, and
//! restores everything on undock, app-pipe loss or core restart sweep.
//! This module only speaks JSON-RPC through `Core::call`.

use std::sync::Arc;

use anyhow::Result;
use serde_json::{Value, json};

use crate::nx::Core;

/// Dock methods this client needs; checked against `hello.methods` on first
/// use so a core without dock support fails loudly instead of half-working.
pub const DOCK_METHODS: [&str; 5] = [
    "dock.discover",
    "dock.request",
    "dock.undock",
    "dock.set_rect",
    "dock.registry",
];

/// A discovered external window (UI-facing mirror of core `Candidate`).
///
/// INTENTIONAL SUBSET (V128): the UI does not need the z-order details
/// (`z_prev`/`z_next`), `was_foreground` etc. — they live in the core's
/// `DockSnapshot` and only come back inside `dock.registry` results.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DockCandidate {
    pub hwnd: usize,
    pub pid: u32,
    pub title: String,
    pub class: String,
    pub minimized: bool,
}

/// A docked window as reported by `dock.request` / `dock.registry`
/// (subset of core `DockSnapshot`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DockStatus {
    pub hwnd: usize,
    pub pid: u32,
    pub title: String,
    /// The core-owned host anchor the child is reparented under.
    pub host: usize,
}

impl TryFrom<&Value> for DockCandidate {
    type Error = anyhow::Error;
    fn try_from(v: &Value) -> Result<Self> {
        Ok(DockCandidate {
            hwnd: v.get("hwnd").and_then(Value::as_u64).ok_or_else(|| anyhow::anyhow!("hwnd missing"))? as usize,
            pid: v.get("pid").and_then(Value::as_u64).ok_or_else(|| anyhow::anyhow!("pid missing"))? as u32,
            title: v.get("title").and_then(Value::as_str).unwrap_or("").to_owned(),
            class: v.get("class").and_then(Value::as_str).unwrap_or("").to_owned(),
            minimized: v.get("minimized").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

fn status_of(v: &Value) -> Result<DockStatus> {
    Ok(DockStatus {
        hwnd: v.get("hwnd").and_then(Value::as_u64).ok_or_else(|| anyhow::anyhow!("dock reply has no hwnd: {v}"))? as usize,
        pid: v.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32,
        title: v.get("title").and_then(Value::as_str).unwrap_or("").to_owned(),
        host: v.get("host").and_then(Value::as_u64).unwrap_or(0) as usize,
    })
}

fn ensure_dock_supported(core: &Arc<Core>) -> Result<()> {
    let methods = core.hello.get("methods").and_then(Value::as_array).cloned().unwrap_or_default();
    for m in DOCK_METHODS {
        if !methods.iter().any(|x| x.as_str() == Some(m)) {
            anyhow::bail!("core does not support {m} (hello.methods missing dock.*)");
        }
    }
    Ok(())
}

/// `0x1a2b`, `0X1A2B` or decimal → handle. Mirrors the core's parser.
pub fn parse_hwnd(s: &str) -> Option<usize> {
    let t = s.trim();
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        usize::from_str_radix(hex, 16).ok()
    } else {
        t.parse::<usize>().ok()
    }
}

/// Ask the core for dockable windows (guarded, ≤15, caller's own excluded).
pub fn discover(core: &Arc<Core>, self_pid: u32) -> Result<Vec<DockCandidate>> {
    ensure_dock_supported(core)?;
    let reply = core.call("dock.discover", json!({"self_pid": self_pid}))?;
    let arr = reply.as_array().ok_or_else(|| anyhow::anyhow!("dock.discover: expected array"))?;
    arr.iter().map(DockCandidate::try_from).collect()
}

/// Dock the target window (all guards live core-side). `hwnd` is the raw
/// param string (`0x…` or decimal); the core revalidates pid/title anyway.
pub fn request_dock(core: &Arc<Core>, hwnd: &str, self_pid: u32) -> Result<DockStatus> {
    ensure_dock_supported(core)?;
    let reply = core.call("dock.request", json!({"hwnd": hwnd, "self_pid": self_pid}))?;
    status_of(&reply)
}

/// Undock: the core restores parent/style/rect/z-order exactly.
pub fn undock(core: &Arc<Core>, hwnd: usize) -> Result<()> {
    ensure_dock_supported(core)?;
    core.call("dock.undock", json!({"hwnd": format!("{hwnd:#x}")}))?;
    Ok(())
}

/// Keep the core's anchor glued to the app panel's screen rect. `x`/`y` are
/// the panel origin; `hwnd` picks the dock when several exist (the core
/// requires it then, uses the only one otherwise).
pub fn set_rect(core: &Arc<Core>, w: i32, h: i32, x: Option<i32>, y: Option<i32>, hwnd: Option<usize>) -> Result<()> {
    ensure_dock_supported(core)?;
    core.call(
        "dock.set_rect",
        json!({"w": w, "h": h, "x": x, "y": y, "hwnd": hwnd}),
    )?;
    Ok(())
}

/// Audit view: every window the core currently has docked.
pub fn registry(core: &Arc<Core>) -> Result<Vec<DockStatus>> {
    ensure_dock_supported(core)?;
    let reply = core.call("dock.registry", json!({}))?;
    let docks = reply.get("docks").and_then(Value::as_array).ok_or_else(|| anyhow::anyhow!("dock.registry: expected docks[]"))?;
    docks.iter().map(status_of).collect()
}

// ---------------------------------------------------------------------------
// Command surface (registered in src/commands.rs)
// ---------------------------------------------------------------------------
//
// - `terminal.dock {hwnd}`        → `request_dock` + a `dockpane` mod pane
//   beside the focused one (window.rs `dock_window`).
// - `terminal.dock` (no hwnd)     → `discover` + the `dockpicker` overlay.
// - `terminal.dock.list`          → `discover` as JSON (`dock_list`).
// - `terminal.undock {hwnd?}`     → `undock` + close the pane (`undock_window`).
// - panel resize/move             → `set_rect` from `sync_docks` each frame.
// - pane/tab/space close          → `sync_docks` sees the pane gone → `undock`.
//
// The `dockpane` mod (defaults/mods/dockpane) is a placeholder surface: it
// draws the dock header (title/pid + Detach) while the real pixels belong
// to the embedded HWND the core positions over the panel rect.
