# MODEX — Mod Index

An Emby-style, browser-based **mod manager** for character mods (3DMigoto / GIMI / ZZMI style folders).
Browse your installed character mods like a media library, switch skins on/off, view in-game hotkeys,
and manage preview images — all from a clean web UI.

> Frontend: HTML / CSS / vanilla JS · Backend: Python (Flask)

---

## English

### Features

- **Library view** — characters shown as poster cards (icon + name), scraped from the Genshin Fandom wiki.
- **Filtering** — quick filters by Quality / Element / Region, plus name search.
- **Per-model actions**
  - **Enable / Disable** a model (single active model per character; the rest are auto-disabled via the `DISABLED ` folder prefix).
  - **Hotkeys** — reads the mod's `.ini` and lists every `[Key…]` binding (key + type + number of states) in a popover.
  - **Edit previews** — add (upload or `Ctrl+V` paste), delete, and **drag to reorder** preview images/GIFs/videos. The first image is the cover.
- **Open folder** — click a character's avatar to open its mod folder in the OS file explorer.
- **Multi-game ready** — games are registered in `app.py` (`SUPPORTED_GAMES`); currently ships with **Genshin Impact**.
- **Offline-friendly** — character icons are downloaded locally on refresh, so browsing works without a connection.

### Requirements

- Python 3.10+
- Windows is recommended (the "open folder" / bring-to-front feature uses the Windows API; the rest is cross-platform).

### Installation

```bash
pip install -r requirements.txt
```

### Run

```bash
python app.py
```

Then open <http://127.0.0.1:8811> in your browser. (Port is set in `app.py`.)

### First-time setup (tutorial)

1. Click the **⚙️ gear** (top-right) to open **Settings → Game Libraries**.
2. Turn on **Genshin Impact**, paste your **Mods folder** path (e.g. `G:\Game Mod\GIMI\Mods`), then click **Save**.
3. Click **Update character data** (first run downloads ~116 character icons).
4. Click **Generate character folders** to create one folder per character inside your Mods folder.
5. Put each model into its own subfolder under the character folder, and drop preview files in it
   (`preview.png`, `preview1.jpg`, a `.gif`, an `.mp4`, …).
6. Back in the sidebar, open the game → click a character → manage its models
   (enable/disable, view hotkeys, edit & reorder previews, open folder).

### Mods folder structure

```
<Mods folder>/
└─ <English character name>/        ← created by "Generate character folders"
   └─ <model name>/                 ← one folder = one model = one card
      ├─ preview.png                ← previews: jpg / png / webp / gif / mp4 / webm …
      ├─ preview1.jpg
      ├─ <model>.ini                ← 3DMigoto mod ini (hotkeys are read from here)
      └─ … (mod buffers / textures)
```

Disabling a model renames its folder with a `DISABLED ` prefix (3DMigoto convention).
Preview order is stored in a small `.modex_order.json` inside each model folder.

### Notes

- Runtime data (`data/`) and downloaded icons (`static/icons/`) are git-ignored; they are recreated at runtime.
- To add another game, register a scraper and its filter facets in `SUPPORTED_GAMES` in `app.py`.

---

## 中文

Emby 風格、瀏覽器操作的**遊戲角色 Mod 管理器**(對應 3DMigoto / GIMI / ZZMI 的資料夾結構)。
像媒體庫一樣瀏覽已安裝的角色模組、切換造型開關、查看遊戲內快捷鍵、管理預覽圖 —— 全在乾淨的網頁介面完成。

> 前端:HTML / CSS / 原生 JS · 後端:Python(Flask)

### 功能

- **圖庫瀏覽** — 角色以海報卡片(頭像 + 名稱)呈現,資料爬自 Genshin Fandom wiki。
- **檢索** — 依 稀有度 / 元素 / 地區 快速篩選,並可用名稱搜尋。
- **每個模型的操作**
  - **啟用 / 停用** — 同一角色只會有一個生效,其餘自動以 `DISABLED ` 前綴停用。
  - **快捷鍵** — 讀取模型的 `.ini`,以懸浮視窗列出每個 `[Key…]`(按鍵 + 類型 + 段數)。
  - **編輯預覽** — 新增(上傳或 `Ctrl+V` 貼上)、刪除、**拖曳調整順序**,第一張為封面。
- **開啟資料夾** — 點角色頭像即以系統檔案總管開啟其 mod 資料夾。
- **多遊戲架構** — 遊戲註冊在 `app.py` 的 `SUPPORTED_GAMES`,目前內建 **原神(Genshin Impact)**。
- **離線可用** — 角色頭像在更新時下載到本機,之後離線也能瀏覽。

### 環境需求

- Python 3.10 以上
- 建議 Windows(「開啟資料夾 / 帶到最前」使用 Windows API;其餘為跨平台)。

### 安裝

```bash
pip install -r requirements.txt
```

### 執行

```bash
python app.py
```

接著用瀏覽器開啟 <http://127.0.0.1:8811>(連接埠在 `app.py` 設定)。

### 第一次設定(教學)

1. 點右上角 **⚙️ 齒輪** 進入 **設定 → 遊戲庫**。
2. 開啟 **原神**,貼上你的 **Mods 資料夾**路徑(例如 `G:\Game Mod\GIMI\Mods`),按 **保存**。
3. 按 **更新角色資料**(第一次會下載約 116 個角色頭像)。
4. 按 **產生角色資料夾**,在 Mods 資料夾下為每位角色建立資料夾。
5. 把每個模型各放進角色資料夾下的一個子資料夾,並放入預覽檔
   (`preview.png`、`preview1.jpg`、`.gif`、`.mp4`…)。
6. 回到左側遊戲庫 → 開啟遊戲 → 點角色 → 管理其模型
   (啟用/停用、查看快捷鍵、編輯與排序預覽、開啟資料夾)。

### Mods 資料夾結構

```
<Mods 資料夾>/
└─ <英文角色名>/                      ← 由「產生角色資料夾」建立
   └─ <模型名稱>/                     ← 一個資料夾 = 一個模型 = 一張卡片
      ├─ preview.png                  ← 預覽:jpg / png / webp / gif / mp4 / webm …
      ├─ preview1.jpg
      ├─ <model>.ini                  ← 3DMigoto 的 ini(快捷鍵由此讀取)
      └─ …(模型 buffer / 貼圖)
```

停用模型時會將其資料夾加上 `DISABLED ` 前綴(3DMigoto 慣例)。
預覽順序記錄在每個模型資料夾內的 `.modex_order.json`。

### 備註

- 執行期資料(`data/`)與下載的頭像(`static/icons/`)已被 git 忽略,會在執行時自動重建。
- 要新增其他遊戲,只要在 `app.py` 的 `SUPPORTED_GAMES` 註冊一個 scraper 與其篩選欄位即可。
