// ===================== MODEX — Mod Index =====================

const ELEMENT_COLORS = {
  Pyro: "var(--Pyro)", Hydro: "var(--Hydro)", Cryo: "var(--Cryo)",
  Electro: "var(--Electro)", Anemo: "var(--Anemo)", Geo: "var(--Geo)",
  Dendro: "var(--Dendro)", None: "var(--None)",
};

const state = {
  games: [],            // all supported games (with config merged)
  view: "home",         // home | library | settings
  gameId: null,         // active library game id
  characters: [],
  facets: [],           // active game's facet metadata
  filters: {},          // { facetKey: Set(values) }
  search: "",
  edit: null,           // { gid, character, folder } when in edit view
};

// ---------- dom helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function gameById(id) { return state.games.find((g) => g.id === id); }

// ---------- in-app navigation history (back / forward) ----------
const navHist = { stack: [], idx: -1 };
let navLock = false; // true while applying a back/forward step (suppress push)

// per-game filter/search state, preserved across navigation
const filterCache = {};   // gid -> { filters: {key:[...]}, search }
function persistFilters() {
  if (!state.gameId) return;
  const f = {};
  for (const k in state.filters) f[k] = [...state.filters[k]];
  filterCache[state.gameId] = { filters: f, search: state.search };
}
function restoreFilters(gid) {
  const saved = filterCache[gid];
  state.filters = {};
  state.facets.forEach((fa) => (state.filters[fa.key] = new Set(saved?.filters?.[fa.key] || [])));
  state.search = saved?.search || "";
}

function pushRoute(route) {
  if (navLock) return;
  const cur = navHist.stack[navHist.idx];
  if (cur && cur.view === route.view && cur.gameId === route.gameId &&
      cur.character === route.character && cur.folder === route.folder) return; // no dup
  navHist.stack = navHist.stack.slice(0, navHist.idx + 1); // drop forward entries
  navHist.stack.push(route);
  navHist.idx = navHist.stack.length - 1;
  updateNavButtons();
}
function applyRoute(route) {
  navLock = true;
  if (route.view === "home") showHome();
  else if (route.view === "settings") showSettings();
  else if (route.view === "library") openLibrary(route.gameId);
  else if (route.view === "character") openCharacter(route.gameId, route.character);
  else if (route.view === "edit") openEditModel(route.gameId, route.character, route.folder);
  navLock = false;
}
function navBack() {
  if (navHist.idx > 0) { navHist.idx--; applyRoute(navHist.stack[navHist.idx]); updateNavButtons(); }
}
function navFwd() {
  if (navHist.idx < navHist.stack.length - 1) { navHist.idx++; applyRoute(navHist.stack[navHist.idx]); updateNavButtons(); }
}
function updateNavButtons() {
  const back = $("#navBack"), fwd = $("#navFwd");
  if (back) back.disabled = navHist.idx <= 0;
  if (fwd) fwd.disabled = navHist.idx >= navHist.stack.length - 1;
}

let toastTimer = null;
function toast(msg, type = "info", ms = 3000) {
  const t = $("#toast");
  t.textContent = msg; t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ===================== init =====================
async function init() {
  wireChrome();
  await loadGames();
  showHome();
}

function wireChrome() {
  const toggle = () => $("#app").classList.toggle("collapsed");
  $("#hamburger").addEventListener("click", toggle);
  $("#hamburger2").addEventListener("click", toggle);
  $("#nav-home").addEventListener("click", showHome);
  $("#btnSettings").addEventListener("click", showSettings);
  $("#sideOpenSettings").addEventListener("click", showSettings);
  $("#btnBell").addEventListener("click", () => toast("目前沒有通知", "info"));
  $("#navBack").addEventListener("click", navBack);
  $("#navFwd").addEventListener("click", navFwd);
  $("#globalSearch").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    if (state.view === "library") { persistFilters(); renderGrid(); }
  });
  // Esc returns from a character / edit page
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (state.view === "character" || state.view === "edit")) navBack(); });
  // Ctrl+V paste images while editing
  document.addEventListener("paste", onPaste);
  // close filter dropdowns on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".fdrop")) $$(".fdrop .menu").forEach((m) => m.classList.add("hidden"));
  });
}

async function loadGames() {
  try {
    const data = await api("/api/games");
    state.games = data.games;
  } catch (_) { state.games = []; }
  renderSidebar();
}

