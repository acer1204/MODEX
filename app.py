"""MODEX — Mod Index (Flask backend).

Multi-game architecture:
  * SUPPORTED_GAMES is a registry of games we know how to scrape.
  * Each game has per-user config (enabled + mods_folder) stored in config.json.
  * Enabled games show up as libraries in the sidebar.

Run:  python app.py   ->  http://127.0.0.1:8811
"""

import os
import json
import mimetypes

from flask import (
    Flask,
    jsonify,
    request,
    render_template,
    send_from_directory,
    send_file,
    abort,
)

import scraper

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
ICON_ROOT = os.path.join(HERE, "static", "icons")
OUTFIT_ROOT = os.path.join(HERE, "static", "outfits")
LOCALES_DIR = os.path.join(HERE, "locales")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
DEFAULT_LANG = "en"
OFFICIAL = "Official"   # default outfit name / its subfolder

PREVIEW_EXT = {
    "image": {".png", ".jpg", ".jpeg", ".webp", ".bmp"},
    "gif": {".gif"},
    "video": {".mp4", ".webm", ".mov", ".m4v"},
}

# --------------------------------------------------------------------------- #
#  Supported games registry
#  Add a new game by registering a scraper(icon_dir)->[{name,icon,...facets}]
#  plus the facet metadata used to build the filter bar.
# --------------------------------------------------------------------------- #
SUPPORTED_GAMES = {
    "genshin": {
        "id": "genshin",
        "name": "Genshin Impact",
        "name_zh": "原神",
        "icon": "⚔️",
        "source": "Fandom Wiki",
        "facets": [
            {"key": "quality", "label": "稀有度", "kind": "stars", "badge": True},
            {"key": "element", "label": "元素", "kind": "tag"},
            {"key": "region", "label": "地區", "kind": "tag"},
        ],
        "scraper": scraper.scrape,
        "outfit_scraper": scraper.scrape_outfits,
    },
    "zzz": {
        "id": "zzz",
        "name": "Zenless Zone Zero",
        "name_zh": "絕區零",
        "icon": "🌀",
        "source": "Fandom Wiki",
        "facets": [
            {"key": "rank", "label": "Rank", "kind": "badge", "badge": True},
            {"key": "attribute", "label": "Attribute", "kind": "tag"},
            {"key": "faction", "label": "Faction", "kind": "tag"},
        ],
        "scraper": scraper.scrape_zzz,
        "outfit_scraper": scraper.scrape_zzz_outfits,
    },
    "hsr": {
        "id": "hsr",
        "name": "Honkai: Star Rail",
        "name_zh": "崩壞:星穹鐵道",
        "icon": "🚂",
        "source": "Fandom Wiki",
        "facets": [
            {"key": "rarity", "label": "Rarity", "kind": "stars", "badge": True},
            {"key": "element", "label": "Element", "kind": "tag"},
            {"key": "path", "label": "Path", "kind": "tag"},
        ],
        "scraper": scraper.scrape_hsr,
        "outfit_scraper": scraper.scrape_hsr_outfits,
    },
}

app = Flask(__name__)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ICON_ROOT, exist_ok=True)
os.makedirs(OUTFIT_ROOT, exist_ok=True)


# --------------------------------------------------------------------------- #
#  json helpers
# --------------------------------------------------------------------------- #
def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_config():
    cfg = load_json(CONFIG_FILE, {})
    cfg.setdefault("games", {})
    cfg.setdefault("language", DEFAULT_LANG)
    return cfg


def available_locales():
    """Scan the locales/ folder and return [{code, name}]."""
    out = []
    if os.path.isdir(LOCALES_DIR):
        for f in sorted(os.listdir(LOCALES_DIR)):
            if f.endswith(".json"):
                data = load_json(os.path.join(LOCALES_DIR, f), {})
                code = data.get("code") or os.path.splitext(f)[0]
                out.append({"code": code, "name": data.get("name", code)})
    # keep English first
    out.sort(key=lambda x: (x["code"] != "en", x["code"]))
    return out


