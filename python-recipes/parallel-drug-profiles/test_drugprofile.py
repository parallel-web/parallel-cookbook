"""Offline regression tests: uv run python -m unittest -v. No API key or network needed."""

import copy
import io
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import checks
import drugprofile
import images
import render

render.ensure_pdf_support()  # on macOS, re-runs the tests with Homebrew's Pango on the library path

SAMPLE = json.loads((Path(__file__).parent / "sample/leqembi.json").read_text())
ASSET = SAMPLE["asset"]


def png(w: int, h: int) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (w, h), (240, 240, 240)).save(out, "PNG")
    return out.getvalue()


class ParsingTests(unittest.TestCase):
    def test_p_values(self):
        self.assertEqual(checks.p_value("P<0.001"), ("<", 0.001))
        self.assertEqual(checks.p_value("0.03"), ("=", 0.03))
        self.assertEqual(checks.p_value("one-sided p<0·0001"), ("<", 0.0001))  # the Lancet's decimal point
        self.assertAlmostEqual(checks.p_value("P = 1.2 × 10−5")[1], 1.2e-5)
        self.assertIsNone(checks.p_value("not significant"))

    def test_dates_compare_at_shared_precision(self):
        self.assertTrue(checks.same_date("2023-01-06", "20230106"))
        self.assertTrue(checks.same_date("2026-07", "2026-07-27"))
        self.assertFalse(checks.same_date("2031-10-29", "2031-10-15"))
        self.assertIsNone(checks.same_date("", "2026-07"))

    def test_label_section_is_copied_verbatim(self):
        page = (
            "# INDICATIONS AND USAGE\n\nHighlights text, not section 1.\n\n"
            "* 1 INDICATIONS AND USAGE\n  \n  LEQEMBI is indicated for the treatment of Alzheimer’s disease.\n"
            "* 2 DOSAGE AND ADMINISTRATION\n  \n  ## 2\\.1 Patient Selection\nRevised: 7/2026\n"
        )
        got = checks.label_section(page)
        self.assertEqual(got["indications_and_usage"], "LEQEMBI is indicated for the treatment of Alzheimer’s disease.")
        self.assertEqual(got["printed_revision"], "2026-07")
        self.assertEqual(checks.label_section("no label here")["status"], "section 1 not found on the page")