// ===================== sidebar =====================
function renderSidebar() {
  const nav = $("#gameNav");
  nav.innerHTML = "";
  const enabled = state.games.filter((g) => g.enabled);
  $("#sideEmpty").classList.toggle("hidden", enabled.length > 0);

  enabled.forEach((g) => {
    const item = el("a", "nav-item");
    item.dataset.game = g.id;
    item.innerHTML = `<span class="nav-ico">${g.icon || "🎮"}</span>
      <span class="nav-label">${g.name_zh || g.name}</span>`;
    item.addEventListener("click", () => openLibrary(g.id));
    nav.appendChild(item);
  });
  highlightNav();
}

function highlightNav() {
  $("#nav-home").classList.toggle("active", state.view === "home");
  const inGame = ["library", "character", "edit"].includes(state.view);
  $$("#gameNav .nav-item").forEach((it) =>
    it.classList.toggle("active", inGame && it.dataset.game === state.gameId));
  // hide the main sidebar entirely while in Settings
  $("#app").classList.toggle("settings-mode", state.view === "settings");
}

function setCrumb(title) { $("#crumbTitle").textContent = title; }

// ===================== HOME view =====================
function showHome() {
  pushRoute({ view: "home", gameId: null });
  state.view = "home";
  setCrumb("首頁");
  $("#filterbar").classList.add("hidden");
  highlightNav();
  const c = $("#content");

  const enabled = state.games.filter((g) => g.enabled);
  if (!enabled.length) {
    c.innerHTML = `<div class="empty-state">
      <div class="big">🎮</div>
      <p>還沒有啟用任何遊戲庫。</p>
      <p>點右上角 <b>⚙️ 設定</b>，勾選遊戲並設定 Mods 資料夾後保存。</p>
      <button class="btn btn-primary" id="homeSettings">前往設定</button>
    </div>`;
    $("#homeSettings").addEventListener("click", showSettings);
    return;
  }
  c.innerHTML = `<div class="section-head"><h2>遊戲庫</h2>
    <span class="count">${enabled.length} 個</span></div>
    <div class="poster-grid" id="homeGrid"></div>`;
  const grid = $("#homeGrid");
  enabled.forEach((g) => {
    const card = el("div", "poster");
    card.innerHTML = `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:60px;">${g.icon || "🎮"}</div>
      <div class="p-title">${g.name_zh || g.name}</div>
      <div class="p-sub">${g.char_count} 位角色</div>`;
    card.addEventListener("click", () => openLibrary(g.id));
    grid.appendChild(card);
  });
}

// ===================== LIBRARY view =====================
async function openLibrary(gid) {
  const g = gameById(gid);
  if (!g) return;
  pushRoute({ view: "library", gameId: gid });
  state.view = "library";
  state.gameId = gid;
  state.facets = g.facets || [];
  restoreFilters(gid);                  // keep prior search/filter conditions
  $("#globalSearch").value = state.search;
  setCrumb(g.name_zh || g.name);
  highlightNav();

  const c = $("#content");
  c.innerHTML = `<div class="empty-state">載入中…</div>`;
  $("#filterbar").classList.add("hidden");

  try {
    const data = await api(`/api/games/${gid}/characters`);
    state.characters = data.characters;
  } catch (e) {
    c.innerHTML = `<div class="empty-state">❌ ${e.message}</div>`;
    return;
  }

  if (!state.characters.length) {
    c.innerHTML = `<div class="empty-state">
      <div class="big">📥</div>
      <p>「${g.name_zh || g.name}」尚未爬取角色資料。</p>
      <button class="btn btn-primary" id="libRefresh">更新角色資料</button>
    </div>`;
    $("#libRefresh").addEventListener("click", () => refreshGame(gid, true));
    return;
  }

  buildFilterBar();
  c.innerHTML = `<div class="section-head"><span class="badge">📺</span>
      <h2>角色</h2><span class="count" id="charCount"></span></div>
    <div class="poster-grid char" id="charGrid"></div>`;
  renderGrid();
}