def game_cfg(cfg, gid):
    return cfg["games"].get(gid, {"enabled": False, "mods_folder": ""})


def characters_path(gid):
    return os.path.join(DATA_DIR, f"characters_{gid}.json")


def outfits_path(gid):
    return os.path.join(DATA_DIR, f"outfits_{gid}.json")


def icon_dir(gid):
    return os.path.join(ICON_ROOT, gid)


def outfit_img_dir(gid):
    return os.path.join(OUTFIT_ROOT, gid)


def media_kind(filename):
    ext = os.path.splitext(filename)[1].lower()
    for kind, exts in PREVIEW_EXT.items():
        if ext in exts:
            return kind
    return None


def require_game(gid):
    if gid not in SUPPORTED_GAMES:
        abort(404, description="未知的遊戲")
    return SUPPORTED_GAMES[gid]


def public_game(gid, cfg=None):
    """Game info merged with the user's config — safe to send to the client."""
    cfg = cfg or get_config()
    g = SUPPORTED_GAMES[gid]
    gc = game_cfg(cfg, gid)
    folder = gc.get("mods_folder", "")
    chars = load_json(characters_path(gid), [])
    return {
        "id": g["id"],
        "name": g["name"],
        "name_zh": g["name_zh"],
        "icon": g["icon"],
        "source": g["source"],
        "facets": g["facets"],
        "enabled": bool(gc.get("enabled")),
        "mods_folder": folder,
        "mods_exists": bool(folder) and os.path.isdir(folder),
        "char_count": len(chars),
    }


def _safe_join(base, *parts):
    target = os.path.abspath(os.path.join(base, *parts))
    base_abs = os.path.abspath(base)
    if os.path.commonpath([base_abs, target]) != base_abs:
        abort(403)
    return target


# --------------------------------------------------------------------------- #
#  model enable / disable  (3DMigoto "DISABLED " folder-name convention)
# --------------------------------------------------------------------------- #
import re

DISABLED_PREFIX = "DISABLED "
ORDER_FILE = ".modex_order.json"   # stores the preview display order (first = cover)


def strip_disabled(name: str) -> str:
    return name[len(DISABLED_PREFIX):] if name.startswith(DISABLED_PREFIX) else name


def is_enabled(name: str) -> bool:
    return not name.startswith(DISABLED_PREFIX)


def _list_media(model_path: str):
    return [f for f in os.listdir(model_path)
            if os.path.isfile(os.path.join(model_path, f)) and media_kind(f)]


