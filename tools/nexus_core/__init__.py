#!/usr/bin/env python3
"""
tools/nexus_core/__init__.py — nexus-core (N1+N2+N3): супервизор v1,
API-слой, события, doc, шаблоны, CLI, машины (реестр + exec), file-ops.

Экспорт главных сущностей. Тесты: pytest tools/nexus_core/ или
python -m tools.nexus_core.test_supervisor_v1.
"""

from tools.nexus_core.osc7501 import AgentStatus, Osc7501Parser, parse_agent_status
from tools.nexus_core.pty_backend import (
    PTYBackend,
    PTYHandle,
    SpawnSpec,
    default_shell,
    get_default_backend,
)
from tools.nexus_core.mock_pty import MockPTYBackend, MockPTYHandle
from tools.nexus_core.supervisor_v1 import SupervisorV1, Terminal, parse_address
from tools.nexus_core.events import EventChannel, SupervisorEventStream
from tools.nexus_core.doc_store import DocStore
from tools.nexus_core.templates import Template, TemplateStore, default_templates_dir
from tools.nexus_core.machine_registry import (
    Machine,
    MachineError,
    MachineRegistry,
    RemoteNotSupportedError,
    machine_exec,
)
from tools.nexus_core.file_ops import FileOps, FileOpsError, FileOpsNotFound

__all__ = [
    "AgentStatus",
    "DocStore",
    "EventChannel",
    "FileOps",
    "FileOpsError",
    "FileOpsNotFound",
    "Machine",
    "MachineError",
    "MachineRegistry",
    "MockPTYBackend",
    "MockPTYHandle",
    "Osc7501Parser",
    "PTYBackend",
    "PTYHandle",
    "RemoteNotSupportedError",
    "SpawnSpec",
    "SupervisorEventStream",
    "SupervisorV1",
    "Template",
    "TemplateStore",
    "Terminal",
    "default_shell",
    "default_templates_dir",
    "get_default_backend",
    "machine_exec",
    "parse_agent_status",
    "parse_address",
]
