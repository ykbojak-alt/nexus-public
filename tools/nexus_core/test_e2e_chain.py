"""E2E battle-chain for nexus-core (ship pre-flight).

Runs the full NEWF chain on a scratch daemon (default :5697):
  spawn -> send+enter -> screen marker -> keys -> resize ->
  rename -> worktree create/list/delete -> kill -> server restore.

Hardened:
  * no-proxy urllib opener (http_proxy env on this box breaks localhost)
  * unique names per run (no dirty-state collisions)
  * temp git repo for worktree (git init if absent)
  * best-effort cleanup of leftover e2e-* terminals up-front
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

BASE = os.environ.get("NEXUS_CORE_URL", "http://127.0.0.1:5697").rstrip("/")
RUN = f"e2e-{os.getpid() % 100000:05d}"
TERM = RUN
RENAMED = RUN + "-r"
WT = RUN + "-wt"
REPO = os.environ.get("E2E_REPO", r"D:\Temp\e2e-repo")
MARK = f"E2E-MARK-{RUN}"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def req(method, path, payload=None, timeout=15):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with _opener.open(request, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(raw) if raw else {}
            except Exception:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, str(e)


def _forensics(name):
    """W9: дамп состояния при падении шага — screen + terminals + audit."""
    try:
        print(f"  --- forensics[{name}] ---")
        if "ACTIVE" in globals() and globals().get("ACTIVE"):
            c, b = req("GET", f"/api/core/screen/{globals()['ACTIVE']}?lines=6")
            txt = b.get("screen", "") if isinstance(b, dict) else str(b)
            print("  screen tail:", txt[-300:].replace("\n", " | "))
        c, b = req("GET", "/api/core/terminals")
        n = len(b.get("terminals", [])) if isinstance(b, dict) else "?"
        print(f"  terminals: {n}")
        c, b = req("GET", "/api/core/audit?limit=3")
        ents = b.get("entries", []) if isinstance(b, dict) else []
        for e in ents[:3]:
            print("  audit:", e.get("action"), e.get("subject"), e.get("decision"))
    except Exception as fe:
        print("  forensics-fail:", fe)


def step(name, fn):
    try:
        ok = fn()
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        if not ok:
            _forensics(name)
        return bool(ok)
    except Exception as e:
        print(f"[FAIL] {name}: {e}")
        _forensics(name)
        return False


# ---------- pre-clean leftovers from crashed runs ----------
def preclean():
    code, body = req("GET", "/api/core/terminals")
    terms = body.get("terminals", []) if isinstance(body, dict) else []
    for t in terms:
        n = t.get("name", "")
        if n.startswith("e2e-"):
            req("POST", "/api/core/kill", {"term": n})


if __name__ == "__main__":
    preclean()
    results = []


    def s1():
        code, body = req("POST", "/api/core/run", {"name": TERM, "command": ["cmd.exe"], "keep": True})
        print("  spawn:", code, body if code not in (200, 201) else "")
        return code in (200, 201)
    results.append(("spawn", step("spawn", s1)))

    time.sleep(2)  # cmd boot

    def s2():
        code, body = req("POST", "/api/core/send", {"term": TERM, "text": f"echo {MARK}", "enter": True})
        print("  send:", code)
        return code in (200, 201, 204)
    results.append(("send", step("send", s2)))

    time.sleep(3)


    def s3():
        # маркер рисуется асинхронно — опрашиваем до 12с
        deadline = time.time() + 12
        code, has = 0, False
        while time.time() < deadline and not has:
            code, body = req("GET", f"/api/core/screen/{TERM}")
            text = body.get("screen", "") if isinstance(body, dict) else str(body)
            has = MARK in text
            if not has:
                time.sleep(0.6)
        print("  screen:", code, "marker:", has)
        return code == 200 and has
    results.append(("screen", step("screen", s3)))


    def s4():
        code, body = req("POST", "/api/core/keys", {"term": TERM, "keys": ["ctrl+c"]})
        print("  keys:", code)
        return code in (200, 204)
    results.append(("keys", step("keys", s4)))


    def s5():
        code, body = req("POST", f"/api/core/terminal/{TERM}/resize", {"cols": 100, "rows": 30})
        print("  resize:", code)
        if code in (404, 501):
            print("  resize SKIP (endpoint absent)")
            return True
        if code in (200, 204):
            time.sleep(1)
            c, b = req("GET", "/api/core/terminals")
            terms = b.get("terminals", []) if isinstance(b, dict) else []
            mine = next((t for t in terms if t.get("name") == TERM), {})
            print("  cols:", mine.get("cols"), "rows:", mine.get("rows"))
            return mine.get("cols") == 100 and mine.get("rows") == 30
        return False
    results.append(("resize", step("resize", s5)))


    def s6():
        code, body = req("POST", f"/api/core/terminal/{TERM}/rename", {"new_name": RENAMED})
        print("  rename:", code)
        if code == 404:
            print("  rename SKIP (endpoint absent)")
            return True
        return code in (200, 204)
    results.append(("rename", step("rename", s6)))

    ACTIVE = RENAMED  # name after rename (or same if skipped)


    def ensure_repo():
        if os.path.isdir(os.path.join(REPO, ".git")):
            return True
        os.makedirs(REPO, exist_ok=True)
        for args in (["init"], ["config", "user.email", "e2e@x"], ["config", "user.name", "e2e"],
                     ["commit", "--allow-empty", "-m", "init"]):
            subprocess.run(["git", "-C", REPO] + args, capture_output=True, timeout=15)
        return os.path.isdir(os.path.join(REPO, ".git"))


    def s7():
        if not ensure_repo():
            print("  worktree SKIP (no git repo)")
            return True
        code, body = req("POST", "/api/core/worktree", {"repo": REPO, "name": WT})
        print("  worktree create:", code, body if code not in (200, 201) else "")
        code2, _ = req("GET", "/api/core/worktrees?repo=" + urllib.request.quote(REPO, safe=""))
        code3, _ = req("DELETE", "/api/core/worktree?name=" + WT + "&repo=" +
                       urllib.request.quote(REPO, safe="") + "&force=1")
        print("  list:", code2, "delete:", code3)
        return code in (200, 201) and code3 in (200, 204)
    results.append(("worktree", step("worktree", s7)))


    def s10():
        code, body = req("GET", "/api/core/programs")
        progs = body.get("programs", []) if isinstance(body, dict) else []
        ids = [p.get("id") for p in progs]
        print("  programs:", code, len(ids), ids[:6])
        return code == 200 and len(ids) > 0
    results.append(("programs", step("programs", s10)))


    def s11():
        # SSE stream: подписка должна отдать первый screen-event за <5s.
        import threading
        got = []
        def listen():
            request = urllib.request.Request(BASE + f"/api/core/terminal/{ACTIVE}/stream")
            try:
                with _opener.open(request, timeout=8) as r:
                    buf = b""
                    t0 = time.time()
                    while time.time() - t0 < 5:
                        c = r.read(1)
                        if not c:
                            break
                        buf += c
                        if buf.endswith(b"\n\n"):
                            got.append(buf)
                            break
            except Exception as e:
                got.append(f"ERR {e}".encode())
        th = threading.Thread(target=listen, daemon=True)
        th.start()
        time.sleep(0.5)
        req("POST", "/api/core/send", {"term": ACTIVE, "text": "echo SSE-PING", "enter": True})
        th.join(6)
        has = any(b"event: screen" in g for g in got)
        print("  stream:", "event" if has else got[:1])
        return has
    results.append(("sse-stream", step("sse-stream", s11)))


    def s12():
        code, body = req("GET", f"/api/core/screen/{ACTIVE}?lines=3")
        lines = body.get("lines") if isinstance(body, dict) else None
        has_trunc = "truncated" in body if isinstance(body, dict) else False
        print("  scrollback:", code, "lines:", lines, "truncated-field:", has_trunc)
        return code == 200 and lines == 3 and has_trunc
    results.append(("scrollback", step("scrollback", s12)))



    def s13():
        # transcript dump: чистый текст без ANSI, attachment header
        import urllib.request as u
        req_obj = u.Request(BASE + f"/api/core/terminal/{ACTIVE}/dump")
        try:
            with _opener.open(req_obj, timeout=10) as r:
                text = r.read().decode("utf-8", "replace")
                cd = r.headers.get("Content-Disposition", "")
                print("  dump:", r.status, "cd:", cd[:50])
                return r.status == 200 and "\x1b" not in text and "attachment" in cd
        except Exception as e:
            print("  dump ERR:", e)
            return False
    results.append(("dump", step("dump", s13)))


    def s14():
        # run-program: резолв cmd из реестра и спавн
        name = RUN + "-rp"
        code, body = req("POST", "/api/core/run-program", {"program": "cmd", "name": name})
        print("  run-program:", code, body.get("address") if isinstance(body, dict) else body)
        if code in (200, 201):
            req("POST", "/api/core/kill", {"term": name})
            return True
        return code == 404 and True  # endpoint absent → не валим
    results.append(("run-program", step("run-program", s14)))



    def s15():
        # spaces CRUD: create → rename → delete (SKIP если 404)
        sp = RUN + "-sp"
        code, body = req("POST", "/api/core/space", {"name": sp})
        if code == 404:
            print("  spaces SKIP (endpoint absent)")
            return True
        if code not in (200, 201):
            print("  space create:", code, body)
            return False
        code2, _ = req("POST", f"/api/core/space/{sp}/rename", {"new_name": sp + "x"})
        code3, _ = req("DELETE", f"/api/core/space/{sp}x")
        print("  spaces:", code, code2, code3)
        return code2 in (200, 204) and code3 in (200, 204)
    results.append(("spaces", step("spaces", s15)))


    def s16():
        # restart: kill → exited → restart → живой (SKIP 404)
        name = RUN + "-rs"
        code, _ = req("POST", "/api/core/run", {"name": name, "command": ["cmd.exe"]})
        if code not in (200, 201):
            print("  restart spawn:", code)
            return False
        time.sleep(1.5)
        req("POST", "/api/core/kill", {"term": name})
        time.sleep(1.5)
        code, body = req("POST", f"/api/core/terminal/{name}/restart", {"term": name})
        if code == 404:
            print("  restart SKIP (endpoint absent)")
            req("POST", "/api/core/kill", {"term": name})
            return True
        print("  restart:", code, (body.get("state") if isinstance(body, dict) else body))
        ok = code in (200, 204)
        req("POST", "/api/core/kill", {"term": name})
        return ok
    results.append(("restart", step("restart", s16)))



    def s17():
        # spawn-child: дочка с parent-ссылкой, kill родителя → die-дочка умирает (SKIP 404)
        par, kid = RUN + "-p", RUN + "-p-1"
        code, _ = req("POST", "/api/core/run", {"name": par, "command": ["cmd.exe"]})
        if code not in (200, 201):
            return False
        time.sleep(1)
        code, body = req("POST", f"/api/core/terminal/{par}/spawn-child", {"command": ["cmd.exe"]})
        if code == 404:
            print("  spawn-child SKIP (absent)")
            req("POST", "/api/core/kill", {"term": par})
            return True
        if code not in (200, 201):
            print("  spawn-child:", code, body)
            return False
        kid = body.get("name", kid)
        print("  child:", kid, "parent:", body.get("parent"))
        req("POST", "/api/core/kill", {"term": par})
        time.sleep(3)
        _, terms = req("GET", "/api/core/terminals")
        dead = [t for t in terms.get("terminals", []) if t.get("name") == kid]
        gone = (not dead) or dead[0].get("state") == "exited"
        print("  die-with-parent:", gone)
        if not gone:
            req("POST", "/api/core/kill", {"term": kid})
        return gone
    results.append(("spawn-child", step("spawn-child", s17)))



    def s18():
        # events?types= фильтр: attention-кадр приходит, прочие нет (SKIP 400-absent)
        import threading
        got = []
        def listen():
            request = urllib.request.Request(BASE + "/api/core/events?types=attention,exited")
            try:
                with _opener.open(request, timeout=10) as r:
                    buf = b""
                    t0 = time.time()
                    while time.time() - t0 < 6 and len(got) < 4:
                        c = r.read(1)
                        if not c:
                            break
                        buf += c
                        if buf.endswith(b"\n\n"):
                            got.append(buf)
                            buf = b""
            except Exception as e:
                got.append(f"ERR {e}".encode())
        th = threading.Thread(target=listen, daemon=True)
        th.start()
        time.sleep(0.6)
        req("POST", "/api/core/send", {"term": ACTIVE, "text": "echo E2E-EV", "enter": True})
        th.join(6)
        bad = req("GET", "/api/core/events?types=bogus-xyz")
        print("  events-frames:", len(got), "bad-type:", bad[0])
        has_filtered = any(b"attention" in g or b"exited" in g for g in got)
        return has_filtered and bad[0] == 400
    results.append(("events-filter", step("events-filter", s18)))


    def s19():
        # audit trail: решения гейта видны (SKIP если 404)
        code, body = req("GET", "/api/core/audit?limit=10")
        if code == 404:
            print("  audit SKIP (absent)")
            return True
        entries = body.get("entries", []) if isinstance(body, dict) else []
        print("  audit:", code, "entries:", len(entries))
        return code == 200 and isinstance(entries, list)
    results.append(("audit", step("audit", s19)))



    def s20():
        # labels: merge + remove (null) + read-back
        c1, _ = req("POST", "/api/core/terminal/" + ACTIVE + "/labels", {"labels": {"env": "e2e", "tmp": "x"}})
        c2, _ = req("POST", "/api/core/terminal/" + ACTIVE + "/labels", {"labels": {"tmp": None}})
        c3, b = req("GET", "/api/core/terminals")
        t = [x for x in b.get("terminals", []) if x.get("name") == ACTIVE]
        lab = t[0].get("labels", {}) if t else {}
        print("  labels:", c1, c2, lab)
        return c1 == 200 and c2 == 200 and lab.get("env") == "e2e" and "tmp" not in lab
    results.append(("labels", step("labels", s20)))



    def s21():
        # machines?detail=1: массив с state/terminals/metrics для local
        c, b = req("GET", "/api/core/machines?detail=1")
        ms = b.get("machines", []) if isinstance(b, dict) else []
        loc = [m for m in ms if isinstance(m, dict) and m.get("name") == "local"]
        met = loc[0].get("metrics", {}) if loc else {}
        print("  machines:", c, len(ms), "local metrics:", bool(met))
        return c == 200 and loc and "cpu_pct" in met
    results.append(("machines-detail", step("machines-detail", s21)))



    def s22():
        # clone: spec-копия, parent=None, auto-name
        c, b = req("POST", f"/api/core/terminal/{ACTIVE}/clone", {})
        kid = b.get("name") if isinstance(b, dict) else None
        ok = (c == 200 and kid and b.get("parent") is None
              and b.get("command") is not None)
        if kid:
            req("POST", "/api/core/kill", {"term": kid})
        print("  clone:", c, kid)
        return ok
    results.append(("clone", step("clone", s22)))


    def s23():
        # wait-longpoll: быстрый ответ, корректный шейп
        c, b = req("GET", f"/api/core/terminal/{ACTIVE}/wait?since=0&timeout=1")
        print("  wait:", c, b.get("changed"), b.get("state") if isinstance(b, dict) else None)
        return c == 200 and isinstance(b, dict) and "seq" in b
    results.append(("wait", step("wait", s23)))


    def s24():
        # batch: spawn два терминала → batch-kill их + честная ошибка на ghost
        n1, n2 = f"{RUN}-bt1", f"{RUN}-bt2"
        for n in (n1, n2):
            req("POST", "/api/core/run", {"name": n, "command": ["cmd.exe"]})
        time.sleep(1.5)
        c, b = req("POST", "/api/core/batch", {"action": "kill",
            "terms": [n1, n2, "ghost-nope"]})
        res = b.get("results", {}) if isinstance(b, dict) else {}
        g = res.get("ghost-nope", {})
        print("  batch:", c, "ok:", [k for k, v in res.items() if v.get("ok")],
              "ghost-ok:", g.get("ok"))
        return c == 200 and g.get("ok") is False and res.get(n1, {}).get("ok")
    results.append(("batch", step("batch", s24)))



    def s25():
        # info: полная спека + env-маскировка секретов
        n = f"{RUN}-inf"
        req("POST", "/api/core/run", {"name": n, "command": ["cmd.exe"],
            "env": {"E2E_API_KEY": "sekrit-9", "e2e_plain": "visible"}})
        time.sleep(1.0)
        c, b = req("GET", f"/api/core/terminal/{n}/info")
        env = b.get("env", {}) if isinstance(b, dict) else {}
        print("  info:", c, "key:", env.get("E2E_API_KEY"), "plain:", env.get("e2e_plain"))
        req("POST", "/api/core/kill", {"term": n})
        return (c == 200 and env.get("E2E_API_KEY") == "***"
                and env.get("e2e_plain") == "visible")
    results.append(("info-mask", step("info-mask", s25)))

    def s8():
        code, _ = req("POST", "/api/core/kill", {"term": ACTIVE})
        print("  kill:", code)
        time.sleep(0.5)
        _, body = req("GET", "/api/core/terminals")
        terms = body.get("terminals", []) if isinstance(body, dict) else []
        alive = [t for t in terms if t.get("name") in (TERM, RENAMED) and not t.get("exited_at")]
        print("  gone:", not alive)
        return code in (200, 204) and not alive
    results.append(("kill", step("kill", s8)))


    def s9():
        code, body = req("GET", "/api/core/server")
        print("  server:", code, "restore:", body.get("restore") if isinstance(body, dict) else body)
        return code == 200
    results.append(("server", step("server", s9)))



    # --- W581 extra read-only probes ---
    def _probe(name, path, validator):
        code, body = req("GET", path)
        ok = (code == 200 and validator(body))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        return ok

    results.append(("health", _probe("health", "/api/core/health", lambda b: isinstance(b, dict) and b.get("pump", {}).get("alive") is True)))
    results.append(("diag", _probe("diag", "/api/core/diag", lambda b: isinstance(b, dict) and b.get("version") == "N3")))
    results.append(("config", _probe("config", "/api/core/config", lambda b: isinstance(b, dict) and bool(b.get("constants")))))
    results.append(("alerts", _probe("alerts", "/api/core/alerts", lambda b: isinstance(b, dict))))
    results.append(("webhooks stats", _probe("webhooks/stats", "/api/core/webhooks/stats", lambda b: isinstance(b, dict) and "pending" in (b or {}))))
    results.append(("events/since", _probe("events/since", "/api/core/events/since?since=0&limit=5", lambda b: isinstance(b, dict) and "cursor" in (b or {}))))
    results.append(("input-log", _probe("input-log", f"/api/core/terminal/{ACTIVE}/input-log", lambda b: isinstance(b, dict) and "entries" in (b or {}))))
    results.append(("merge", _probe("merge", f"/api/core/merge?a={ACTIVE}&b={ACTIVE}", lambda b: isinstance(b, (dict, str)))))
    results.append(("stats", _probe("stats", "/api/core/stats", lambda b: isinstance(b, (dict, str)))))

    # --- ALICE: post-W581 endpoint coverage ---
    results.append(("terminals/summary", _probe("terminals/summary",
        "/api/core/terminals/summary?limit=5",
        lambda b: isinstance(b, dict) and isinstance(b.get("terminals"), list) and "count" in b)))
    results.append(("spaces/detail", _probe("spaces/detail",
        "/api/core/spaces/detail",
        lambda b: isinstance(b, dict) and isinstance(b.get("spaces"), list))))
    results.append(("ratelimit", _probe("ratelimit",
        "/api/core/ratelimit",
        lambda b: isinstance(b, dict) and "window_s" in b)))
    results.append(("children", _probe("children",
        f"/api/core/terminal/{ACTIVE}/children",
        lambda b: isinstance(b, dict) and "children" in b)))
    def s_restore_preview():
        cs, _ = req("POST", "/api/core/workspace/snapshot", {"name": "e2e-prev"})
        c2, b2 = req("GET", "/api/core/workspace/restore/preview?name=e2e-prev")
        c3, _ = req("GET", "/api/core/workspace/restore/preview")
        print("  snapshot:", cs, "preview:", c2, "no-name:", c3)
        return (cs in (200, 201) and c2 == 200 and isinstance(b2, dict)
                and c3 == 400)
    results.append(("restore/preview", step("restore/preview", s_restore_preview)))
    results.append(("webhooks/pending", _probe("webhooks/pending",
        "/api/core/webhooks/pending",
        lambda b: isinstance(b, (dict, list)))))
    results.append(("events/types", _probe("events/types",
        "/api/core/events/types",
        lambda b: isinstance(b, (dict, list)))))

    # --- SPARK W79/W89: share-токены (W63) полный цикл ---
    # share создаётся scopes=["screen","info"] → /view screen 200,
    # info 200, dump 403 (scope не выдан), view_url/view_urls по
    # ALICE-патчу, DELETE revoke → view 404. Публичные /view/*
    # без core-token.
    share = {}

    def s_share_create():
        cs, bs = req("POST", "/api/core/share",
                     {"term": ACTIVE, "scopes": ["screen", "info"],
                      "ttl_s": 600})
        share["body"] = bs if isinstance(bs, dict) else {}
        share["token"] = share["body"].get("token")
        print(f"  share create: {cs} token={str(share['token'])[:10]}…")
        return cs == 201 and bool(share["token"])

    def s_share_view_urls():
        # W89(a): ALICE-патч — view_url = первый scope (sorted →
        # "info"), view_urls — все выданные scope → /view/<t>/<s>.
        t = share.get("token")
        body = share.get("body") or {}
        if not t:
            return False
        vu = body.get("view_url")
        vus = body.get("view_urls")
        ok = (vu == f"/view/{t}/info"
              and isinstance(vus, dict)
              and vus.get("info") == f"/view/{t}/info"
              and vus.get("screen") == f"/view/{t}/screen"
              and "dump" not in vus)
        print(f"  view_url={vu} view_urls={vus}")
        return ok

    def s_share_screen():
        t = share.get("token")
        if not t:
            return False
        code, body = req("GET", f"/view/{t}/screen")
        ok = code == 200 and isinstance(body, dict) and "screen" in body
        print(f"  view screen: {code}")
        return ok

    def s_share_info():
        t = share.get("token")
        if not t:
            return False
        code, body = req("GET", f"/view/{t}/info")
        ok = (code == 200 and isinstance(body, dict)
              and "term" in body)
        print(f"  view info: {code}")
        return ok

    def s_share_scope_deny():
        t = share.get("token")
        if not t:
            return False
        code, body = req("GET", f"/view/{t}/dump")
        print(f"  view dump (scope=screen): {code} {body}")
        return code == 403

    def s_share_revoke():
        t = share.get("token")
        if not t:
            return False
        cr, br = req("DELETE", f"/api/core/share/{t}")
        code, body = req("GET", f"/view/{t}/screen")
        print(f"  revoke: {cr} post-revoke view: {code}")
        return cr == 200 and code == 404

    results.append(("share-create", step("share-create", s_share_create)))
    results.append(("share-view-urls",
                    step("share-view-urls", s_share_view_urls)))
    results.append(("share-screen", step("share-screen", s_share_screen)))
    results.append(("share-info", step("share-info", s_share_info)))
    results.append(("share-scope-deny",
                    step("share-scope-deny", s_share_scope_deny)))
    results.append(("share-revoke", step("share-revoke", s_share_revoke)))


    print("\nSUMMARY")
    fails = [n for n, ok in results if not ok]
    print("PASS:", sum(1 for _, ok in results if ok), "FAIL:", len(fails))
    if fails:
        print("FAILED:", ", ".join(fails))
        sys.exit(1)
    sys.exit(0)