def _apply_order(model_path: str, files):
    """Order media files by the saved order; unlisted files go to the end."""
    saved = []
    op = os.path.join(model_path, ORDER_FILE)
    if os.path.isfile(op):
        try:
            with open(op, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
            if not isinstance(saved, list):
                saved = []
        except Exception:
            saved = []
    fileset = set(files)
    ordered = [f for f in saved if f in fileset]
    rest = sorted([f for f in files if f not in set(ordered)], key=str.lower)
    return ordered + rest


def _previews_of(model_path: str):
    return [{"file": f, "kind": media_kind(f)} for f in _apply_order(model_path, _list_media(model_path))]


def count_models(model_dir: str, exclude=None):
    """Count model subfolders in a directory (excluding given names)."""
    if not os.path.isdir(model_dir):
        return 0
    exclude = {e.lower() for e in (exclude or set())}
    n = 0
    for entry in os.listdir(model_dir):
        if os.path.isdir(os.path.join(model_dir, entry)) and strip_disabled(entry).lower() not in exclude:
            n += 1
    return n


def list_models(char_dir: str, exclude=None):
    """Return the model folders under a directory with display info.
    ``exclude`` = set of folder names to skip (e.g. outfit subfolders)."""
    exclude = {e.lower() for e in (exclude or set())}
    models = []
    for entry in sorted(os.listdir(char_dir), key=lambda n: strip_disabled(n).lower()):
        model_path = os.path.join(char_dir, entry)
        if not os.path.isdir(model_path):
            continue
        if strip_disabled(entry).lower() in exclude:
            continue
        previews = _previews_of(model_path)
        models.append(
            {
                "folder": entry,               # real name on disk (for API ops)
                "name": strip_disabled(entry), # display name (no DISABLED prefix)
                "enabled": is_enabled(entry),
                "preview_count": len(previews),
                "previews": previews,
            }
        )
    # enabled model first
    models.sort(key=lambda m: (not m["enabled"], m["name"].lower()))
    return models


# --------------------------------------------------------------------------- #
#  hotkey parsing from the mod's .ini
# --------------------------------------------------------------------------- #
def _format_key(raw: str):
    if not raw:
        return None
    mod_map = {"ctrl": "Ctrl", "control": "Ctrl", "alt": "Alt", "shift": "Shift"}
    mods, keys = [], []
    for tok in raw.split():
        low = tok.lower()
        if low == "no_modifiers":
            continue
        if low in mod_map:
            mods.append(mod_map[low])
        else:
            keys.append(tok.upper() if len(tok) == 1 else tok)
    out = " + ".join(mods + keys)
    return out or raw


def find_main_ini(model_path: str):
    """The mod's active .ini = a .ini whose filename has no DISABLED prefix.
    Prefer one that actually declares [Key...] hotkeys."""
    candidates = []
    for root, _dirs, files in os.walk(model_path):
        for f in files:
            if f.lower().endswith(".ini") and not f.upper().startswith("DISABLED"):
                candidates.append(os.path.join(root, f))
    if not candidates:
        return None
    for p in candidates:
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as fh:
                low = fh.read().lower()
                if re.search(r"^\s*\[key", low, re.M):
                    return p
        except Exception:
            pass
    return candidates[0]


def parse_hotkeys(ini_path: str):
    """Scan every [Key...] section (the reliable source of a hotkey).

    For each section return {name, key, type, states}:
      * key    -> the bound hotkey (e.g. "Y", "Alt + 6", "/")
      * type   -> cycle / toggle / hold / activate ...
      * states -> number of cycle values if it cycles a $var = a,b,c list
      * name   -> the cycled variable name if any, else the section name
                  with its leading "Key" stripped (e.g. KeyHelp -> Help)
    Sections without a `key =` line are skipped (not a hotkey).
    """
    try:
        with open(ini_path, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.read().splitlines()
    except Exception:
        return []

    sections, cur = [], None
    for raw in lines:
        line = raw.strip()
        if line.startswith("[") and line.endswith("]"):
            if cur is not None:
                sections.append(cur)
            name = line[1:-1]
            cur = {"section": name, "key": None, "type": None, "var": None, "states": None} \
                if name.lower().startswith("key") else None
            continue
        if cur is None or not line or line.startswith(";"):
            continue
        mk = re.match(r"key\s*=\s*(.+)", line, re.I)
        if mk:
            cur["key"] = mk.group(1).strip()
            continue
        mt = re.match(r"type\s*=\s*(\w+)", line, re.I)
        if mt:
            cur["type"] = mt.group(1).lower()
            continue
        mv = re.match(r"\$(\w+)\s*=\s*([0-9][0-9,\s]*)$", line)
        if mv:
            vals = [v for v in re.split(r"\s*,\s*", mv.group(2).strip()) if v != ""]
            if cur["var"] is None and len(vals) > 1:
                cur["var"] = mv.group(1)
                cur["states"] = len(vals)
    if cur is not None:
        sections.append(cur)

    result = []
    for s in sections:
        if not s["key"]:
            continue  # no actual hotkey bound
        name = s["var"] or re.sub(r"^key[\s_-]*", "", s["section"], flags=re.I) or s["section"]
        result.append(
            {
                "name": name,
                "key": _format_key(s["key"]),
                "type": s["type"],
                "states": s["states"],
            }
        )
    return result


def sanitize_upload_name(name: str) -> str:
    name = os.path.basename(name or "")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip() or "image.png"
    return name


def unique_name(folder: str, filename: str) -> str:
    base, ext = os.path.splitext(filename)
    cand, i = filename, 1
    while os.path.exists(os.path.join(folder, cand)):
        cand = f"{base}_{i}{ext}"
        i += 1
    return cand


# --------------------------------------------------------------------------- #
#  page
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------- #
#  app-level config (language) + locale files
# --------------------------------------------------------------------------- #
@app.route("/api/app", methods=["GET", "POST"])
def api_app():
    cfg = get_config()
    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        if "language" in data:
            lang = str(data["language"])
            codes = [l["code"] for l in available_locales()]
            cfg["language"] = lang if lang in codes else DEFAULT_LANG
            save_json(CONFIG_FILE, cfg)
    return jsonify({"language": cfg.get("language", DEFAULT_LANG), "locales": available_locales()})


@app.route("/locales/<path:filename>")
def locales(filename):
    return send_from_directory(LOCALES_DIR, filename)


# --------------------------------------------------------------------------- #
#  games
# --------------------------------------------------------------------------- #
@app.route("/api/games")
def api_games():
    cfg = get_config()
    games = [public_game(gid, cfg) for gid in SUPPORTED_GAMES]
    return jsonify({"games": games})


@app.route("/api/games/<gid>/config", methods=["POST"])
def api_game_config(gid):
    require_game(gid)
    data = request.get_json(force=True, silent=True) or {}
    cfg = get_config()
    gc = game_cfg(cfg, gid)
    if "enabled" in data:
        gc["enabled"] = bool(data["enabled"])
    if "mods_folder" in data:
        gc["mods_folder"] = (data.get("mods_folder") or "").strip().strip('"')
    cfg["games"][gid] = gc
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True, "game": public_game(gid, cfg)})


