(function () {
  "use strict";

  // Liste fixe de genres (voir README) — s'agrandira au fil des ajouts, mais reste
  // une liste fermée : pas de saisie libre, uniquement ces valeurs dans catalog.json.
  var GENRES = [
    "Aventure", "Biographie", "Documentaire", "Drame / Chronique sociale",
    "Fantastique / Horreur", "Fantasy", "Guerre", "Historique", "Humour",
    "Jeunesse", "Policier / Thriller", "Science-fiction", "Super-héros", "Western"
  ];

  var state = {
    catalog: [],
    favorites: {},     // titleId -> { is_favorite }
    volumeRead: {},    // "titleId::idx" -> true
    filters: { title: "", author: "", read: false, unread: false, inprogress: false, fav: false, genre: "" },
    activeId: null,
    activeVolIdx: 0,
  };

  function coverUrl(filename) {
    if (!filename) return "";
    return (window.BD_IMAGE_BASE || "covers/") + filename;
  }

  function volKey(titleId, idx) { return titleId + "::" + idx; }

  var els = {
    grid: document.getElementById("grid"),
    empty: document.getElementById("empty-state"),
    stats: document.getElementById("stats"),
    searchTitle: document.getElementById("search-title"),
    searchAuthor: document.getElementById("search-author"),
    filterGenre: document.getElementById("filter-genre"),
    filterRead: document.getElementById("filter-read"),
    filterInprogress: document.getElementById("filter-inprogress"),
    filterUnread: document.getElementById("filter-unread"),
    filterFav: document.getElementById("filter-fav"),
    overlay: document.getElementById("overlay"),
    sheetClose: document.getElementById("sheet-close"),
    sheetCover: document.getElementById("sheet-cover"),
    sheetCoverZoom: document.getElementById("sheet-cover-zoom"),
    sheetTitle: document.getElementById("sheet-title"),
    sheetAuthor: document.getElementById("sheet-author"),
    sheetMeta: document.getElementById("sheet-meta"),
    sheetGenres: document.getElementById("sheet-genres"),
    volumeList: document.getElementById("sheet-volume-list"),
    btnRead: document.getElementById("btn-read"),
    btnFav: document.getElementById("btn-fav"),
    syncNote: document.getElementById("sync-note"),
    zoomOverlay: document.getElementById("zoom-overlay"),
    zoomImg: document.getElementById("zoom-img"),
    zoomClose: document.getElementById("zoom-close"),
  };

  // ---------- local cache ----------
  var LOCAL_FAV_KEY = "bd_status_cache_v1";
  var LOCAL_VOL_KEY = "bd_volume_status_cache_v1";

  function loadLocalFavorites() {
    try {
      var raw = localStorage.getItem(LOCAL_FAV_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveLocalFavorites() {
    try { localStorage.setItem(LOCAL_FAV_KEY, JSON.stringify(state.favorites)); } catch (e) {}
  }
  function loadLocalVolumeRead() {
    try {
      var raw = localStorage.getItem(LOCAL_VOL_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveLocalVolumeRead() {
    try { localStorage.setItem(LOCAL_VOL_KEY, JSON.stringify(state.volumeRead)); } catch (e) {}
  }

  // ---------- computed read status ----------
  function isVolumeRead(titleId, idx) {
    return state.volumeRead[volKey(titleId, idx)] === true;
  }
  function isTitleRead(entry) {
    if (!entry.volume_count) return false;
    for (var i = 0; i < entry.volume_count; i++) {
      if (!isVolumeRead(entry.id, i)) return false;
    }
    return true;
  }
  function countRead(entry) {
    var n = 0;
    for (var i = 0; i < entry.volume_count; i++) {
      if (isVolumeRead(entry.id, i)) n++;
    }
    return n;
  }
  function isInProgress(entry) {
    var c = countRead(entry);
    return c > 0 && c < entry.volume_count;
  }

  // ---------- supabase ----------
  var supabase = null;
  function initSupabase() {
    if (!window.supabase || !window.BD_SUPABASE_URL || !window.BD_SUPABASE_ANON_KEY) {
      setSyncNote("Synchronisation indisponible (config manquante) — mode local uniquement.");
      return;
    }
    try {
      supabase = window.supabase.createClient(window.BD_SUPABASE_URL, window.BD_SUPABASE_ANON_KEY);
      fetchRemoteFavorites();
      fetchRemoteVolumeStatus();
      subscribeRealtime();
    } catch (e) {
      setSyncNote("Synchronisation indisponible — mode local uniquement.");
    }
  }

  function setSyncNote(text) {
    els.syncNote.textContent = text || "";
  }

  function fetchRemoteFavorites() {
    supabase.from("bd_status").select("id,is_favorite,updated_at")
      .then(function (res) {
        if (res.error) { setSyncNote("Synchro : hors ligne (données locales conservées)."); return; }
        (res.data || []).forEach(function (row) {
          state.favorites[row.id] = { is_favorite: !!row.is_favorite };
        });
        saveLocalFavorites();
        renderGrid();
        if (state.activeId) renderSheetActions();
        setSyncNote("");
      })
      .catch(function () { setSyncNote("Synchro : hors ligne (données locales conservées)."); });
  }

  function fetchRemoteVolumeStatus() {
    supabase.from("bd_volume_status").select("id,is_read,updated_at")
      .then(function (res) {
        if (res.error) { setSyncNote("Synchro : hors ligne (données locales conservées)."); return; }
        (res.data || []).forEach(function (row) {
          if (row.is_read) state.volumeRead[row.id] = true;
          else delete state.volumeRead[row.id];
        });
        saveLocalVolumeRead();
        renderGrid();
        if (state.activeId) { renderVolumeList(); renderSheetActions(); }
        setSyncNote("");
      })
      .catch(function () { setSyncNote("Synchro : hors ligne (données locales conservées)."); });
  }

  function subscribeRealtime() {
    supabase.channel("bd_status_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bd_status" }, function (payload) {
        var row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || !row.id) return;
        if (payload.eventType === "DELETE") { delete state.favorites[row.id]; }
        else { state.favorites[row.id] = { is_favorite: !!row.is_favorite }; }
        saveLocalFavorites();
        renderGrid();
        if (state.activeId === row.id) renderSheetActions();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bd_volume_status" }, function (payload) {
        var row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || !row.id) return;
        if (payload.eventType === "DELETE" || !row.is_read) { delete state.volumeRead[row.id]; }
        else { state.volumeRead[row.id] = true; }
        saveLocalVolumeRead();
        renderGrid();
        if (state.activeId && row.id.indexOf(state.activeId + "::") === 0) {
          renderVolumeList();
          renderSheetActions();
        }
      })
      .subscribe();
  }

  function pushFavorite(titleId) {
    if (!supabase) return;
    var f = state.favorites[titleId] || { is_favorite: false };
    supabase.from("bd_status").upsert({
      id: titleId, is_favorite: f.is_favorite, updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res.error) setSyncNote("Dernière modification pas encore synchronisée (réessaiera).");
    }).catch(function () {});
  }

  function pushVolumeStatus(titleId, idx) {
    if (!supabase) return;
    var read = isVolumeRead(titleId, idx);
    supabase.from("bd_volume_status").upsert({
      id: volKey(titleId, idx), title_id: titleId, is_read: read, updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res.error) setSyncNote("Dernière modification pas encore synchronisée (réessaiera).");
    }).catch(function () {});
  }

  function pushVolumeStatusBulk(titleId, count, read) {
    if (!supabase) return;
    var rows = [];
    var now = new Date().toISOString();
    for (var i = 0; i < count; i++) {
      rows.push({ id: volKey(titleId, i), title_id: titleId, is_read: read, updated_at: now });
    }
    supabase.from("bd_volume_status").upsert(rows).then(function (res) {
      if (res.error) setSyncNote("Dernière modification pas encore synchronisée (réessaiera).");
    }).catch(function () {});
  }

  // ---------- data ----------
  function loadCatalog() {
    // cache: "no-store" + un paramètre unique évitent qu'un navigateur (ou un cache
    // intermédiaire) serve une ancienne version de catalog.json après une mise à jour.
    fetch("data/catalog.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.catalog = data.entries;
        els.stats.textContent = data.generated_count + " séries · " + data.total_volumes + " albums";
        renderGrid();
      })
      .catch(function () {
        els.empty.hidden = false;
        els.empty.textContent = "Impossible de charger le catalogue (data/catalog.json).";
      });
  }

  // ---------- filtering ----------
  function normalize(s) {
    return (s || "").toString().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function matches(entry) {
    var fav = state.favorites[entry.id] || { is_favorite: false };
    var read = isTitleRead(entry);
    var readCount = countRead(entry);
    var inProgress = isInProgress(entry);
    if (state.filters.title && normalize(entry.title).indexOf(normalize(state.filters.title)) === -1) return false;
    if (state.filters.author && normalize(entry.author || "").indexOf(normalize(state.filters.author)) === -1) return false;
    if (state.filters.genre && (entry.genre || []).indexOf(state.filters.genre) === -1) return false;
    if (state.filters.read && !read) return false;
    if (state.filters.inprogress && !inProgress) return false;
    if (state.filters.unread && readCount > 0) return false;
    if (state.filters.fav && !fav.is_favorite) return false;
    return true;
  }

  function populateGenreFilter() {
    GENRES.forEach(function (g) {
      var opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      els.filterGenre.appendChild(opt);
    });
  }

  // ---------- render ----------
  function renderGrid() {
    var list = state.catalog.filter(matches);
    els.grid.innerHTML = "";
    els.empty.hidden = list.length > 0;
    var frag = document.createDocumentFragment();
    list.forEach(function (entry) {
      frag.appendChild(renderCard(entry));
    });
    els.grid.appendChild(frag);
  }

  function renderCard(entry) {
    var fav = state.favorites[entry.id] || {};
    var read = isTitleRead(entry);
    var readCount = countRead(entry);
    var inProgress = isInProgress(entry);
    var card = document.createElement("div");
    card.className = "card";
    card.setAttribute("data-id", entry.id);

    var coverWrap = document.createElement("div");
    coverWrap.className = "card-cover-wrap";
    var img = document.createElement("img");
    // "lazy" natif s'est révélé peu fiable ici (certaines vignettes ne se
    // chargent jamais, même visibles à l'écran) — chargement immédiat, plus
    // sûr, quitte à consommer un peu plus de bande passante à l'ouverture.
    img.alt = entry.title;
    img.src = coverUrl(entry.cover);
    if (!entry.cover) img.style.display = "none";
    coverWrap.appendChild(img);

    var badges = document.createElement("div");
    badges.className = "card-badges";
    if (entry.cover) {
      var zoomBtn = document.createElement("button");
      zoomBtn.type = "button";
      zoomBtn.className = "magnify-btn";
      zoomBtn.setAttribute("aria-label", "Agrandir la couverture");
      zoomBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      zoomBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openZoom(coverUrl(entry.cover), entry.title);
      });
      badges.appendChild(zoomBtn);
    }
    if (fav.is_favorite) {
      var bf = document.createElement("span"); bf.className = "badge fav"; bf.textContent = "★"; badges.appendChild(bf);
    }
    if (read) {
      var br = document.createElement("span"); br.className = "badge read"; br.textContent = "Lu"; badges.appendChild(br);
    } else if (inProgress) {
      var bp = document.createElement("span"); bp.className = "badge inprogress"; bp.textContent = readCount + "/" + entry.volume_count + " lus"; badges.appendChild(bp);
    }
    coverWrap.appendChild(badges);

    var info = document.createElement("div");
    info.className = "card-info";
    var t = document.createElement("div"); t.className = "card-title"; t.textContent = entry.title;
    var a = document.createElement("div"); a.className = "card-author"; a.textContent = entry.author || "Auteur non renseigné";
    var c = document.createElement("div"); c.className = "card-count"; c.textContent = entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome");
    info.appendChild(t); info.appendChild(a); info.appendChild(c);

    card.appendChild(coverWrap);
    card.appendChild(info);
    card.addEventListener("click", function () { openSheet(entry.id); });
    return card;
  }

  // ---------- detail sheet ----------
  function currentEntry() {
    return state.catalog.find(function (e) { return e.id === state.activeId; });
  }

  function openSheet(id) {
    var entry = state.catalog.find(function (e) { return e.id === id; });
    if (!entry) return;
    state.activeId = id;
    state.activeVolIdx = 0;
    els.sheetTitle.textContent = entry.title;
    els.sheetAuthor.textContent = entry.author || "Auteur non renseigné";
    els.sheetMeta.textContent = entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome") + (entry.parent_series ? " · série liée à " + entry.parent_series : "");
    renderSheetGenres(entry);
    setActiveCover(entry, 0);
    renderVolumeList();
    renderSheetActions();
    els.overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function renderSheetGenres(entry) {
    els.sheetGenres.innerHTML = "";
    var genres = entry.genre || [];
    if (!genres.length) { els.sheetGenres.hidden = true; return; }
    els.sheetGenres.hidden = false;
    genres.forEach(function (g) {
      var tag = document.createElement("span");
      tag.className = "genre-tag";
      tag.textContent = g;
      els.sheetGenres.appendChild(tag);
    });
  }

  function setActiveCover(entry, idx) {
    state.activeVolIdx = idx;
    var vol = entry.volumes[idx];
    var cover = (vol && vol.cover) || entry.cover;
    var alt = entry.title + (vol ? " — " + vol.label : "");
    if (cover) {
      els.sheetCover.src = coverUrl(cover);
      els.sheetCover.style.display = "";
      els.sheetCoverZoom.hidden = false;
      state.activeCoverUrl = coverUrl(cover);
    } else {
      els.sheetCover.removeAttribute("src");
      els.sheetCover.style.display = "none";
      els.sheetCoverZoom.hidden = true;
      state.activeCoverUrl = null;
    }
    els.sheetCover.alt = alt;
    state.activeCoverAlt = alt;
  }

  // ---------- zoom overlay ----------
  function openZoom(url, alt) {
    if (!url) return;
    els.zoomImg.src = url;
    els.zoomImg.alt = alt || "";
    els.zoomOverlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeZoom() {
    els.zoomOverlay.hidden = true;
    els.zoomImg.removeAttribute("src");
    // le sheet reste ouvert derrière le zoom : ne restaure le scroll que si
    // aucune autre couche modale n'est ouverte.
    if (els.overlay.hidden) document.body.style.overflow = "";
  }

  function renderVolumeList() {
    var entry = currentEntry();
    if (!entry) return;
    els.volumeList.innerHTML = "";
    entry.volumes.forEach(function (v, i) {
      var li = document.createElement("li");
      li.className = "vol-row" + (isVolumeRead(entry.id, i) ? " is-read" : "") + (i === state.activeVolIdx ? " active" : "");

      var check = document.createElement("button");
      check.type = "button";
      check.className = "vol-check";
      check.setAttribute("aria-label", "Marquer ce tome comme lu");
      check.textContent = isVolumeRead(entry.id, i) ? "✓" : "";
      check.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleVolumeRead(entry.id, i);
      });

      var num = document.createElement("span"); num.className = "num";
      num.textContent = String(i + 1).padStart(2, "0");
      var label = document.createElement("span"); label.className = "vol-label"; label.textContent = v.label;

      li.appendChild(check);
      li.appendChild(num);
      li.appendChild(label);
      li.addEventListener("click", function () {
        setActiveCover(entry, i);
        renderVolumeList();
      });
      els.volumeList.appendChild(li);
    });
  }

  function toggleVolumeRead(titleId, idx) {
    var key = volKey(titleId, idx);
    if (state.volumeRead[key]) delete state.volumeRead[key];
    else state.volumeRead[key] = true;
    saveLocalVolumeRead();
    renderVolumeList();
    renderSheetActions();
    renderGrid();
    pushVolumeStatus(titleId, idx);
  }

  function renderSheetActions() {
    var entry = currentEntry();
    if (!entry) return;
    var allRead = isTitleRead(entry);
    els.btnRead.setAttribute("data-on", allRead ? "true" : "false");
    els.btnRead.textContent = allRead ? "✓ Tout marquer comme non lu" : "Tout marquer comme lu";

    var fav = state.favorites[entry.id] || { is_favorite: false };
    els.btnFav.setAttribute("data-on", fav.is_favorite ? "true" : "false");
    els.btnFav.textContent = fav.is_favorite ? "★ Dans les favoris" : "★ Ajouter aux favoris";
  }

  function closeSheet() {
    if (!els.zoomOverlay.hidden) closeZoom();
    els.overlay.hidden = true;
    state.activeId = null;
    document.body.style.overflow = "";
  }

  function toggleAllVolumesRead() {
    var entry = currentEntry();
    if (!entry) return;
    var makeRead = !isTitleRead(entry);
    for (var i = 0; i < entry.volume_count; i++) {
      var key = volKey(entry.id, i);
      if (makeRead) state.volumeRead[key] = true;
      else delete state.volumeRead[key];
    }
    saveLocalVolumeRead();
    renderVolumeList();
    renderSheetActions();
    renderGrid();
    pushVolumeStatusBulk(entry.id, entry.volume_count, makeRead);
  }

  function toggleFavorite() {
    var entry = currentEntry();
    if (!entry) return;
    var f = state.favorites[entry.id] || { is_favorite: false };
    f.is_favorite = !f.is_favorite;
    state.favorites[entry.id] = f;
    saveLocalFavorites();
    renderSheetActions();
    renderGrid();
    pushFavorite(entry.id);
  }

  // ---------- wiring ----------
  els.searchTitle.addEventListener("input", function () { state.filters.title = els.searchTitle.value; renderGrid(); });
  els.searchAuthor.addEventListener("input", function () { state.filters.author = els.searchAuthor.value; renderGrid(); });
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

  els.sheetClose.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", function (e) { if (e.target === els.overlay) closeSheet(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!els.zoomOverlay.hidden) closeZoom();
    else closeSheet();
  });
  els.btnRead.addEventListener("click", toggleAllVolumesRead);
  els.btnFav.addEventListener("click", toggleFavorite);

  els.sheetCoverZoom.addEventListener("click", function () {
    openZoom(state.activeCoverUrl, state.activeCoverAlt);
  });
  els.zoomClose.addEventListener("click", closeZoom);
  els.zoomOverlay.addEventListener("click", function (e) { if (e.target === els.zoomOverlay) closeZoom(); });

  // ---------- boot ----------
  populateGenreFilter();
  state.favorites = loadLocalFavorites();
  state.volumeRead = loadLocalVolumeRead();
  loadCatalog();
  initSupabase();
})();
