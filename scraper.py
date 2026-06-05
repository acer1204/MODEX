"""Genshin Impact playable-character scraper.

Fandom blocks plain page requests behind Cloudflare, but the MediaWiki
`action=parse` API is reachable.  We pull the rendered HTML for the
``Character/List`` page, locate the *Playable Characters* table and extract
icon / name / quality / element / region for every row.
"""

import os
import re
import json
import requests
from bs4 import BeautifulSoup

API_URL = "https://genshin-impact.fandom.com/api.php"
PAGE = "Character/List"
SECTION_ID = "Playable_Characters"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def _clean_icon_url(url: str, width: int = 256) -> str:
    """Bump the wikia thumbnail width so grid icons look crisp."""
    if not url:
        return ""
    return re.sub(r"/scale-to-width-down/\d+", f"/scale-to-width-down/{width}", url)


def _img_src(img):
    """Wikia lazy-loads images; the real URL lives in data-src."""
    if not img:
        return ""
    return img.get("data-src") or img.get("src") or ""


def fetch_html() -> str:
    params = {
        "action": "parse",
        "page": PAGE,
        "prop": "text",
        "format": "json",
        "formatversion": "2",
    }
    r = requests.get(API_URL, params=params, headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.json()["parse"]["text"]


def parse_characters(html: str):
    soup = BeautifulSoup(html, "lxml")
    span = soup.find("span", id=SECTION_ID)
    if span is None:
        raise RuntimeError("Could not find the 'Playable Characters' section")

    table = span.find_parent().find_next("table")
    rows = table.find_all("tr")

    characters = []
    for row in rows[1:]:  # skip header
        cells = row.find_all("td", recursive=False)
        if len(cells) < 6:
            continue

        # Name -- prefer the data-name attribute, fall back to link text
        name_cell = cells[1]
        name = name_cell.get("data-name") or name_cell.get_text(strip=True)
        if not name:
            continue

        # Icon (column 0)
        icon_url = _clean_icon_url(_img_src(cells[0].find("img")))

        # Quality -- a span titled e.g. "4 Stars"
        quality = None
        q_span = cells[2].find("span", title=re.compile(r"\d+\s*Stars?"))
        if q_span:
            m = re.search(r"(\d+)", q_span["title"])
            if m:
                quality = int(m.group(1))

        # Element (column 3) -- link text, may be "None" for the Traveler etc.
        element = cells[3].get_text(strip=True) or "None"

        # Region (column 5)
        region = cells[5].get_text(strip=True) or "None"

        characters.append(
            {
                "name": name,
                "icon_url": icon_url,
                "quality": quality,
                "element": element,
                "region": region,
            }
        )

    return characters


def download_icon(url: str, dest_path: str, retries: int = 3) -> bool:
    """Download a single icon to dest_path; returns True on success.

    Writes to a temp file first and only renames into place once the full
    image is on disk, so an interrupted download never leaves a broken file.
    """
    if not url:
        return False
    tmp = dest_path + ".part"
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            r.raise_for_status()
            if not r.content:
                raise ValueError("empty response")
            with open(tmp, "wb") as f:
                f.write(r.content)
            os.replace(tmp, dest_path)
            return True
        except Exception:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
    return False


def _icon_ok(path: str) -> bool:
    """A locally cached icon counts only if it exists and is non-empty."""
    return os.path.isfile(path) and os.path.getsize(path) > 0


def safe_filename(name: str) -> str:
    """Make a character name safe to use as a file/folder name."""
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip()


def scrape(icon_dir: str, progress=None):
    """Full scrape: fetch, parse, download icons.

    Returns a list of character dicts (each gains a local ``icon`` filename).
    ``progress`` is an optional callback(str) for status messages.
    """
    def log(msg):
        if progress:
            progress(msg)

    log("Fetching character list from Fandom API ...")
    html = fetch_html()
    characters = parse_characters(html)
    log(f"Parsed {len(characters)} characters. Downloading icons ...")

    os.makedirs(icon_dir, exist_ok=True)
    ok_count = 0
    failed = []
    for i, ch in enumerate(characters, 1):
        fname = safe_filename(ch["name"]) + ".png"
        dest = os.path.join(icon_dir, fname)
        # (re)download if we don't already have a valid local copy
        if not _icon_ok(dest):
            download_icon(ch["icon_url"], dest)
        # only point the UI at the local file if it really exists; otherwise
        # leave only icon_url so the app can still fall back to the network.
        if _icon_ok(dest):
            ch["icon"] = fname
            ok_count += 1
        else:
            ch["icon"] = None
            failed.append(ch["name"])
        if i % 20 == 0:
            log(f"  icons {i}/{len(characters)}")

    log(f"Done. {ok_count}/{len(characters)} icons cached locally.")
    if failed:
        log(f"  {len(failed)} icon(s) could not be downloaded: {', '.join(failed[:8])}")
    return characters


if __name__ == "__main__":
    # quick manual test
    here = os.path.dirname(os.path.abspath(__file__))
    chars = scrape(os.path.join(here, "static", "icons"))
    print(json.dumps(chars[:5], indent=2, ensure_ascii=False))
    print("total:", len(chars))
