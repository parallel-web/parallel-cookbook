"""Offline tests for the parser, the checks and the template: uv run python -m unittest -v."""

import csv
import json
import sys
import unittest
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from jinja2 import Environment, FileSystemLoader
from parallel.types.extract_result import ExtractResult

import claimchart as cc

ROOT = Path(__file__).parent

# Google Patents serves two page layouts; Extract returns both as markdown like this.
PAGE_A = """## US5960411A
Current Assignee
    Amazon.com Inc

1997-09-12

Application filed by Amazon.com Inc

1999-09-28

Application granted

2017-09-12

Anticipated expiration

Status

Expired - Lifetime

### Claims (26)

We claim:

1\\. A method of placing an order for an item comprising:

under control of a client system,

displaying information identifying the item; and

in response to only a single action being performed, sending a request to order the item to a server system;

2\\. The method of claim 1 wherein the display is a web page.

Priority Applications (23)

Application Priority date Filing date Title

US08/928,951 1997-09-12 1997-09-12 Method and system for placing a purchase order
"""

PAGE_B = """Current Assignee (The listed assignees may be inaccurate.)
    Apple Inc
    2009-01-20 Application granted granted Critical
    Status Active legal-status Critical Current
    2027-09-05 Anticipated expiration legal-status Critical

## Claims ( 20 )

1\\. A computing device, comprising:

a touch screen display;

one or more programs including:

instructions for detecting one or more finger contacts;

2\\. The device of claim 1.

Priority Applications (3)

|Application Number |Priority Date |Filing Date |Title |
|US12/101,832 US7479949B2 ( en ) |2006-09-06 |2008-04-11 |Touch screen device |
"""


def record(**kw):
    return {"elements": [{"id": "1[pre]", "text": "A device comprising:"}, {"id": "1[a]", "text": "a touch screen display;"}],
            "priority_date": "2006-09-06", "grant_date": "2009-01-20", "expiration": "2027-09-05"} | kw


class ParsePatent(unittest.TestCase):
    def test_layout_a(self):
        p = cc.parse_patent(PAGE_A)
        self.assertEqual(p["assignee"], "Amazon.com Inc")
        self.assertEqual((p["priority_date"], p["grant_date"], p["expiration"]), ("1997-09-12", "1999-09-28", "2017-09-12"))
        self.assertEqual(p["status"], "Expired - Lifetime")
        self.assertEqual(p["claim_count"], 26)
        self.assertEqual([e["id"] for e in p["elements"]], ["1[pre]", "1[a]", "1[b]"])
        # a clause ending in a comma joins the next line, so the element reads as one limitation
        self.assertEqual(p["elements"][1]["text"], "under control of a client system, displaying information identifying the item; and")

    def test_single_claim_ends_before_bibliography_or_at_eof(self):
        prefix = PAGE_B.split("## Claims")[0]
        claim = "An apparatus comprising a sensor."
        for trailer in ("", "\n\nPriority Applications (1)\nmetadata", "\n## References\nmetadata",
                        "\n\nUS12/345,678 2006-09-06 2008-04-11 Title\n## Priority Applications (1)"):
            with self.subTest(trailer=trailer):
                page = prefix + "## Claims (1)\n\n  1. " + claim + trailer
                record = cc.parse_patent(page)
                self.assertEqual(record["elements"], [{"id": "1[a]", "text": claim}])
                self.assertEqual(cc.patent_checks("US1", "US1", record, page)[1]["status"], "pass")
        multi = PAGE_B.split(r"2\. The device")[0]
        self.assertEqual(cc.parse_patent(multi)["elements"], [])
        single = multi.replace("Claims ( 20 )", "Claims ( 1 )")
        self.assertEqual(cc.parse_patent(single)["elements"], cc.parse_patent(PAGE_B)["elements"])

    def test_layout_b(self):
        p = cc.parse_patent(PAGE_B)
        self.assertEqual((p["assignee"], p["status"], p["priority_date"]), ("Apple Inc", "Active", "2006-09-06"))
        self.assertEqual((p["grant_date"], p["expiration"], p["claim_count"]), ("2009-01-20", "2027-09-05", 20))
        self.assertEqual([e["text"] for e in p["elements"]][2:], ["one or more programs including:", "instructions for detecting one or more finger contacts;"])

    def test_patent_checks_catch_a_changed_claim(self):
        p = cc.parse_patent(PAGE_A)
        ok = cc.patent_checks("US5960411A", "US5960411A - Method", p, PAGE_A)
        self.assertTrue(all(c["status"] == "pass" for c in ok), ok)
        p["elements"][1]["text"] += " using a shopping cart"
        bad = {c["name"]: c["status"] for c in cc.patent_checks("US5960411A", "US5960411A - Method", p, PAGE_A)}
        self.assertEqual(bad["Claim 1 copied verbatim"], "fail")
        self.assertEqual(cc.patent_checks("US1234567B2", "US5960411A - Method", p, PAGE_A)[0]["status"], "fail")


