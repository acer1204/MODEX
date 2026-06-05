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
  edit: null,           // { gid, character, folder, outfit } when in edit view
  outfit: "Official",   // current outfit/skin on the character detail page
  lang: "en",           // current language code
  locale: null,         // loaded translation object
  locales: [],          // available [{code, name}]
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
function gameLabel(g) { return state.lang.startsWith("zh") ? (g.name_zh || g.name) : g.name; }

// ---------- i18n ----------
// t("ui.save") / t("ui.updatedChars", {n: 5}); falls back to the path if missing.
function t(path, vars) {
  let cur = state.locale;
  for (const part of path.split(".")) {
    cur = cur && cur[part];
    if (cur == null) break;
  }
  let s = (typeof cur === "string") ? cur : path;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
function tList(path) {
  const cur = path.split(".").reduce((o, p) => (o ? o[p] : null), state.locale);
  return Array.isArray(cur) ? cur : [];
}
// data lookups — fall back to the raw English value when a translation is absent
function tChar(name) { return (state.locale?.characters?.[name]) || name; }
function tElement(e) { return (state.locale?.elements?.[e]) || e; }
function tRegion(r) { return (state.locale?.regions?.[r]) || r; }
function tFacetLabel(key) { return (state.locale?.facets?.[key]) || key; }
function tHotkeyType(ty) { return (state.locale?.hotkeyTypes?.[ty]) || ty; }

async function loadLocale() {
  try {
    const appcfg = await api("/api/app");
    state.lang = appcfg.language || "en";
    state.locales = appcfg.locales || [];
  } catch (_) { state.lang = "en"; }
  try {
    state.locale = await (await fetch(`/locales/${state.lang}.json`)).json();
  } catch (_) {
    state.locale = await (await fetch(`/locales/en.json`)).json();
  }
}

// translate the static markup in index.html (sidebar / topbar)
function applyStaticI18n() {
  const set = (sel, val, attr) => {
    const e = $(sel);
    if (!e) return;
    if (attr) e.setAttribute(attr, val); else e.textContent = val;
  };
  set("#nav-home .nav-label", t("ui.home"));
  set(".side-section-title", t("ui.gameLibraries"));
  set("#globalSearch", t("ui.search"), "placeholder");
  set("#btnSettings", t("ui.settings"), "title");
  set("#btnBell", t("ui.notifications"), "title");
  set("#navBack", t("ui.back"), "title");
  set("#navFwd", t("ui.forward"), "title");
  const se = $("#sideEmpty span"); if (se) se.textContent = t("ui.noGamesEnabled");
  const so = $("#sideOpenSettings"); if (so) so.textContent = t("ui.goToSettings");
}

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
      cur.character === route.character && cur.folder === route.folder &&
      cur.outfit === route.outfit) return; // no dup
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
  else if (route.view === "edit") openEditModel(route.gameId, route.character, route.folder, route.outfit);
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
  await loadLocale();
  applyStaticI18n();
  await loadGames();
  showHome();
}

async function changeLanguage(code) {
  try {
    await api("/api/app", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: code }),
    });
    location.reload();   // re-init with the new locale everywhere
  } catch (e) { toast(`❌ ${e.message}`, "err"); }
}