function buildFilterBar() {
  const bar = $("#filterbar");
  bar.innerHTML = "";
  bar.classList.remove("hidden");

  state.facets.forEach((f) => {
    let values = [...new Set(state.characters.map((ch) => ch[f.key]).filter((v) => v != null))];
    values.sort((a, b) => (f.kind === "stars" ? b - a : String(a).localeCompare(String(b))));

    const activeSet = state.filters[f.key] || new Set();
    const drop = el("div", "fdrop");
    const btn = el("button", activeSet.size ? "has-active" : "", `${f.label} <span class="caret">▾</span>`);
    const menu = el("div", "menu hidden");

    values.forEach((v) => {
      const opt = el("label", "fopt");
      const cb = el("input"); cb.type = "checkbox"; cb.value = v;
      cb.checked = activeSet.has(String(v));   // reflect preserved state
      cb.addEventListener("change", () => {
        const set = state.filters[f.key];
        cb.checked ? set.add(String(v)) : set.delete(String(v));
        btn.classList.toggle("has-active", set.size > 0);
        persistFilters();
        renderGrid();
      });
      opt.appendChild(cb);
      if (f.key === "element") {
        const d = el("span", "dot"); d.style.background = ELEMENT_COLORS[v] || "var(--None)"; opt.appendChild(d);
      }
      const label = f.kind === "stars" ? `${v} ★` : String(v);
      opt.appendChild(el("span", "", label));
      menu.appendChild(opt);
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !menu.classList.contains("hidden");
      $$(".fdrop .menu").forEach((m) => m.classList.add("hidden"));
      menu.classList.toggle("hidden", open);
    });
    drop.appendChild(btn); drop.appendChild(menu);
    bar.appendChild(drop);
  });

  const reset = el("button", "btn filter-reset", "重設檢索");
  reset.addEventListener("click", () => {
    Object.values(state.filters).forEach((s) => s.clear());
    state.search = ""; $("#globalSearch").value = "";
    persistFilters();
    $$("#filterbar .fopt input").forEach((c) => (c.checked = false));
    $$("#filterbar .fdrop > button").forEach((b) => b.classList.remove("has-active"));
    renderGrid();
  });
  bar.appendChild(reset);
}

function matches(ch) {
  for (const f of state.facets) {
    const set = state.filters[f.key];
    if (set && set.size && !set.has(String(ch[f.key]))) return false;
  }
  if (state.search && !String(ch.name).toLowerCase().includes(state.search)) return false;
  return true;
}

function renderGrid() {
  const grid = $("#charGrid");
  if (!grid) return;
  const gid = state.gameId;
  const list = state.characters.filter(matches);
  const cc = $("#charCount");
  if (cc) cc.textContent = `${list.length} / ${state.characters.length}`;

  grid.innerHTML = "";
  list.forEach((ch) => {
    const card = el("div", `poster char q${ch.quality || 0}`);
    const iconSrc = ch.icon ? `/icons/${gid}/${encodeURIComponent(ch.icon)}` : (ch.icon_url || "");
    const dot = ELEMENT_COLORS[ch.element] || "var(--None)";
    const sub = [ch.element, ch.region].filter((x) => x && x !== "None").join(" · ");
    card.innerHTML = `
      <div class="thumb">
        ${ch.quality ? `<span class="badge-tl">${ch.quality}★</span>` : ""}
        <img loading="lazy" alt="${ch.name}" src="${iconSrc}">
      </div>
      <div class="p-title">${ch.name}</div>
      <div class="p-sub">${ch.element ? `<span class="dot" style="background:${dot}"></span>` : ""}${sub || "&nbsp;"}</div>`;
    const img = card.querySelector("img");
    if (img && ch.icon_url) img.onerror = () => { if (img.src !== ch.icon_url) img.src = ch.icon_url; };
    card.addEventListener("click", () => openCharacter(state.gameId, ch.name));
    grid.appendChild(card);
  });
}

async function refreshGame(gid, reopen) {
  toast("正在從來源爬取角色資料與圖示…", "info", 0);
  try {
    const data = await api(`/api/games/${gid}/refresh`, { method: "POST" });
    await loadGames();
    toast(`✅ 已更新 ${data.count} 位角色`, "ok");
    if (reopen) openLibrary(gid);
    else if (state.view === "settings") showSettings();
  } catch (e) {
    toast(`❌ 更新失敗：${e.message}`, "err", 6000);
  }
}

