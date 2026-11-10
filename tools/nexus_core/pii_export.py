"""Deterministic, fail-closed PII processing for JSON export bundles.

This is a value-level export gate, not a classifier for database metadata.
It scans every nested JSON scalar, emits only category/path evidence, and
never copies matched source values into the audit envelope.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


SCHEMA_VERSION = "1.2"
POLICY_VERSION = "nexus-export-pii-2026-11-v2"
SCAN_SCOPE = "all_nested_scalar_leaves"
REDACTION_MARKER = "[REDACTED]"
_OWNER_TEXT_SUFFIXES = {".md", ".txt", ".json", ".jsonl", ".py", ".ps1", ".yaml", ".yml", ".toml", ".sh"}
ExportScope = Literal["trader_internal_sanitized", "owner_kit_internal_sanitized", "public_payload"]

_EMAIL = re.compile(
    r"(?i)(?<![A-Z0-9.!#$%&'*+/=?^_`{|}~-])"
    r"[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?"
    r"(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+(?![A-Z0-9_-])"
)
_PHONE = re.compile(
    r"(?<![\w-])(?:\+\d{1,3}[ .()-]*)?"
    r"(?:\(?\d{2,4}\)?[ .()-]+){1,3}\d{2,4}(?![\w])"
)
_IPV4 = re.compile(
    r"(?<![\w.])(?:25[0-5]|2[0-4]\d|1?\d?\d)"
    r"(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\w.])"
)
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(pattern, re.IGNORECASE | re.DOTALL)
    for pattern in (
        r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
        r"\b(?:sk-(?:proj|live|test|ant|svcacct)?-[A-Za-z0-9_-]{16,})\b",
        r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b",
        r"\bAKIA[0-9A-Z]{16}\b",
        r"\bxox[baprs]-[A-Za-z0-9-]{12,}\b",
        r"\b(?:sk|rk)_live_[A-Za-z0-9]{12,}\b",
        r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
        r"\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}",
        r"\b(?:nue_[a-f0-9]{16,}|nl-[A-Za-z0-9_-]{20,})\b",
        r"\b(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{32,}\b",
        r"\bAIza[0-9A-Za-z_-]{30,}\b",
    )
)

_SENSITIVE_CREDENTIAL_WORDS = {
    "password", "passwd", "secret", "credential", "authorization", "cookie",
    "mnemonic", "mnemonics", "jwt", "bearer", "seed",
}
_ACCOUNT_ID_WORDS = {"session", "device", "user", "customer", "account"}


@dataclass(frozen=True)
class _Finding:
    pointer: str
    category: str
    method: str
    action: str

    def as_dict(self) -> dict[str, str]:
        return {
            "field_pointer": self.pointer,
            "category": self.category,
            "method": self.method,
            "action": self.action,
        }


@dataclass(frozen=True)
class PiiExportBatch:
    """Manifest plus a separate record stream, matching the v1.2 contract."""

    manifest: dict[str, Any]
    records: list[dict[str, Any]]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _valid_timestamp(value: str | None) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _pointer(path: tuple[str | int, ...]) -> str:
    return "".join(
        "/" + str(part).replace("~", "~0").replace("/", "~1")
        for part in path
    )


def _key_category(key: str) -> str | None:
    words = set(re.findall(r"[a-z0-9]+", key.lower()))
    if words & _SENSITIVE_CREDENTIAL_WORDS:
        return "credential"
    if words & {"key"} and words & {"api", "access", "secret", "private", "refresh", "client", "signing"}:
        return "credential"
    if words & {"token"}:
        return "credential"
    if "phrase" in words and words & {"seed", "recovery", "mnemonic"}:
        return "credential"
    if "auth" in words and words & {"header", "token", "key"}:
        return "credential"
    if words & _ACCOUNT_ID_WORDS and words & {"id", "number", "ref", "identifier"}:
        return "account_identifier"
    if "wallet" in words:
        return "wallet_address"
    if words & {"email", "e-mail"}:
        return "email"
    if words & {"phone", "telephone", "mobile", "cell", "cellular"}:
        return "phone"
    if "address" in words and (words & {"postal", "street", "home", "shipping", "billing"} or len(words) == 1):
        return "postal_address"
    if "ip" in words and "address" in words:
        return "ip_address"
    return None


def _text_matches(value: str) -> list[tuple[int, int, str]]:
    matches: list[tuple[int, int, str]] = []
    for pattern in _SECRET_PATTERNS:
        matches.extend((m.start(), m.end(), "credential") for m in pattern.finditer(value))
    matches.extend((m.start(), m.end(), "email") for m in _EMAIL.finditer(value))
    for match in _PHONE.finditer(value):
        candidate = match.group(0)
        # Do not classify ISO calendar dates as telephone numbers.
        if re.search(r"\d{4}-\d{2}-\d{2}", candidate):
            continue
        digits = sum(ch.isdigit() for ch in candidate)
        if 7 <= digits <= 15:
            matches.append((match.start(), match.end(), "phone"))
    matches.extend((m.start(), m.end(), "ip_address") for m in _IPV4.finditer(value))
    return matches


def _redact_text(value: str, path: tuple[str | int, ...], findings: list[_Finding]) -> str:
    matches = _text_matches(value)
    if not matches:
        return value

    # Merge overlapping matches so one replacement cannot re-expose the tail
    # of a longer credential pattern. The event categories remain exhaustive.
    ordered = sorted(matches, key=lambda item: (item[0], -(item[1] - item[0])))
    merged: list[tuple[int, int, set[str]]] = []
    for start, end, category in ordered:
        if merged and start < merged[-1][1]:
            old_start, old_end, categories = merged[-1]
            merged[-1] = (old_start, max(old_end, end), categories | {category})
        else:
            merged.append((start, end, {category}))

    pointer = _pointer(path)
    for _, _, categories in merged:
        for category in sorted(categories):
            findings.append(_Finding(pointer, category, "mask", "replace"))
    output = value
    for start, end, _ in reversed(merged):
        output = output[:start] + REDACTION_MARKER + output[end:]
    return output


def _sanitize_value(value: Any, path: tuple[str | int, ...], findings: list[_Finding]) -> Any:
    if isinstance(value, str):
        return _redact_text(value, path, findings)
    if isinstance(value, list):
        return [_sanitize_value(item, path + (index,), findings) for index, item in enumerate(value)]
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("JSON object keys must be strings")
            key_category = _key_category(key)
            key_findings = _text_matches(key)
            if key_category or key_findings:
                # Dynamic keys can themselves contain PII; point at the
                # containing object so the audit pointer does not repeat it.
                target = path if key_findings else path + (key,)
                categories = {key_category} if key_category else {row[2] for row in key_findings}
                for category in categories:
                    findings.append(_Finding(_pointer(target), category, "remove", "remove"))
                continue
            sanitized[key] = _sanitize_value(item, path + (key,), findings)
        return sanitized
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise TypeError("export data must contain only finite JSON scalar values")


def _normalized_findings(findings: list[_Finding]) -> list[dict[str, str]]:
    unique = {(item.pointer, item.category, item.method, item.action): item for item in findings}
    return [item.as_dict() for _, item in sorted(unique.items())]


def _record(
    source: Any,
    *,
    scope: ExportScope,
    record_id: str,
    reviewer_role: str | None,
    reviewed_at: str | None,
    processed_at: str | None,
    public_approved: bool,
) -> dict[str, Any]:
    if scope not in ("trader_internal_sanitized", "owner_kit_internal_sanitized", "public_payload"):
        raise ValueError("unsupported export scope")
    if not re.fullmatch(r"export-local-[0-9]{6,}", record_id):
        raise ValueError("record_id must be an export-local sequence id")
    if not isinstance(source, dict):
        raise TypeError("export record must be a JSON object")

    # Round-trip makes a detached JSON snapshot and rejects cycles/NaN before
    # any output is committed. No partial result is returned on failure.
    snapshot = json.loads(json.dumps(source, ensure_ascii=False, allow_nan=False))
    findings: list[_Finding] = []
    data = _sanitize_value(snapshot, (), findings)
    events = _normalized_findings(findings)
    categories = sorted({event["category"] for event in events})
    fields = sorted({event["field_pointer"] for event in events})
    methods = sorted({event["method"] for event in events})
    redacted = bool(events)
    processed_time = _valid_timestamp(processed_at) or _utc_now()

    reviewer = (reviewer_role or "").strip()
    review_time = _valid_timestamp(reviewed_at)
    approved = bool(public_approved and reviewer and review_time) if scope == "public_payload" else False
    if scope == "public_payload" and not approved:
        status = "manual_review_required"
        decision = "withheld"
        review = {"status": "pending", "reviewer_role": None, "reviewed_at": None}
    else:
        status = "processed_redactions" if redacted else "processed_no_pii"
        decision = "allow"
        review = (
            {"status": "approved", "reviewer_role": reviewer, "reviewed_at": review_time}
            if scope == "public_payload"
            else {"status": "not_required", "reviewer_role": None, "reviewed_at": None}
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "record_id": record_id,
        "export_scope": scope,
        "pii_processed": True,
        "pii_scan_scope": SCAN_SCOPE,
        "redacted": redacted,
        "pii_status": status,
        "pii_policy_version": POLICY_VERSION,
        "pii_processed_at": processed_time,
        "pii_categories": categories,
        "redacted_fields": fields,
        "redaction_methods": methods,
        "redaction_events": events,
        "pii_review": review,
        "export_decision": decision,
        "data": data,
    }


def process_record(
    source: dict[str, Any],
    *,
    scope: ExportScope,
    record_id: str = "export-local-000001",
    reviewer_role: str | None = None,
    reviewed_at: str | None = None,
    processed_at: str | None = None,
    public_approved: bool = False,
) -> dict[str, Any]:
    """Return one sanitized record envelope; public data needs explicit review."""

    return _record(
        source,
        scope=scope,
        record_id=record_id,
        reviewer_role=reviewer_role,
        reviewed_at=reviewed_at,
        processed_at=processed_at,
        public_approved=public_approved,
    )


def process_batch(
    sources: list[dict[str, Any]],
    *,
    scope: ExportScope,
    reviewer_role: str | None = None,
    reviewed_at: str | None = None,
    processed_at: str | None = None,
    public_approved: bool = False,
) -> PiiExportBatch:
    """Process JSON records atomically and return a sanitized batch envelope.

    Public rows lacking explicit reviewer metadata are counted as withheld and
    omitted. Any malformed row fails the whole batch without partial output.
    """

    if not isinstance(sources, list):
        raise TypeError("sources must be a list of JSON objects")
    if scope not in ("trader_internal_sanitized", "owner_kit_internal_sanitized", "public_payload"):
        raise ValueError("unsupported export scope")
    created = _valid_timestamp(processed_at) or _utc_now()
    records: list[dict[str, Any]] = []
    try:
        candidates = [
            _record(
                source,
                scope=scope,
                record_id=f"export-local-{index:06d}",
                reviewer_role=reviewer_role,
                reviewed_at=reviewed_at,
                processed_at=created,
                public_approved=public_approved,
            )
            for index, source in enumerate(sources, start=1)
        ]
    except Exception:
        return PiiExportBatch(
            manifest={
                "schema_version": SCHEMA_VERSION,
                "export_id": "export-" + uuid.uuid4().hex,
                "export_scope": scope,
                "created_at": created,
                "pii_processed": False,
                "redacted": False,
                "pii_status": "failed",
                "pii_policy_version": POLICY_VERSION,
                "record_count": 0,
                "withheld_record_count": len(sources),
                "export_decision": "withheld",
            },
            records=[],
        )

    for candidate in candidates:
        if candidate["export_decision"] == "allow":
            records.append(candidate)
    withheld = len(candidates) - len(records)

    if not records:
        batch_status = "empty"
        decision = "withheld"
        batch_pii_processed = False
        any_redacted = False
    else:
        statuses = {record["pii_status"] for record in records}
        if len(statuses) > 1:
            batch_status = "mixed"
        else:
            batch_status = next(iter(statuses))
        decision = "allow"
        batch_pii_processed = True
        any_redacted = any(record["redacted"] for record in records)

    return PiiExportBatch(
        manifest={
            "schema_version": SCHEMA_VERSION,
            "export_id": "export-" + uuid.uuid4().hex,
            "export_scope": scope,
            "created_at": created,
            "pii_processed": batch_pii_processed,
            "redacted": any_redacted,
            "pii_status": batch_status,
            "pii_policy_version": POLICY_VERSION,
            "record_count": len(records),
            "withheld_record_count": withheld,
            "export_decision": decision,
        },
        records=records,
    )


def _load_source(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        if not all(isinstance(row, dict) for row in rows):
            raise ValueError("JSONL input must contain one object per line")
        return rows
    if isinstance(value, list):
        if not all(isinstance(row, dict) for row in value):
            raise ValueError("JSON array input must contain objects")
        return value
    if not isinstance(value, dict):
        raise ValueError("JSON input must be an object or an array of objects")
    # Treat a dataset document (e.g. HackWatch ranking[]) as one record so
    # every nested project/analysis scalar is covered by the same scan.
    return [value]


def _load_owner_kit(root: Path) -> list[dict[str, Any]]:
    root = root.resolve(strict=True)
    allowlist = root / "03-nexus" / "ALLOWLIST-RECOVERY.md"
    paths = re.findall(r"(?m)^\s*-\s+`([^`]+)`\s*$", allowlist.read_text(encoding="utf-8"))
    if not paths or len(paths) > 128 or len(set(paths)) != len(paths):
        raise ValueError("owner-kit allowlist must contain 1..128 unique path entries")
    hashes = {
        match.group(1): match.group(2).lower()
        for line in (root / "MANIFEST.md").read_text(encoding="utf-8").splitlines()
        if (match := re.match(r"^\|\s*`([^`]+)`\s*\|.*?`([a-f0-9]{64})`\s*\|", line, re.I))
    }
    files = []
    total_bytes = 0
    for value in paths:
        relative_input = Path(value)
        if relative_input.is_absolute() or ".." in relative_input.parts:
            raise ValueError("owner-kit allowlist path must stay within the kit")
        path = (root / relative_input).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("owner-kit allowlist path must stay within the kit")
        relative = path.relative_to(root)
        if not relative.parts or relative.parts[0] != "03-nexus" or path.suffix.lower() not in _OWNER_TEXT_SUFFIXES:
            raise ValueError("owner-kit allowlist contains an unsafe or non-text path")
        size = path.stat().st_size
        if size > 1_048_576 or total_bytes + size > 10_485_760:
            raise ValueError("owner-kit allowlist exceeds the text size limit")
        content = path.read_bytes()
        if hashes.get(relative.as_posix()) != hashlib.sha256(content).hexdigest():
            raise ValueError("owner-kit allowlist file does not match the kit manifest")
        total_bytes += len(content)
        files.append({"path": relative.as_posix(), "content": content.decode("utf-8")})
    return [{"files": files}]


def _atomic_write(path: Path, text: str) -> None:
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _failed_manifest(scope: ExportScope) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "export_id": "export-" + uuid.uuid4().hex,
        "export_scope": scope,
        "created_at": _utc_now(),
        "pii_processed": False,
        "redacted": False,
        "pii_status": "failed",
        "pii_policy_version": POLICY_VERSION,
        "record_count": 0,
        "withheld_record_count": 0,
        "export_decision": "withheld",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan and redact a JSON export candidate")
    parser.add_argument("--scope", required=True, choices=("trader_internal_sanitized", "owner_kit_internal_sanitized", "public_payload"))
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument("--input", type=Path, help="JSON object/array or JSONL records")
    sources.add_argument("--owner-kit-root", type=Path, help="internal-only owner-kit source; reads explicit recovery-allowlist paths")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reviewer-role", help="explicit review approval for public_payload")
    parser.add_argument("--reviewed-at", help="review time in timezone-aware ISO 8601")
    parser.add_argument("--approve-public", action="store_true", help="explicitly release reviewed public records")
    args = parser.parse_args(argv)
    manifest_path = Path(str(args.output) + ".manifest.json")
    input_path = args.input if args.input else args.owner_kit_root / "03-nexus" / "ALLOWLIST-RECOVERY.md"
    may_write = False

    try:
        if input_path.resolve() in (args.output.resolve(), manifest_path.resolve()):
            raise ValueError("input and output paths must differ")
        if args.output.exists() or manifest_path.exists():
            raise FileExistsError("refusing to overwrite an existing export candidate")
        owner_root = args.owner_kit_root.resolve(strict=True) if args.owner_kit_root else None
        if owner_root and args.output.resolve().is_relative_to(owner_root):
            raise ValueError("owner-kit export output must be outside the source kit")
        may_write = True
        args.output.parent.mkdir(parents=True, exist_ok=True)
        if args.owner_kit_root:
            if args.scope != "owner_kit_internal_sanitized" or args.approve_public or args.reviewer_role or args.reviewed_at:
                raise ValueError("owner-kit mode is internal-only and cannot approve public export")
            source = _load_owner_kit(owner_root)
        else:
            source = _load_source(args.input)
        result = process_batch(
            source,
            scope=args.scope,
            reviewer_role=args.reviewer_role,
            reviewed_at=args.reviewed_at,
            public_approved=args.approve_public,
        )
        stream = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in result.records)
        # Publish a withheld manifest first. If writing the stream or final
        # manifest fails, consumers never see an allow decision for partial data.
        _atomic_write(manifest_path, json.dumps(_failed_manifest(args.scope), ensure_ascii=False, indent=2) + "\n")
        _atomic_write(args.output, stream)
        _atomic_write(manifest_path, json.dumps(result.manifest, ensure_ascii=False, indent=2) + "\n")
    except Exception as error:
        if may_write:
            try:
                if not manifest_path.exists():
                    _atomic_write(manifest_path, json.dumps(_failed_manifest(args.scope), ensure_ascii=False, indent=2) + "\n")
                if not args.output.exists():
                    _atomic_write(args.output, "")
            except OSError:
                pass
        # Only the exception class is emitted; parser or filesystem messages
        # may contain source paths or values and are intentionally suppressed.
        print(f"PII export failed: {type(error).__name__}", file=sys.stderr)
        return 2

    print(
        f"PII export {result.manifest['export_decision']}: scope={args.scope} "
        f"included={result.manifest['record_count']} withheld={result.manifest['withheld_record_count']} "
        f"status={result.manifest['pii_status']}"
    )
    return 0 if result.manifest["export_decision"] == "allow" else 3


if __name__ == "__main__":  # pragma: no cover - exercised through CLI manually
    raise SystemExit(main())
