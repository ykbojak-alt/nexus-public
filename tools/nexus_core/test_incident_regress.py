import asyncio
import sys
import types
import urllib.error

import pytest

from tools.nexus_core import api as core_api
from tools.nexus_core.supervisor_v1 import SupervisorV1
from tools.nexus_core.system_metrics import _collect_gpu


class DummySession:
    async def post(self, *a, **k):
        raise Exception("connection refused")


def test_drain_empty_no_crash():
    sup = SupervisorV1()
    async def main():
        return await core_api.drain_pending_webhooks(sup, DummySession())
    assert asyncio.run(main()) == 0


def test_failed_hook_deferred():
    sup = SupervisorV1()
    hook = {"url": "http://example.com", "payload": {}, "attempts": 0, "next_retry_at": 0.0}
    sup.pending_webhooks.append(hook)
    class FailSession:
        def post(self, *_a, **_k):
            raise ConnectionRefusedError()
    async def _post(session, h):
        return False
    core_api._post_webhook = _post
    async def main():
        await core_api.drain_pending_webhooks(sup, FailSession())
    asyncio.run(main())
    assert len(sup.pending_webhooks) >= 1


def test_collect_gpu_timeout_safe(monkeypatch):
    import subprocess
    def boom(*a, **k):
        raise subprocess.TimeoutExpired("x", 1)
    monkeypatch.setattr("subprocess.run", boom)
    assert _collect_gpu() is None