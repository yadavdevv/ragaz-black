"""Fetch public-domain Braj/Hindi poetry from Hindi Wikisource, for the lyrics writer.

    uv run python scripts/fetch_wikisource.py        # → data/external/wikisource/<collection>.json

The works are public domain (the poets lived 15th–17th c.; the editors died before 1963, so the
editions are out of copyright in India). Wikisource's transcriptions are CC BY-SA 4.0: credit
"Hindi Wikisource contributors" and keep derived text under the same licence.

Pages are rendered through the MediaWiki API (their text is transcluded from the scanned book),
one request a second, resumable (a collection already on disk is skipped).
"""

import json
import re
import ssl
import time
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

import certifi

CTX = ssl.create_default_context(cafile=certifi.where())  # python.org builds ship without CA certs

API = "https://hi.wikisource.org/w/api.php"
UA = "ragaz-research/0.1 (https://github.com/yadavdevv/ragaz)"
OUT = Path("data/external/wikisource")

COLLECTIONS = {
    "bhramargeet": {"prefix": "भ्रमरगीत-सार/", "poet": "Surdas", "editor": "Ramchandra Shukla (d. 1941)", "form": "pad"},
    "kabir": {"prefix": "कबीर ग्रंथावली/", "poet": "Kabir", "editor": "Shyamsundar Das (d. 1945)", "form": "sakhi"},
    "bihari": {"prefix": "बिहारी-रत्नाकर/", "poet": "Bihari", "editor": "Jagannathdas Ratnakar (d. 1932)", "form": "doha"},
    "rahim": {"prefix": "रहीम-कवितावली/", "poet": "Rahim", "editor": "Rahim-Kavitavali", "form": "doha"},
}


def get(params: dict) -> dict:
    # POST: 50 Devanagari titles make a GET URL too long.
    body = urllib.parse.urlencode(params | {"format": "json", "formatversion": "2"}).encode()
    req = urllib.request.Request(API, data=body, headers={"User-Agent": UA})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                return json.loads(r.read())
        except Exception as e:  # network hiccup: back off and retry
            print(f"  retry {attempt + 1}: {str(e)[:120]}")
            time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"failed: {params.get('action')} {str(params)[:120]}")


def titles(prefix: str) -> list[str]:
    out, cont = [], {}
    while True:
        d = get({"action": "query", "list": "allpages", "apprefix": prefix, "aplimit": "500"} | cont)
        out += [p["title"] for p in d["query"]["allpages"]]
        time.sleep(1)
        if "continue" not in d:
            return out
        cont = d["continue"]


def rendered(title: str) -> dict | None:
    """The page as readers see it: its text is transcluded from the scanned book's pages, so the
    page source is only a <pages/> tag. Rendered HTML → plain text, line breaks kept."""
    d = get({"action": "parse", "page": title, "prop": "text|revid", "disablelimitreport": "1"})
    if "parse" not in d:
        return None
    html = d["parse"]["text"]
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
    html = re.sub(r'<span[^>]*class="[^"]*pagenum[^"]*"[^>]*>.*?</span>', "", html, flags=re.S)  # scan page numbers
    html = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</tr>", "\n", html)
    text = unescape(re.sub(r"<[^>]+>", "", html))
    lines = [ln.strip() for ln in text.splitlines()]
    return {"revid": d["parse"].get("revid"), "text": "\n".join(ln for ln in lines if ln)}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, meta in COLLECTIONS.items():
        path = OUT / f"{key}.json"
        if path.exists():
            print(f"{key}: on disk, skipped")
            continue
        names = titles(meta["prefix"])
        pages = {}
        for name in names:
            page = rendered(name)
            if page:
                pages[name] = page
            time.sleep(1)
        path.write_text(json.dumps({"collection": key, **meta, "licence": "CC BY-SA 4.0 (Hindi Wikisource contributors)", "source": "https://hi.wikisource.org/wiki/" + urllib.parse.quote(meta["prefix"]), "pages": pages}, ensure_ascii=False))
        print(f"{key}: {len(pages)} pages, {sum(len(p['text']) for p in pages.values()) / 1e3:.0f}k characters", flush=True)


if __name__ == "__main__":
    main()