@app.route("/api/games/<gid>/refresh", methods=["POST"])
def api_game_refresh(gid):
    g = require_game(gid)
    try:
        chars = g["scraper"](icon_dir(gid))
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502
    save_json(characters_path(gid), chars)
    # alternate outfits / skins (best-effort — don't fail the whole refresh)
    if g.get("outfit_scraper"):
        try:
            outfits = g["outfit_scraper"](outfit_img_dir(gid), [c["name"] for c in chars])
            save_json(outfits_path(gid), outfits)
        except Exception:
            pass
    return jsonify({"ok": True, "count": len(chars), "game": public_game(gid)})


@app.route("/api/games/<gid>/characters")
def api_game_characters(gid):
    require_game(gid)
    chars = load_json(characters_path(gid), [])
    return jsonify({"characters": chars, "count": len(chars), "game": public_game(gid)})


@app.route("/api/games/<gid>/mod-counts")
def api_game_mod_counts(gid):
    """Total mod (model folder) count per character, summed across all outfits."""
    require_game(gid)
    folder = _mods_folder(gid)
    if not folder or not os.path.isdir(folder):
        return jsonify({"ok": True, "counts": {}})

    chars = load_json(characters_path(gid), [])
    all_outfits = load_json(outfits_path(gid), {})
    counts = {}
    for ch in chars:
        name = ch.get("name", "")
        char_dir = _safe_join(folder, scraper.safe_filename(name))
        if not os.path.isdir(char_dir):
            continue
        skins = [o["folder"] for o in all_outfits.get(name, []) if o.get("folder") != OFFICIAL]
        # official = Official/ subfolder, or the char root (excluding skin folders)
        off = os.path.join(char_dir, OFFICIAL)
        if os.path.isdir(off):
            total = count_models(off)
        else:
            total = count_models(char_dir, _skin_folders(gid, name))
        for skin in skins:
            total += count_models(_safe_join(char_dir, scraper.safe_filename(skin)))
        if total:
            counts[name] = total
    return jsonify({"ok": True, "counts": counts})