class Checks(unittest.TestCase):
    def test_quote_match(self):
        page = cc.norm("Press the Home button or the On/Off button, then drag the slider. It’s that simple.")
        self.assertEqual(cc.quote_match("Press the Home button or the On/Off button, then drag the slider.", page), 1.0)
        self.assertEqual(cc.quote_match("It's that simple.", page), 1.0)  # curly and straight apostrophes match
        self.assertLess(cc.quote_match("Tap the Home button twice and swipe across the lock screen to open it.", page), 0.6)
        self.assertEqual(cc.quote_match("anything", ""), 0.0)

    def test_quote_check_statuses(self):
        pages = {"u": {"text": cc.norm("one two three four five six seven eight"), "fetched": "2026-11-03"}}
        self.assertEqual(cc.quote_check("one two three four five six seven eight", "u", pages)["status"], "pass")
        self.assertEqual(cc.quote_check("one two three four five six seven nine", "u", pages)["status"], "warn")
        self.assertEqual(cc.quote_check("nothing like this appears on that page at all", "u", pages)["status"], "fail")
        self.assertEqual(cc.quote_check("one two", "missing", pages)["status"], "warn")
        pages["u"]["stale"] = True  # verbatim, but only on an old cached copy
        self.assertEqual(cc.quote_check("one two three four five six seven eight", "u", pages)["status"], "warn")

    def test_verbatim_requires_contiguous_whole_words(self):
        phrase = "allow users with an active account to approve every pending purchase in the current list without entering a second password or contacting the account administrator"
        pages = {"u": {"text": cc.norm(phrase), "fetched": "2026-11-03"}}
        self.assertEqual(cc.quote_check("Never " + phrase, "u", pages)["status"], "warn")
        pages["u"]["text"] = "one two three four five six unrelated two three four five six seven"
        self.assertEqual(cc.quote_check("one two three four five six seven", "u", pages)["status"], "warn")
        pages["u"]["text"] = "unavailable"
        self.assertEqual(cc.quote_check("available", "u", pages)["status"], "fail")

    def test_dates(self):
        self.assertEqual([cc.parse_date(v) for v in ("2017-06-30", "2017-06", "2017", "2017-13-01", "June 2017", "")],
                         ["2017-06-30", "2017-06", "2017", None, None, None])
        self.assertEqual([cc.before(v, "2005-12-23") for v in ("1992-05", "2005", "2005-12-23", "2006")], [True, None, False, False])
        r = record()
        self.assertEqual([cc.term_label(d, r) for d in ("2008", "2009", "2017-06-30", "2028-01")],
                         ["before the patent issued", "during the patent term", "during the patent term", "after the patent expired"])
        self.assertEqual([cc.bluebook_date(d) for d in ("2026-11-03", "2017-06", "2017-09-01", "2017")],
                         ["Nov. 3, 2026", "June 2017", "Sept. 1, 2017", "2017"])

    def test_patent_sources(self):
        self.assertTrue(cc.is_patent_source("https://patents.google.com/patent/US1/en"))
        self.assertTrue(cc.is_patent_source("https://ppubs.uspto.gov/pubwebapp/"))
        self.assertFalse(cc.is_patent_source("https://support.apple.com/guide/iphone"))


