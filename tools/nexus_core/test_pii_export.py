import hashlib
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

from tools.nexus_core.pii_export import main, process_batch, process_record


class PiiExportTests(unittest.TestCase):
    def test_public_batch_redacts_nested_email_phone_and_credentials(self):
        source = {
            "contacts": [
                {
                    "email": "alice@example.test",
                    "phone": "+1 (202) 555-0100",
                    "note": "Reply with Bearer abcdefghijklmnopqrstuv",
                }
            ],
            "provider": {"api_key": "synthetic-provider-key-123456"},
        }

        result = process_batch(
            [source],
            scope="public_payload",
            reviewer_role="owner",
            reviewed_at="2026-11-06T12:00:00Z",
            processed_at="2026-11-06T12:00:00Z",
            public_approved=True,
        )

        self.assertEqual(result.manifest["export_decision"], "allow")
        self.assertEqual(result.manifest["record_count"], 1)
        record = result.records[0]
        self.assertTrue(record["pii_processed"])
        self.assertTrue(record["redacted"])
        self.assertEqual(record["pii_status"], "processed_redactions")
        self.assertEqual(record["pii_review"]["status"], "approved")
        self.assertNotIn("api_key", record["data"]["provider"])
        serialized = repr(record["data"])
        for sensitive in (
            "alice@example.test",
            "+1 (202) 555-0100",
            "abcdefghijklmnopqrstuv",
            "synthetic-provider-key-123456",
        ):
            self.assertNotIn(sensitive, serialized)
        pointers = {event["field_pointer"] for event in record["redaction_events"]}
        self.assertIn("/contacts/0/email", pointers)
        self.assertIn("/contacts/0/phone", pointers)
        self.assertIn("/contacts/0/note", pointers)
        self.assertIn("/provider/api_key", pointers)

    def test_public_without_explicit_review_is_withheld(self):
        result = process_batch(
            [{"project": "public demo", "url": "https://example.test"}],
            scope="public_payload",
            processed_at="2026-11-06T12:00:00Z",
        )

        self.assertEqual(result.manifest["export_decision"], "withheld")
        self.assertEqual(result.manifest["record_count"], 0)
        self.assertEqual(result.manifest["withheld_record_count"], 1)
        self.assertEqual(result.manifest["pii_status"], "empty")
        self.assertEqual(result.records, [])

    def test_trader_contour_is_recursively_sanitized_without_public_review(self):
        result = process_batch(
            [{"account_id": "account-123", "fills": [{"memo": "mail alice@example.test"}]}],
            scope="trader_internal_sanitized",
            processed_at="2026-11-06T12:00:00Z",
        )

        self.assertEqual(result.manifest["export_decision"], "allow")
        self.assertEqual(result.manifest["record_count"], 1)
        self.assertEqual(result.records[0]["export_scope"], "trader_internal_sanitized")
        self.assertNotIn("account-123", repr(result.records[0]["data"]))
        self.assertNotIn("alice@example.test", repr(result.records[0]["data"]))

    def test_dates_and_hyphenated_report_ids_are_not_misclassified_as_phone(self):
        record = process_record(
            {"note": "Build evidence (2026-11-06); see CODEX-report-414-1106.md."},
            scope="trader_internal_sanitized",
            processed_at="2026-11-06T12:00:00Z",
        )
        self.assertEqual(record["redaction_events"], [])
        self.assertFalse(record["redacted"])

    def test_processed_record_uses_export_local_id_and_pointer_escaping(self):
        record = process_record(
            {"a/b~c": {"comment": "contact alice@example.test"}},
            scope="public_payload",
            record_id="export-local-000007",
            reviewer_role="owner",
            reviewed_at="2026-11-06T12:00:00Z",
            processed_at="2026-11-06T12:00:00Z",
            public_approved=True,
        )

        self.assertEqual(record["record_id"], "export-local-000007")
        self.assertIn("/a~1b~0c/comment", record["redacted_fields"])

    def test_hackwatch_dataset_shape_is_processed_as_one_nested_record(self):
        dataset = {
            "ranking": [
                {
                    "project": {"name": "Demo", "contact": "owner@example.test"},
                    "analysis": {"rationale": "Use key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"},
                }
            ]
        }
        result = process_batch(
            [dataset],
            scope="public_payload",
            reviewer_role="owner",
            reviewed_at="2026-11-06T12:00:00Z",
            processed_at="2026-11-06T12:00:00Z",
            public_approved=True,
        )
        record = result.records[0]
        rendered = repr(record["data"])
        self.assertNotIn("owner@example.test", rendered)
        self.assertNotIn("sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", rendered)
        self.assertTrue(record["pii_processed"])

    def test_owner_kit_candidate_shape_scans_document_payload_recursively(self):
        candidate = {
            "files": [
                {
                    "path": "README.md",
                    "content": "Contact the synthetic owner at owner@example.test.",
                }
            ]
        }
        record = process_record(
            candidate,
            scope="public_payload",
            reviewer_role="owner",
            reviewed_at="2026-11-06T12:00:00Z",
            processed_at="2026-11-06T12:00:00Z",
            public_approved=True,
        )
        self.assertTrue(record["pii_processed"])
        self.assertNotIn("owner@example.test", repr(record["data"]))
        self.assertIn("/files/0/content", record["redacted_fields"])

    def test_public_reviewer_metadata_without_approval_flag_still_withholds(self):
        record = process_record(
            {"project": "demo"},
            scope="public_payload",
            reviewer_role="owner",
            reviewed_at="2026-11-06T12:00:00Z",
            processed_at="2026-11-06T12:00:00Z",
        )
        self.assertEqual(record["export_decision"], "withheld")
        self.assertEqual(record["pii_status"], "manual_review_required")

    def test_non_json_input_fails_closed_without_partial_records(self):
        result = process_batch(
            [{"ok": "safe"}, {"not_finite": float("nan")}],
            scope="trader_internal_sanitized",
            processed_at="2026-11-06T12:00:00Z",
        )
        self.assertEqual(result.manifest["export_decision"], "withheld")
        self.assertEqual(result.manifest["pii_status"], "failed")
        self.assertEqual(result.manifest["record_count"], 0)
        self.assertEqual(result.manifest["withheld_record_count"], 2)
        self.assertEqual(result.records, [])

    def test_batch_status_mixed_when_some_rows_need_redaction(self):
        result = process_batch(
            [{"project": "clean"}, {"contact": "mail owner@example.test"}],
            scope="public_payload",
            reviewer_role="owner",
            reviewed_at="2026-11-06T12:00:00Z",
            processed_at="2026-11-06T12:00:00Z",
            public_approved=True,
        )
        self.assertEqual(result.manifest["pii_status"], "mixed")
        self.assertEqual(result.manifest["record_count"], 2)
        self.assertTrue(result.manifest["pii_processed"])
        self.assertTrue(result.manifest["redacted"])

    def test_cli_writes_jsonl_records_and_separate_manifest(self):
        with tempfile.TemporaryDirectory(prefix="pii-export-test-") as tmp:
            source = Path(tmp) / "input.json"
            output = Path(tmp) / "safe.jsonl"
            source.write_text(
                json.dumps({"contact": "owner@example.test"}), encoding="utf-8"
            )
            stdout = StringIO()
            with redirect_stdout(stdout):
                code = main([
                    "--scope", "public_payload",
                    "--input", str(source),
                    "--output", str(output),
                    "--reviewer-role", "owner",
                    "--reviewed-at", "2026-11-06T12:00:00Z",
                    "--approve-public",
                ])
            manifest = Path(str(output) + ".manifest.json")
            row = json.loads(output.read_text(encoding="utf-8"))
            envelope = json.loads(manifest.read_text(encoding="utf-8"))
            self.assertEqual(code, 0)
            self.assertEqual(envelope["record_count"], 1)
            self.assertEqual(row["pii_status"], "processed_redactions")
            self.assertNotIn("owner@example.test", output.read_text(encoding="utf-8"))
            self.assertIn("included=1", stdout.getvalue())

    def test_cli_parse_failure_writes_empty_stream_and_failed_manifest(self):
        with tempfile.TemporaryDirectory(prefix="pii-export-fail-closed-") as tmp:
            source = Path(tmp) / "broken.json"
            output = Path(tmp) / "safe.jsonl"
            source.write_text("not-json", encoding="utf-8")
            stderr = StringIO()
            with redirect_stderr(stderr):
                code = main([
                    "--scope", "public_payload",
                    "--input", str(source),
                    "--output", str(output),
                ])
            manifest = json.loads(Path(str(output) + ".manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(code, 2)
            self.assertEqual(output.read_text(encoding="utf-8"), "")
            self.assertEqual(manifest["pii_status"], "failed")
            self.assertEqual(manifest["export_decision"], "withheld")
            self.assertNotIn("not-json", stderr.getvalue())

    def test_owner_kit_export_uses_listed_files_and_redacts_them(self):
        with tempfile.TemporaryDirectory(prefix="pii-owner-kit-") as tmp:
            root = Path(tmp) / "kit"
            folder = root / "03-nexus"
            folder.mkdir(parents=True)
            (folder / "approved.md").write_text("owner@example.test", encoding="utf-8")
            (folder / "private.md").write_text("unlisted@example.test", encoding="utf-8")
            (folder / "ALLOWLIST-RECOVERY.md").write_text(
                "- `03-nexus/approved.md`\n", encoding="utf-8"
            )
            digest = hashlib.sha256(b"owner@example.test").hexdigest()
            (root / "MANIFEST.md").write_text(
                f"| `03-nexus/approved.md` | approved text | `{digest}` | source | checked |\n",
                encoding="utf-8",
            )
            output = Path(tmp) / "safe.jsonl"
            code = main(["--scope", "owner_kit_internal_sanitized", "--owner-kit-root", str(root), "--output", str(output)])
            row = json.loads(output.read_text(encoding="utf-8"))
            text = json.dumps(row, ensure_ascii=False)
            manifest = json.loads(Path(str(output) + ".manifest.json").read_text(encoding="utf-8"))
            self.assertEqual((code, manifest["export_decision"], manifest["record_count"]), (0, "allow", 1))
            self.assertEqual((row["schema_version"], row["export_scope"]), ("1.2", "owner_kit_internal_sanitized"))
            self.assertIn("[REDACTED]", text)
            self.assertNotIn("owner@example.test", text)
            self.assertNotIn("private.md", text)

    def test_owner_kit_empty_or_unsafe_allowlist_and_public_scope_fail_closed(self):
        cases = (
            ("", "owner_kit_internal_sanitized", "03-nexus/safe.md", "safe"),
            ("- `../outside.md`\n", "owner_kit_internal_sanitized", "03-nexus/safe.md", "safe"),
            ("- `02-hackwatch/safe.md`\n", "owner_kit_internal_sanitized", "02-hackwatch/safe.md", "safe"),
            ("- `03-nexus/safe.md`\n", "owner_kit_internal_sanitized", "03-nexus/safe.md", "0" * 64),
            ("- `03-nexus/safe.md`\n", "public_payload", "03-nexus/safe.md", "safe"),
        )
        for entries, scope, manifest_path, manifest_digest in cases:
            with self.subTest(entries=entries, scope=scope), tempfile.TemporaryDirectory(prefix="pii-owner-kit-closed-") as tmp:
                root = Path(tmp) / "kit"
                folder = root / "03-nexus"
                folder.mkdir(parents=True)
                (folder / "safe.md").write_text("safe", encoding="utf-8")
                (Path(tmp) / "outside.md").write_text("outside", encoding="utf-8")
                (root / "02-hackwatch").mkdir(parents=True)
                (root / "02-hackwatch" / "safe.md").write_text("safe", encoding="utf-8")
                (folder / "ALLOWLIST-RECOVERY.md").write_text(entries, encoding="utf-8")
                digest = manifest_digest if manifest_digest == "0" * 64 else hashlib.sha256(b"safe").hexdigest()
                (root / "MANIFEST.md").write_text(f"| `{manifest_path}` | test | `{digest}` | source | checked |\n", encoding="utf-8")
                output = Path(tmp) / "safe.jsonl"
                stderr = StringIO()
                with redirect_stderr(stderr):
                    code = main(["--scope", scope, "--owner-kit-root", str(root), "--output", str(output)])
                manifest = json.loads(Path(str(output) + ".manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(code, 2)
                self.assertEqual(output.read_text(encoding="utf-8"), "")
                self.assertEqual(manifest["export_decision"], "withheld")
                self.assertNotIn("outside.md", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