@app.route("/api/games/<gid>/generate-folders", methods=["POST"])
def api_game_generate(gid):
    require_game(gid)
    cfg = get_config()
    gc = game_cfg(cfg, gid)
    folder = gc.get("mods_folder", "")
    if not folder:
        return jsonify({"ok": False, "error": "尚未設定 Mods 資料夾"}), 400
    if not os.path.isdir(folder):
        return jsonify({"ok": False, "error": f"資料夾不存在：{folder}"}), 400

    chars = load_json(characters_path(gid), [])
    if not chars:
        return jsonify({"ok": False, "error": "尚未爬取角色資料，請先更新"}), 400

    all_outfits = load_json(outfits_path(gid), {})
    created = skipped = 0

    def make(path):
        nonlocal created, skipped
        if os.path.isdir(path):
            skipped += 1
        else:
            try:
                os.makedirs(path, exist_ok=True)
                created += 1
            except Exception:
                skipped += 1

    for ch in chars:
        char_dir = os.path.join(folder, scraper.safe_filename(ch["name"]))
        make(char_dir)
        # for characters with alternate outfits, also create each outfit
        # subfolder (Official + each skin) so mods can be dropped straight in.
        outfits = all_outfits.get(ch["name"], [])
        if len(outfits) > 1:
            for o in outfits:
                make(os.path.join(char_dir, scraper.safe_filename(o.get("folder", ""))))

    return jsonify({"ok": True, "created_count": created, "skipped_count": skipped})


def _mods_folder(gid):
    return game_cfg(get_config(), gid).get("mods_folder", "")


def _resolve_char_dir(gid, character):
    """Return (char_dir, error_response). error_response is None on success."""
    folder = _mods_folder(gid)
    if not folder or not os.path.isdir(folder):
        return None, (jsonify({"ok": False, "error": "Mods 資料夾未設定或不存在"}), 400)
    char_dir = _safe_join(folder, scraper.safe_filename(character))
    return char_dir, None


def _skin_folders(gid, character):
    """Lowercased set of a character's skin folder names + 'official'."""
    names = {OFFICIAL.lower()}
    for s in load_json(outfits_path(gid), {}).get(character, []):
        names.add(str(s.get("folder", "")).lower())
        names.add(str(s.get("name", "")).lower())
    return {n for n in names if n}


def _resolve_outfit_dir(gid, character, outfit):
    """Return (outfit_dir, exclude_set, error_response).

    Outfit folder layout (chosen): <char>/Official/<models> and
    <char>/<SkinName>/<models>. For backward compatibility, the Official
    outfit falls back to model folders directly under <char> (excluding any
    skin subfolders) when no Official/ subfolder exists.
    """
    char_dir, err = _resolve_char_dir(gid, character)
    if err:
        return None, None, err
    outfit = outfit or OFFICIAL
    if outfit == OFFICIAL:
        off = _safe_join(char_dir, OFFICIAL)
        if os.path.isdir(off):
            return off, set(), None
        return char_dir, _skin_folders(gid, character), None
    return _safe_join(char_dir, scraper.safe_filename(outfit)), set(), None


@app.route("/api/games/<gid>/models")
def api_game_models(gid):
    require_game(gid)
    character = request.args.get("character", "")
    outfit = request.args.get("outfit", OFFICIAL)
    char_dir, err = _resolve_char_dir(gid, character)
    if err:
        return err
    if not os.path.isdir(char_dir):
        return jsonify({"ok": True, "models": [], "char_dir_exists": False})
    odir, exclude, err2 = _resolve_outfit_dir(gid, character, outfit)
    if err2:
        return err2
    if not os.path.isdir(odir):
        return jsonify({"ok": True, "models": [], "char_dir_exists": True})
    return jsonify({"ok": True, "models": list_models(odir, exclude), "char_dir_exists": True})