// ===================== CHARACTER detail view (models) =====================
async function openCharacter(gid, charName) {
  pushRoute({ view: "character", gameId: gid, character: charName });
  state.view = "character";

  // make sure the right game's characters are loaded (e.g. forward-nav)
  if (state.gameId !== gid || !state.characters.length) {
    const g = gameById(gid);
    state.gameId = gid;
    state.facets = g ? g.facets || [] : [];
    try {
      const data = await api(`/api/games/${gid}/characters`);
      state.characters = data.characters;
    } catch (_) {}
  }

  const g = gameById(gid);
  const ch = state.characters.find((c) => c.name === charName) || { name: charName };
  setCrumb(`${(g && (g.name_zh || g.name)) || ""} · ${charName}`);
  $("#filterbar").classList.add("hidden");
  highlightNav();

  const dot = ELEMENT_COLORS[ch.element] || "var(--None)";
  const meta = [ch.quality ? `${ch.quality}★` : "", ch.element, ch.region]
    .filter((x) => x && x !== "None").join(" · ");
  const iconSrc = ch.icon ? `/icons/${gid}/${encodeURIComponent(ch.icon)}` : (ch.icon_url || "");

  const c = $("#content");
  c.innerHTML = `
    <div class="char-detail-head">
      ${iconSrc ? `<button class="cd-icon-btn" id="cdOpenFolder" title="開啟此角色的資料夾">
        <img class="cd-icon" src="${iconSrc}" alt="${ch.name}">
        <span class="cd-icon-overlay">📂</span>
      </button>` : ""}
      <div class="cd-meta">
        <h2>${ch.name}</h2>
        <div class="cd-sub">${ch.element ? `<span class="dot" style="background:${dot}"></span>` : ""}${meta || "模型"}</div>
      </div>
    </div>
    <div class="model-list" id="modelGrid"><div class="model-empty">載入中…</div></div>`;

  const openBtn = $("#cdOpenFolder");
  if (openBtn) openBtn.addEventListener("click", () => openCharacterFolder(gid, charName));

  const box = $("#modelGrid");
  try {
    const data = await api(`/api/games/${gid}/models?character=${encodeURIComponent(charName)}`);
    if (!data.char_dir_exists) {
      box.innerHTML = `<div class="model-empty">尚未建立此角色的資料夾。<br>請到設定產生角色資料夾。</div>`; return;
    }
    if (!data.models.length) {
      box.innerHTML = `<div class="model-empty">此角色資料夾內沒有模型。<br>把每個模型各放進一個子資料夾即可顯示。</div>`; return;
    }
    box.innerHTML = "";
    data.models.forEach((m) => box.appendChild(modelCard(gid, charName, m)));
  } catch (e) {
    box.innerHTML = `<div class="model-empty">❌ ${e.message}</div>`;
  }
}

