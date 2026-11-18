"""A product photo for each profile, found with the Parallel Images API and vetted in plain Python.

The Images API has no source policy, so results can include online pharmacies and
resellers. A candidate is used only if all of these hold:

  source   the page or image is on the sponsor's or brand's own site, a press-release
           wire, or a regulator (DailyMed carton images count)
  subject  its title or URLs name the drug: a brand name, the generic name or a code
  image    it downloads, decodes as an image, is at least 160 px on its short side and
           is not a banner (aspect ratio between 1:2.5 and 2.5:1)

The first candidate that passes, in the API's relevance order, is re-encoded as a PNG
in <out>/images/, so renders work offline and never embed the original bytes.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import httpx

MODE = "advanced"  # $5 per 1,000 requests; "fast" is $1 and lower quality
MAX_RESULTS = 10
MAX_BYTES = 8_000_000
MIN_SIDE = 160
MAX_ASPECT = 2.5
MAX_SIDE = 800  # stored size; plenty for a 176 px header column at print resolution

WIRES = ("prnewswire.com", "multivu.com", "businesswire.com", "globenewswire.com", "newswire.ca")
REGULATORS = ("dailymed.nlm.nih.gov", "fda.gov", "ema.europa.eu", "nmpa.gov.cn", "pmda.go.jp")
GENERIC_WORDS = {
    "inc", "corp", "corporation", "company", "limited", "ltd", "llc", "plc", "holdings", "group", "the", "and",
    "pharma", "pharmaceutical", "pharmaceuticals", "therapeutics", "biologics", "biotech", "biosciences", "bio",
    "sciences", "health", "healthcare", "medical", "global", "international", "worldwide", "rights", "united",
    "states", "china", "japan", "europe", "except", "development", "commercialization",
}


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) >= 4 and w not in GENERIC_WORDS}


def host(url: str) -> str:
    return url.split("://", 1)[-1].split("/", 1)[0].split(":")[0].lower().removeprefix("www.")


def registrable(domain: str) -> str:
    """The name a site registered: 'eisai' for media-us.eisai.com, 'akesobio' for akesobio.com.cn, 'evil' for eisai.com.evil.example."""
    labels = domain.split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in {"com", "co", "org", "net", "ac", "gov", "or", "ne"}:
        return labels[-3]
    return labels[-2] if len(labels) >= 2 else domain


def on(domain: str, suffixes: tuple[str, ...]) -> bool:
    return any(domain == s or domain.endswith("." + s) for s in suffixes)


def identity_terms(asset: dict, identity: dict) -> tuple[set[str], set[str]]:
    """(company words that mark a sponsor's own domain, drug names that must appear in the result)."""
    companies = words(asset.get("sponsor", "")) | words(identity.get("originator", ""))
    companies |= {w for r in identity.get("rights_holders", []) for w in words(r.get("company", ""))}
    names = {n.lower() for n in [identity.get("generic_name", ""), asset.get("asset", "")] if n and not n.lower().startswith("none")}
    names |= {b.get("name", "").lower() for b in identity.get("brand_names", []) if b.get("name")}
    names |= {c.lower() for c in identity.get("development_codes", []) if c}
    names = {n for n in names if len(n) >= 3}
    brands = {w for n in names for w in words(n)}  # brand domains such as leqembi.com
    return companies | brands, names


def vet(candidate: dict, companies: set[str], names: set[str]) -> str | None:
    """None if the candidate's source and subject pass, otherwise the reason it was rejected."""
    page, image = host(candidate.get("source_page_url", "")), host(candidate.get("image_url", ""))
    official = any(on(d, WIRES + REGULATORS) or any(c in registrable(d) for c in companies) for d in (page, image))
    if not official:
        return f"source {page} is not the sponsor, the brand, a press wire or a regulator"
    text = " ".join([candidate.get("title", ""), candidate.get("image_url", ""), candidate.get("source_page_url", "")]).lower()
    if not any(n in text for n in names):
        return "title and URLs do not name the drug"
    return None


def search(client, asset: dict, identity: dict) -> dict:
    generic = identity.get("generic_name") or asset["asset"]
    brand = next((b["name"] for b in identity.get("brand_names", []) if b.get("region") == "United States"), None) \
        or next((b["name"] for b in identity.get("brand_names", [])), None)
    label = f"{brand} ({generic})" if brand and brand.lower() != generic.lower() else generic
    queries = [f"{label} product", f"{brand or generic} packaging carton", f"{generic} {asset['sponsor']} vial tablet injection"]
    body = {
        "objective": (
            f"An official product photo of {label} from {asset['sponsor']}: the pack, carton, vial, tablets or injection "
            "device, ideally on a plain background, from the sponsor or brand website, a press release, or the "
            "regulator's label. Not a person, a chart or a logo."
        ),
        "search_queries": queries,
        "mode": MODE,
        "advanced_settings": {"max_results": MAX_RESULTS},
    }
    return client.post("/v1/images/search", body=body, cast_to=object)


def fetch(url: str) -> tuple[bytes, int, int] | str:
    """Download an image and validate it. Returns PNG bytes and the original size, or the reason it was rejected."""
    try:
        with httpx.stream("GET", url, timeout=20, follow_redirects=True, headers={"User-Agent": "parallel-drug-profiles/0.1"}) as r:
            if r.status_code != 200:
                return f"download failed: HTTP {r.status_code}"
            data = b""
            for chunk in r.iter_bytes():
                data += chunk
                if len(data) > MAX_BYTES:
                    return "larger than 8 MB"
    except httpx.HTTPError as e:
        return f"download failed: {type(e).__name__}"
    return validate(data)


def validate(data: bytes) -> tuple[bytes, int, int] | str:
    """Decode untrusted bytes, check the size and shape, and re-encode as PNG so the original file is never embedded."""
    from PIL import Image, UnidentifiedImageError

    try:
        Image.open(io.BytesIO(data)).verify()  # rejects truncated or non-image content
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return "not a readable image"
    w, h = img.size
    if min(w, h) < MIN_SIDE:
        return f"too small ({w}x{h})"
    if max(w, h) / min(w, h) > MAX_ASPECT:
        return f"banner-shaped ({w}x{h})"
    img = img.convert("RGBA") if img.mode in ("P", "LA", "RGBA") else img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue(), w, h


def product_image(client, asset: dict, identity: dict, folder: Path, slug: str) -> dict:
    """Search, vet and save one product photo. Returns what was chosen and why the others were not."""
    resp = search(client, asset, identity)
    companies, names = identity_terms(asset, identity)
    rejected = []
    for c in resp.get("results", []):
        reason = vet(c, companies, names)
        if reason is None:
            got = fetch(c["image_url"])
            if isinstance(got, str):
                reason = got
            else:
                png, w, h = got
                folder.mkdir(parents=True, exist_ok=True)
                (folder / f"{slug}.png").write_bytes(png)
                return {"status": "found", "file": f"images/{slug}.png", "image_url": c["image_url"], "source_page_url": c["source_page_url"],
                        "title": c.get("title", ""), "width": w, "height": h, "search_id": resp.get("search_id"), "rejected": rejected}
        rejected.append({"source_page_url": c.get("source_page_url"), "reason": reason})
    return {"status": "none passed", "search_id": resp.get("search_id"), "rejected": rejected}
