"""Offline regression tests: uv run python -m unittest -v."""

import copy
import io
import json
import tempfile
import unittest
from contextlib import nullcontext, redirect_stdout
from html.parser import HTMLParser
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from parallel import APITimeoutError, Parallel

import render
import spec
import tearsheet


SAMPLE = json.loads((Path(__file__).parent / "sample/NVDA.json").read_text())
COMPANY = SAMPLE["company"]


class Links(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.urls = set()
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.urls.add(dict(attrs).get("href"))


class RenderingTests(unittest.TestCase):
    def render(self, out, data):
        (out / "data").mkdir(exist_ok=True)
        (out / "data/NVDA.json").write_text(json.dumps(data))
        html = Mock()
        with patch.dict("sys.modules", {"weasyprint": SimpleNamespace(HTML=html)}), redirect_stdout(io.StringIO()):
            result = render.render_all(out, [COMPANY])
        return result, html.call_args_list[0].kwargs["string"]

    def test_citations_link_to_original_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            (written, incomplete), html = self.render(Path(folder), SAMPLE)
        self.assertEqual(len(written), 1)
        self.assertEqual(incomplete, [])
        source = render.build(SAMPLE)["src"]
        for field in render.FIELD_LABELS:
            source.refs(field)
        self.assertTrue(set(source.urls).issubset(Links(html).urls))

    def test_failed_or_missing_sections_still_render_and_report_incomplete(self):
        for section in (*spec.SECTIONS, "thesis"):
            for missing in (False, True):
                with self.subTest(section=section, missing=missing), tempfile.TemporaryDirectory() as folder:
                    data = copy.deepcopy(SAMPLE)
                    if missing:
                        del data["runs"][section]
                    else:
                        data["runs"][section].update(content=None, basis=[], status="failed")
                    (written, incomplete), html = self.render(Path(folder), data)
                    self.assertEqual(len(written), 1)
                    self.assertEqual(incomplete, ["NVDA"])
                    self.assertIn(f"Runs that did not complete: {section}.", html)

    def test_no_research_still_renders_a_marked_partial_sheet(self):
        with tempfile.TemporaryDirectory() as folder:
            (written, incomplete), html = self.render(Path(folder), {"company": COMPANY, "runs": {}})
        self.assertEqual(len(written), 1)
        self.assertEqual(incomplete, ["NVDA"])
        self.assertIn("Financials could not be researched", html)

    def test_missing_or_malformed_file_is_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / "data").mkdir()
            for body in (None, "invalid json"):
                with self.subTest(body=body):
                    if body is not None:
                        (out / "data/NVDA.json").write_text(body)
                    with patch.dict("sys.modules", {"weasyprint": SimpleNamespace(HTML=Mock())}), redirect_stdout(io.StringIO()):
                        self.assertEqual(render.render_all(out, [COMPANY]), ([], ["NVDA"]))

    def test_cli_exits_unsuccessfully_for_incomplete_output(self):
        with tempfile.TemporaryDirectory() as folder:
            csv = Path(folder) / "companies.csv"
            csv.write_text("company_name,ticker\nNVIDIA,NVDA\n")
            args = ["tearsheet.py", str(csv), "--render-only", "--out", str(Path(folder) / "out")]
            with patch("sys.argv", args), patch.object(render, "ensure_pdf_support"), \
                    patch.object(render, "render_all", return_value=([Path("NVDA.pdf")], ["NVDA"])), \
                    redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as exc:
                tearsheet.main()
            self.assertIn("Incomplete output for NVDA", str(exc.exception))


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.out = Path(self.folder.name)
        self.job = tearsheet.Job(self.out)
        self.job.state["task_group_id"] = "test-group"
        self.job.save()
        self.batch = [("NVDA", section, tearsheet.section_run(COMPANY, section)) for section in ("profile", "financials")]

    def event(self, section, run_id):
        return SimpleNamespace(type="task_run.state", run=SimpleNamespace(
            metadata={"ticker": "NVDA", "section": section}, run_id=run_id))

    def recover(self, events):
        client = SimpleNamespace(task_group=SimpleNamespace(get_runs=lambda _: nullcontext(events)))
        job = tearsheet.Job(self.out)
        tearsheet.recover_pending(client, job)
        return tearsheet.Job(self.out)

    def test_lost_response_is_not_retried_and_runs_are_recovered(self):
        requests = []

        def accept_then_timeout(request):
            requests.append(request)
            self.assertEqual(tearsheet.Job(self.out).state["pending"], [["NVDA", "profile"], ["NVDA", "financials"]])
            raise httpx.ReadTimeout("Response lost after acceptance", request=request)

        with Parallel(api_key="offline-test", http_client=httpx.Client(transport=httpx.MockTransport(accept_then_timeout))) as client:
            with self.assertRaises(APITimeoutError):
                tearsheet.submit(client, self.job, self.batch)
        self.assertEqual(len(requests), 1)
        job = self.recover([self.event("profile", "run-1"), self.event("financials", "run-2")])
        self.assertEqual(job.runs("NVDA"), {"profile": "run-1", "financials": "run-2"})
        self.assertNotIn("pending", job.state)

    def test_crash_before_saving_receipt_is_recoverable(self):
        save = self.job.save

        def interrupt_receipt():
            if not self.job.state.get("pending"):
                raise RuntimeError("interrupted")
            save()

        with Parallel(api_key="offline-test", http_client=httpx.Client(transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"run_ids": ["run-1", "run-2"]})))) as client:
            with patch.object(self.job, "save", side_effect=interrupt_receipt):
                with self.assertRaises(RuntimeError):
                    tearsheet.submit(client, self.job, self.batch)
        job = self.recover([self.event("profile", "run-1"), self.event("financials", "run-2")])
        self.assertEqual(len(job.runs("NVDA")), 2)
        self.assertNotIn("pending", job.state)

    def test_unresolved_batches_block_new_submissions_and_preserve_state(self):
        self.job.state["pending"] = [["NVDA", "profile"], ["NVDA", "financials"]]
        self.job.save()
        cases = [[], [self.event("profile", "run-1")],
                 [self.event("profile", "run-1"), self.event("profile", "duplicate")],
                 [self.event("profile", "run-1"), self.event("financials", "run-2"), SimpleNamespace(type="error")]]
        for events in cases:
            with self.subTest(events=events):
                with self.assertRaises(SystemExit):
                    self.recover(events)
                self.assertEqual(tearsheet.Job(self.out).state, self.job.state)
        client = Mock()
        with self.assertRaises(SystemExit):
            tearsheet.submit(client, tearsheet.Job(self.out), self.batch)
        client.with_options.assert_not_called()

    def test_successful_submission_saves_receipt_and_clears_pending(self):
        with Parallel(api_key="offline-test", http_client=httpx.Client(transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"run_ids": ["run-1", "run-2"]})))) as client:
            tearsheet.submit(client, self.job, self.batch)
        job = tearsheet.Job(self.out)
        self.assertEqual(job.runs("NVDA"), {"profile": "run-1", "financials": "run-2"})
        self.assertNotIn("pending", job.state)


if __name__ == "__main__":
    unittest.main()
