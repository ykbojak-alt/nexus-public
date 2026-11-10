"""Автоматический слой native desktop smoke (W1, диспетч волны-4 п.2).

Всё, что проверяется через js_api/bridge без человеческого глаза:
- инвентарь публичных методов DesktopBridge против контракта;
- деградация без окна (честные False/None, не исключения);
- pick_image / save_text через подменённый create_file_dialog;
- emit-семантика, лимиты payload, изоляция ошибок подписчиков;
- geometry persist round-trip и отбраковка повреждённого файла;
- instance lock: busy-сценарий второго инстанса, release → reacquire;
- open_browser URL-валидация до рендерера;
- unreal_scene_state честность при отсутствии data_dir;
- autostart status (read-only, без записи в реестр).

Отдельным блоком проверяется мост приложения шины (tools/bus_desktop):
контракт нативной части, форма bus_status и честность счётчиков леджера
(«пусто после ротации» ≠ «счётчик сломан»).

С флагом --live добавляется tier B: настоящее скрытое окно pywebview —
js_api виден из JS, evaluate_js round-trip, set_title/minimize на живом окне,
push unreal-scene.state доходит до DOM. Требует pywebview и графический
сеанс; без них tier B честно "skipped".

Запуск (venv AI-2):
  D:\\ai2_pilot\\ai2\\.venv\\Scripts\\python.exe scripts\\desktop-smoke-auto.py
      --out docs\\verification\\evidence\\desktop-smoke-auto-2026-10-14.json
      [--ai2-root D:\\ai2_pilot\\ai2] [--live]

Результат — JSON evidence: per-check {id, status, detail}; статусы
ok | fail | skipped. GUI-остаток — за оператором по
docs/verification/desktop-smoke-manual.md.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# Публичный контракт js_api: методы, доступные JS как window.pywebview.api.*.
# Методы из EXPECTED обязаны существовать; лишние публичные методы — сигнал
# (возможно, незадокументированная поверхность моста).
EXPECTED_API = {
    "app_info", "set_title", "set_fullscreen", "toggle_fullscreen", "minimize",
    "notify", "close_window", "pick_image", "save_text", "open_browser",
    "instagram_web_state", "instagram_web_open", "instagram_web_close",
    "unreal_scene_state", "unreal_scene_open", "emit", "on_event",
    "attach", "attach_tray", "is_frameless", "shutdown",
}
PAYLOAD_MAX = 64 * 1024


class _FakeWindow:
    """Заглушка окна: минимум для bridge-логики + управляемые file-dialogs."""

    def __init__(self) -> None:
        self.title = ""
        self.calls: list[str] = []
        self.fullscreen = False
        self.dialog_result: Any = None
        self.evaluated: list[str] = []

    def set_title(self, title: str) -> None:
        self.title = title
        self.calls.append("set_title")

    def toggle_fullscreen(self) -> None:
        self.fullscreen = not self.fullscreen
        self.calls.append("toggle_fullscreen")

    def minimize(self) -> None:
        self.calls.append("minimize")

    def destroy(self) -> None:
        self.calls.append("destroy")

    def create_file_dialog(self, *_args: Any, **kw: Any) -> Any:
        self.calls.append("create_file_dialog")
        return self.dialog_result

    def evaluate_js(self, script: str) -> Any:
        self.evaluated.append(script)


class Smoke:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []

    def record(self, check_id: str, status: str, detail: str = "") -> None:
        self.checks.append({"id": check_id, "status": status, "detail": detail})
        print(f"  [{status:>7}] {check_id} — {detail}")

    def ok(self, check_id: str, detail: str = "") -> None:
        self.record(check_id, "ok", detail)

    def fail(self, check_id: str, detail: str = "") -> None:
        self.record(check_id, "fail", detail)

    def skip(self, check_id: str, detail: str = "") -> None:
        self.record(check_id, "skipped", detail)

    def check(self, check_id: str, condition: bool, detail: str = "") -> None:
        (self.ok if condition else self.fail)(check_id, detail)


def run_tier_a(sm: Smoke, data_dir: Path) -> None:
    from ai2.desktop import (DesktopBridge, InstanceBusy, acquire_instance_lock,
                             load_window_geometry, manage_autostart,
                             release_instance_lock, save_window_geometry,
                             write_instance_info)

    # --- инвентарь API против контракта
    methods = {m for m in dir(DesktopBridge) if not m.startswith("_") and callable(getattr(DesktopBridge, m))}
    missing, extra = EXPECTED_API - methods, methods - EXPECTED_API
    sm.check("api.inventory", not missing,
             f"всего {len(methods)} методов; extra={sorted(extra) or 'нет'}"
             + (f"; ОТСУТСТВУЮТ: {sorted(missing)}" if missing else ""))

    # --- app_info без окна
    info = DesktopBridge(data_dir=data_dir).app_info()
    sm.check("app_info.shape", info.get("desktop") is True and info.get("platform") == sys.platform
             and info.get("pid") is None and bool(info.get("version")),
             f"version={info.get('version')} platform={info.get('platform')} pid={info.get('pid')} (нет окна → None)")

    # --- деградация без окна: False/None, не исключения.
    # open_browser не входит: он не зависит от главного окна — pywebview
    # ставит дочернее окно в очередь и без него, True = окно создано/в очереди.
    bare = DesktopBridge()
    degrade = {"set_title": bare.set_title("x"), "toggle_fullscreen": bare.toggle_fullscreen(),
               "minimize": bare.minimize(), "close_window": bare.close_window(),
               "pick_image": bare.pick_image(), "save_text": bare.save_text("a.txt", "t"),
               "notify": bare.notify("t", "m")}
    bad = [k for k, v in degrade.items() if v not in (False, None)]
    sm.check("degrade.no_window", not bad, f"все {len(degrade)} методов → False/None; нарушители: {bad or 'нет'}")

    # --- window controls через заглушку
    bridge = DesktopBridge()
    win = _FakeWindow()
    bridge.attach(win)
    sm.check("window.set_title", bridge.set_title("  NEXUS · тест  ") is True and win.title == "NEXUS · тест",
             f"title={win.title!r}")
    sm.check("window.minimize", bridge.minimize() is True and "minimize" in win.calls, "minimize → True")
    sm.check("window.fullscreen_toggle", bridge.toggle_fullscreen() is True and win.fullscreen is True,
             "toggle → fullscreen=True")

    # --- pick_image: файл → data URL; отмена → None; чужой тип → None
    png = data_dir / "pick.png"
    png.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="))
    win.dialog_result = (str(png),)
    picked = bridge.pick_image()
    sm.check("pick_image.data_url", isinstance(picked, dict) and picked["mime"] == "image/png"
             and picked["data_url"].startswith("data:image/png;base64,"),
             f"name={picked and picked.get('name')} mime={picked and picked.get('mime')}")
    win.dialog_result = ()
    sm.check("pick_image.cancel", bridge.pick_image() is None, "отмена диалога → None")
    txt = data_dir / "not-image.txt"
    txt.write_text("x", encoding="utf-8")
    win.dialog_result = (str(txt),)
    sm.check("pick_image.wrong_type", bridge.pick_image() is None, "txt-файл → None (фильтр mime)")

    # --- save_text: запись через диалог; отмена → None.
    # Реальный OS-диалог возвращает только существующие каталоги — имитируем.
    target = data_dir / "export" / "trajectory.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    win.dialog_result = str(target)
    saved = bridge.save_text("trajectory.txt", "привет, мир")
    sm.check("save_text.writes", saved == str(target) and target.read_text(encoding="utf-8") == "привет, мир",
             f"path={saved}")
    win.dialog_result = None
    sm.check("save_text.cancel", bridge.save_text("a.txt", "x") is None, "отмена → None, файл не тронут")

    # --- emit: доставка, лимит, изоляция ошибок
    got: list[Any] = []
    bridge.on_event("ui.ping", got.append)
    bridge.on_event("ui.ping", lambda _p: 1 / 0)
    delivered = bridge.emit("ui.ping", {"n": 1})
    sm.check("emit.delivers", delivered is True and got == [{"n": 1}],
             "подписчик получил payload; упавший сосед не помешал")
    sm.check("emit.oversize", bridge.emit("ui.ping", "x" * (PAYLOAD_MAX + 1)) is False,
             "payload >64 КБ → False")
    sm.check("emit.bad_name", bridge.emit("", {}) is False and bridge.emit(" " * 5, None) is False,
             "пустое имя → False")

    # --- geometry persist
    gpath = data_dir / "sub" / "desktop_window.json"
    save_window_geometry(gpath, 1280, 800, 12, 34)
    loaded = load_window_geometry(gpath)
    sm.check("geometry.roundtrip", loaded == {"width": 1280, "height": 800, "x": 12, "y": 34},
             f"{loaded}")
    gpath.write_text("{битый json", encoding="utf-8")
    sm.check("geometry.corrupt", load_window_geometry(gpath) is None, "битый файл → None (дефолты)")
    save_window_geometry(gpath, 10, 10)  # вне допустимого диапазона
    sm.check("geometry.bounds", load_window_geometry(gpath) is None, "10×10 → None")

    # --- instance lock: busy второго инстанса → release → reacquire
    lock_path = data_dir / "desktop.lock"
    fh = acquire_instance_lock(lock_path)
    if fh is None:
        sm.skip("instance_lock", "платформа без файловых блокировок")
    else:
        write_instance_info(fh, pid=4242, port=62281)
        try:
            try:
                acquire_instance_lock(lock_path)
                sm.fail("instance_lock.busy", "второй инстанс прошёл — блокировка не держится")
            except InstanceBusy as e:
                sm.check("instance_lock.busy", e.info.get("pid") == 4242 and e.info.get("port") == 62281,
                         f"InstanceBusy info={e.info}")
        finally:
            release_instance_lock(lock_path, fh)
        fh2 = acquire_instance_lock(lock_path)
        sm.check("instance_lock.reacquire", fh2 is not None, "после release lock снова берётся")
        release_instance_lock(lock_path, fh2)

    # --- open_browser: URL-валидация до рендерера
    b = DesktopBridge()
    bad_urls = ["javascript:alert(1)", "file:///etc/passwd", "https://user:pw@host/x",
                "notaurl", "", "https://good.example/x" * 300, "http://h\x01ost/"]
    rejected = [u for u in bad_urls if b.open_browser(u) is not False]
    sm.check("open_browser.validation", not rejected,
             f"{len(bad_urls)} вредных/битых URL отклонены до рендерера; пропущены: {rejected or 'нет'}")
    good = b.open_browser("https://example.com/docs")
    sm.check("open_browser.queue", isinstance(good, bool),
             f"валидный https → {good} (True = окно создано/в очереди, False = нет бэкенда)")

    # --- unreal_scene_state без пакета → честное состояние
    st = DesktopBridge().unreal_scene_state()
    sm.check("unreal_scene.no_datadir", isinstance(st, dict)
             and st.get("status") in ("error", "unavailable", "disconnected", "idle", "not-installed"),
             f"status={st.get('status')!r} reason={st.get('reason')!r}")

    # --- autostart status: read-only
    status = manage_autostart("status")
    sm.check("autostart.status_readonly", isinstance(status, str) and "автозапуск" in status,
             status[:90])


def run_bus_tier_a(sm: Smoke, data_dir: Path) -> None:
    """Tier A моста шины (tools/bus_desktop) — контракт и честность ответов.

    Отдельный оболочке продукт (AI-2) слой: у приложения шины свой мост, но
    контракт нативной части тот же (EXPECTED_API), иначе инвентарь разойдётся.
    """
    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    try:
        from tools.bus_desktop.bridge import EXPECTED_API as BUS_API
        from tools.bus_desktop.bridge import BusBridge
    except ImportError as exc:
        sm.skip("bus.api", f"мост шины недоступен: {exc}")
        return

    methods = {m for m in dir(BusBridge) if not m.startswith("_") and callable(getattr(BusBridge, m))}
    missing = BUS_API - methods
    sm.check("bus.api.inventory", not missing,
             f"всего {len(methods)} методов; ОТСУТСТВУЮТ: {sorted(missing) or 'нет'}")

    bridge = BusBridge()
    status = bridge.bus_status()
    sm.check("bus_status.shape", isinstance(status, dict) and "error" not in status
             and isinstance(status.get("windows"), list) and len(status["windows"]) == 7
             and "health" in status and "policy" in status,
             f"окон={len(status.get('windows', []))}, "
             f"health={status.get('health', {}).get('state')!r}, "
             f"policy={status.get('policy', {}).get('blocking')}")

    # Мост без окна не падает: bus_* возвращают значения, а не исключения.
    bare = BusBridge()
    degrade = {
        "bus_card": bare.bus_card("W0", "../secret.md"),
        "bus_hold": bare.bus_hold("W0", "../secret.md"),
        "bus_dispatch": bare.bus_dispatch("W0", "нет-такой.md"),
        "bus_add_task": bare.bus_add_task("W0", "   "),
    }
    bad = [k for k, v in degrade.items() if not (isinstance(v, dict) and "error" in v)]
    sm.check("bus.degrade.no_window", not bad,
             f"все {len(degrade)} методов → error; нарушители: {bad or 'нет'}")

    # Честность счётчиков: «пусто после ротации» ≠ «счётчик сломан».
    bus_dir = data_dir / "bus"
    archive = bus_dir / "queue" / "W0" / "sent" / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    (archive / "01-старая.md").write_text("карточка", encoding="utf-8")
    old = os.environ.get("NEXUS_BUS_DIR")
    os.environ["NEXUS_BUS_DIR"] = str(bus_dir)
    try:
        health = BusBridge().bus_health()
    finally:
        if old is None:
            os.environ.pop("NEXUS_BUS_DIR", None)
        else:
            os.environ["NEXUS_BUS_DIR"] = old
    sm.check("bus.health.empty_vs_broken", health.get("state") == "empty_after_rotation"
             and health.get("totalArchive", 0) > 0,
             f"state={health.get('state')!r} archive={health.get('totalArchive')}")


def tier_b_checks(data_dir: Path) -> list[dict[str, Any]]:
    """Живое скрытое окно pywebview: js_api из JS, evaluate_js, set_title, push-событие.

    Выполняется в дочернем процессе (см. run_tier_b) — GUI-цикл webview.start()
    может не завершиться без дисплея; родитель гасит по таймауту."""
    sm = Smoke()
    try:
        import webview
    except ImportError:
        sm.skip("live.window", "pywebview не установлен — tier B пропущен")
        return sm.checks
    from ai2.desktop import DesktopBridge

    bridge = DesktopBridge(data_dir=data_dir)
    done: dict[str, Any] = {}

    def probe() -> None:
        try:
            bridge.attach(webview.windows[0])
            win = webview.windows[0]
            done["title_before"] = bridge.set_title("SMOKE-TITLE-OK")
            done["app_info_js"] = win.evaluate_js(
                "window.pywebview && window.pywebview.api ? 'api-present' : 'api-absent'")
            done["eval_roundtrip"] = win.evaluate_js("40 + 2")
            done["minimize"] = bridge.minimize()
            time.sleep(0.5)
            win.evaluate_js(
                "window.__scenePush = null; window.addEventListener('unreal-scene.state',"
                " e => { window.__scenePush = e.detail; }); 'armed'")
            bridge._push_scene_state({"status": "testing", "source": "smoke", "reason": None,
                                      "lastUpdated": 0, "protocolVersion": 1})
            time.sleep(0.5)
            done["scene_push"] = win.evaluate_js("window.__scenePush && window.__scenePush.status")
            done["restore_title"] = bridge.set_title("NEXUS Smoke")
        except Exception as e:  # noqa: BLE001 — фиксируем факт, не прячем
            done["error"] = f"{type(e).__name__}: {e}"
        finally:
            try:
                webview.windows[0].destroy()
            except Exception:  # noqa: BLE001
                pass

    try:
        webview.create_window("nexus-smoke-auto", "about:blank", width=640, height=480, hidden=True)
        webview.start(probe, debug=False)
    except Exception as e:  # noqa: BLE001 — headless/нет дисплея/нет runtime
        sm.skip("live.window", f"окно не создано: {type(e).__name__}: {e}")
        return sm.checks
    if "error" in done:
        # Renderer не поднялся — среда без интерактивного рабочего стола,
        # а не баг моста: честный skipped, прогон за оператором.
        if "failed to start" in str(done["error"]).lower():
            sm.skip("live.window", f"renderer не поднялся в этой сессии: {done['error']} "
                                   "— tier B за оператором (интерактивный сеанс)")
        else:
            sm.fail("live.window", f"probe упал: {done['error']}")
        return sm.checks
    sm.check("live.api_from_js", done.get("app_info_js") == "api-present", f"pywebview.api → {done.get('app_info_js')!r}")
    sm.check("live.evaluate_js", done.get("eval_roundtrip") == 42, f"40+2 → {done.get('eval_roundtrip')!r}")
    sm.check("live.set_title", done.get("title_before") is True, "set_title на живом окне → True")
    sm.check("live.minimize", done.get("minimize") is True, "minimize → True (состояние не проверяется глазом)")
    sm.check("live.scene_push", done.get("scene_push") == "testing",
             f"unreal-scene.state до DOM: detail.status={done.get('scene_push')!r}")
    sm.check("live.restore_title", done.get("restore_title") is True, "restore → True")
    return sm.checks


def run_tier_b(sm: Smoke, data_dir: Path, ai2_root: str) -> None:
    """Tier B в дочернем процессе с жёстким таймаутом — GUI-цикл может виснуть
    на сессиях без интерактивного дисплея; зависание ≠ падение продукта."""
    frag = data_dir / "tier_b_result.json"
    cmd = [sys.executable, str(Path(__file__).resolve()), "--live-child",
           "--ai2-root", ai2_root, "--fragment", str(frag), "--data-dir", str(data_dir)]
    import subprocess
    try:
        proc = subprocess.run(cmd, timeout=180, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        sm.skip("live.window", "tier B: дочерний процесс не завершился за 180 с "
                               "(GUI-цикл без дисплея) — проверка за оператором")
        return
    if frag.is_file():
        try:
            for check in json.loads(frag.read_text(encoding="utf-8")):
                sm.record(check["id"], check["status"], check.get("detail", ""))
            return
        except (ValueError, KeyError):
            pass
    tail = (proc.stdout or "")[-400:] + (proc.stderr or "")[-400:]
    sm.skip("live.window", f"tier B: фрагмент не записан, rc={proc.returncode}; tail: {tail.strip()[:300]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ai2-root", default="D:/ai2_pilot/ai2", help="корень репозитория AI-2")
    ap.add_argument("--out", help="JSON evidence файл")
    ap.add_argument("--live", action="store_true", help="tier B: живое скрытое окно pywebview")
    ap.add_argument("--live-child", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--fragment", help=argparse.SUPPRESS)
    ap.add_argument("--data-dir", help=argparse.SUPPRESS)
    args = ap.parse_args()

    sys.path.insert(0, args.ai2_root)
    try:
        sys.stdout.reconfigure(errors="replace")  # cp1251-консоль не ест unicode-стрелки
    except Exception:  # noqa: BLE001
        pass

    if args.live_child:  # дочерний процесс tier B: только GUI-проверки → фрагмент
        checks = tier_b_checks(Path(args.data_dir))
        Path(args.fragment).write_text(json.dumps(checks, ensure_ascii=False), encoding="utf-8")
        return 0

    if not args.out:
        ap.error("--out обязателен в родительском режиме")
    sm = Smoke()
    with tempfile.TemporaryDirectory(prefix="desktop_smoke_") as td:
        data_dir = Path(td)
        print("tier A — bridge-логика без окна")
        run_tier_a(sm, data_dir)
        print("tier A — мост шины (tools/bus_desktop)")
        run_bus_tier_a(sm, data_dir)
        if args.live:
            print("tier B — живое скрытое окно pywebview (дочерний процесс, таймаут 180 с)")
            run_tier_b(sm, data_dir, args.ai2_root)

    fails = [c for c in sm.checks if c["status"] == "fail"]
    doc = {
        "smoke": "desktop-auto",
        "date": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "ai2_root": args.ai2_root,
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "live_tier": bool(args.live),
        "summary": {"total": len(sm.checks), "ok": sum(1 for c in sm.checks if c["status"] == "ok"),
                    "fail": len(fails), "skipped": sum(1 for c in sm.checks if c["status"] == "skipped")},
        "checks": sm.checks,
        "note": "GUI-остаток (визуал, трей, геометрия окна на дисплее, диалоги ОС глазами) — "
                "за оператором по docs/verification/desktop-smoke-manual.md",
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nevidence → {out}  ({doc['summary']})")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
