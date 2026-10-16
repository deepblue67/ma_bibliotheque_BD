(function () {
  "use strict";

  // Liste fixe de genres (voir README) — s'agrandira au fil des ajouts, mais reste
  // une liste fermée : pas de saisie libre, uniquement ces valeurs dans catalog.json.
  var GENRES = [
    "Aventure", "Biographie", "Documentaire", "Drame / Chronique sociale",
    "Fantastique / Horreur", "Fantasy", "Guerre", "Historique", "Humour",
    "Jeunesse", "Policier / Thriller", "Science-fiction", "Super-héros", "Western"
  ];

  // ---------- mode propriétaire ----------
  // Garde-fou, pas une serrure : sans le code, les statuts (lu, en cours, favoris) ne
  // sont ni lus ni affichés, et les commandes qui écrivent dans Supabase n'apparaissent
  // pas. Mais les règles Supabase restent ouvertes en écriture à la clé publique : quelqu'un
  // qui lit le code source peut toujours écrire dans la base. Le code n'est stocké nulle
  // part. config.js ne contient que son empreinte PBKDF2 (BD_OWNER_HASH), et l'appareil
  // déverrouillé garde cette même empreinte dans son localStorage.
  var OWNER_KEY = "bd_owner_v1";
  var OWNER_SALT = "ma-bibliotheque-bd/owner/v1";
  var OWNER_ITER = 200000;
  function ownerHashConfigured() { return (window.BD_OWNER_HASH || "").trim().toLowerCase(); }
  function ownerHashStored() { try { return localStorage.getItem(OWNER_KEY) || ""; } catch (e) { return ""; } }
  var IS_OWNER = !!ownerHashConfigured() && ownerHashStored() === ownerHashConfigured();
  document.documentElement.classList.toggle("is-owner", IS_OWNER);

  function deriveOwnerHash(code) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(OWNER_SALT), iterations: OWNER_ITER }, key, 256);
      })
      .then(function (bits) {
        return Array.prototype.map.call(new Uint8Array(bits), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      });
  }

  var state = {
    catalog: [],
    favorites: {},     // titleId -> { is_favorite }
    volumeRead: {},    // "titleId::idx" -> true
    filters: { title: "", author: "", read: false, unread: false, inprogress: false, fav: false, genre: "", kind: "" },
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
    filterSeries: document.getElementById("filter-series"),
    filterOneshot: document.getElementById("filter-oneshot"),
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
        // "hidden" : fiche masquée (ex : ancien dossier d'une série remplacé par un plus
        // complet). Elle reste dans le catalogue pour que le prochain import la reconnaisse
        // et ne la réinsère pas, mais elle n'est jamais affichée ni comptée.
        state.catalog = data.entries.filter(function (e) { return !e.hidden; });
        buildSearchIndex(state.catalog);
        var nOne = state.catalog.filter(function (e) { return e.one_shot; }).length;
        var nSer = state.catalog.length - nOne;
        var nVol = state.catalog.reduce(function (t, e) { return t + e.volume_count; }, 0);
        els.stats.textContent = nSer + " séries · " + nOne + " one-shots · " + nVol + " albums";
        renderGrid();
      })
      .catch(function () {
        els.empty.hidden = false;
        els.empty.textContent = "Impossible de charger le catalogue (data/catalog.json).";
      });
  }

  // ---------- filtering ----------
  // Normalisation pour la recherche : minuscules, sans accents, apostrophes droites
  // ou courbes confondues, et toute ponctuation (tirets, points, deux-points…) vue
  // comme un espace. « kim jong un » trouve donc « Kim Jong-un », et « l'arabe »
  // trouve « L’Arabe ».
  function normalize(s) {
    return (s || "").toString().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2019\u2018\u02bc\u0060\u00b4]/g, "'")
      .replace(/œ/g, "oe").replace(/æ/g, "ae")
      .replace(/[^a-z0-9']+/g, " ")
      .replace(/'/g, "")
      .replace(/\s+/g, " ").trim();
  }

  // Index de recherche precalcule une fois au chargement : titre de la serie
  // + titres de tous ses tomes (on retrouve Thorgal en tapant « magicienne trahie »).
  function buildSearchIndex(entries) {
    entries.forEach(function (e) {
      var labels = (e.volumes || []).map(function (v) { return v.label; }).join(" ");
      e._qTitle = " " + normalize(e.title) + " ";
      e._qAll = " " + normalize(e.title + " " + labels) + " ";
      e._qAuthor = " " + normalize(e.author || "") + " ";
    });
  }

  // Tous les mots tapes doivent se retrouver, dans n'importe quel ordre.
  function hasAllWords(haystack, query) {
    var words = normalize(query).split(" ");
    for (var i = 0; i < words.length; i++) {
      if (words[i] && haystack.indexOf(words[i]) === -1) return false;
    }
    return true;
  }

  function matches(entry) {
    var fav = state.favorites[entry.id] || { is_favorite: false };
    var read = isTitleRead(entry);
    var readCount = countRead(entry);
    var inProgress = isInProgress(entry);
    if (state.filters.title && !hasAllWords(entry._qAll, state.filters.title)) return false;
    if (state.filters.author && !hasAllWords(entry._qAuthor, state.filters.author)) return false;
    if (state.filters.genre && (entry.genre || []).indexOf(state.filters.genre) === -1) return false;
    if (!IS_OWNER) { /* visiteur : filtres de statut ignorés (et masqués) */ }
    else if (state.filters.read && !read) return false;
    if (IS_OWNER && state.filters.inprogress && !inProgress) return false;
    if (state.filters.kind === "oneshot" && !entry.one_shot) return false;
    if (state.filters.kind === "series" && entry.one_shot) return false;
    if (IS_OWNER && state.filters.unread && readCount > 0) return false;
    if (IS_OWNER && state.filters.fav && !fav.is_favorite) return false;
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

  // ---------- chargement differe des vignettes ----------
  var lazyObserver = ("IntersectionObserver" in window) ? new IntersectionObserver(function (items) {
    items.forEach(function (it) {
      if (!it.isIntersecting) return;
      var im = it.target;
      im.src = im.getAttribute("data-src");
      im.removeAttribute("data-src");
      lazyObserver.unobserve(im);
    });
  }, { rootMargin: "800px 0px" }) : null;

  function lazyImage(img, url) {
    if (!url) return;
    if (!lazyObserver) { img.src = url; return; }   // navigateur ancien : chargement direct
    img.setAttribute("data-src", url);
    lazyObserver.observe(img);
  }

  var renderTimer = null;
  function renderGridSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderGrid, 150);
  }

  // ---------- render ----------
  function renderGrid() {
    var list = state.catalog.filter(matches);
    if (lazyObserver) lazyObserver.disconnect();
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
    // Chargement differe : avec ~2000 vignettes, tout charger a l'ouverture pesait
    // ~140 Mo. On n'utilise PAS loading="lazy" (natif), qui s'etait revele peu fiable
    // ici (vignettes jamais chargees), mais un IntersectionObserver explicite.
    lazyImage(img, coverUrl(entry.cover));
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
    if (IS_OWNER && fav.is_favorite) {
      var bf = document.createElement("span"); bf.className = "badge fav"; bf.textContent = "★"; badges.appendChild(bf);
    }
    if (!IS_OWNER) {
      // visiteur : pas de pastille de statut
    } else if (read) {
      var br = document.createElement("span"); br.className = "badge read"; br.textContent = "Lu"; badges.appendChild(br);
    } else if (inProgress) {
      var bp = document.createElement("span"); bp.className = "badge inprogress"; bp.textContent = readCount + "/" + entry.volume_count + " lus"; badges.appendChild(bp);
    }
    coverWrap.appendChild(badges);

    var info = document.createElement("div");
    info.className = "card-info";
    var t = document.createElement("div"); t.className = "card-title"; t.textContent = entry.title;
    var a = document.createElement("div"); a.className = "card-author"; a.textContent = entry.author || "Auteur non renseigné";
    var c = document.createElement("div"); c.className = "card-count" + (entry.one_shot ? " oneshot" : ""); c.textContent = entry.one_shot ? "One-shot" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome");
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
    els.sheetMeta.textContent = (entry.one_shot ? "One-shot · album unique" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome")) + (entry.parent_series ? " · série liée à " + entry.parent_series : "");
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
      li.className = "vol-row" + (IS_OWNER && isVolumeRead(entry.id, i) ? " is-read" : "") + (i === state.activeVolIdx ? " active" : "");

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

      if (IS_OWNER) li.appendChild(check);
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
    if (entry.one_shot) els.btnRead.textContent = allRead ? "✓ Lu — marquer comme non lu" : "Marquer comme lu";
    else els.btnRead.textContent = allRead ? "✓ Tout marquer comme non lu" : "Tout marquer comme lu";

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
  els.searchTitle.addEventListener("input", function () { state.filters.title = els.searchTitle.value; renderGridSoon(); });
  els.searchAuthor.addEventListener("input", function () { state.filters.author = els.searchAuthor.value; renderGridSoon(); });
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

  // ---------- réglages ----------
  var settingsEls = {
    overlay: document.getElementById("settings-overlay"),
    open: document.getElementById("settings-open"),
    close: document.getElementById("settings-close"),
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
    if (!window.crypto || !crypto.subtle) {
      box.innerHTML = '<p class="settings-hint">Ce navigateur ne permet pas le mode propriétaire (il faut une page en https).</p>';
      return;
    }
    var configured = !!ownerHashConfigured();
    var html = "";
    if (IS_OWNER) {
      html += '<p class="owner-status on">Mode propriétaire actif sur cet appareil : tu peux cocher les statuts. Tes visiteurs, eux, ne voient que la bibliothèque.</p>' +
              '<div class="owner-row"><button type="button" class="btn" id="owner-quit">Quitter le mode propriétaire</button>' +
              '<button type="button" class="btn btn-ghost" id="owner-change">Changer de code…</button></div>';
    } else if (configured) {
      html += '<p class="owner-status">Cet appareil est en mode visiteur. Saisis ton code pour retrouver tes statuts et pouvoir les modifier.</p>' +
              '<form id="owner-unlock" class="owner-form" autocomplete="on">' +
              '<input type="password" id="owner-code" class="owner-input" placeholder="Code propriétaire" autocomplete="current-password" required>' +
              '<button type="submit" class="btn">Déverrouiller</button></form>' +
              '<p id="owner-msg" class="owner-msg" role="status"></p>';
    } else {
      html += '<p class="owner-status">Le mode propriétaire n\'est pas encore configuré : l\'appli est en lecture seule pour tout le monde, toi compris.</p>';
    }
    if (!configured || IS_OWNER) {
      html += '<div id="owner-gen" class="owner-gen"' + (IS_OWNER ? ' hidden' : '') + '>' +
              '<p class="settings-hint">' + (configured ? 'Choisis un nouveau code.' : 'Choisis ton code (au moins 6 caractères).') +
              ' L\'appli en calcule une empreinte, qu\'il faudra recopier dans <code>config.js</code> puis publier. Le code lui-même n\'est enregistré nulle part.</p>' +
              '<form id="owner-genform" class="owner-form" autocomplete="off">' +
              '<input type="password" id="owner-new1" class="owner-input" placeholder="Code" autocomplete="new-password" minlength="6" required>' +
              '<input type="password" id="owner-new2" class="owner-input" placeholder="Confirme le code" autocomplete="new-password" minlength="6" required>' +
              '<button type="submit" class="btn">Générer l\'empreinte</button></form>' +
              '<p id="owner-genmsg" class="owner-msg" role="status"></p>' +
              '<div id="owner-out" class="owner-out" hidden></div></div>';
    }
    box.innerHTML = html;

    var quit = document.getElementById("owner-quit");
    if (quit) quit.addEventListener("click", function () {
      try { localStorage.removeItem(OWNER_KEY); } catch (e) {}
      location.reload();
    });
    var change = document.getElementById("owner-change");
    if (change) change.addEventListener("click", function () {
      document.getElementById("owner-gen").hidden = false; change.hidden = true;
    });
    var unlock = document.getElementById("owner-unlock");
    if (unlock) unlock.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("owner-msg");
      msg.textContent = "Vérification…"; msg.className = "owner-msg";
      deriveOwnerHash(document.getElementById("owner-code").value).then(function (h) {
        if (h === ownerHashConfigured()) {
          try { localStorage.setItem(OWNER_KEY, h); } catch (e2) {}
          location.reload();
        } else {
          msg.textContent = "Code incorrect."; msg.className = "owner-msg err";
        }
      });
    });
    var gen = document.getElementById("owner-genform");
    if (gen) gen.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = document.getElementById("owner-new1").value, b = document.getElementById("owner-new2").value;
      var msg = document.getElementById("owner-genmsg"), out = document.getElementById("owner-out");
      out.hidden = true;
      if (a.length < 6) { msg.textContent = "Le code doit faire au moins 6 caractères."; msg.className = "owner-msg err"; return; }
      if (a !== b) { msg.textContent = "Les deux saisies ne sont pas identiques."; msg.className = "owner-msg err"; return; }
      msg.textContent = "Calcul…"; msg.className = "owner-msg";
      deriveOwnerHash(a).then(function (h) {
        var line = 'window.BD_OWNER_HASH = "' + h + '";';
        msg.textContent = "";
        out.innerHTML = '<p class="settings-hint">Remplace la ligne <code>window.BD_OWNER_HASH</code> de <code>config.js</code> par celle-ci, puis publie (commit + push). Ensuite, reviens ici et saisis ton code pour déverrouiller.</p>' +
                        '<pre class="owner-line">' + esc(line) + '</pre><button type="button" class="btn" id="owner-copy">Copier la ligne</button>';
        out.hidden = false;
        document.getElementById("owner-copy").addEventListener("click", function () {
          var btn = this;
          (navigator.clipboard ? navigator.clipboard.writeText(line) : Promise.reject()).then(
            function () { btn.textContent = "✓ Copiée"; },
            function () { btn.textContent = "Sélectionne et copie la ligne"; });
        });
        document.getElementById("owner-new1").value = ""; document.getElementById("owner-new2").value = "";
      });
    });
  }

  function openSettings() {
    if (window.BD_THEMES) window.BD_THEMES.loadAllFonts();
    renderThemeGrid();
    renderOwnerPanel();
    settingsEls.overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSettings() {
    settingsEls.overlay.hidden = true;
    if (els.overlay.hidden) document.body.style.overflow = "";
  }
  settingsEls.open.addEventListener("click", openSettings);
  settingsEls.close.addEventListener("click", closeSettings);
  settingsEls.overlay.addEventListener("click", function (e) { if (e.target === settingsEls.overlay) closeSettings(); });

  els.sheetClose.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", function (e) { if (e.target === els.overlay) closeSheet(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!settingsEls.overlay.hidden) closeSettings();
    else if (!els.zoomOverlay.hidden) closeZoom();
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
  if (IS_OWNER) {
    state.favorites = loadLocalFavorites();
    state.volumeRead = loadLocalVolumeRead();
  }
  loadCatalog();
  if (IS_OWNER) initSupabase();
})();
