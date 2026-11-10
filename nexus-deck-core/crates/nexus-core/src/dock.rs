//! Terminal dock/undock (whole-window HWND embed) — core-side manager (v2).
//!
//! Design: docs/TERMINAL_DOCK_IMPLEMENTATION.md v2 + docs/EXTERNAL_TERMINAL_DOCKING.md v3.
//! Evidence: DEV W83 (SetParent OK on restored window; minimized → err=5).
//! HERETIC v125/v126: crash/liveness/persistence gaps — host anchors are
//! core-owned HWNDs (usize, Send-safe), pipe-loss restore, liveness sweep,
//! persisted registry. Integration wiring: docs/DOCK_INTEGRATION_WIRING.md.
//!
//! The core process survives app crashes, so DOCK STATE LIVES HERE. The app
//! side only sends commands (dock_client.rs). Win32 parts are
//! `#[cfg(target_os = "windows")]`; every public entry point exists on all
//! platforms and answers `unsupported_platform` elsewhere.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, EnumWindows, GetClassNameW, GetClientRect,
        GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextW,
        GetWindowThreadProcessId, GW_HWNDNEXT, GW_HWNDPREV, GWL_EXSTYLE, GWL_STYLE, GWLP_HWNDPARENT,
        HWND_TOP, IsIconic, IsWindow, IsWindowVisible, MoveWindow, RegisterClassW, SetForegroundWindow,
        SetParent, SetWindowLongW, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SW_SHOW, WS_CHILD, WS_EX_TOOLWINDOW, WS_POPUP,
    },
};

/// Max candidates the picker returns (design §3).
pub const MAX_CANDIDATES: usize = 15;

/// Accepted terminal window classes (WT + legacy console).
const ACCEPTED_CLASS_FRAGMENTS: [&str; 2] = ["CASCADIA_HOSTING_WINDOW_CLASS", "ConsoleWindowClass"];
const WT_CLASS: &str = "CASCADIA_HOSTING_WINDOW_CLASS";

/// Registry file name (persisted next to the core's state dir).
pub const REGISTRY_FILE: &str = "dock-registry.json";

/// A discovered external window.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct Candidate {
    pub hwnd: usize,
    pub pid: u32,
    pub title: String,
    pub class: String,
    pub minimized: bool,
}

/// Full pre-dock state, restored exactly on undock. Persisted (serde).
/// `hwnd` duplicates the registry key so a bare snapshot is self-describing
/// in RPC results (design: RequestResult is a serialized DockSnapshot).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct DockSnapshot {
    #[serde(default)]
    pub hwnd: usize,
    pub parent: usize,
    pub style: i32,
    pub exstyle: i32,
    pub rect: [i32; 4],
    pub pid: u32,
    pub title: String,
    pub z_prev: usize,
    pub z_next: usize,
    pub was_foreground: bool,
    /// Our own host-anchor HWND (core-owned; survives app crash).
    pub host: usize,
    /// Persisted at dock time for restart recovery.
    pub persisted_at: Option<u64>,
}

pub type DockRegistry = HashMap<usize, DockSnapshot>;