class Verify(unittest.TestCase):
    def test_quote_freshness_uses_acquisition_time_and_handles_absent_sdk_field(self):
        url = "https://example.org/doc"
        now = datetime.now(UTC)
        cases = [(now - timedelta(hours=23, minutes=59), "pass"), (now - timedelta(hours=24, minutes=1), "warn"),
                 (now - timedelta(days=2), "warn"), (now + timedelta(hours=1), "warn"),
                 (None, "warn"), ("bad-date", "warn"), (now.date().isoformat(), "warn")]
        for timestamp, expected in cases:
            with self.subTest(timestamp=timestamp):
                result = ExtractResult(url=url, excerpts=[], full_content="Quoted text", title="US1")
                if isinstance(timestamp, datetime):
                    timestamp = timestamp.astimezone(timezone(timedelta(hours=-7))).isoformat()
                if timestamp is not None:
                    result.acquired_at = timestamp
                client = Mock()
                client.extract.return_value.results = [result]
                pages = cc.fetch_pages(client, {url})
                self.assertEqual(cc.quote_check("Quoted text", url, pages)["status"], expected)
        result = ExtractResult(url="https://patents.google.com/patent/US1/en", excerpts=[], full_content=PAGE_B, title="US1")
        client.extract.return_value.results = [result]
        self.assertIsNone(cc.fetch_patents(client, ["US1"])["US1"]["fetched"])

    def test_every_element_gets_a_row_and_checks(self):
        r = record()
        result = {"content": {"elements": [
            {"element_id": "1[a]", "assessment": "documented", "quote": "The touch screen display responds to fingers.",
             "source_url": "https://example.com/guide", "source_title": "Guide", "source_date": "2010-01", "evidence_summary": "s"}]},
            "basis": [{"field": "elements.0", "confidence": "high", "reasoning": "r", "citations": [{"url": "https://example.com/guide"}]}]}
        pages = {"https://example.com/guide": {"text": cc.norm("The touch screen display responds to fingers."), "fetched": "2026-11-03"}}
        rows = cc.verify_evidence(r, result, pages, "2026-11-03")
        self.assertEqual([x["id"] for x in rows], ["1[pre]", "1[a]"])
        self.assertEqual(rows[0]["assessment"], "unresearched")
        self.assertEqual(rows[0]["checks"][0]["status"], "fail")  # missing from the research output
        status = {c["name"]: c["status"] for c in rows[1]["checks"]}
        self.assertEqual(set(status.values()), {"pass"}, status)
        self.assertEqual((rows[1]["term"], rows[1]["basis"]["confidence"]), ("during the patent term", "high"))

        result["content"]["elements"][0] |= {"source_url": "https://patents.google.com/patent/US1", "source_date": "2030"}
        status = {c["name"]: c["status"] for c in cc.verify_evidence(r, result, pages, "2026-11-03")[1]["checks"]}
        self.assertEqual((status["Not a patent document"], status["Source dated"]), ("fail", "fail"))
        self.assertEqual(status["Source cited in the research basis"], "warn")

    def test_prior_art_dates_are_enforced(self):
        refs = [{"title": t, "author_or_publisher": "a", "publication_date": d, "url": u, "elements_disclosed": "1[a]", "quote": "q"}
                for t, d, u in [("Early", "1992-05", "https://a.org/1"), ("Same year", "2006", "https://a.org/2"),
                                ("Late", "2007-01", "https://a.org/3"), ("A patent", "1990", "https://patents.google.com/x")]]
        pages = {ref["url"]: {"published": ref["publication_date"]} for ref in refs}
        accepted, rejected = cc.verify_prior_art(record(), {"content": {"references": refs}}, pages)
        self.assertEqual([r["title"] for r in accepted], ["Early"])
        self.assertEqual([r["title"] for r in rejected], ["Same year", "Late", "A patent"])
        self.assertEqual(rejected[0]["checks"][0]["status"], "warn")

    def test_cutoff_requires_source_support_and_excludes_known_late_dates(self):
        cases = [
            ("2001", "2001-08-01", "pass"), ("", "2001-08-01", "pass"),
            ("2001-01-01", "2007-10-01", "fail"), ("2001", None, "warn"),
            ("2001-03-01", "2001", "warn"), ("2004", "2003", "warn"),
            ("2006-09-06", "2006-09-06", "fail"), ("2006-09", "2006-09", "warn"),
            ("First publicly archived on 2007-10-01", None, "fail"),
            ("First publicly archived on 2006-09-06", None, "fail"),
            ("First publicly archived on 2001-02-30", None, "fail"),
        ]
        for claimed, source, expected in cases:
            with self.subTest(claimed=claimed, source=source):
                _, result = cc.prior_date_check(claimed, source, "2006-09-06")
                self.assertEqual(result["status"], expected)


