#!/usr/bin/env python3
"""_core_testserver.py — real aiohttp core на ephemeral-порту в потоке.

Shared fixture для CLI↔API тестов (#515): nx стал thin client, поэтому
тесты поднимают НАСТОЯЩИЙ core (create_app) и гоняют cli_main против
него по HTTP — без моков транспорта.

Не собирается pytest'ом (имя с подчёркивания).
"""

from __future__ import annotations

import asyncio
import socket
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from aiohttp import web

from tools.nexus_core.api import create_app


class CoreTestServer:
    """aiohttp core в daemon-потоке со своим event loop."""

    def __init__(self, base, *, supervisor=None, pump: bool = False):
        self.base = Path(base)
        self._supervisor = supervisor
        self._pump = pump
        self.url = ""
        self.port = 0
        self.state = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._runner: Optional[web.AppRunner] = None

    def __enter__(self) -> "CoreTestServer":
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self._loop = asyncio.new_event_loop()
        ready = threading.Event()

        def _run() -> None:
            asyncio.set_event_loop(self._loop)
            app = create_app(
                base=self.base,
                supervisor=self._supervisor,
                host="127.0.0.1",
                port=self.port,
                pump=self._pump,
            )
            self.state = app["state"]

            async def _start() -> None:
                self._runner = web.AppRunner(app)
                await self._runner.setup()
                await web.TCPSite(
                    self._runner, "127.0.0.1", self.port).start()

            self._loop.run_until_complete(_start())
            ready.set()
            self._loop.run_forever()

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        if not ready.wait(10):
            raise RuntimeError("core test server did not start")
        self.url = f"http://127.0.0.1:{self.port}"
        return self

    def __exit__(self, *exc) -> bool:
        if self._loop is not None:
            async def _shutdown() -> None:
                if self._runner is not None:
                    await self._runner.cleanup()

            def _stop_when_done(_: object) -> None:
                self._loop.call_soon_threadsafe(self._loop.stop)

            self._loop.call_soon_threadsafe(
                lambda: asyncio.ensure_future(_shutdown())
                .add_done_callback(_stop_when_done))
            if self._thread is not None:
                self._thread.join(timeout=10)
        return False


@contextmanager
def core_test_server(base, *, supervisor=None, pump: bool = False):
    srv = CoreTestServer(base, supervisor=supervisor, pump=pump)
    srv.__enter__()
    try:
        yield srv
    finally:
        srv.__exit__(None, None, None)