async function openCharacterFolder(gid, character) {
  try {
    const data = await api(`/api/games/${gid}/open-folder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character }),
    });
    toast(`📂 已開啟資料夾：${data.path}`, "ok", 4000);
  } catch (e) { toast(`❌ ${e.message}`, "err", 5000); }
}

function mediaUrl(gid, character, folder, file) {
  return `/api/games/${gid}/media?character=${encodeURIComponent(character)}&model=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`;
}

function modelCard(gid, character, model) {
  const card = el("div", "model-card" + (model.enabled ? " enabled" : " disabled"));
  const preview = el("div", "preview");
  const previews = model.previews || [];
  let idx = 0;
  const slot = el("div");
  slot.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;";
  const tag = el("span", "kind-tag");
  const counter = el("span", "counter");
  preview.appendChild(slot); preview.appendChild(tag); preview.appendChild(counter);

  function render() {
    slot.innerHTML = "";
    if (!previews.length) {
      slot.appendChild(el("div", "no-preview", "（無預覽）<br>按 ✏️ 編輯加入圖片 / GIF / 影片"));
      tag.textContent = ""; counter.textContent = ""; return;
    }
    const p = previews[idx];
    const src = mediaUrl(gid, character, model.folder, p.file);
    let node;
    if (p.kind === "video") {
      node = el("video"); node.src = src; node.controls = true; node.loop = true; node.muted = true; node.autoplay = true;
    } else { node = el("img"); node.src = src; node.alt = p.file; }
    slot.appendChild(node);
    tag.textContent = p.kind;
    counter.textContent = `${idx + 1} / ${previews.length}`;
  }

  if (previews.length > 1) {
    const l = el("button", "arrow left", "‹"), r = el("button", "arrow right", "›");
    l.addEventListener("click", () => { idx = (idx - 1 + previews.length) % previews.length; render(); });
    r.addEventListener("click", () => { idx = (idx + 1) % previews.length; render(); });
    preview.appendChild(l); preview.appendChild(r);
  }
  card.appendChild(preview);

  // name (fixed 2-line height so all cards align)
  const nameRow = el("div", "m-name");
  nameRow.textContent = model.name;
  nameRow.title = model.name;
  card.appendChild(nameRow);
  card.appendChild(el("div", "m-sub", `${previews.length} 個預覽`));

  // ---- 3 action buttons ----
  const actions = el("div", "model-actions");

  const tgl = el("button", `mbtn toggle ${model.enabled ? "on" : "off"}`,
    model.enabled ? "⏻ 啟用中" : "⏻ 已停用");
  tgl.title = model.enabled ? "點擊以停用" : "點擊以啟用（其餘自動停用）";
  tgl.addEventListener("click", () => toggleModel(gid, character, model));

  const keys = el("button", "mbtn keys", "⌨ 快捷鍵");
  keys.addEventListener("click", (e) => { e.stopPropagation(); showHotkeys(gid, character, model, keys); });

  const edit = el("button", "mbtn edit", "✏️ 編輯");
  edit.addEventListener("click", () => openEditModel(gid, character, model.folder));

  actions.appendChild(tgl); actions.appendChild(keys); actions.appendChild(edit);
  card.appendChild(actions);

  render();
  return card;
}

async function toggleModel(gid, character, model) {
  try {
    await api(`/api/games/${gid}/model/toggle`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, folder: model.folder, enable: !model.enabled }),
    });
    toast(model.enabled ? "已停用此模型" : "✅ 已啟用（其餘模型自動停用）", "ok");
    openCharacter(gid, character); // re-render with fresh states (no extra history)
  } catch (e) { toast(`❌ ${e.message}`, "err"); }
}

// ---------- hotkey floating popover ----------
const HK_TYPE_LABEL = { cycle: "循環", toggle: "開關", hold: "按住", activate: "觸發" };
function hotkeyStateLabel(h) {
  if (h.states) return `${h.states} 段`;
  if (h.type) return HK_TYPE_LABEL[h.type] || h.type;
  return "—";
}
let hotkeyPopover = null;
function closeHotkeyPopover() {
  if (hotkeyPopover) { hotkeyPopover.remove(); hotkeyPopover = null; }
  document.removeEventListener("click", onDocClickHK, true);
}
function onDocClickHK(e) {
  if (hotkeyPopover && !hotkeyPopover.contains(e.target) && !e.target.closest(".mbtn.keys")) closeHotkeyPopover();
}
function positionPopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  let left = r.left, top = r.bottom + 6;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  if (top + ph > window.innerHeight - 10) top = Math.max(10, r.top - ph - 6);
  pop.style.left = Math.max(10, left) + "px";
  pop.style.top = top + "px";
}
async function showHotkeys(gid, character, model, anchor) {
  if (hotkeyPopover && hotkeyPopover.dataset.folder === model.folder) { closeHotkeyPopover(); return; }
  closeHotkeyPopover();
  const pop = el("div", "hotkey-popover");
  pop.dataset.folder = model.folder;
  pop.innerHTML = `<div class="hk-head">⌨ 快捷鍵 <span class="hk-ini"></span></div>
    <div class="hk-cols"><span>項目</span><span>按鍵</span><span>段數</span></div>
    <div class="hk-body">載入中…</div>`;
  document.body.appendChild(pop);
  hotkeyPopover = pop;
  positionPopover(pop, anchor);
  try {
    const data = await api(`/api/games/${gid}/model/hotkeys?character=${encodeURIComponent(character)}&folder=${encodeURIComponent(model.folder)}`);
    pop.querySelector(".hk-ini").textContent = data.ini ? `· ${data.ini}` : "";
    const body = pop.querySelector(".hk-body");
    if (!data.hotkeys.length) {
      body.innerHTML = `<div class="hk-empty">此模型的 .ini 找不到可切換的快捷鍵</div>`;
    } else {
      body.innerHTML = "";
      data.hotkeys.forEach((h) => {
        const row = el("div", "hk-row");
        row.innerHTML = `<span class="hk-name">${h.name}</span>
          <span class="hk-key">${h.key ? `<kbd>${h.key.replace(/ \+ /g, "</kbd>+<kbd>")}</kbd>` : "—"}</span>
          <span class="hk-states">${hotkeyStateLabel(h)}</span>`;
        body.appendChild(row);
      });
    }
    positionPopover(pop, anchor);
  } catch (e) {
    pop.querySelector(".hk-body").innerHTML = `<div class="hk-empty">❌ ${e.message}</div>`;
  }
  setTimeout(() => document.addEventListener("click", onDocClickHK, true), 0);
}

// ===================== EDIT model previews view =====================
function extFromType(t) {
  return ({ "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp", "video/mp4": ".mp4", "video/webm": ".webm" })[t] || ".png";
}

async function openEditModel(gid, character, folder) {
  pushRoute({ view: "edit", gameId: gid, character, folder });
  state.view = "edit";
  state.gameId = gid;
  state.edit = { gid, character, folder };
  closeHotkeyPopover();
  $("#filterbar").classList.add("hidden");
  highlightNav();

  const g = gameById(gid);
  const modelName = folder.replace(/^DISABLED /, "");
  setCrumb(`${(g && (g.name_zh || g.name)) || ""} · ${character} · 編輯`);

  const c = $("#content");
  c.innerHTML = `
    <div class="char-detail-head">
      <div class="cd-meta"><h2>編輯預覽</h2><div class="cd-sub">${modelName}</div></div>
    </div>
    <div class="edit-toolbar">
      <button class="btn btn-primary" id="uploadBtn">⬆️ 上傳圖片 / 影片</button>
      <input type="file" id="fileInput" multiple accept="image/*,video/*" hidden>
      <span class="edit-hint">或在此頁面直接按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 貼上剪貼簿圖片 · 拖曳縮圖可調整順序（第一張為封面）</span>
    </div>
    <div class="edit-grid" id="editGrid"><div class="model-empty">載入中…</div></div>`;

  $("#uploadBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => uploadFiles([...e.target.files]));

  try {
    const data = await api(`/api/games/${gid}/models?character=${encodeURIComponent(character)}`);
    const m = (data.models || []).find((x) => x.folder === folder);
    renderEditPreviews(m ? m.previews : []);
  } catch (e) {
    $("#editGrid").innerHTML = `<div class="model-empty">❌ ${e.message}</div>`;
  }
}

let dragFile = null;
function renderEditPreviews(previews) {
  const grid = $("#editGrid");
  if (!grid || !state.edit) return;
  const { gid, character, folder } = state.edit;
  state.edit.previews = previews.slice();
  grid.innerHTML = "";
  if (!previews.length) {
    grid.innerHTML = `<div class="model-empty">目前沒有預覽。<br>上傳或貼上圖片即可加入。</div>`;
    return;
  }
  previews.forEach((p, idx) => {
    const item = el("div", "edit-item");
    item.draggable = true;
    item.dataset.file = p.file;
    const src = mediaUrl(gid, character, folder, p.file);
    const media = p.kind === "video"
      ? `<video src="${src}" muted loop></video>`
      : `<img src="${src}" alt="${p.file}">`;
    item.innerHTML = `<div class="edit-thumb">${media}
        <span class="edit-kind">${p.kind}</span>
        ${idx === 0 ? `<span class="edit-cover">封面</span>` : ""}
        <span class="drag-handle" title="拖曳調整順序">⠿</span>
      </div>
      <div class="edit-name" title="${p.file}">${p.file}</div>
      <button class="edit-del" title="刪除">✕ 刪除</button>`;
    item.querySelector(".edit-del").addEventListener("click", () => deletePreview(p.file));

    item.addEventListener("dragstart", (e) => {
      dragFile = p.file; item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", p.file); } catch (_) {}
    });
    item.addEventListener("dragend", () => {
      dragFile = null;
      $$(".edit-item").forEach((x) => x.classList.remove("dragging", "drop-target"));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (dragFile && dragFile !== p.file) item.classList.add("drop-target");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
    item.addEventListener("drop", (e) => {
      e.preventDefault(); item.classList.remove("drop-target");
      movePreview(dragFile, p.file);
    });
    grid.appendChild(item);
  });
}

function movePreview(srcFile, targetFile) {
  if (!srcFile || srcFile === targetFile || !state.edit) return;
  const arr = state.edit.previews.slice();
  const from = arr.findIndex((p) => p.file === srcFile);
  const to = arr.findIndex((p) => p.file === targetFile);   // capture BEFORE removing
  if (from < 0 || to < 0) return;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);     // dropping onto target takes its slot (works both directions)
  renderEditPreviews(arr);      // optimistic
  persistOrder(arr.map((p) => p.file));
}

async function persistOrder(order) {
  const { gid, character, folder } = state.edit;
  try {
    const data = await api(`/api/games/${gid}/model/preview/reorder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, folder, order }),
    });
    renderEditPreviews(data.previews);
    toast("✅ 已更新預覽順序（第一張為封面）", "ok", 2000);
  } catch (e) { toast(`❌ ${e.message}`, "err"); }
}

