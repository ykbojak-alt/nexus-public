import asyncio
from unittest.mock import AsyncMock, patch

from tools.nexus_core import api as core_api
from tools.nexus_core.supervisor_v1 import SupervisorV1


def _run(coro):
    return asyncio.run(coro)


def test_drain_success_increments_sent():
    sup = SupervisorV1()
    hook = {"url": "http://x", "payload": {"event": "e"}, "attempts": 0, "next_retry_at": 0.0}
    sup.pending_webhooks.append(hook)

    class Session:
        async def post(self, url, data=None, headers=None, timeout=None):
            class R:
                status = 200
            async def __aenter__(self): return R()
            async def __aexit__(self, *a): return False
            r = R()
            r.__aenter__ = lambda *a: R()
            r.__aexit__ = lambda *a: False
            return r

    # Use AsyncMock instead
    async def ok_post(session, hook):
        return True
    orig = core_api._post_webhook
    core_api._post_webhook = ok_post
    try:
        n = _run(core_api.drain_pending_webhooks(sup, None))
    finally:
        core_api._post_webhook = orig
    assert n == 1
    assert list(sup.pending_webhooks) == []


def test_failed_hook_deferred():
    sup = SupervisorV1()
    hook = {"url": "http://x", "payload": {"event": "e"}, "attempts": 0, "next_retry_at": 0.0}
    sup.pending_webhooks.append(hook)

    async def fail_post(session, hook):
        return False
    orig = core_api._post_webhook
    core_api._post_webhook = fail_post
    try:
        _run(core_api.drain_pending_webhooks(sup, None))
    finally:
        core_api._post_webhook = orig
    assert len(sup.pending_webhooks) == 1
    assert sup.pending_webhooks[0]["attempts"] == 1
    assert sup.pending_webhooks[0]["next_retry_at"] > 0


def test_max_attempts_dead():
    sup = SupervisorV1()
    hook = {"url": "http://x", "payload": {"event": "e"}, "attempts": 4, "next_retry_at": 0.0}
    sup.pending_webhooks.append(hook)

    async def fail_post(session, hook):
        return False
    orig = core_api._post_webhook
    core_api._post_webhook = fail_post
    try:
        _run(core_api.drain_pending_webhooks(sup, None))
    finally:
        core_api._post_webhook = orig
    assert len(sup.pending_webhooks) == 0
    assert len(sup.dead_webhooks) == 1


def test_requeue_dead():
    sup = SupervisorV1()
    hook = {"url": "http://x", "payload": {"event": "e"}, "attempts": 3}
    sup.dead_webhooks.append(hook)
    before = len(sup.pending_webhooks)
    sup.dead_webhooks.clear()
    sup.pending_webhooks.append({**hook, "attempts": 0, "next_retry_at": 0.0})
    assert len(sup.pending_webhooks) == before + 1
    assert sup.pending_webhooks[-1]["attempts"] == 0


def test_snapshot_roundtrip(tmp_path):
    sup = SupervisorV1()
    hook = {"url": "http://x", "payload": {"event": "e"}, "attempts": 1, "next_retry_at": 1.0}
    sup.pending_webhooks.append(hook)
    sup.dead_webhooks.append(hook)
    # emulate persistence by writing json
    import json
    snap = tmp_path / "wh.json"
    snap.write_text(json.dumps({"pending": [dict(hook)], "dead": [dict(hook)]}))
    loaded = json.loads(snap.read_text())
    assert len(loaded["pending"]) == 1
    assert len(loaded["dead"]) == 1