function wireChrome() {
  const toggle = () => $("#app").classList.toggle("collapsed");
  $("#hamburger").addEventListener("click", toggle);
  $("#hamburger2").addEventListener("click", toggle);
  $("#nav-home").addEventListener("click", showHome);
  $("#btnSettings").addEventListener("click", showSettings);
  $("#sideOpenSettings").addEventListener("click", showSettings);
  $("#btnBell").addEventListener("click", () => toast(t("ui.noNotifications"), "info"));
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
  setCrumb(t("ui.home"));
  $("#filterbar").classList.add("hidden");
  highlightNav();
  const c = $("#content");

  const enabled = state.games.filter((g) => g.enabled);
  if (!enabled.length) {
    c.innerHTML = `<div class="empty-state">
      <div class="big">🎮</div>
      <p>${t("ui.noGamesHomeTitle")}</p>
      <p>${t("ui.noGamesHomeHint")}</p>
      <button class="btn btn-primary" id="homeSettings">${t("ui.goToSettingsBtn")}</button>
    </div>`;
    $("#homeSettings").addEventListener("click", showSettings);
    return;
  }
  c.innerHTML = `<div class="section-head"><h2>${t("ui.gameLibraries")}</h2>
    <span class="count">${t("ui.gamesCount", { n: enabled.length })}</span></div>
    <div class="poster-grid" id="homeGrid"></div>`;
  const grid = $("#homeGrid");
  enabled.forEach((g) => {
    const card = el("div", "poster");
    card.innerHTML = `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:60px;">${g.icon || "🎮"}</div>
      <div class="p-title">${gameLabel(g)}</div>
      <div class="p-sub">${t("ui.charsCount", { n: g.char_count })}</div>`;
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
  setCrumb(gameLabel(g));
  highlightNav();

  const c = $("#content");
  c.innerHTML = `<div class="empty-state">${t("ui.loading")}</div>`;
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
      <p>${gameLabel(g)}</p>
      <button class="btn btn-primary" id="libRefresh">${t("ui.updateChars")}</button>
    </div>`;
    $("#libRefresh").addEventListener("click", () => refreshGame(gid, true));
    return;
  }

  buildFilterBar();
  c.innerHTML = `<div class="section-head"><span class="badge">📺</span>
      <h2>${t("ui.characters")}</h2><span class="count" id="charCount"></span></div>
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
    const btn = el("button", activeSet.size ? "has-active" : "", `${tFacetLabel(f.key)} <span class="caret">▾</span>`);
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
      let label = String(v);
      if (f.kind === "stars") label = `${v} ★`;
      else if (f.key === "element") label = tElement(v);
      else if (f.key === "region") label = tRegion(v);
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

  const reset = el("button", "btn filter-reset", t("ui.resetFilters"));
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
  if (state.search) {
    const q = state.search;
    const hit = String(ch.name).toLowerCase().includes(q) || String(tChar(ch.name)).toLowerCase().includes(q);
    if (!hit) return false;
  }
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
    const sub = [ch.element && ch.element !== "None" ? tElement(ch.element) : null,
                 ch.region && ch.region !== "None" ? tRegion(ch.region) : null]
                .filter(Boolean).join(" · ");
    card.innerHTML = `
      <div class="thumb">
        ${ch.quality ? `<span class="badge-tl">${ch.quality}★</span>` : ""}
        <img loading="lazy" alt="${tChar(ch.name)}" src="${iconSrc}">
      </div>
      <div class="p-title">${tChar(ch.name)}</div>
      <div class="p-sub">${ch.element ? `<span class="dot" style="background:${dot}"></span>` : ""}${sub || "&nbsp;"}</div>`;
    const img = card.querySelector("img");
    if (img && ch.icon_url) img.onerror = () => { if (img.src !== ch.icon_url) img.src = ch.icon_url; };
    card.addEventListener("click", () => openCharacter(state.gameId, ch.name));
    grid.appendChild(card);
  });
}