@app.route("/api/games/<gid>/model/toggle", methods=["POST"])
def api_model_toggle(gid):
    require_game(gid)
    data = request.get_json(force=True, silent=True) or {}
    character = data.get("character", "")
    outfit = data.get("outfit", OFFICIAL)
    folder = data.get("folder", "")
    enable = bool(data.get("enable"))

    odir, exclude, err = _resolve_outfit_dir(gid, character, outfit)
    if err:
        return err
    if not os.path.isdir(odir):
        return jsonify({"ok": False, "error": "角色資料夾不存在"}), 404

    exc_l = {e.lower() for e in exclude}
    target_base = strip_disabled(folder)
    for entry in os.listdir(odir):
        path = os.path.join(odir, entry)
        if not os.path.isdir(path):
            continue
        ebase = strip_disabled(entry)
        if ebase.lower() in exc_l:   # don't touch sibling skin folders
            continue
        if enable:
            # exactly one active: target on, every sibling off
            want_enabled = (ebase == target_base)
        else:
            # only switch the target off; leave the rest untouched
            want_enabled = is_enabled(entry) if ebase != target_base else False
        desired = ebase if want_enabled else DISABLED_PREFIX + ebase
        if desired != entry:
            dst = os.path.join(odir, desired)
            if not os.path.exists(dst):
                try:
                    os.rename(path, dst)
                except OSError as exc_e:
                    return jsonify({"ok": False, "error": f"無法重新命名「{entry}」：{exc_e}"}), 500

    return jsonify({"ok": True, "models": list_models(odir, exclude)})


@app.route("/api/games/<gid>/model/hotkeys")
def api_model_hotkeys(gid):
    require_game(gid)
    character = request.args.get("character", "")
    outfit = request.args.get("outfit", OFFICIAL)
    folder = request.args.get("folder", "")
    odir, _exc, err = _resolve_outfit_dir(gid, character, outfit)
    if err:
        return err
    model_path = _safe_join(odir, folder)
    if not os.path.isdir(model_path):
        return jsonify({"ok": False, "error": "模型資料夾不存在"}), 404
    ini = find_main_ini(model_path)
    if not ini:
        return jsonify({"ok": True, "ini": None, "hotkeys": []})
    return jsonify(
        {
            "ok": True,
            "ini": os.path.basename(ini),
            "hotkeys": parse_hotkeys(ini),
        }
    )


@app.route("/api/games/<gid>/model/preview/delete", methods=["POST"])
def api_preview_delete(gid):
    require_game(gid)
    data = request.get_json(force=True, silent=True) or {}
    character, folder, fname = data.get("character", ""), data.get("folder", ""), data.get("file", "")
    outfit = data.get("outfit", OFFICIAL)
    odir, _exc, err = _resolve_outfit_dir(gid, character, outfit)
    if err:
        return err
    path = _safe_join(odir, folder, fname)
    if not os.path.isfile(path) or not media_kind(fname):
        return jsonify({"ok": False, "error": "檔案不存在"}), 404
    try:
        os.remove(path)
    except OSError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
    model_path = _safe_join(odir, folder)
    return jsonify({"ok": True, "previews": _previews_of(model_path)})


@app.route("/api/games/<gid>/model/preview/upload", methods=["POST"])
def api_preview_upload(gid):
    require_game(gid)
    character = request.form.get("character", "")
    folder = request.form.get("folder", "")
    outfit = request.form.get("outfit", OFFICIAL)
    odir, _exc, err = _resolve_outfit_dir(gid, character, outfit)
    if err:
        return err
    if not folder:
        return jsonify({"ok": False, "error": "缺少模型資料夾"}), 400
    model_path = _safe_join(odir, folder)
    if not os.path.isdir(model_path) or os.path.abspath(model_path) == os.path.abspath(odir):
        return jsonify({"ok": False, "error": "模型資料夾不存在"}), 404

    files = request.files.getlist("file")
    if not files:
        return jsonify({"ok": False, "error": "沒有收到檔案"}), 400

    saved = []
    for fs in files:
        name = sanitize_upload_name(fs.filename)
        if not media_kind(name):
            continue  # skip non-media
        name = unique_name(model_path, name)
        fs.save(os.path.join(model_path, name))
        saved.append(name)
    if not saved:
        return jsonify({"ok": False, "error": "不支援的檔案格式"}), 400
    return jsonify({"ok": True, "saved": saved, "previews": _previews_of(model_path)})