// ---------------------------------------------------------------------------
// RPC types (api.rs methods! table; spec docs/DOCK_INTEGRATION_WIRING.md §2)
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct DiscoverParams {
    /// The caller's pid: its own windows are never candidates.
    pub self_pid: u32,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct RequestParams {
    /// Window handle, hex (`0x…`) or decimal.
    pub hwnd: String,
    /// The caller's pid: its own windows are refused (`self` guard).
    #[serde(default)]
    pub self_pid: Option<u32>,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct UndockParams {
    /// Window handle, hex (`0x…`) or decimal.
    pub hwnd: String,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct SetRectParams {
    pub w: i32,
    pub h: i32,
    /// Panel origin on screen; current anchor position kept when absent.
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    /// Which dock when several exist; the only one is used when absent.
    #[serde(default)]
    pub hwnd: Option<usize>,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
pub struct EmptyParams {}

#[derive(serde::Serialize, schemars::JsonSchema)]
pub struct EmptyResult {}

#[derive(serde::Serialize, schemars::JsonSchema)]
pub struct RegistryResult {
    pub docks: Vec<DockSnapshot>,
}

/// A dock failure with the RPC error kind the method table declares.
pub struct DockError {
    pub kind: &'static str,
    pub message: String,
}

impl DockError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        DockError { kind, message: message.into() }
    }
}

fn guard_err(kind: &'static str, message: String) -> DockError {
    DockError::new(kind, message)
}

/// Runtime + persisted dock state. Lives in `runtime::State`.
#[derive(Default)]
pub struct DockState {
    /// Persisted registry: docked child HWND → pre-dock snapshot.
    pub registry: DockRegistry,
    /// Live host anchors: docked child HWND → core-owned anchor HWND.
    /// Kept as raw handles (usize) so `State` stays `Send`; the windows
    /// themselves are owned by the core process, not by Rust values.
    #[cfg(target_os = "windows")]
    pub anchors: HashMap<usize, usize>,
}

/// Parse a window handle param: `0x1a2b`, `0X1A2B` or decimal.
pub fn parse_hwnd(s: &str) -> Option<usize> {
    let t = s.trim();
    match t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        Some(hex) => usize::from_str_radix(hex, 16).ok(),
        None => t.parse().ok(),
    }
}

#[cfg(target_os = "windows")]
fn hwnd_usize(h: HWND) -> usize {
    h as usize
}
#[cfg(target_os = "windows")]
fn hwnd_from_usize(h: usize) -> HWND {
    h as HWND
}

/// --- Win32 helpers (Windows only) ---

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::LPARAM;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    /// Enumerate visible top-level windows.
    pub unsafe fn enum_top_level() -> Vec<(HWND, u32, Vec<u16>)> {
        let mut out = Vec::new();
        unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let out = &mut *(lparam as *mut Vec<(HWND, u32, Vec<u16>)>);
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let mut class = [0u16; 128];
            let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
            if n > 0 {
                out.push((hwnd, pid, class[..n as usize].to_vec()));
            }
            1
        }
        EnumWindows(Some(cb), &mut out as *mut _ as LPARAM);
        out
    }

    /// One window by handle, freshly read (pid/title/class/minimized).
    pub fn candidate_of(hwnd: HWND) -> Option<Candidate> {
        if unsafe { IsWindow(hwnd) } == 0 {
            return None;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        let mut class = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32) };
        Some(Candidate {
            hwnd: hwnd_usize(hwnd),
            pid,
            title: title_of(hwnd),
            class: if n > 0 { String::from_utf16_lossy(&class[..n as usize]) } else { String::new() },
            minimized: is_minimized(hwnd),
        })
    }

    pub fn class_is_accepted(class: &[u16]) -> bool {
        let s = String::from_utf16_lossy(class);
        ACCEPTED_CLASS_FRAGMENTS.iter().any(|c| s.contains(c))
    }

    pub fn is_wt_class(class: &[u16]) -> bool {
        String::from_utf16_lossy(class).contains(WT_CLASS)
    }

    pub fn title_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 512];
        let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if n > 0 {
            String::from_utf16_lossy(&buf[..n as usize])
        } else {
            String::new()
        }
    }

    pub fn is_minimized(hwnd: HWND) -> bool {
        unsafe { IsIconic(hwnd) != 0 }
    }

    /// Living + same-PID (liveness guard; HERETIC v125 GAP-2).
    pub fn is_live(hwnd: HWND, expected_pid: u32) -> bool {
        if unsafe { IsWindow(hwnd) } == 0 {
            return false;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        pid == expected_pid
    }

    /// TokenElevation of a process: Some(true/false), None when unreadable
    /// (caller treats None as "cannot verify" → refuse, safe default).
    pub fn elevation_of(pid: u32) -> Option<bool> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TokenElevation, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::OpenProcessToken;
        unsafe {
            let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if proc.is_null() {
                return None;
            }
            let mut token: windows_sys::Win32::Foundation::HANDLE = std::ptr::null_mut();
            let ok = OpenProcessToken(proc, TOKEN_QUERY, &mut token);
            CloseHandle(proc);
            if ok == 0 || token.is_null() {
                return None;
            }
            let mut elev = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                &mut elev as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret,
            );
            CloseHandle(token);
            if ok == 0 {
                None
            } else {
                Some(elev.TokenIsElevated != 0)
            }
        }
    }

    pub fn snapshot(hwnd: HWND) -> DockSnapshot {
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        unsafe { GetWindowRect(hwnd, &mut rect) };
        let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) };
        let exstyle = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) };
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        let parent = unsafe { hwnd_from_usize(GetWindowLongW(hwnd, GWLP_HWNDPARENT) as usize) };
        let z_prev = unsafe { hwnd_usize(GetWindow(hwnd, GW_HWNDPREV)) };
        let z_next = unsafe { hwnd_usize(GetWindow(hwnd, GW_HWNDNEXT)) };
        DockSnapshot {
            hwnd: hwnd_usize(hwnd),
            parent: hwnd_usize(parent),
            style,
            exstyle,
            rect: [rect.left, rect.top, rect.right, rect.bottom],
            pid,
            title: title_of(hwnd),
            z_prev,
            z_next,
            was_foreground: unsafe { GetForegroundWindow() == hwnd },
            host: 0,
            persisted_at: None,
        }
    }

    /// Current window rect of any HWND (anchor position tracking).
    pub fn rect_of(hwnd: HWND) -> [i32; 4] {
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        unsafe { GetWindowRect(hwnd, &mut rect) };
        [rect.left, rect.top, rect.right, rect.bottom]
    }
}