async function refreshGame(gid, reopen) {
  toast(t("ui.refreshingChars"), "info", 0);
  try {
    const data = await api(`/api/games/${gid}/refresh`, { method: "POST" });
    await loadGames();
    toast(t("ui.updatedChars", { n: data.count }), "ok");
    if (reopen) openLibrary(gid);
    else if (state.view === "settings") showSettings();
  } catch (e) {
    toast(t("ui.updateFailed", { msg: e.message }), "err", 6000);
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
  setCrumb(`${(g && gameLabel(g)) || ""} · ${tChar(charName)}`);
  $("#filterbar").classList.add("hidden");
  highlightNav();

  const dot = ELEMENT_COLORS[ch.element] || "var(--None)";
  const meta = [ch.quality ? `${ch.quality}★` : null,
                ch.element && ch.element !== "None" ? tElement(ch.element) : null,
                ch.region && ch.region !== "None" ? tRegion(ch.region) : null]
    .filter(Boolean).join(" · ");
  const iconSrc = ch.icon ? `/icons/${gid}/${encodeURIComponent(ch.icon)}` : (ch.icon_url || "");

  state.outfit = "Official";   // reset to the default outfit on entry

  const c = $("#content");
  c.innerHTML = `
    <div class="char-detail-head">
      ${iconSrc ? `<button class="cd-icon-btn" id="cdOpenFolder" title="${t("ui.openFolderTip")}">
        <img class="cd-icon" src="${iconSrc}" alt="${tChar(ch.name)}">
        <span class="cd-icon-overlay">📂</span>
      </button>` : ""}
      <div class="cd-meta">
        <h2>${tChar(ch.name)}</h2>
        <div class="cd-sub">${ch.element ? `<span class="dot" style="background:${dot}"></span>` : ""}${meta || t("ui.models")}<span class="cd-outfit" id="cdOutfit"></span></div>
      </div>
    </div>
    <div class="outfit-switcher hidden" id="outfitSwitcher"></div>
    <div class="model-list" id="modelGrid"><div class="model-empty">${t("ui.loading")}</div></div>`;

  const openBtn = $("#cdOpenFolder");
  if (openBtn) openBtn.addEventListener("click", () => openCharacterFolder(gid, charName, state.outfit));

  // outfit switcher (Official + alternate skins)
  try {
    const od = await api(`/api/games/${gid}/outfits?character=${encodeURIComponent(charName)}`);
    if (od.has_skins) renderOutfitSwitcher(gid, charName, od.outfits);
  } catch (_) {}

  renderOutfitModels(gid, charName);
}

function renderOutfitSwitcher(gid, charName, outfits) {
  const bar = $("#outfitSwitcher");
  if (!bar) return;
  bar.classList.remove("hidden");
  bar.innerHTML = "";
  outfits.forEach((o) => {
    const card = el("button", "outfit-card" + (o.folder === state.outfit ? " active" : ""));
    card.dataset.folder = o.folder;
    const label = o.folder === "Official" ? t("ui.officialOutfit") : o.name;
    card.innerHTML = `<div class="oc-img">${o.image_url ? `<img src="${o.image_url}" alt="${o.name}">` : ""}</div>
      <div class="oc-name" title="${o.name}">${label}</div>`;
    card.addEventListener("click", () => {
      if (state.outfit === o.folder) return;
      state.outfit = o.folder;
      $$("#outfitSwitcher .outfit-card").forEach((x) => x.classList.remove("active"));
      card.classList.add("active");
      renderOutfitModels(gid, charName);
    });
    bar.appendChild(card);
  });
}

async function renderOutfitModels(gid, charName) {
  const box = $("#modelGrid");
  if (!box) return;
  const outfit = state.outfit;
  // show current outfit label next to the character name
  const lbl = $("#cdOutfit");
  if (lbl) lbl.textContent = outfit && outfit !== "Official" ? ` · ${outfit}` : ` · ${t("ui.officialOutfit")}`;
  box.innerHTML = `<div class="model-empty">${t("ui.loading")}</div>`;
  try {
    const data = await api(`/api/games/${gid}/models?character=${encodeURIComponent(charName)}&outfit=${encodeURIComponent(outfit)}`);
    if (!data.char_dir_exists) {
      box.innerHTML = `<div class="model-empty">${t("ui.noCharDir")}</div>`; return;
    }
    if (!data.models.length) {
      box.innerHTML = `<div class="model-empty">${t("ui.noModels")}</div>`; return;
    }
    box.innerHTML = "";
    data.models.forEach((m) => box.appendChild(modelCard(gid, charName, m, outfit)));
  } catch (e) {
    box.innerHTML = `<div class="model-empty">❌ ${e.message}</div>`;
  }
}

async function openCharacterFolder(gid, character, outfit) {
  try {
    const data = await api(`/api/games/${gid}/open-folder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, outfit: outfit || "Official" }),
    });
    toast(t("ui.folderOpened", { path: data.path }), "ok", 4000);
  } catch (e) { toast(`❌ ${e.message}`, "err", 5000); }
}

function mediaUrl(gid, character, folder, file, outfit) {
  return `/api/games/${gid}/media?character=${encodeURIComponent(character)}&outfit=${encodeURIComponent(outfit || "Official")}&model=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`;
}

function modelCard(gid, character, model, outfit) {
  outfit = outfit || "Official";
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
      slot.appendChild(el("div", "no-preview", t("ui.noPreview")));
      tag.textContent = ""; counter.textContent = ""; return;
    }
    const p = previews[idx];
    const src = mediaUrl(gid, character, model.folder, p.file, outfit);
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

  // name (fixed 2-line height so all cards align) — model folder names stay as-is
  const nameRow = el("div", "m-name");
  nameRow.textContent = model.name;
  nameRow.title = model.name;
  card.appendChild(nameRow);
  card.appendChild(el("div", "m-sub", t("ui.previewsCount", { n: previews.length })));

  // ---- 3 action buttons ----
  const actions = el("div", "model-actions");

  const tgl = el("button", `mbtn toggle ${model.enabled ? "on" : "off"}`,
    model.enabled ? `⏻ ${t("ui.active")}` : `⏻ ${t("ui.disabled")}`);
  tgl.title = model.enabled ? t("ui.toggleDisableTip") : t("ui.toggleEnableTip");
  tgl.addEventListener("click", () => toggleModel(gid, character, model, outfit));

  const keys = el("button", "mbtn keys", `⌨ ${t("ui.hotkeys")}`);
  keys.addEventListener("click", (e) => { e.stopPropagation(); showHotkeys(gid, character, model, keys, outfit); });

  const edit = el("button", "mbtn edit", `✏️ ${t("ui.edit")}`);
  edit.addEventListener("click", () => openEditModel(gid, character, model.folder, outfit));

  actions.appendChild(tgl); actions.appendChild(keys); actions.appendChild(edit);
  card.appendChild(actions);

  render();
  return card;
}

async function toggleModel(gid, character, model, outfit) {
  outfit = outfit || "Official";
  try {
    await api(`/api/games/${gid}/model/toggle`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, outfit, folder: model.folder, enable: !model.enabled }),
    });
    toast(model.enabled ? t("ui.modelDisabled") : t("ui.modelEnabled"), "ok");
    renderOutfitModels(gid, character); // re-render current outfit (keeps switcher)
  } catch (e) { toast(`❌ ${e.message}`, "err"); }
}

// ---------- hotkey floating popover ----------
function hotkeyStateLabel(h) {
  if (h.states) return t("ui.statesUnit", { n: h.states });
  if (h.type) return tHotkeyType(h.type);
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
async function showHotkeys(gid, character, model, anchor, outfit) {
  outfit = outfit || "Official";
  if (hotkeyPopover && hotkeyPopover.dataset.folder === model.folder) { closeHotkeyPopover(); return; }
  closeHotkeyPopover();
  const pop = el("div", "hotkey-popover");
  pop.dataset.folder = model.folder;
  pop.innerHTML = `<div class="hk-head">⌨ ${t("ui.hotkeys")} <span class="hk-ini"></span></div>
    <div class="hk-cols"><span>${t("ui.hkItem")}</span><span>${t("ui.hkKey")}</span><span>${t("ui.hkSteps")}</span></div>
    <div class="hk-body">${t("ui.loading")}</div>`;
  document.body.appendChild(pop);
  hotkeyPopover = pop;
  positionPopover(pop, anchor);
  try {
    const data = await api(`/api/games/${gid}/model/hotkeys?character=${encodeURIComponent(character)}&outfit=${encodeURIComponent(outfit)}&folder=${encodeURIComponent(model.folder)}`);
    pop.querySelector(".hk-ini").textContent = data.ini ? `· ${data.ini}` : "";
    const body = pop.querySelector(".hk-body");
    if (!data.hotkeys.length) {
      body.innerHTML = `<div class="hk-empty">${t("ui.hkEmpty")}</div>`;
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

async function openEditModel(gid, character, folder, outfit) {
  outfit = outfit || "Official";
  pushRoute({ view: "edit", gameId: gid, character, folder, outfit });
  state.view = "edit";
  state.gameId = gid;
  state.outfit = outfit;
  state.edit = { gid, character, folder, outfit };
  closeHotkeyPopover();
  $("#filterbar").classList.add("hidden");
  highlightNav();

  const g = gameById(gid);
  const modelName = folder.replace(/^DISABLED /, "");
  setCrumb(`${(g && gameLabel(g)) || ""} · ${tChar(character)} · ${t("ui.edit")}`);

  const c = $("#content");
  c.innerHTML = `
    <div class="char-detail-head">
      <div class="cd-meta"><h2>${t("ui.editPreviews")}</h2><div class="cd-sub">${modelName}</div></div>
    </div>
    <div class="edit-toolbar">
      <button class="btn btn-primary" id="uploadBtn">${t("ui.uploadBtn")}</button>
      <input type="file" id="fileInput" multiple accept="image/*,video/*" hidden>
      <span class="edit-hint">${t("ui.editHint")}</span>
    </div>
    <div class="edit-grid" id="editGrid"><div class="model-empty">${t("ui.loading")}</div></div>`;

  $("#uploadBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => uploadFiles([...e.target.files]));

  try {
    const data = await api(`/api/games/${gid}/models?character=${encodeURIComponent(character)}&outfit=${encodeURIComponent(outfit)}`);
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
  const { gid, character, folder, outfit } = state.edit;
  state.edit.previews = previews.slice();
  grid.innerHTML = "";
  if (!previews.length) {
    grid.innerHTML = `<div class="model-empty">${t("ui.editEmpty")}</div>`;
    return;
  }
  previews.forEach((p, idx) => {
    const item = el("div", "edit-item");
    item.draggable = true;
    item.dataset.file = p.file;
    const src = mediaUrl(gid, character, folder, p.file, outfit);
    const media = p.kind === "video"
      ? `<video src="${src}" muted loop></video>`
      : `<img src="${src}" alt="${p.file}">`;
    item.innerHTML = `<div class="edit-thumb">${media}
        <span class="edit-kind">${p.kind}</span>
        ${idx === 0 ? `<span class="edit-cover">${t("ui.cover")}</span>` : ""}
        <span class="drag-handle" title="${t("ui.hkSteps")}">⠿</span>
      </div>
      <div class="edit-name" title="${p.file}">${p.file}</div>
      <button class="edit-del">${t("ui.deleteBtn")}</button>`;
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
  const { gid, character, folder, outfit } = state.edit;
  try {
    const data = await api(`/api/games/${gid}/model/preview/reorder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, outfit, folder, order }),
    });
    renderEditPreviews(data.previews);
    toast(t("ui.reorderOk"), "ok", 2000);
  } catch (e) { toast(`❌ ${e.message}`, "err"); }
}