@app.route("/api/games/<gid>/model/preview/reorder", methods=["POST"])
def api_preview_reorder(gid):
    require_game(gid)
    data = request.get_json(force=True, silent=True) or {}
    character, folder = data.get("character", ""), data.get("folder", "")
    outfit = data.get("outfit", OFFICIAL)
    order = data.get("order", [])
    odir, _exc, err = _resolve_outfit_dir(gid, character, outfit)
    if err:
        return err
    if not folder:
        return jsonify({"ok": False, "error": "缺少模型資料夾"}), 400
    model_path = _safe_join(odir, folder)
    if not os.path.isdir(model_path) or os.path.abspath(model_path) == os.path.abspath(odir):
        return jsonify({"ok": False, "error": "模型資料夾不存在"}), 404
    # keep only names that are real media files in this folder
    media = set(_list_media(model_path))
    clean = [f for f in order if f in media]
    try:
        with open(os.path.join(model_path, ORDER_FILE), "w", encoding="utf-8") as fh:
            json.dump(clean, fh, ensure_ascii=False, indent=2)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
    return jsonify({"ok": True, "previews": _previews_of(model_path)})


def open_in_explorer(path):
    """Open a folder in the OS file manager (this app runs locally)."""
    import sys
    import subprocess
    if os.name == "nt":
        _open_and_focus_windows(path)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def _open_and_focus_windows(path):
    """Open the folder in Explorer and pull its window to the foreground.

    A window spawned by a background process (our Flask server) normally
    opens behind the active window because of Windows' foreground lock.
    We locate the matching Explorer window and force it to the front using
    AttachThreadInput + a topmost flicker.

    NOTE: ctypes argtypes/restype MUST be declared — window/thread handles
    are pointer-sized and get corrupted if left as the default c_int.
    """
    import ctypes
    import time
    from ctypes import wintypes

    u = ctypes.windll.user32
    k = ctypes.windll.kernel32

    u.GetForegroundWindow.restype = wintypes.HWND
    u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    u.GetWindowThreadProcessId.restype = wintypes.DWORD
    u.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    u.SetForegroundWindow.argtypes = [wintypes.HWND]
    u.BringWindowToTop.argtypes = [wintypes.HWND]
    u.SetActiveWindow.argtypes = [wintypes.HWND]
    u.IsIconic.argtypes = [wintypes.HWND]
    u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    u.IsWindowVisible.argtypes = [wintypes.HWND]
    u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int,
                               ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
    u.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

    os.startfile(path)  # noqa: only exists on Windows

    target = os.path.basename(os.path.normpath(path)).lower()
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def find():
        hits = []

        def cb(hwnd, _lparam):
            if not u.IsWindowVisible(hwnd):
                return True
            cls = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(hwnd, cls, 256)
            if cls.value in ("CabinetWClass", "ExploreWClass"):
                txt = ctypes.create_unicode_buffer(512)
                u.GetWindowTextW(hwnd, txt, 512)
                # Explorer titles the window e.g. "Zibai - File Explorer";
                # the folder name is a prefix, so match by "contains".
                if target in txt.value.lower():
                    hits.append(hwnd)
            return True

        u.EnumWindows(EnumWindowsProc(cb), 0)
        return hits[-1] if hits else None

    hwnd = None
    for _ in range(30):  # poll up to ~3s for the window to appear
        hwnd = find()
        if hwnd:
            break
        time.sleep(0.1)
    if not hwnd:
        return

    SW_RESTORE, SW_SHOW = 9, 5
    SWP_NOSIZE, SWP_NOMOVE, SWP_SHOWWINDOW = 0x0001, 0x0002, 0x0040
    HWND_TOPMOST = wintypes.HWND(-1)
    HWND_NOTOPMOST = wintypes.HWND(-2)
    try:
        if u.IsIconic(hwnd):
            u.ShowWindow(hwnd, SW_RESTORE)
        else:
            u.ShowWindow(hwnd, SW_SHOW)
        # ALT key tap resets the foreground lock so SetForegroundWindow is honoured
        u.keybd_event(0x12, 0, 0, 0)
        u.keybd_event(0x12, 0, 0x0002, 0)
        # topmost flicker raises the window's Z-order to the very top (this
        # works even when we can't grab keyboard focus), then drop always-on-top
        u.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
        u.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
        u.BringWindowToTop(hwnd)
        u.SetForegroundWindow(hwnd)
        u.SetActiveWindow(hwnd)
    except Exception:
        pass


