// Ma Bibliothèque BD — demarrage.js (7/7) : pages et routage, Réglages → Présentation, sections repliables, version, fiche précédente / suivante, démarrage. Voir README, « Organisation du code ».
"use strict";
  // =====================================================================
  // PAGES (routage par l'adresse) : #/ = bibliothèque, #/reglages = réglages,
  // #/doublons = doublons probables (propriétaire). De vraies pages plutôt que des
  // fenêtres : le bouton retour du téléphone fonctionne, et on retrouve chaque page à
  // l'endroit où on l'avait quittée (dans la grille notamment, avec ~2000 vignettes).
  // =====================================================================
  var views = {
    home: document.getElementById("home-view"),
    settings: document.getElementById("settings-page"),
    dups: document.getElementById("dups-page"),
    stats: document.getElementById("stats-page"),
    carnet: document.getElementById("carnet-page"),
  };
  var viewScroll = {};
  state.view = "home";

  function viewFromHash() {
    var h = location.hash || "#/";
    if (h.indexOf("#/fiche/") === 0) return "home";
    if (h === "#/reglages") return "settings";
    if (h === "#/stats") return "stats";
    if (h === "#/carnet") {                               // 3.6 : carnet de lecture (propriétaire)
      if (IS_OWNER) return "carnet";
      try { history.replaceState(null, "", "#/reglages"); } catch (e) {}
      return "settings";
    }
    if (h === "#/doublons") {
      if (IS_OWNER) return "dups";
      try { history.replaceState(null, "", "#/reglages"); } catch (e) {}
      return "settings";
    }
    return "home";
  }

  // ---------- Réglages → Présentation (3.4) ----------
  var PRES_ICONS = {
    defaut: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    grille: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    eventail: '<path d="M3.5 7.5l3-1.2 2.6 11-3 1.2z"/><path d="M9 5.5h4.5v12H9z"/><path d="M17 6.3l3.2.9-2.3 11-3.2-.9z"/>',
    etagere: '<path d="M5 18V8h3v10M9 18V5h3v13M13 18V7h3v11M17 18V9l2.5-.6L21 18"/><path d="M3 20.5h19"/>',
    mur: '<rect x="8" y="3" width="12" height="15" rx="1.5"/><path d="M5.5 6v14.5H17"/><path d="M3 8.5V23h11.5"/>',
    liste: '<rect x="4" y="5" width="4" height="4" rx="1"/><rect x="4" y="14" width="4" height="4" rx="1"/><path d="M11 7h9M11 16h9"/>'
  };
  function presButton(id, label, pressed, sub) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pres-btn";
    b.setAttribute("data-pres", id);
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
      (PRES_ICONS[id] || "") + '</svg><span class="pres-name"></span>' + (sub ? '<span class="pres-sub"></span>' : "");
    b.querySelector(".pres-name").textContent = label;
    if (sub) b.querySelector(".pres-sub").textContent = sub;
    return b;
  }
  function renderPresBlock() {
    var box = document.getElementById("pres-grid");
    if (!box) return;
    var site = presSite() || "grille";
    box.innerHTML = "";
    var d = presButton("defaut", "Par défaut", !state.presDevice, "actuellement : " + presNom(site));
    d.addEventListener("click", function () { setPresDevice(null); });
    box.appendChild(d);
    PRESENTATIONS.forEach(function (p) {
      var b = presButton(p.id, p.name, state.presDevice === p.id);
      b.addEventListener("click", function () { setPresDevice(p.id); });
      box.appendChild(b);
    });
    var sb = document.getElementById("pres-site");
    if (!sb) return;
    sb.hidden = !IS_OWNER;
    if (!IS_OWNER) { sb.innerHTML = ""; return; }
    var msg = state.presMsg || "";
    sb.innerHTML = '<h3 class="pres-site-title">Pour tes visiteurs</h3><p class="settings-hint" id="pres-site-hint"></p>' +
      '<div class="pres-grid" id="pres-site-grid" aria-label="Présentation par défaut des visiteurs"></div>' +
      '<p class="settings-hint pres-msg" id="pres-msg" role="status"></p>';
    sb.querySelector("#pres-site-hint").textContent = state.siteMissing
      ? "La table bd_reglages n'existe pas encore dans Supabase : lance d'abord supabase_reglages.sql (voir README)."
      : "La présentation sur laquelle arrive un visiteur qui n'a rien choisi sur son appareil. Actuellement : " + presNom(site) + ".";
    var g = sb.querySelector("#pres-site-grid");
    PRESENTATIONS.forEach(function (p) {
      var b = presButton(p.id, p.name, site === p.id);
      b.addEventListener("click", function () { saveSitePres(p.id); });
      g.appendChild(b);
    });
    var m = sb.querySelector("#pres-msg");
    m.textContent = msg; m.hidden = !msg;
    m.classList.toggle("err", !!state.presMsgErr);
  }
  function setPresDevice(v) {
    state.presDevice = presOk(v) ? v : null;
    try {
      if (state.presDevice) localStorage.setItem(PRES_KEY, state.presDevice);
      else localStorage.removeItem(PRES_KEY);
    } catch (e) {}
    viewScroll.home = 0;          // la grille change de hauteur : on y revient en haut
    renderGrid();
    renderPresBlock();
  }
  function presSaved(text, err) {
    state.presMsg = text; state.presMsgErr = !!err;
    if (state.view === "settings") renderPresBlock();
  }
  function saveSitePres(v) {
    if (!presOk(v) || !IS_OWNER) return;
    if (!supa) { presSaved("Pas enregistré : Supabase n'est pas configuré.", true); return; }
    if (needLogin()) return;
    presSaved("Enregistrement…");
    supa.from("bd_reglages")
      .upsert({ cle: "presentation", valeur: v, updated_at: new Date().toISOString() })
      .select()
      .then(function (res) {
        var e = res.error, m = e ? ((e.message || "") + "") : "";
        if (e && (e.code === "42P01" || e.code === "PGRST205" || /could not find the table|does not exist/i.test(m))) {
          state.siteMissing = true;
          presSaved("Pas enregistré : lance d'abord supabase_reglages.sql dans Supabase (voir README).", true);
        } else if (e) {
          presSaved("Pas enregistré : " + refusedText(e), true);
        } else if (!res.data || !res.data.length) {
          presSaved("Pas enregistré : la base a refusé (reconnecte-toi dans Réglages → Mode propriétaire).", true);
        } else {
          state.siteMissing = false;
          var before = presentation();
          state.site.presentation = v;
          try { localStorage.setItem(SITE_KEY, JSON.stringify(state.site)); } catch (x) {}
          if (presentation() !== before) renderGrid();
          presSaved("Enregistré : tes visiteurs arrivent sur « " + presNom(v) + " ».");
        }
      })
      .catch(function (err) { presSaved("Pas enregistré : " + ((err && err.message) || "hors ligne"), true); });
  }

  function renderSettingsPage() {
    renderPresBlock();
    renderStyleBlock();                                    // 3.9
    if (window.BD_THEMES) window.BD_THEMES.loadAllFonts();
    renderThemeGrid();
    renderOwnerPanel();
    renderHiddenList();
    updateDupButton();
  }

  function route() {
    var v = viewFromHash(), prev = state.view;
    viewScroll[prev] = window.scrollY;
    if (v !== "home") {
      state.navMoved = false;
      if (!els.zoomOverlay.hidden) closeZoom();
      if (state.activeId) closeSheetUI();
    }
    state.view = v;
    Object.keys(views).forEach(function (k) { if (views[k]) views[k].hidden = k !== v; });
    document.documentElement.classList.toggle("view-page", v !== "home");
    if (v === "settings") renderSettingsPage();
    else if (v === "dups") renderDups();
    else if (v === "stats") renderStats();
    else if (v === "carnet") renderCarnet();
    window.scrollTo(0, viewScroll[v] || 0);
    if (v === "home") {
      sweepSoon();
      var fid = ficheFromHash();
      if (fid !== null) openFromRouteSafe(fid);
      else if (state.activeId) { state.sheetFromApp = false; closeSheetUI(); }
    }
  }
  window.addEventListener("hashchange", route);
  settingsEls.open.addEventListener("click", function () { location.hash = "#/reglages"; });

  // ---------- sections des Réglages repliables ----------
  // Titre cliquable avec chevron ; ce qui est replié est mémorisé sur l'appareil, la page
  // se rouvre donc telle qu'on l'a laissée. Tout est déplié au tout premier affichage.
  var SET_CLOSED_KEY = "bd_reglages_replies_v1";
  var setClosed = (function () {
    try { var v = JSON.parse(localStorage.getItem(SET_CLOSED_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  })();
  function saveSetClosed() {
    try { localStorage.setItem(SET_CLOSED_KEY, JSON.stringify(setClosed)); } catch (e) {}
  }
  function setBlockOpen(block, open) {
    var head = block.querySelector(".set-head"), body = block.querySelector(".set-body");
    var id = block.getAttribute("data-sec"), i = setClosed.indexOf(id);
    head.setAttribute("aria-expanded", open ? "true" : "false");
    body.hidden = !open;
    block.classList.toggle("is-closed", !open);
    if (open && i !== -1) setClosed.splice(i, 1);
    if (!open && i === -1) setClosed.push(id);
  }
  var setBlocks = Array.prototype.slice.call(document.querySelectorAll("#settings-page .set-block"));
  setBlocks.forEach(function (b) {
    setBlockOpen(b, setClosed.indexOf(b.getAttribute("data-sec")) === -1);
    b.querySelector(".set-head").addEventListener("click", function () {
      setBlockOpen(b, this.getAttribute("aria-expanded") !== "true");
      saveSetClosed();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#settings-page .set-all-btn"), function (btn) {
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("data-all") === "open";
      setBlocks.forEach(function (b) { setBlockOpen(b, open); });
      saveSetClosed();
    });
  });

  // ---------- numéro de version (bas des Réglages, visible par tous) ----------
  // Lien vers le PDF du mode d'emploi (à la racine du site) : on y ajoute le numéro de
  // version pour qu'un téléphone ne garde pas en cache un ancien PDF après une livraison.
  var pdfLink = document.getElementById("pdf-link");
  if (pdfLink) pdfLink.setAttribute("href", "Mode_emploi_proprietaire.pdf?v=" + APP_VERSION);
  var upLink = document.getElementById("uploader-link");      // page d'envoi des couvertures
  if (upLink) upLink.setAttribute("href", "uploader.html?v=" + APP_VERSION);

  var versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = "Ma Bibliothèque BD — version " + APP_VERSION + " du " +
    APP_VERSION_DATE.split("-").reverse().join("/");

  // ---------- fiche précédente / suivante (3.5) ----------
  // Dans la fiche ouverte : boutons ‹ › en haut, flèches ← → du clavier, et glissement du
  // doigt sur téléphone. L'ordre est celui de la grille telle qu'elle est affichée (filtres,
  // recherche et tri compris : state.gridOrder, rempli par renderGrid). L'adresse suit la
  // fiche (#/fiche/<id>) sans s'empiler dans l'historique : le retour du téléphone referme
  // la fiche comme avant, et la grille revient sur la dernière fiche vue.
  // Pas de passage d'une fiche à l'autre au clavier ni au doigt pendant une modification
  // (éditeur de fiche ou de tome ouvert), pour ne rien perdre de ce qui est en cours.
  function sheetEditing() {
    return !!((edit.box && !edit.box.hidden) || state.editVol !== null && state.editVol !== undefined || state.avisEdit);
  }
  function navIndex() { return state.activeId ? (state.gridOrder || []).indexOf(state.activeId) : -1; }
  function titleOf(id) { var e = state.catalog.find(function (x) { return x.id === id; }); return e ? e.title : ""; }
  function updateSheetNav() {
    if (!els.sheetNav) return;
    var order = state.gridOrder || [], i = navIndex(), n = order.length;
    var show = i !== -1 && n > 1;
    els.sheetNav.hidden = !show;
    if (!show) return;
    els.sheetPrev.disabled = i === 0;
    els.sheetNext.disabled = i === n - 1;
    els.sheetPrev.setAttribute("aria-label", i > 0 ? "Fiche précédente : " + titleOf(order[i - 1]) : "Pas de fiche précédente");
    els.sheetNext.setAttribute("aria-label", i < n - 1 ? "Fiche suivante : " + titleOf(order[i + 1]) : "Pas de fiche suivante");
    els.sheetPrev.title = i > 0 ? titleOf(order[i - 1]) : "";
    els.sheetNext.title = i < n - 1 ? titleOf(order[i + 1]) : "";
    els.sheetPos.textContent = (i + 1) + " / " + n;
  }
  // couvertures des fiches voisines chargées d'avance : le passage est immédiat
  function preloadAround(i) {
    var order = state.gridOrder || [];
    [i - 1, i + 1].forEach(function (k) {
      var e = order[k] && state.catalog.find(function (x) { return x.id === order[k]; });
      if (e && e.cover) { var im = new Image(); im.src = coverUrl(e.cover); }
    });
  }
  function stepSheet(d, how) {
    if (els.overlay.hidden || !els.zoomOverlay.hidden) return;
    if (how !== "btn" && sheetEditing()) return;
    var order = state.gridOrder || [], i = navIndex(), id = order[i + d];
    if (i === -1 || !id) return;
    try { history.replaceState(null, "", FICHE_PREFIX + encodeURIComponent(id)); } catch (e) {}
    state.navMoved = true;
    openSheetUI(id, { dir: d, keepFocus: how === "btn" });
    if (els.sheetLive) els.sheetLive.textContent = titleOf(id) + ", fiche " + (i + d + 1) + " sur " + order.length;
    preloadAround(i + d);
  }
  if (els.sheetPrev) els.sheetPrev.addEventListener("click", function () { stepSheet(-1, "btn"); });
  if (els.sheetNext) els.sheetNext.addEventListener("click", function () { stepSheet(1, "btn"); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (els.overlay.hidden || !els.zoomOverlay.hidden || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
    e.preventDefault();
    stepSheet(e.key === "ArrowLeft" ? -1 : 1, "key");
  });
  (function () {                                      // glissement du doigt (téléphone, tablette)
    var sheetEl = document.getElementById("sheet"), sx = 0, sy = 0, st = 0, on = false;
    if (!sheetEl) return;
    sheetEl.addEventListener("touchstart", function (e) {
      var t = e.target, tag = t && t.tagName;
      on = e.touches.length === 1 && !(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA");
      if (!on) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    }, { passive: true });
    sheetEl.addEventListener("touchend", function (e) {
      if (!on || !e.changedTouches.length) return;
      on = false;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > 1.8 * Math.abs(dy) && Date.now() - st < 800) stepSheet(dx < 0 ? 1 : -1, "swipe");
    }, { passive: true });
  })();

  els.sheetClose.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", function (e) { if (e.target === els.overlay) closeSheet(); });
  // 2.8 : Tab reste dans la fiche ouverte (fenêtre modale)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || els.overlay.hidden || !els.zoomOverlay.hidden) return;
    var f = Array.prototype.filter.call(
      document.getElementById("sheet").querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var a = document.activeElement, i = f.indexOf(a);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!els.zoomOverlay.hidden) closeZoom();
    else if (state.activeId) closeSheet();
    else if (state.view === "dups" || state.view === "stats" || state.view === "carnet") location.hash = "#/reglages";
    else if (state.view === "settings") location.hash = "#/";
  });
  els.btnRead.addEventListener("click", toggleAllVolumesRead);
  els.btnFav.addEventListener("click", toggleFavorite);

  els.sheetCoverZoom.addEventListener("click", function () {
    openZoom(state.activeCoverUrl, state.activeCoverAlt);
  });
  els.zoomClose.addEventListener("click", closeZoom);
  els.zoomOverlay.addEventListener("click", function (e) { if (e.target === els.zoomOverlay) closeZoom(); });

  // session perdue au chargement précédent (lostSession) : on le dit, une fois
  try {
    if (sessionStorage.getItem(LOST_KEY)) {
      sessionStorage.removeItem(LOST_KEY);
      setTimeout(function () { toast("Ta connexion à Supabase a expiré : reconnecte-toi pour retrouver le mode propriétaire.", "Se connecter", goLogin); }, 600);
    }
  } catch (e) {}

  // ---------- boot ----------
  populateGenreFilter();
  state.overrides = loadLocalOverrides();
  var hadOvCache = Object.keys(state.overrides).length > 0;
  if (IS_OWNER) {
    state.favorites = loadLocalFavorites();
    state.volumeRead = loadLocalVolumeRead();
  }
  route();
  loadCatalog();
  initSupabase();