async function uploadFiles(files) {
  files = (files || []).filter(Boolean);
  if (!files.length || !state.edit) return;
  const { gid, character, folder, outfit } = state.edit;
  const fd = new FormData();
  fd.append("character", character);
  fd.append("outfit", outfit || "Official");
  fd.append("folder", folder);
  files.forEach((f, i) => {
    const name = (f.name && f.name !== "image.png")
      ? f.name : `pasted_${Date.now()}_${i}${extFromType(f.type)}`;
    fd.append("file", f, name);
  });
  toast(t("ui.uploading"), "info", 0);
  try {
    const r = await fetch(`/api/games/${gid}/model/preview/upload`, { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "upload failed");
    toast(t("ui.uploadedN", { n: data.saved.length }), "ok");
    renderEditPreviews(data.previews);
  } catch (e) { toast(`❌ ${e.message}`, "err", 5000); }
}

async function deletePreview(file) {
  if (!state.edit) return;
  const { gid, character, folder, outfit } = state.edit;
  try {
    const data = await api(`/api/games/${gid}/model/preview/delete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, outfit, folder, file }),
    });
    toast(t("ui.deletedFile", { file }), "ok");
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
  { id: "library", labelKey: "catLibrary", sub: "Game Libraries", icon: "🎮" },
  { id: "language", labelKey: "catLanguage", sub: "Language", icon: "🌐" },
  { id: "about", labelKey: "catAbout", sub: "About", icon: "ℹ️" },
];

function showSettings() {
  pushRoute({ view: "settings", gameId: null });
  state.view = "settings";
  setCrumb(t("ui.settingsTitle"));
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
      <span class="sc-text"><span class="sc-label">${t("ui." + cat.labelKey)}</span><span class="sc-sub">${cat.sub}</span></span>`;
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
    panel.appendChild(el("h2", "settings-title", t("ui.catLibrary")));
    panel.appendChild(el("p", "settings-desc", t("ui.libraryDesc")));
    const rows = el("div");
    state.games.forEach((g) => rows.appendChild(gameRow(g)));
    panel.appendChild(rows);
  } else if (catId === "language") {
    panel.appendChild(el("h2", "settings-title", t("ui.languageTitle")));
    panel.appendChild(el("p", "settings-desc", t("ui.languageDesc")));
    const list = el("div", "lang-list");
    state.locales.forEach((loc) => {
      const opt = el("button", "lang-opt" + (loc.code === state.lang ? " active" : ""));
      opt.innerHTML = `<span class="lang-name">${loc.name}</span><span class="lang-code">${loc.code}</span>
        ${loc.code === state.lang ? `<span class="lang-check">✓</span>` : ""}`;
      opt.addEventListener("click", () => { if (loc.code !== state.lang) changeLanguage(loc.code); });
      list.appendChild(opt);
    });
    panel.appendChild(list);
  } else if (catId === "about") {
    const enabled = state.games.filter((g) => g.enabled);
    const feats = tList("ui.aboutFeats").map((f) => `<span>${f}</span>`).join("");
    panel.appendChild(el("h2", "settings-title", t("ui.aboutTitle")));
    panel.appendChild(el("div", "about-box", `
      <div class="about-brand"><span class="brand-dot"></span><b>MODEX</b> <span class="about-tag">Mod Index</span></div>
      <p class="about-line">${t("ui.aboutDesc")}</p>
      <div class="about-grid">
        <div><span class="about-k">${t("ui.aboutSupported")}</span><span class="about-v">${state.games.length}</span></div>
        <div><span class="about-k">${t("ui.aboutEnabled")}</span><span class="about-v">${enabled.length}</span></div>
        <div><span class="about-k">${t("ui.aboutStack")}</span><span class="about-v">HTML · Python (Flask)</span></div>
      </div>
      <div class="about-feats">${feats}</div>`));
  }
}

function gameRow(g) {
  const row = el("div", "game-row");
  row.innerHTML = `
    <div class="game-row-head">
      <div class="g-ico">${g.icon || "🎮"}</div>
      <div class="g-meta">
        <div class="g-name">${gameLabel(g)} <span style="color:var(--muted);font-weight:400;font-size:13px;">${g.name}</span></div>
        <div class="g-sub">${t("ui.sourceLine", { src: g.source, n: g.char_count })}</div>
      </div>
      <label class="switch"><input type="checkbox" ${g.enabled ? "checked" : ""}><span class="slider"></span></label>
    </div>
    <div class="game-row-body">
      <div class="field-row">
        <label>${t("ui.modsFolder")}</label>
        <input type="text" class="g-folder" placeholder="G:\\Game Mod\\GIMI\\Mods" value="${g.mods_folder || ""}">
      </div>
      <div class="game-row-actions">
        <button class="btn btn-primary g-save">${t("ui.save")}</button>
        <button class="btn g-refresh">${t("ui.updateChars")}</button>
        <button class="btn g-gen">${t("ui.genFolders")}</button>
        <span class="g-status"></span>
      </div>
    </div>`;

  const enableCb = row.querySelector(".switch input");
  const folderInput = row.querySelector(".g-folder");
  const status = row.querySelector(".g-status");
  const setStatus = (msg, cls = "") => { status.textContent = msg; status.className = `g-status ${cls}`; };

  if (g.mods_folder && !g.mods_exists) setStatus(t("ui.statusFolderMissing"), "warn");
  else if (g.enabled) setStatus(t("ui.statusEnabled"), "ok");

  row.querySelector(".g-save").addEventListener("click", async () => {
    try {
      const data = await api(`/api/games/${g.id}/config`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enableCb.checked, mods_folder: folderInput.value.trim() }),
      });
      Object.assign(g, data.game);
      await loadGames();                 // refresh sidebar
      if (data.game.enabled && data.game.mods_folder && !data.game.mods_exists)
        setStatus(t("ui.statusSavedMissing"), "warn");
      else setStatus(t("ui.statusSaved"), "ok");
      toast(t("ui.savedOk"), "ok");
    } catch (e) { setStatus(`❌ ${e.message}`, "warn"); }
  });

  row.querySelector(".g-refresh").addEventListener("click", async (ev) => {
    const b = ev.target; b.classList.add("spinning"); b.disabled = true; setStatus(t("ui.scraping"));
    try {
      const data = await api(`/api/games/${g.id}/refresh`, { method: "POST" });
      Object.assign(g, data.game); await loadGames();
      setStatus(t("ui.updatedChars", { n: data.count }), "ok");
      row.querySelector(".g-sub").textContent = t("ui.sourceLine", { src: g.source, n: data.count });
    } catch (e) { setStatus(`❌ ${e.message}`, "warn"); }
    finally { b.classList.remove("spinning"); b.disabled = false; }
  });

  row.querySelector(".g-gen").addEventListener("click", async (ev) => {
    const b = ev.target; b.disabled = true; setStatus(t("ui.buildingFolders"));
    try {
      const data = await api(`/api/games/${g.id}/generate-folders`, { method: "POST" });
      setStatus(t("ui.generated", { created: data.created_count, skipped: data.skipped_count }), "ok");
    } catch (e) { setStatus(`❌ ${e.message}`, "warn"); }
    finally { b.disabled = false; }
  });

  return row;
}

init();