@app.route("/api/games/<gid>/open-folder", methods=["POST"])
def api_open_folder(gid):
    require_game(gid)
    data = request.get_json(force=True, silent=True) or {}
    character = data.get("character", "")
    outfit = data.get("outfit", OFFICIAL)
    odir, _exc, err = _resolve_outfit_dir(gid, character, outfit)
    if err:
        return err
    if not os.path.isdir(odir):
        return jsonify({"ok": False, "error": "資料夾不存在，請先建立該外觀的資料夾"}), 404
    try:
        open_in_explorer(odir)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
    return jsonify({"ok": True, "path": odir})


@app.route("/api/games/<gid>/media")
def api_game_media(gid):
    require_game(gid)
    character = request.args.get("character", "")
    outfit = request.args.get("outfit", OFFICIAL)
    model = request.args.get("model", "")
    fname = request.args.get("file", "")
    odir, _exc, err = _resolve_outfit_dir(gid, character, outfit)
    if err or not odir or not os.path.isdir(odir):
        abort(404)
    path = _safe_join(odir, model, fname)
    if not os.path.isfile(path):
        abort(404)
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return send_file(path, mimetype=mime, conditional=True)


@app.route("/icons/<gid>/<path:filename>")
def icons(gid, filename):
    require_game(gid)
    return send_from_directory(icon_dir(gid), filename)


@app.route("/outfits/<gid>/<path:filename>")
def outfit_images(gid, filename):
    require_game(gid)
    return send_from_directory(outfit_img_dir(gid), filename)


@app.route("/api/games/<gid>/outfits")
def api_game_outfits(gid):
    """Return the outfits (Official + alternate skins) for a character.

    The stored list already includes an "Official" entry (with wish art) for
    characters that have alternate outfits. Characters without skins fall back
    to a single Official entry using the character icon.
    """
    require_game(gid)
    character = request.args.get("character", "")
    stored = load_json(outfits_path(gid), {}).get(character, [])

    chars = load_json(characters_path(gid), [])
    ch = next((c for c in chars if c.get("name") == character), None)
    icon_img = (f"/icons/{gid}/{ch['icon']}" if ch and ch.get("icon")
                else (ch.get("icon_url") if ch else None))

    def img_of(s):
        if s.get("image"):
            return f"/outfits/{gid}/{s['image']}"
        # official falls back to the character icon when no wish art was found
        return s.get("image_url") or (icon_img if s.get("folder") == OFFICIAL else None)

    if stored:
        outfits = [{"name": s["name"], "folder": s["folder"], "type": s.get("type"),
                    "image_url": img_of(s)} for s in stored]
        return jsonify({"ok": True, "outfits": outfits, "has_skins": len(stored) > 1})

    # no outfit data yet — single Official entry using the character icon
    return jsonify({
        "ok": True,
        "outfits": [{"name": OFFICIAL, "folder": OFFICIAL, "type": "Default", "image_url": icon_img}],
        "has_skins": False,
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8811, debug=True)
