"""Offline regressions: python -m unittest discover -s python-recipes -p 'test_large_scale_tasks_recipe.py'."""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from parallel import APITimeoutError, Parallel


spec = importlib.util.spec_from_file_location(
    "recipe", os.environ.get("RECIPE_UNDER_TEST", str(Path(__file__).with_name("Large_Scale_Tasks_Recipe.py")))
)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


class RecipeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.csv = self.root / "rows.csv"
        self.csv.write_text("row_id,name\na,Alpha\nb,Beta\nc,Gamma\n")
        self.task_spec = self.root / "spec.json"
        self.task_spec.write_text('{"output_schema":"Research this company"}')
        self.work = self.root / "job"
        self.output = self.root / "results.jsonl"
        self.groups = {}
        self.posts = []
        self.mode = "success"
        self.stream_error = False
        self.clients = []
        self.addCleanup(lambda: [c.close() for c in self.clients])
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.stack.enter_context(patch.object(recipe.time, "sleep"))
        self.stack.enter_context(patch("parallel.Parallel", side_effect=self.client))

    def client(self, **kwargs):
        client = Parallel(
            api_key="offline-test-key",
            http_client=httpx.Client(transport=httpx.MockTransport(self.request)),
            **kwargs,
        )
        self.clients.append(client)
        return client

    def request(self, request):
        path = request.url.path
        if request.method == "POST" and path.endswith("/groups"):
            gid = f"group-{len(self.groups)}"
            self.groups[gid] = []
            return httpx.Response(200, json={"taskgroup_id": gid, "status": self.status(gid)})
        gid = path.split("/")[-2] if path.endswith("/runs") else path.split("/")[-1]
        if request.method == "POST":
            self.assertEqual(request.url.params.get("refresh_status"), "false")
            self.posts.append(json.loads(request.content))
            inputs = self.posts[-1]["inputs"]
            if self.mode == "partial":
                inputs = inputs[:1]
            ids = []
            for value in inputs:
                rid = f"{gid}-run-{len(self.groups[gid])}"
                ids.append(rid)
                self.groups[gid].append({
                    "type": "task_run.state", "event_id": rid,
                    "run": {
                        "run_id": rid, "interaction_id": rid, "processor": "core",
                        "status": "completed", "is_active": False,
                        "metadata": value["metadata"], "taskgroup_id": gid,
                    },
                    "input": value,
                    "output": {"type": "json", "content": {"name": value["input"]["name"]}, "basis": []},
                })
            if self.mode == "timeout":
                raise httpx.ReadTimeout("response lost after accepting runs", request=request)
            return httpx.Response(200, json={"run_ids": ids, "status": self.status(gid)})
        if path.endswith("/runs"):
            events = list(self.groups[gid])
            if self.stream_error:
                events.append({"type": "error", "error": {"message": "stream interrupted"}})
            data = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
            return httpx.Response(200, text=data, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"taskgroup_id": gid, "status": self.status(gid)})

    def status(self, gid):
        return {"is_active": False, "num_task_runs": len(self.groups[gid]),
                "task_run_status_counts": {"completed": len(self.groups[gid])}}

    def submit(self, *extra):
        recipe.main([
            "submit", "--input", str(self.csv), "--task-spec", str(self.task_spec),
            "--processor", "core", "--work-dir", str(self.work), *extra,
        ])

    def export(self):
        recipe.main(["export", "--work-dir", str(self.work), "--output", str(self.output), "--include-input"])

    def report(self):
        return json.loads(Path(str(self.output) + ".validation.json").read_text())

    def test_lost_response_is_not_retried_and_resume_recovers_original_runs(self):
        self.mode = "timeout"
        with self.assertRaises(APITimeoutError):
            self.submit()
        self.assertEqual(len(self.posts), 1)
        self.mode = "success"
        self.submit()
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(len(recipe.Job(str(self.work)).submitted()), 3)
        self.export()
        self.assertTrue(self.report()["ok"])

    def test_crash_before_receipt_recovers_by_metadata_not_stream_order(self):
        with patch.object(recipe.Job, "add_runs", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        self.groups["group-0"].reverse()
        self.submit()
        self.assertEqual(len(self.posts), 1)
        self.export()
        rows = [json.loads(line) for line in self.output.read_text().splitlines()]
        self.assertEqual({r["row_id"]: r["output"]["name"] for r in rows}, {"a": "Alpha", "b": "Beta", "c": "Gamma"})

    def test_partial_receipt_and_crash_after_receipt_do_not_duplicate(self):
        original = recipe.Job.add_runs
        def interrupted(job, gid, pairs):
            original(job, gid, pairs[:1])
            raise KeyboardInterrupt
        with patch.object(recipe.Job, "add_runs", interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        with patch.object(recipe.Job, "finish_batch", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        self.submit()
        job = recipe.Job(str(self.work))
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(len(job.runs_path.read_text().splitlines()), 3)
        self.assertFalse(job.pending_path.exists())

    def test_partial_server_acceptance_stays_blocked_on_resume(self):
        self.mode = "partial"
        with self.assertRaises(SystemExit):
            self.submit()
        self.mode = "success"
        with self.assertRaisesRegex(SystemExit, "unresolved batch"):
            self.submit()
        self.assertEqual(len(self.posts), 1)
        self.assertTrue((self.work / "pending.json").exists())

    def test_checkpoint_precedes_post_and_missing_remote_rows_are_not_retried(self):
        original = recipe.Job.begin_batch
        def interrupted(job, gid, rows):
            original(job, gid, rows)
            raise KeyboardInterrupt
        with patch.object(recipe.Job, "begin_batch", interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        with self.assertRaisesRegex(SystemExit, "unresolved batch"):
            self.submit()
        self.assertEqual(self.posts, [])

    def test_duplicate_remote_rows_and_stream_errors_block_resume(self):
        with patch.object(recipe.Job, "add_runs", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        self.stream_error = True
        with self.assertRaisesRegex(SystemExit, "stream error"):
            self.submit()
        self.stream_error = False
        self.groups["group-0"].append(self.groups["group-0"][0])
        with self.assertRaisesRegex(SystemExit, "duplicate runs"):
            self.submit()
        self.assertEqual(len(self.posts), 1)

    def test_incomplete_input_export_fails_even_when_all_submitted_runs_finished(self):
        with patch.object(recipe.time, "sleep", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit("--runs-per-group", "2")
        with self.assertRaises(SystemExit) as exc:
            self.export()
        self.assertEqual(exc.exception.code, 2)
        self.assertEqual(self.report()["expected_rows"], 3)
        self.assertEqual(self.report()["missing_row_ids"], ["c"])
        self.submit("--runs-per-group", "2")
        self.export()
        self.assertTrue(self.report()["ok"])
        self.assertEqual([len(p["inputs"]) for p in self.posts], [2, 1])

    def test_dry_run_needs_no_client_and_zero_submission_export_fails(self):
        with patch("parallel.Parallel", side_effect=AssertionError("dry-run must not need credentials")):
            self.submit("--dry-run")
        with self.assertRaises(SystemExit) as exc:
            self.export()
        self.assertEqual(exc.exception.code, 2)
        self.assertEqual(self.report()["missing"], 3)
        self.assertEqual(self.posts, [])

    def test_export_rejects_legacy_job_without_original_manifest(self):
        self.work.mkdir()
        (self.work / "config.json").write_text("{}")
        with self.assertRaisesRegex(SystemExit, "original row manifest"):
            self.export()

    def test_export_stays_invalid_until_pending_batch_is_reconciled(self):
        with patch.object(recipe.Job, "finish_batch", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        with self.assertRaises(SystemExit):
            self.export()
        self.assertEqual(self.report()["written"], 3)
        self.assertTrue(self.report()["unresolved_batch"])
        self.submit()
        self.export()
        self.assertTrue(self.report()["ok"])

    def test_export_active_duplicate_unexpected_and_missing_runs(self):
        self.submit()
        originals = list(self.groups["group-0"])
        for case in ("active", "duplicate", "unexpected", "missing"):
            with self.subTest(case=case):
                self.groups["group-0"] = json.loads(json.dumps(originals))
                events = self.groups["group-0"]
                if case == "active":
                    events[0]["run"].update(status="running", is_active=True)
                elif case == "duplicate":
                    events.append(events[0])
                elif case == "unexpected":
                    events[0]["run"]["run_id"] = "unknown"
                else:
                    events.pop()
                with self.assertRaises(SystemExit) as exc:
                    self.export()
                self.assertEqual(exc.exception.code, 2)
                self.assertFalse(self.report()["ok"])

    def test_submit_status_export_roundtrip_and_rerun(self):
        self.submit()
        self.submit()
        recipe.main(["status", "--work-dir", str(self.work), "--wait"])
        self.export()
        self.export()
        self.assertEqual(len(self.posts), 1)
        self.assertTrue(self.report()["ok"])
        self.assertEqual(self.report()["written"], 3)

    def test_request_cap_and_group_sharding_preserve_every_row(self):
        self.csv.write_text("row_id,name\n" + "".join(f"{i},Company {i}\n" for i in range(1003)))
        self.submit("--runs-per-group", "1001")
        self.assertEqual([len(p["inputs"]) for p in self.posts], [1000, 1, 2])
        self.assertEqual([len(runs) for runs in self.groups.values()], [1001, 2])
        self.export()
        self.assertTrue(self.report()["ok"])
        self.assertEqual(self.report()["written"], 1003)

    def test_torn_receipt_stops_resume_without_another_post(self):
        with patch.object(recipe.Job, "add_runs", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        (self.work / "runs.jsonl").write_text('{"row_id":')
        with self.assertRaises(json.JSONDecodeError):
            self.submit()
        self.assertEqual(len(self.posts), 1)
        self.assertTrue((self.work / "pending.json").exists())

    def test_conflicting_receipt_stops_recovery(self):
        with patch.object(recipe.Job, "finish_batch", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.submit()
        recipe.Job(str(self.work)).add_runs("group-0", [("a", "different-run")])
        with self.assertRaisesRegex(SystemExit, "conflicting receipt"):
            self.submit()
        self.assertEqual(len(self.posts), 1)


if __name__ == "__main__":
    unittest.main()
