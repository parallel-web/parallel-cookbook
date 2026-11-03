"""Offline tests for the parser, the checks and the template: uv run python -m unittest -v."""

import json
import unittest
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

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

    def test_dates(self):
        self.assertEqual([cc.parse_date(v) for v in ("2017-06-30", "2017-06", "2017", "2017-13-01", "June 2017", "")],
                         ["2017-06-30", "2017-06", "2017", None, None, None])
        self.assertEqual([cc.before(v, "2005-12-23") for v in ("1992-05", "2005", "2005-12-23", "2006")], [True, None, None, False])
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
    def test_every_element_gets_a_row_and_checks(self):
        r = record()
        result = {"content": {"elements": [
            {"element_id": "1[a]", "assessment": "documented", "quote": "The touch screen display responds to fingers.",
             "source_url": "https://example.com/guide", "source_title": "Guide", "source_date": "2010-01", "evidence_summary": "s"}]},
            "basis": [{"field": "elements.0", "confidence": "high", "reasoning": "r", "citations": [{"url": "https://example.com/guide"}]}]}
        pages = {"https://example.com/guide": {"text": cc.norm("The touch screen display responds to fingers."), "fetched": "2026-11-03"}}
        rows = cc.verify_evidence(r, result, pages, "2026-11-03")
        self.assertEqual([x["id"] for x in rows], ["1[pre]", "1[a]"])
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
        accepted, rejected = cc.verify_prior_art(record(), {"content": {"references": refs}}, {})
        self.assertEqual([r["title"] for r in accepted], ["Early", "Same year"])
        self.assertEqual([r["title"] for r in rejected], ["Late", "A patent"])
        self.assertEqual(accepted[1]["checks"][0]["status"], "warn")  # same period: flagged for a person


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