class CheckTests(unittest.TestCase):
    def result(self, **over):
        r = {"trial": "T", "pmid": "", "effect_measure": "hazard ratio", "estimate": 0.51, "ci_lower": 0.38, "ci_upper": 0.69, "p_value": "one-sided p<0·0001"}
        return {**r, **over}

    def outcomes(self, r):
        return {x["check"]: x["result"] for x in checks.check_results([r])}

    def test_effect_size_arithmetic(self):
        self.assertEqual(self.outcomes(self.result())["estimate inside its 95% CI"], "pass")
        self.assertEqual(self.outcomes(self.result())["P value agrees with the 95% CI"], "pass")
        self.assertEqual(self.outcomes(self.result(estimate=0.9))["estimate inside its 95% CI"], "fail")
        self.assertEqual(self.outcomes(self.result(p_value="0.40"))["P value agrees with the 95% CI"], "fail")
        diff = self.result(effect_measure="difference in means", estimate=-0.45, ci_lower=-0.67, ci_upper=-0.23, p_value="P<0.001")
        self.assertEqual(self.outcomes(diff)["P value agrees with the 95% CI"], "pass")
        self.assertEqual(self.outcomes(self.result(estimate=None))["estimate inside its 95% CI"], "skip")

    def test_pubmed_accepts_online_or_print_year(self):
        record = {"result": {"36449413": {"title": "Lecanemab in Early Alzheimer's Disease.", "source": "N Engl J Med",
                                          "fulljournalname": "The New England journal of medicine", "pubdate": "2023 Jan 5", "epubdate": "2022 Nov 29"}}}
        with patch.object(checks, "get_json", return_value=record):
            out = self.outcomes(self.result(pmid="36449413", journal="N Engl J Med", publication_year=2022))
        self.assertEqual(out["PMID resolves"], "pass")
        self.assertEqual(out["publication year matches PubMed"], "pass")
        self.assertEqual(out["journal matches PubMed"], "pass")

    def test_trial_against_registry(self):
        study = {"protocolSection": {
            "identificationModule": {"briefTitle": "A study"},
            "statusModule": {"overallStatus": "ACTIVE_NOT_RECRUITING", "primaryCompletionDateStruct": {"date": "2026-12-31"}},
            "designModule": {"phases": ["PHASE3"], "enrollmentInfo": {"count": 1906}},
            "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Eisai Inc."}},
        }}
        trial = {"nct_id": "NCT03887455", "acronym": "Clarity AD", "phase": "phase 3", "status": "active, not recruiting",
                 "lead_sponsor": "Eisai", "enrollment": 1906, "start_date": "2019-03", "primary_completion_date": "2026-12-31"}
        with patch.object(checks, "get_json", return_value=study):
            got = {x["check"]: x["result"] for x in checks.check_trial(trial, "pivotal")}
            self.assertNotIn("fail", got.values())
            self.assertTrue(all(x["ref"] == "NCT03887455" for x in checks.check_trial(trial, "pivotal")))
            stale = {x["check"]: x["result"] for x in checks.check_trial({**trial, "status": "completed"}, "pivotal")}
        self.assertEqual(stale["trial status matches registry"], "fail")
        self.assertEqual(checks.check_trial({**trial, "nct_id": "NCT123"}, "pivotal")[0]["result"], "fail")

    def test_news_approvals_against_regulatory(self):
        reg = {"china": {"status": "approved", "first_approval_date": "2024-05-24",
                         "approved_indications": [{"indication": "EGFR NSCLC", "approval_date": "2024-05-24"}]}}
        news = lambda action, when: {"region": "china", "action": action, "date": when, "detail": "x"}
        self.assertEqual(checks.news_approval(news("new indication approved", "2026-08-12"), reg), "unconfirmed")
        self.assertEqual(checks.news_approval(news("new indication approved", "2024-05-27"), reg), "confirmed")
        self.assertEqual(checks.news_approval(news("approval", "2026-09-02"), reg), "formulation")
        self.assertIsNone(checks.news_approval(news("submission", "2026-01-12"), reg))
        self.assertEqual(len(checks.unconfirmed_approvals(reg, {"regulatory_actions": [news("new indication approved", "2026-08-12")]})), 1)

    def test_exclusivity_is_computed(self):
        got = checks.exclusivity({"application_number": "BLA761269", "first_approval_date": "2023-01-06"}, {})
        self.assertEqual(got["reference_product_exclusivity_ends"], "2035-01-06")
        leap = checks.exclusivity({"application_number": "BLA761000", "first_approval_date": "2024-02-29"}, {})
        self.assertEqual(leap["reference_product_exclusivity_ends"], "2036-02-29")  # +12 years from a leap day is another leap day
        market = {"us_exclusivity": {"listed_exclusivities": [{"kind": "NCE", "expiry_date": "2030-09-30"}],
                                     "patents": [{"patent_number": "1", "expiry_date": "2043-12-09", "covers": "compound"}]}}
        got = checks.exclusivity({"application_number": "NDA218436", "first_approval_date": "2025-09-30"}, market)
        self.assertEqual(got["last_protection_ends"], "2043-12-09")
        self.assertNotIn("reference_product_exclusivity_ends", got)

    def test_sample_checks_are_stable_offline(self):
        """Re-running the arithmetic, date and consistency checks on the sample gives the saved results."""
        data = copy.deepcopy(SAMPLE)
        with patch.object(checks, "get_json", return_value=None):  # registries unreachable: those checks fail, the rest must not change
            got = checks.run_all(data)
        offline = lambda rs: [(r["check"], r["subject"], r["result"]) for r in rs if r["check"].startswith(("estimate", "P value", "approval date", "indication approved", "accelerated", "brand region", "news "))]
        self.assertEqual(offline(got["results"]), offline(SAMPLE["checks"]["results"]))


