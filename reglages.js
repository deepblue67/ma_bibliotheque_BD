// Ma Bibliothèque BD — reglages.js (4/7) : champs et filtres du bandeau, tri, page Réglages (thème, mode propriétaire, fiches masquées). Voir README, « Organisation du code ».
"use strict";
  // ---------- wiring ----------
  els.searchTitle.addEventListener("input", function () { state.filters.title = els.searchTitle.value; renderGridSoon(); });
  els.searchAuthor.addEventListener("input", function () { state.filters.author = els.searchAuthor.value; renderGridSoon(); });

  // Petite croix dans chaque champ : apparait des qu'il y a du texte, vide le champ et le filtre.
  function wireClear(input, apply) {
    var btn = input.parentNode.querySelector(".field-clear");
    if (!btn) return;
    var sync = function () { btn.hidden = !input.value; };
    input.addEventListener("input", sync);
    btn.addEventListener("click", function () {
      input.value = ""; apply(""); sync(); input.focus();
    });
    sync();
  }
  wireClear(els.searchTitle, function (v) { state.filters.title = v; renderGrid(); });
  wireClear(els.searchAuthor, function (v) { state.filters.author = v; renderGrid(); });
  els.filterGenre.addEventListener("change", function () { state.filters.genre = els.filterGenre.value; renderGrid(); });

  function toggleChip(el, key) {
    el.addEventListener("click", function () {
      state.filters[key] = !state.filters[key];
      el.setAttribute("data-active", state.filters[key] ? "true" : "false");
      renderGrid();
    });
  }
  toggleChip(els.filterRead, "read");
  toggleChip(els.filterInprogress, "inprogress");
  toggleChip(els.filterUnread, "unread");
  toggleChip(els.filterFav, "fav");

  function kindChip(el, kind) {
    el.addEventListener("click", function () {
      state.filters.kind = state.filters.kind === kind ? "" : kind;
      els.filterSeries.setAttribute("data-active", state.filters.kind === "series" ? "true" : "false");
      els.filterOneshot.setAttribute("data-active", state.filters.kind === "oneshot" ? "true" : "false");
      renderGrid();
    });
  }
  kindChip(els.filterSeries, "series");
  kindChip(els.filterOneshot, "oneshot");

  // 3.0 : tri de la grille, mémorisé sur l'appareil
  var SORT_KEY = "bd_tri_v1";
  // 3.7 : + « Nombre de tomes » (tous) et « Lus récemment » (propriétaire seulement)
  function sortOk(v) { return v === "title" || v === "recent" || v === "tomes" || (v === "lus" && IS_OWNER); }
  if (els.sortBy && IS_OWNER && !els.sortBy.querySelector('option[value="lus"]')) {
    var oLus = document.createElement("option"); oLus.value = "lus"; oLus.textContent = "Lus récemment";
    els.sortBy.appendChild(oLus);
  }
  try { var s0 = localStorage.getItem(SORT_KEY); if (sortOk(s0)) state.sort = s0; } catch (e) {}
  function setSort(v) {
    state.sort = sortOk(v) ? v : "title";
    if (els.sortBy) els.sortBy.value = state.sort;
    try { localStorage.setItem(SORT_KEY, state.sort); } catch (e) {}
  }
  if (els.sortBy) {
    els.sortBy.value = state.sort;
    els.sortBy.addEventListener("change", function () {
      setSort(els.sortBy.value);
      window.scrollTo(0, 0);
      renderGrid();
    });
  }

  // ---------- réglages ----------
  var settingsEls = {
    open: document.getElementById("settings-open"),
    grid: document.getElementById("theme-grid"),
  };

  function renderThemeGrid() {
    var T = window.BD_THEMES;
    if (!T) return;
    var cur = T.current();
    settingsEls.grid.innerHTML = "";
    T.list.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "theme-card";
      b.setAttribute("data-theme", t.id);      // la carte se dessine dans son propre thème
      b.setAttribute("aria-pressed", t.id === cur ? "true" : "false");
      b.innerHTML =
        '<div class="tc-bar">Mes BD</div>' +
        '<div class="tc-body"><div class="tc-mini"></div><div class="tc-mini"></div><div class="tc-mini"></div></div>' +
        '<div class="tc-foot"><div class="tc-name"></div><div class="tc-desc"></div></div>' +
        '<span class="tc-check" aria-hidden="true">✓</span>';
      b.querySelector(".tc-name").textContent = t.name;
      b.querySelector(".tc-desc").textContent = t.desc;
      b.addEventListener("click", function () {
        T.apply(t.id, true);
        Array.prototype.forEach.call(settingsEls.grid.children, function (c) {
          c.setAttribute("aria-pressed", c.getAttribute("data-theme") === t.id ? "true" : "false");
        });
      });
      settingsEls.grid.appendChild(b);
    });
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function renderOwnerPanel() {
    var box = document.getElementById("owner-panel");
    if (!box) return;
    var html;
    if (IS_OWNER) {
      var s = state.auth.session || storedSession(), who = (s && s.user && s.user.email) || "";
      html = '<p class="owner-status on">Mode propriétaire actif sur cet appareil' + (who ? ' (connecté : <b>' + esc(who) + '</b>)' : '') +
             ' : tu peux cocher tes lectures, corriger un titre, masquer une fiche. Tes visiteurs, eux, ne voient que la bibliothèque.</p>' +
             '<div class="owner-row"><button type="button" class="btn" id="owner-quit">Quitter le mode propriétaire</button></div>' +
             '<p class="settings-hint">Quitter déconnecte cet appareil de Supabase : fais-le sur un appareil qui n\'est pas le tien.</p>';
    } else {
      html = '<p class="owner-status">Cet appareil est en mode visiteur. Connecte-toi avec l\'adresse e-mail et le mot de passe de ton compte Supabase pour retrouver tes statuts et pouvoir les modifier.</p>' +
             '<div id="auth-box" class="auth-box"></div>';
    }
    box.innerHTML = html;
    renderAuthBox();
    var quit = document.getElementById("owner-quit");
    if (quit) quit.addEventListener("click", function () {
      state.auth.leaving = true;
      try { localStorage.removeItem(AVIS_KEY); } catch (e) {}   // 3.6 : avis privés
      signOutLocal().then(function () { location.reload(); });
    });
  }

  function renderHiddenList() {
    var box = document.getElementById("hidden-list");
    if (!box || !IS_OWNER) return;
    box.innerHTML = "";
    var priv = state.catalog.filter(function (e) { return e._private; });
    if (!state.hiddenList.length && !state.mergedList.length && !priv.length) { box.innerHTML = '<p class="settings-hint">Aucune fiche masquée, privée ni fusionnée.</p>'; return; }
    var ul = document.createElement("ul"); ul.className = "hidden-list";
    priv.forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML = '<div class="hl-text"><div class="hl-title"></div><div class="hl-why"></div></div>';
      li.querySelector(".hl-title").textContent = e.title;
      li.querySelector(".hl-why").textContent = "Réservée au propriétaire : invisible pour les visiteurs";
      var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = "Rendre visible";
      b.addEventListener("click", function () {
        saveOverride(e.id, { owner_only: null }, function () { toast("« " + e.title + " » est de nouveau visible pour tous."); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    state.mergedList.forEach(function (m) {
      var li = document.createElement("li");
      var into = state.catalog.find(function (e) { return e.id === m.into; });
      li.innerHTML = '<div class="hl-text"><div class="hl-title"></div><div class="hl-why"></div></div>';
      li.querySelector(".hl-title").textContent = m.title;
      li.querySelector(".hl-why").textContent = "Fusionnée dans « " + (into ? into.title : m.into) + " »";
      var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = "Séparer";
      b.addEventListener("click", function () {
        saveOverride(m.id, { merged_into: null }, function () { toast("« " + m.title + " » est de nouveau une fiche à part."); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    state.hiddenList.forEach(function (e) {
      var li = document.createElement("li");
      var o = state.overrides[e.id] || {};
      var byImport = e._raw.hidden && o.hidden !== true;
      li.innerHTML = '<div class="hl-text"><div class="hl-title"></div><div class="hl-why"></div></div>';
      li.querySelector(".hl-title").textContent = e.title;
      li.querySelector(".hl-why").textContent = byImport ? "Doublon écarté à l'import — " + (e._raw.hidden_reason || "") : "Masquée par toi";
      var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = "Ré-afficher";
      b.addEventListener("click", function () {
        saveOverride(e.id, { hidden: e._raw.hidden ? false : null }, function () { toast("« " + e.title + " » est de nouveau visible."); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  // ---------- Réglages → Style (3.9) ----------
  // Les choix et préréglages sont décrits dans themes.js (window.BD_STYLE), qui les applique
  // avant le premier affichage ; ici, la section des Réglages et son aperçu en direct.
  var STYLE_PREVIEW =
    '<div class="topbar"><div class="brand-row"><span class="brand">Ma Bibliothèque BD</span>' +
    '<span class="gear-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg></span></div>' +
    '<div class="sp-controls"><div class="field"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
    '<input type="text" placeholder="Titre de série ou de tome…" tabindex="-1" readonly></div></div>' +
    '<div class="chips"><span class="chip">Lus</span><span class="chip" data-active="true">Séries</span><span class="chip">One-shots</span></div></div>' +
    '<div class="sp-body"><div class="card"><div class="card-cover-wrap"><div class="sp-cover"></div>' +
    '<div class="card-badges"><span class="badge read">Lu</span><span class="badge note">8/10</span></div><span class="badge new card-new">Nouveau</span></div>' +
    '<div class="card-info"><div class="card-title">Thorgal</div><div class="card-author">Van Hamme, Rosinski</div><div class="card-count">43 tomes</div></div></div>' +
    '<div class="sp-side"><div class="sp-title">Titre de page</div><span class="genre-tag">Aventure</span>' +
    '<span class="btn">Bouton</span><div class="st-tile"><div class="st-num">2 282</div><div class="st-lab">fiches</div></div></div></div>';
  function renderStyleBlock() {
    var box = document.getElementById("style-box"), S = window.BD_STYLE;
    if (!box || !S) return;
    S.loadAllFonts();
    box.innerHTML = "";
    var wrap = st("div", "style-wrap"), left = st("div", "style-left");
    // préréglages
    var pr = st("div", "style-presets"); pr.setAttribute("role", "group"); pr.setAttribute("aria-label", "Préréglages");
    var curP = S.presetOf();
    S.presets.forEach(function (p) {
      var b = st("button", "style-opt", p.name); b.type = "button"; b.title = p.desc;
      b.setAttribute("data-preset", p.id);
      b.setAttribute("aria-pressed", curP === p.id ? "true" : "false");
      b.addEventListener("click", function () { S.applyPreset(p.id); renderStyleBlock(); });
      pr.appendChild(b);
    });
    var cur = st("span", "style-cur", curP ? "" : "personnalisé"); cur.id = "style-cur"; pr.appendChild(cur);
    left.appendChild(pr);
    S.groups.forEach(function (g) {
      var gr = st("div", "style-group");
      gr.appendChild(st("h3", "style-group-h", g.name));
      g.items.forEach(function (it) {
        var row = st("div", "style-row"); row.setAttribute("data-key", it.key);
        var lab = st("div", "style-row-lab", it.name); lab.id = "style-lab-" + it.key;
        var opts = st("div", "style-opts"); opts.setAttribute("role", "group"); opts.setAttribute("aria-labelledby", lab.id);
        var val = S.get(it.key);
        it.opts.forEach(function (o) {
          var b = st("button", "style-opt" + (it.fonts && S.fontFamily(o[0]) ? " f" : ""), o[1]); b.type = "button";
          b.setAttribute("data-val", o[0]);
          b.setAttribute("aria-pressed", val === o[0] ? "true" : "false");
          if (it.fonts && S.fontFamily(o[0])) b.style.fontFamily = S.fontFamily(o[0]);
          b.addEventListener("click", function () { S.set(it.key, o[0]); renderStyleBlock(); });
          opts.appendChild(b);
        });
        row.appendChild(lab); row.appendChild(opts); gr.appendChild(row);
      });
      left.appendChild(gr);
    });
    var prev = st("div", "style-preview"); prev.setAttribute("aria-hidden", "true"); prev.setAttribute("inert", "");
    prev.innerHTML = STYLE_PREVIEW;
    wrap.appendChild(left); wrap.appendChild(prev);
    box.appendChild(wrap);
  }