/// --- Pure logic ---

/// Discover candidates: visible top-level terminal windows, skipping our own
/// process, minimized windows, and already-docked HWNDs. ≤ MAX_CANDIDATES.
#[cfg(target_os = "windows")]
pub fn discover(self_pid: u32, docked: &DockRegistry) -> Vec<Candidate> {
    let mut out = Vec::new();
    let windows = unsafe { win::enum_top_level() };
    for (hwnd, pid, class) in windows {
        if pid == self_pid {
            continue;
        }
        if !win::class_is_accepted(&class) {
            continue;
        }
        let key = hwnd_usize(hwnd);
        if docked.contains_key(&key) {
            continue;
        }
        if out.len() >= MAX_CANDIDATES {
            break;
        }
        out.push(Candidate {
            hwnd: key,
            pid,
            title: win::title_of(hwnd),
            class: String::from_utf16_lossy(&class),
            minimized: win::is_minimized(hwnd),
        });
    }
    out
}

/// Guard 1 — minimized windows cannot be reparented (W91 evidence).
pub fn guard_minimized(c: &Candidate) -> Result<(), String> {
    if c.minimized {
        Err("Окно свёрнуто — разверните его сначала (minimized нельзя репарентить).".into())
    } else {
        Ok(())
    }
}

/// Guard 2 — unique HWND per dock.
pub fn guard_unique(hwnd: usize, docked: &DockRegistry) -> Result<(), String> {
    if docked.contains_key(&hwnd) {
        Err(format!("Окно уже докнуто (HWND {hwnd:#x})."))
    } else {
        Ok(())
    }
}

/// Guard 3 — PID/title re-match at dock time.
#[cfg(target_os = "windows")]
pub fn guard_identity(c: &Candidate) -> Result<(), String> {
    let hwnd = hwnd_from_usize(c.hwnd);
    if !win::is_live(hwnd, c.pid) {
        return Err("Окно изменилось или закрыто — перепроверьте список.".into());
    }
    let now = win::title_of(hwnd);
    if now != c.title {
        return Err("Заголовок окна изменился с момента выбора — обновите список.".into());
    }
    Ok(())
}

/// Guard 4 — elevation comparison (UIPI). Caller supplies booleans from
/// TokenIntegrityLevel reads; refusal is the safe default.
pub fn guard_elevation(target_elevated: bool, self_elevated: bool) -> Result<(), String> {
    if target_elevated && !self_elevated {
        Err("Окно запущено от администратора — запустите nx-app от администратора или без повышения.".into())
    } else {
        Ok(())
    }
}