class ImageTests(unittest.TestCase):
    identity = {"generic_name": "lecanemab", "brand_names": [{"name": "Leqembi", "region": "United States"}],
                "development_codes": ["BAN2401"], "originator": "BioArctic", "rights_holders": [{"company": "Biogen", "rights": "co-promotion"}]}

    def vet(self, page, title="LEQEMBI 200-mg vial", image="https://cdn.example.com/a.png"):
        companies, names = images.identity_terms(ASSET, self.identity)
        return images.vet({"source_page_url": page, "image_url": image, "title": title}, companies, names)

    def test_official_sources_pass(self):
        self.assertIsNone(self.vet("https://www.leqembihcp.com/supply"))  # brand domain
        self.assertIsNone(self.vet("https://media-us.eisai.com/2025-10-13-leqembi"))  # sponsor domain
        self.assertIsNone(self.vet("https://www.prnewswire.com/news/leqembi"))  # press wire
        self.assertIsNone(self.vet("https://dailymed.nlm.nih.gov/dailymed/lookup.cfm", title="PRINCIPAL DISPLAY PANEL Leqembi"))

    def test_resellers_and_off_topic_images_fail(self):
        self.assertIn("not the sponsor", self.vet("https://247qualitymeds.com/product/leqembi"))
        self.assertIn("not the sponsor", self.vet("https://www.amazon.com/LEQEMBI/dp/B0"))
        self.assertIn("do not name the drug", self.vet("https://www.eisai.com/products", title="Our medicines", image="https://www.eisai.com/a.png"))
        self.assertIn("not the sponsor", self.vet("https://www.eisai.com.evil.example/leqembi", image="https://www.eisai.com.evil.example/a.png"))  # lookalike
        self.assertIsNone(self.vet("https://www.eisai.com.cn/x"))  # country second-level domains

    def test_validation_reencodes_and_rejects(self):
        data, w, h = images.validate(png(600, 400))
        self.assertEqual((w, h), (600, 400))
        self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertIn("too small", images.validate(png(120, 90)))
        self.assertIn("banner", images.validate(png(2400, 600)))
        self.assertEqual(images.validate(b"<html>not an image</html>"), "not a readable image")
        self.assertEqual(images.validate(png(600, 400)[:200]), "not a readable image")  # truncated

    def test_first_passing_candidate_is_saved(self):
        results = {"search_id": "s1", "results": [
            {"title": "Buy Leqembi", "image_url": "https://shop.example/a.png", "source_page_url": "https://shop.example/leqembi"},
            {"title": "LEQEMBI vial", "image_url": "https://www.leqembi.com/tiny.png", "source_page_url": "https://www.leqembi.com/a"},
            {"title": "LEQEMBI vial and carton", "image_url": "https://www.leqembi.com/good.png", "source_page_url": "https://www.leqembi.com/b"},
        ]}

        class Client:
            def post(self, path, body, cast_to):
                assert path == "/v1/images/search" and body["search_queries"]
                return results

        def fake_fetch(url):
            return images.validate(png(80, 80) if "tiny" in url else png(500, 400))

        with tempfile.TemporaryDirectory() as d, patch.object(images, "fetch", side_effect=fake_fetch):
            got = images.product_image(Client(), ASSET, self.identity, Path(d) / "images", "leqembi")
            self.assertEqual(got["status"], "found")
            self.assertEqual(got["source_page_url"], "https://www.leqembi.com/b")
            self.assertTrue((Path(d) / got["file"]).exists())
            self.assertEqual([r["reason"][:10] for r in got["rejected"]], ["source sho", "too small "])


class RunTests(unittest.TestCase):
    def test_source_policies_and_connectors(self):
        reg = drugprofile.section_run(ASSET, "regulatory")
        self.assertIn("fda.gov", reg["source_policy"]["include_domains"])
        self.assertNotIn("advanced_settings", reg)
        news = drugprofile.section_run(ASSET, "news")
        self.assertEqual(date.fromisoformat(news["source_policy"]["after_date"]), date.today() - __import__("datetime").timedelta(days=365))
        self.assertEqual(drugprofile.section_run(ASSET, "trials")["advanced_settings"], {"data_sources": {"free": ["clinical_trials"]}})
        self.assertNotIn("advanced_settings", drugprofile.section_run(ASSET, "trials", connectors=False))

    def test_csv_validation(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a.csv"
            p.write_text("asset,sponsor\nLeqembi,Eisai\nleqembi,Eisai\n")
            with self.assertRaises(SystemExit):
                drugprofile.read_assets(str(p))
            p.write_text("name,sponsor\nLeqembi,Eisai\n")
            with self.assertRaises(SystemExit):
                drugprofile.read_assets(str(p))


class RenderTests(unittest.TestCase):
    def render(self, data, image: bytes | None = None):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        out = Path(d.name)
        (out / "data").mkdir()
        if image:
            (out / "images").mkdir()
            (out / "images/leqembi.png").write_bytes(image)
            data["image"] = {"status": "found", "file": "images/leqembi.png", "source_page_url": "https://www.leqembihcp.com/x", "title": "vial"}
        (out / "data/leqembi.json").write_text(json.dumps(data))
        written, incomplete = render.render_all(out, [ASSET])
        return out, written, incomplete

    def test_sample_renders_with_and_without_image(self):
        from pypdf import PdfReader

        for image in (None, png(500, 400)):
            out, written, incomplete = self.render(copy.deepcopy(SAMPLE), image)
            self.assertEqual((len(written), incomplete), (1, []))
            pages = PdfReader(written[0]).pages
            self.assertLessEqual(len(pages), 6)
            text = "".join(p.extract_text() for p in pages).lower()
            for needle in ("leqembi is indicated for the treatment of alzheimer", "research basis", "checks, no model involved"):
                self.assertIn(needle, text)
            self.assertEqual("image: leqembihcp.com" in text, image is not None)

    def test_missing_sections_are_reported_not_fatal(self):
        data = copy.deepcopy(SAMPLE)
        data["runs"]["market"] = {"status": "failed", "content": None, "basis": []}
        _, written, incomplete = self.render(data)
        self.assertEqual(len(written), 1)
        self.assertEqual(incomplete, [ASSET["asset"]])


if __name__ == "__main__":
    unittest.main()