async function uploadFiles(files) {
  files = (files || []).filter(Boolean);
  if (!files.length || !state.edit) return;
  const { gid, character, folder } = state.edit;
  const fd = new FormData();
  fd.append("character", character);
  fd.append("folder", folder);
  files.forEach((f, i) => {
    const name = (f.name && f.name !== "image.png")
      ? f.name : `pasted_${Date.now()}_${i}${extFromType(f.type)}`;
    fd.append("file", f, name);
  });
  toast("上傳中…", "info", 0);
  try {
    const r = await fetch(`/api/games/${gid}/model/preview/upload`, { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "上傳失敗");
    toast(`✅ 已新增 ${data.saved.length} 個檔案`, "ok");
    renderEditPreviews(data.previews);
  } catch (e) { toast(`❌ ${e.message}`, "err", 5000); }
}

async function deletePreview(file) {
  if (!state.edit) return;
  const { gid, character, folder } = state.edit;
  try {
    const data = await api(`/api/games/${gid}/model/preview/delete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, folder, file }),
    });
    toast(`🗑️ 已刪除 ${file}`, "ok");
    renderEditPreviews(data.previews);
  } catch (e) { toast(`❌ ${e.message}`, "err"); }
}

function onPaste(e) {
  if (state.view !== "edit" || !state.edit) return;
  const items = [...(e.clipboardData?.items || [])].filter((it) => it.type.startsWith("image/"));
  if (!items.length) return;
  e.preventDefault();
  const files = items.map((it) => it.getAsFile()).filter(Boolean);
  uploadFiles(files);
}

// ===================== SETTINGS view =====================
const SETTINGS_CATS = [
  { id: "library", label: "遊戲庫", sub: "Game Libraries", icon: "🎮" },
  { id: "about", label: "關於", sub: "About", icon: "ℹ️" },
];

function showSettings() {
  pushRoute({ view: "settings", gameId: null });
  state.view = "settings";
  setCrumb("設定");
  $("#filterbar").classList.add("hidden");
  highlightNav();
  if (!state.settingsCat) state.settingsCat = "library";

  const c = $("#content");
  c.innerHTML = `<div class="settings-layout">
    <nav class="settings-nav" id="settingsNav"></nav>
    <div class="settings-panel" id="settingsPanel"></div>
  </div>`;

  const nav = $("#settingsNav");
  SETTINGS_CATS.forEach((cat) => {
    const item = el("a", "settings-cat" + (cat.id === state.settingsCat ? " active" : ""));
    item.innerHTML = `<span class="sc-ico">${cat.icon}</span>
      <span class="sc-text"><span class="sc-label">${cat.label}</span><span class="sc-sub">${cat.sub}</span></span>`;
    item.addEventListener("click", () => {
      state.settingsCat = cat.id;
      $$("#settingsNav .settings-cat").forEach((x) => x.classList.remove("active"));
      item.classList.add("active");
      renderSettingsPanel(cat.id);
    });
    nav.appendChild(item);
  });

  renderSettingsPanel(state.settingsCat);
}

function renderSettingsPanel(catId) {
  const panel = $("#settingsPanel");
  if (!panel) return;
  panel.innerHTML = "";

  if (catId === "library") {
    panel.appendChild(el("h2", "settings-title", "遊戲庫"));
    panel.appendChild(el("p", "settings-desc", "勾選要啟用的遊戲，設定其 Mods 資料夾後保存，該遊戲就會出現在左側遊戲庫。"));
    const rows = el("div");
    state.games.forEach((g) => rows.appendChild(gameRow(g)));
    panel.appendChild(rows);
  } else if (catId === "about") {
    const enabled = state.games.filter((g) => g.enabled);
    panel.appendChild(el("h2", "settings-title", "關於 MODEX"));
    panel.appendChild(el("div", "about-box", `
      <div class="about-brand"><span class="brand-dot"></span><b>MODEX</b> <span class="about-tag">Mod Index</span></div>
      <p class="about-line">Emby 風格的多遊戲 Mod 管理庫，像「圖鑑」一樣瀏覽與整理角色模組。</p>
      <div class="about-grid">
        <div><span class="about-k">支援遊戲</span><span class="about-v">${state.games.length}</span></div>
        <div><span class="about-k">已啟用</span><span class="about-v">${enabled.length}</span></div>
        <div><span class="about-k">前端 / 後端</span><span class="about-v">HTML · Python (Flask)</span></div>
      </div>
      <div class="about-feats">
        <span>圖庫式瀏覽</span><span>稀有度/元素/地區檢索</span><span>啟用 ↔ 停用</span>
        <span>快捷鍵檢視</span><span>預覽編輯・拖曳排序</span><span>開啟資料夾</span>
      </div>`));
  }
}

function gameRow(g) {
  const row = el("div", "game-row");
  row.innerHTML = `
    <div class="game-row-head">
      <div class="g-ico">${g.icon || "🎮"}</div>
      <div class="g-meta">
        <div class="g-name">${g.name_zh || g.name} <span style="color:var(--muted);font-weight:400;font-size:13px;">${g.name}</span></div>
        <div class="g-sub">來源：${g.source} · 已爬取 ${g.char_count} 位角色</div>
      </div>
      <label class="switch"><input type="checkbox" ${g.enabled ? "checked" : ""}><span class="slider"></span></label>
    </div>
    <div class="game-row-body">
      <div class="field-row">
        <label>Mods 資料夾</label>
        <input type="text" class="g-folder" placeholder="例如 G:\\Game Mod\\GIMI\\Mods" value="${g.mods_folder || ""}">
      </div>
      <div class="game-row-actions">
        <button class="btn btn-primary g-save">保存</button>
        <button class="btn g-refresh">更新角色資料</button>
        <button class="btn g-gen">產生角色資料夾</button>
        <span class="g-status"></span>
      </div>
    </div>`;

  const enableCb = row.querySelector(".switch input");
  const folderInput = row.querySelector(".g-folder");
  const status = row.querySelector(".g-status");
  const setStatus = (msg, cls = "") => { status.textContent = msg; status.className = `g-status ${cls}`; };

  if (g.mods_folder && !g.mods_exists) setStatus("⚠️ 資料夾不存在", "warn");
  else if (g.enabled) setStatus("✓ 已啟用", "ok");

  row.querySelector(".g-save").addEventListener("click", async () => {
    try {
      const data = await api(`/api/games/${g.id}/config`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enableCb.checked, mods_folder: folderInput.value.trim() }),
      });
      Object.assign(g, data.game);
      await loadGames();                 // refresh sidebar
      if (data.game.enabled && data.game.mods_folder && !data.game.mods_exists)
        setStatus("已保存，但資料夾不存在", "warn");
      else setStatus("✅ 已保存", "ok");
      toast("✅ 設定已保存", "ok");
    } catch (e) { setStatus(`❌ ${e.message}`, "warn"); }
  });

  row.querySelector(".g-refresh").addEventListener("click", async (ev) => {
    const b = ev.target; b.classList.add("spinning"); b.disabled = true; setStatus("爬取中…");
    try {
      const data = await api(`/api/games/${g.id}/refresh`, { method: "POST" });
      Object.assign(g, data.game); await loadGames();
      setStatus(`✅ 已更新 ${data.count} 位角色`, "ok");
      row.querySelector(".g-sub").textContent = `來源：${g.source} · 已爬取 ${data.count} 位角色`;
    } catch (e) { setStatus(`❌ ${e.message}`, "warn"); }
    finally { b.classList.remove("spinning"); b.disabled = false; }
  });

  row.querySelector(".g-gen").addEventListener("click", async (ev) => {
    const b = ev.target; b.disabled = true; setStatus("建立資料夾中…");
    try {
      const data = await api(`/api/games/${g.id}/generate-folders`, { method: "POST" });
      setStatus(`📁 已建立 ${data.created_count} 個（略過 ${data.skipped_count} 個）`, "ok");
    } catch (e) { setStatus(`❌ ${e.message}`, "warn"); }
    finally { b.disabled = false; }
  });

  return row;
}

init();