class Workflow(unittest.TestCase):
    def test_full_row_identity_survives_reordering_and_distinguishes_inputs(self):
        product = "Business application suite for enterprise customers"
        values = [(product + " Alpha", "A", "first"), (product + " Beta", "A", "first"),
                  (product + " Alpha", "B", "first"), (product + " Alpha", "A", "second")]
        def read(path, entries):
            with path.open("w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["patent_number", "product", "company", "note"])
                writer.writerows(("US1", *entry) for entry in entries)
            return [r["key"] for r in cc.read_rows(path)]
        with TemporaryDirectory() as tmp:
            path = Path(tmp, "input.csv")
            keys = read(path, values)
            self.assertEqual(len(set(keys)), 4)
            self.assertEqual(keys[::-1], read(path, values[::-1]))

    def test_skipped_record_cannot_republish_previous_exhibit(self):
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            csv_path = out / "input.csv"
            csv_path.write_text("patent_number,product,company,note\nUS1,Device,A,first customer\n")
            old = cc.read_rows(csv_path)[0]
            (out / "pdf").mkdir()
            (out / "data").mkdir()
            name = f"pdf/{old['key']}.pdf"
            (out / name).write_bytes(b"private")
            (out / "claim-charts.pdf").write_bytes(b"private")
            (out / "portfolio.csv").write_text(f"pdf\n{name}\n")
            cc.write_json(out / "data" / f"{old['key']}.json", {"row": old, "key": old["key"]})
            csv_path.write_text(csv_path.read_text().replace("first customer", "second customer"))
            self.assertEqual(cc.saved_charts(out, cc.read_rows(csv_path)), [])
            with (patch.object(sys, "argv", ["cc", str(csv_path), "--out", tmp]),
                  patch.object(cc, "ensure_pdf_support"), patch("parallel.Parallel"),
                  patch.dict(cc.os.environ, PARALLEL_API_KEY="test"),
                  patch.object(cc, "fetch_patents", return_value={"US1": {"error": "unreadable"}}),
                  patch.object(cc, "render_all") as render):
                with self.assertRaisesRegex(SystemExit, "1 missing"):
                    cc.main()
                self.assertEqual(render.call_args.args[1], [])
            self.assertFalse(any((out / f).exists() for f in (name, "claim-charts.pdf", "portfolio.csv")))

    def test_resume_uses_actual_inputs_and_retries_only_failed_task(self):
        client = Mock()
        def event(key, product, run_id, status):
            run = SimpleNamespace(metadata={"key": key}, processor="pro", run_id=run_id, status=status)
            return SimpleNamespace(type="task_run.state", run=run, input=SimpleNamespace(input={"product": product}),
                                   output=SimpleNamespace(content={"references": [], "elements": []}, basis=[]))
        events = [event("evidence:legacy", "other", "wrong", "completed"),
                  event("evidence:legacy", "right", "omitted", "completed"),
                  event("evidence:legacy", "right", "reuse", "completed"),
                  event("prior_art:p", "right", "old", "failed")]
        finished = [*events, event("prior_art:p", "right", "retry", "completed")]
        client.task_group.get_runs.side_effect = [events, finished, finished]
        submit = client.with_options.return_value.task_group.add_runs
        submit.return_value.run_ids = ["retry"]
        tasks = {key: {"input": {"product": "right"}, "processor": "pro"} for key in ("evidence:new", "prior_art:p")}
        with TemporaryDirectory() as tmp:
            state = Path(tmp, "runs.json")
            cc.write_json(state, {"group": "test-group", "incomplete_runs": ["omitted"]})
            results = cc.research(client, tasks, state)
        self.assertEqual([r["run_id"] for r in results.values()], ["reuse", "retry"])
        self.assertEqual([r["metadata"]["key"] for r in submit.call_args.kwargs["inputs"]], ["prior_art:p"])

    def test_omitted_elements_mark_reports_incomplete_and_retry_only_evidence(self):
        row = cc.read_rows(ROOT / "patents.csv")[0]
        sample = json.loads((ROOT / "sample/data" / f"{row['key']}.json").read_text())
        claim = sample["patent"]["elements"]
        # The task explicitly researched the first element and omitted the others.
        item = {"element_id": claim[0]["id"], "assessment": "not_found", "quote": "", "source_url": "",
                "source_date": "", "source_title": "", "evidence_summary": ""}
        ev = {"content": {"elements": [item]}, "basis": [], "status": "completed", "run_id": "ev", "processor": "pro"}
        pa = dict(ev, content={"references": []}, run_id="pa")
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            cc.write_json(out / "runs.json", {"group": "test-group"})
            with (patch.object(cc, "fetch_patents", return_value={row["patent_number"]: sample["patent"]}),
                  patch.object(cc, "research", return_value={f"evidence:{row['key']}": ev, f"prior_art:{row['patent_number']}": pa})):
                chart, = cc.build(Mock(), [row], out)
            self.assertEqual(json.loads((out / "runs.json").read_text())["incomplete_runs"], ["ev"])
            self.assertEqual(cc.summarize(chart)["not_found"], 1)
            self.assertEqual(cc.summarize(chart)["unresearched"], len(claim) - 1)

            # Run the CLI from a legacy cache; capture the HTML and CSV before PDF encoding.
            del chart["verification_version"]
            for e in chart["elements"]:
                e["assessment"] = "not_found"
            cc.write_json(out / "data" / f"{row['key']}.json", chart)
            backend = Mock()
            backend.HTML.return_value.render.return_value.pages = []
            with (patch.object(sys, "argv", ["cc", str(ROOT / "patents.csv"), "--limit", "1", "--out", tmp, "--render-only"]),
                  patch.object(cc, "ensure_pdf_support"), patch.dict(sys.modules, weasyprint=backend),
                  self.assertRaisesRegex(SystemExit, "unresearched elements")):
                cc.main()
            exhibit, index = [call.kwargs["string"] for call in backend.HTML.call_args_list]
            self.assertIn("Incomplete research.", exhibit)
            self.assertEqual(exhibit.count("No public evidence found."), 1)
            self.assertEqual(exhibit.count("The research omitted this element."), len(claim) - 1)
            self.assertIn(f"incomplete ({len(claim) - 1} unresearched)", index)
            with (out / "portfolio.csv").open() as f:
                summary, = csv.DictReader(f)
            self.assertEqual((summary["not_found"], summary["unresearched"]), ("1", str(len(claim) - 1)))

    def test_old_cache_needs_a_recheck_for_ambiguous_quote_age(self):
        row = cc.read_rows(ROOT / "patents.csv")[0]
        name = f"{row['key']}.json"
        chart = json.loads((ROOT / "sample/data" / name).read_text())
        chart["elements"][0]["fetched"] = "2026-11-02"
        with TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "data").mkdir()
            cc.write_json(out / "data" / name, chart)
            with self.assertRaisesRegex(SystemExit, "recheck the sources"):
                cc.saved_charts(out, [row])

    def test_failed_task_is_visible_and_commands_exit_incomplete(self):
        chart = json.loads(next((ROOT / "sample/data").glob("*.json")).read_text())
        chart.update(prior_art=[], rejected=[], status={"evidence": "completed", "prior_art": "failed"})
        env = Environment(loader=FileSystemLoader(ROOT), autoescape=True)
        env.filters.update(longdate=cc.bluebook_date, patno=str)
        template = env.get_template("chart.html.j2")
        ctx = {"charts": [chart | {"summary": cc.summarize(chart), "exhibit": "A-1"}], "wordmark": ""}
        exhibit = template.render(**ctx)
        self.assertIn("Prior-art research is unavailable (task failed)", exhibit)
        self.assertNotIn("No non-patent prior art passed", exhibit)
        self.assertIn("Task failed", template.render(index=True, **ctx))
        with TemporaryDirectory() as tmp:
            for mode in ([], ["--render-only"]):
                with (patch.object(sys, "argv", ["cc", str(ROOT / "patents.csv"), "--limit", "1", "--out", tmp, *mode]),
                      patch.object(cc, "ensure_pdf_support"), patch("parallel.Parallel"),
                      patch.dict(cc.os.environ, PARALLEL_API_KEY="test"),
                      patch.object(cc, "build", return_value=[chart]), patch.object(cc, "saved_charts", return_value=[chart]),
                      patch.object(cc, "render_all"), self.assertRaisesRegex(SystemExit, "1 with unsuccessful tasks")):
                    cc.main()


class Template(unittest.TestCase):
    def test_sample_renders_every_quote_and_citation(self):
        env = Environment(loader=FileSystemLoader(ROOT), autoescape=True)
        env.filters |= {"longdate": cc.bluebook_date, "patno": lambda pn: pn}
        for path in sorted((ROOT / "sample/data").glob("*.json")):
            chart = json.loads(path.read_text())
            chart |= {"exhibit": "A-1", "summary": cc.summarize(chart)}
            html = env.get_template("chart.html.j2").render(charts=[chart], wordmark="")
            for e in chart["elements"]:
                self.assertIn(e["id"], html)
                if e.get("quote"):
                    self.assertIn(e["source_url"].replace("&", "&amp;"), html)
            for r in chart["prior_art"]:
                self.assertIn(r["url"].replace("&", "&amp;"), html)


if __name__ == "__main__":
    unittest.main()