/// Guard 5 — self-window exclusion (by pid; the caller's own windows are
/// never dockable into itself).
pub fn guard_self_pid(pid: u32, self_pid: Option<u32>) -> Result<(), String> {
    if self_pid == Some(pid) {
        Err("Нельзя докнуть окно самого приложения.".into())
    } else {
        Ok(())
    }
}

/// Guard 6 — sane visible rect.
#[cfg(target_os = "windows")]
pub fn guard_rect(hwnd: usize) -> Result<(), String> {
    let h = hwnd_from_usize(hwnd);
    let [l, t, r, b] = win::rect_of(h);
    if r - l <= 0 || b - t <= 0 {
        return Err("Окно имеет невидимый размер.".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn check_all_guards(
    c: &Candidate,
    docked: &DockRegistry,
    self_pid: Option<u32>,
    self_elevated: bool,
    target_elevated: bool,
) -> Result<(), String> {
    guard_self_pid(c.pid, self_pid)?;
    guard_minimized(c)?;
    guard_unique(c.hwnd, docked)?;
    guard_identity(c)?;
    guard_elevation(target_elevated, self_elevated)?;
    guard_rect(c.hwnd)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Core-owned host anchors (v2) — raw HWNDs, not Rust values
// ---------------------------------------------------------------------------
//
// An anchor is a borderless top-level window the CORE owns. The docked
// child is parented to it, NOT to the app's HWND, so the app dying does not
// destroy the child (HERETIC v125 GAP-1). Anchors are created hidden and
// shown by the first `dock.set_rect`; the app keeps the rect in sync.
// The HWND is stored as usize in `DockState::anchors` — `HWND` is a raw
// pointer and would make `State` !Send.

#[cfg(target_os = "windows")]
unsafe extern "system" fn anchor_wndproc(hwnd: HWND, msg: u32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    unsafe { DefWindowProcW(hwnd, msg, wparam as WPARAM, lparam as LPARAM) as LRESULT as isize }
}

/// Create a hidden borderless anchor window; returns its HWND (0 on failure).
#[cfg(target_os = "windows")]
pub fn anchor_create() -> usize {
    unsafe {
        let class_name = windows_sys::core::w!("NXCoreDockAnchor");
        let wc = windows_sys::Win32::UI::WindowsAndMessaging::WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(anchor_wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: std::ptr::null_mut(),
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name,
        };
        let _ = RegisterClassW(&wc); // ERROR_CLASS_ALREADY_EXISTS when reused: fine
        let h = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            class_name,
            class_name,
            WS_POPUP,
            0,
            0,
            1,
            1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
        if h.is_null() {
            return 0;
        }
        ShowWindow(h, 0); // hidden until the first set_rect
        hwnd_usize(h)
    }
}

/// Move/size the anchor and reveal it. `x`/`y` keep the current position
/// when `None`.
#[cfg(target_os = "windows")]
pub fn anchor_set_rect(anchor: usize, x: Option<i32>, y: Option<i32>, w: i32, h: i32) {
    unsafe {
        let hwnd = hwnd_from_usize(anchor);
        let [cx, cy, _, _] = win::rect_of(hwnd);
        let _ = MoveWindow(hwnd, x.unwrap_or(cx), y.unwrap_or(cy), w, h, 1);
        let _ = ShowWindow(hwnd, SW_SHOW);
    }
}

/// Destroy an anchor window (its docked child must already be undocked).
#[cfg(target_os = "windows")]
pub fn anchor_destroy(anchor: usize) {
    unsafe {
        DestroyWindow(hwnd_from_usize(anchor));
    }
}

// ---------------------------------------------------------------------------
// Dock / undock / restore
// ---------------------------------------------------------------------------

/// Dock: snapshot, embed as WS_CHILD under our host anchor (v2: not under the
/// app's window). The caller inserts the snapshot into the registry and
/// persists it immediately.
#[cfg(target_os = "windows")]
pub fn dock(c: &Candidate, host: usize, now_ms: u64) -> Result<DockSnapshot, String> {
    let hwnd = hwnd_from_usize(c.hwnd);
    let host_hwnd = hwnd_from_usize(host);
    let mut snap = win::snapshot(hwnd);
    snap.host = host;
    snap.persisted_at = Some(now_ms);

    if unsafe { SetParent(hwnd, host_hwnd) }.is_null() {
        return Err(format!("SetParent failed (err={:?})", std::io::Error::last_os_error()));
    }

    // style: drop WS_POPUP, add WS_CHILD (keep the rest).
    let mut style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) };
    style &= !WS_POPUP as i32;
    style |= WS_CHILD as i32;
    unsafe { SetWindowLongW(hwnd, GWL_STYLE, style) };

    // Size to the anchor's client area; show (invisible while anchor hidden).
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe { GetClientRect(host_hwnd, &mut r) };
    unsafe {
        MoveWindow(hwnd, 0, 0, r.right - r.left, r.bottom - r.top, 1);
        ShowWindow(hwnd, SW_SHOW);
    }
    Ok(snap)
}

/// Undock one window: exact reverse restore (design §7). Best-effort per step.
#[cfg(target_os = "windows")]
pub fn undock_window(key: usize, snap: &DockSnapshot) -> Result<(), String> {
    let hwnd = hwnd_from_usize(key);
    if unsafe { IsWindow(hwnd) } == 0 {
        return Ok(()); // already gone: nothing to restore
    }
    unsafe {
        // 1. Back to top level.
        SetParent(hwnd, std::ptr::null_mut());
        // 2. Restore the saved styles (drops the WS_CHILD we added).
        SetWindowLongW(hwnd, GWL_STYLE, snap.style);
        SetWindowLongW(hwnd, GWL_EXSTYLE, snap.exstyle);
        // 3. Back to the saved screen rect.
        let [l, t, r, b] = snap.rect;
        MoveWindow(hwnd, l, t, r - l, b - t, 1);
        ShowWindow(hwnd, SW_SHOW);
        // 4. Z-order: directly above the window that was below it, else top.
        let after = if snap.z_next != 0 && IsWindow(hwnd_from_usize(snap.z_next)) != 0 {
            hwnd_from_usize(snap.z_next)
        } else {
            HWND_TOP
        };
        SetWindowPos(hwnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        if snap.was_foreground {
            SetForegroundWindow(hwnd);
        }
    }
    Ok(())
}

/// Remove a dock entry completely: restore the window and destroy its anchor.
#[cfg(target_os = "windows")]
fn remove_dock(st: &mut DockState, key: usize) -> Result<(), String> {
    let snap = st.registry.remove(&key);
    if let Some(anchor) = st.anchors.remove(&key) {
        anchor_destroy(anchor);
    }
    match snap {
        Some(snap) => undock_window(key, &snap),
        None => Ok(()),
    }
}

/// Restore-all (clean app close / pipe loss): undock every registered window.
#[cfg(target_os = "windows")]
pub fn restore_all(st: &mut DockState) -> Vec<Result<(), String>> {
    let keys: Vec<usize> = st.registry.keys().copied().collect();
    keys.iter().map(|k| remove_dock(st, *k)).collect()
}

// ---------------------------------------------------------------------------
// Crash recovery (HERETIC v125 GAP-1/GAP-2, wired per DOCK_INTEGRATION_WIRING)
// ---------------------------------------------------------------------------

/// Called when the last app client connection is lost — the app crashed or
/// closed abnormally. The core is still alive; restore every docked window
/// to top level and drop the now-empty anchors.
#[cfg(target_os = "windows")]
pub fn on_app_pipe_loss(st: &mut DockState) -> Vec<Result<(), String>> {
    restore_all(st)
}

/// Liveness sweep (HERETIC v125 GAP-2). Call sites (wired):
///   1. Core startup — after `Core::start` loaded the persisted registry
///      (`server::serve` → `startup_sweep`): stale/orphaned entries left by
///      a previous crash are dropped before any new dock.
///   2. App (re)connect — `server::connection` when the framed-client count
///      goes 0→1, so a fresh app session sees a clean registry.
///
/// Entries whose HWND is gone or PID changed are dropped silently (with
/// their anchors); a live child that lost its parent is restored.
#[cfg(target_os = "windows")]
pub fn sweep_liveness(st: &mut DockState) -> Vec<Result<(), String>> {
    let mut out = Vec::new();
    let keys: Vec<usize> = st.registry.keys().copied().collect();
    for k in keys {
        let snap = match st.registry.remove(&k) {
            Some(s) => s,
            None => continue,
        };
        let hwnd = hwnd_from_usize(k);
        if !win::is_live(hwnd, snap.pid) {
            if let Some(a) = st.anchors.remove(&k) {
                anchor_destroy(a);
            }
            continue; // stale (WT died) — drop silently
        }
        let parent = unsafe { GetWindowLongW(hwnd, GWLP_HWNDPARENT) as usize };
        if parent == 0 {
            out.push(Err(format!("docked {k:#x} lost parent — restored as top-level")));
        } else {
            // Still parented: keep the dock (anchor may be ours and alive).
            st.registry.insert(k, snap);
            continue;
        }
        if let Some(a) = st.anchors.remove(&k) {
            anchor_destroy(a);
        }
    }
    out
}

/// Cross-platform startup sweep + persist (no-op registry work off Windows).
pub fn startup_sweep(st: &mut DockState, path: &Path) {
    #[cfg(target_os = "windows")]
    {
        let _ = sweep_liveness(st);
    }
    #[cfg(not(target_os = "windows"))]
    {
        st.registry.clear();
    }
    let _ = save_registry(path, &st.registry);
}

/// Cross-platform app-pipe-loss + persist.
pub fn pipe_lost(st: &mut DockState, path: &Path) {
    #[cfg(target_os = "windows")]
    {
        let _ = on_app_pipe_loss(st);
    }
    #[cfg(not(target_os = "windows"))]
    {
        st.registry.clear();
    }
    let _ = save_registry(path, &st.registry);
}

// ---------------------------------------------------------------------------
// Handler-facing API (called by api.rs dock_* handlers)
// ---------------------------------------------------------------------------

/// `dock.discover` — guarded candidate list.
pub fn rpc_discover(self_pid: u32, st: &DockState) -> Result<Vec<Candidate>, DockError> {
    #[cfg(target_os = "windows")]
    {
        Ok(discover(self_pid, &st.registry))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(DockError::new("unsupported_platform", "dock is Windows-only"))
    }
}

/// `dock.request` — all six guards, then embed under a fresh anchor.
/// Mutates `st` (registry + anchors); the caller persists the registry.
#[cfg(target_os = "windows")]
pub fn rpc_request(hwnd: usize, self_pid: Option<u32>, st: &mut DockState, now_ms: u64) -> Result<DockSnapshot, DockError> {
    let cand = win::candidate_of(hwnd_from_usize(hwnd))
        .ok_or_else(|| DockError::new("not_found", format!("окно {hwnd:#x} не найдено или закрыто")))?;
    if !win::class_is_accepted(&class_of(&cand)) {
        return Err(DockError::new("invalid_params", "окно не похоже на терминал (WT/console class)"));
    }
    // Guards in declared order; each failure carries its RPC kind.
    guard_self_pid(cand.pid, self_pid).map_err(|m| guard_err("self", m))?;
    guard_minimized(&cand).map_err(|m| guard_err("minimized", m))?;
    guard_unique(cand.hwnd, &st.registry).map_err(|m| guard_err("already_docked", m))?;
    guard_identity(&cand).map_err(|m| guard_err("not_found", m))?;
    let self_elev = win::elevation_of(std::process::id());
    let target_elev = win::elevation_of(cand.pid);
    match (self_elev, target_elev) {
        (Some(s), Some(t)) => guard_elevation(t, s).map_err(|m| guard_err("elevation", m))?,
        _ => {
            return Err(DockError::new(
                "elevation",
                "не удалось проверить уровень прав процесса — dock отклонён (безопасный дефолт)",
            ))
        }
    }
    guard_rect(cand.hwnd).map_err(|m| guard_err("bad_rect", m))?;

    let anchor = anchor_create();
    if anchor == 0 {
        return Err(DockError::new("setparent_failed", "не удалось создать host-anchor ядра"));
    }
    match dock(&cand, anchor, now_ms) {
        Ok(mut snap) => {
            snap.hwnd = cand.hwnd;
            st.registry.insert(cand.hwnd, snap.clone());
            st.anchors.insert(cand.hwnd, anchor);
            Ok(snap)
        }
        Err(m) => {
            anchor_destroy(anchor);
            Err(DockError::new("setparent_failed", m))
        }
    }
}

#[cfg(target_os = "windows")]
fn class_of(c: &Candidate) -> Vec<u16> {
    c.class.encode_utf16().collect()
}

#[cfg(not(target_os = "windows"))]
pub fn rpc_request(_hwnd: usize, _self_pid: Option<u32>, _st: &mut DockState, _now_ms: u64) -> Result<DockSnapshot, DockError> {
    Err(DockError::new("unsupported_platform", "dock is Windows-only"))
}

/// `dock.undock` — exact restore; drops registry entry and anchor.
pub fn rpc_undock(hwnd: usize, st: &mut DockState) -> Result<(), DockError> {
    #[cfg(target_os = "windows")]
    {
        if !st.registry.contains_key(&hwnd) {
            return Err(DockError::new("not_found", format!("окно {hwnd:#x} не докнуто")));
        }
        remove_dock(st, hwnd).map_err(|m| DockError::new("setparent_failed", m))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (hwnd, st);
        Err(DockError::new("unsupported_platform", "dock is Windows-only"))
    }
}

/// `dock.set_rect` — keep the anchor (and the docked child) sized to the
/// app's panel. Without `hwnd`: the only dock, or `not_docked`/`invalid_params`.
pub fn rpc_set_rect(st: &mut DockState, p: &SetRectParams) -> Result<(), DockError> {
    #[cfg(target_os = "windows")]
    {
        let target = match p.hwnd {
            Some(h) => {
                if !st.registry.contains_key(&h) {
                    return Err(DockError::new("not_docked", format!("окно {h:#x} не докнуто")));
                }
                h
            }
            None => match st.anchors.len() {
                0 => return Err(DockError::new("not_docked", "нет докнутых окон")),
                1 => *st.anchors.keys().next().unwrap(),
                _ => {
                    return Err(DockError::new(
                        "invalid_params",
                        "несколько докнутых окон — укажите hwnd",
                    ))
                }
            },
        };
        let anchor = *st.anchors.get(&target).ok_or_else(|| DockError::new("not_docked", "anchor отсутствует"))?;
        anchor_set_rect(anchor, p.x, p.y, p.w, p.h);
        // The child fills the anchor's client area (borderless ⇒ window == client).
        unsafe {
            let child = hwnd_from_usize(target);
            let _ = MoveWindow(child, 0, 0, p.w, p.h, 1);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (st, p);
        Err(DockError::new("unsupported_platform", "dock is Windows-only"))
    }
}

/// `dock.registry` — audit view: snapshots sorted by hwnd.
pub fn rpc_registry(st: &DockState) -> RegistryResult {
    let mut docks: Vec<DockSnapshot> = st.registry.values().cloned().collect();
    docks.sort_by_key(|s| s.hwnd);
    RegistryResult { docks }
}

// ---------------------------------------------------------------------------
// Persistence (HERETIC v125 GAP-3)
// ---------------------------------------------------------------------------

pub fn registry_path(state_dir: &Path) -> PathBuf {
    state_dir.join(REGISTRY_FILE)
}

/// Load a persisted registry after core restart. Entries are re-validated on
/// the next sweep; anchors are re-created lazily. `hwnd` fields are
/// backfilled from the map keys for files written before the field existed.
pub fn load_registry(path: &Path) -> DockRegistry {
    let mut reg: DockRegistry = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => DockRegistry::new(),
    };
    for (k, snap) in reg.iter_mut() {
        if snap.hwnd == 0 {
            snap.hwnd = *k;
        }
    }
    reg
}

pub fn save_registry(path: &Path, docked: &DockRegistry) -> Result<(), String> {
    let text = serde_json::to_string_pretty(docked).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}
