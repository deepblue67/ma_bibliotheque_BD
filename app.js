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
    raw: [],           // catalogue tel que généré (data/catalog.json), jamais modifié
    catalog: [],       // fiches visibles, corrections appliquées (voir applyOverrides)
    hiddenList: [],    // fiches masquées (import ou propriétaire)
    overrides: {},     // corrections : "id" ou "id::index" -> { hidden, title, author, genre }
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
  // entry._vis = index D'ORIGINE des tomes visibles (un tome masqué garde sa place :
  // les clés "id::index" de bd_volume_status ne bougent donc jamais).
  function isTitleRead(entry) {
    var v = entry._vis || [];
    if (!v.length) return false;
    for (var k = 0; k < v.length; k++) {
      if (!isVolumeRead(entry.id, v[k])) return false;
    }
    return true;
  }
  function countRead(entry) {
    var v = entry._vis || [], n = 0;
    for (var k = 0; k < v.length; k++) {
      if (isVolumeRead(entry.id, v[k])) n++;
    }
    return n;
  }
  function isInProgress(entry) {
    var c = countRead(entry);
    return c > 0 && c < (entry._vis || []).length;
  }

  // ---------- corrections (masquer / corriger) ----------
  // Le catalogue n'est jamais modifié : les corrections sont stockées à part (Supabase,
  // table bd_overrides, + copie locale) et appliquées par-dessus, pour tout le monde.
  // Clé = id de fiche, ou "id::index" pour un tome. Comme le prochain import garde les
  // mêmes identifiants, une correction ou un masquage n'est jamais écrasé par un réimport.
  var LOCAL_OV_KEY = "bd_overrides_cache_v1";
  function loadLocalOverrides() {
    try { var raw = localStorage.getItem(LOCAL_OV_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
  }
  function saveLocalOverrides() {
    try { localStorage.setItem(LOCAL_OV_KEY, JSON.stringify(state.overrides)); } catch (e) {}
  }
  function sameGenres(a, b) {
    a = (a || []).slice().sort(); b = (b || []).slice().sort();
    return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
  }

  function applyOverrides() {
    var list = [], hidden = [];
    state.raw.forEach(function (r) {
      var o = state.overrides[r.id] || {};
      var isHidden = (o.hidden === true || o.hidden === false) ? o.hidden : !!r.hidden;
      var labels = [], vis = [], hid = [];
      (r.volumes || []).forEach(function (v, i) {
        var vo = state.overrides[volKey(r.id, i)] || {};
        labels.push(vo.title || v.label);
        if (vo.hidden === true) hid.push(i); else vis.push(i);
      });
      var first = vis.length ? r.volumes[vis[0]] : null;
      var e = {
        id: r.id,
        title: o.title || r.title,
        author: o.author || r.author,
        genre: Array.isArray(o.genre) ? o.genre : (r.genre || []),
        one_shot: r.one_shot,
        parent_series: r.parent_series,
        volumes: r.volumes,
        cover: (first && first.cover) || null,
        volume_count: vis.length,
        _labels: labels, _vis: vis, _hidVols: hid, _raw: r,
        _edited: !!(o.title || o.author || Array.isArray(o.genre))
      };
      (isHidden ? hidden : list).push(e);
    });
    var cmp = function (a, b) { return a.title.localeCompare(b.title, "fr", { sensitivity: "base", numeric: true }); };
    list.sort(cmp); hidden.sort(cmp);
    buildSearchIndex(list);
    state.catalog = list;
    state.hiddenList = hidden;
    var nOne = list.filter(function (e) { return e.one_shot; }).length;
    var nVol = list.reduce(function (t, e) { return t + e.volume_count; }, 0);
    els.stats.textContent = (list.length - nOne) + " séries · " + nOne + " one-shots · " + nVol + " albums";
  }

  function refreshAll() {
    if (!state.raw.length) return;
    applyOverrides();
    renderGrid();
    if (state.activeId) {
      if (currentEntry()) refreshSheet(); else closeSheet();
    }
    if (settingsEls && !settingsEls.overlay.hidden) renderHiddenList();
  }

  // Enregistre une correction (fusionnée avec l'existante). Appliquée tout de suite à
  // l'écran, puis envoyée à Supabase ; en cas d'échec, on revient en arrière.
  function saveOverride(key, patch, onOk) {
    var prev = state.overrides[key] ? JSON.parse(JSON.stringify(state.overrides[key])) : null;
    var cur = { hidden: null, title: null, author: null, genre: null };
    if (prev) Object.keys(cur).forEach(function (k) { if (prev[k] !== undefined) cur[k] = prev[k]; });
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    var empty = cur.hidden === null && !cur.title && !cur.author && !Array.isArray(cur.genre);
    if (empty) delete state.overrides[key]; else state.overrides[key] = cur;
    saveLocalOverrides();
    refreshAll();
    function rollback(msg) {
      if (prev) state.overrides[key] = prev; else delete state.overrides[key];
      saveLocalOverrides();
      refreshAll();
      toast("Non enregistré : " + msg);
    }
    if (!supabase) { rollback("synchronisation indisponible."); return; }
    var q = empty
      ? supabase.from("bd_overrides").delete().eq("id", key)
      : supabase.from("bd_overrides").upsert({ id: key, hidden: cur.hidden, title: cur.title || null,
          author: cur.author || null, genre: Array.isArray(cur.genre) ? cur.genre : null, updated_at: new Date().toISOString() });
    q.then(function (res) {
      if (res.error) rollback(res.error.message || "erreur Supabase");
      else if (onOk) onOk();
    }).catch(function (err) { rollback((err && err.message) || "hors ligne"); });
  }

  function fetchOverrides() {
    supabase.from("bd_overrides").select("id,hidden,title,author,genre")
      .then(function (res) {
        if (res.error) {
          if (IS_OWNER) setSyncNote("Corrections indisponibles : la table bd_overrides n'existe pas encore dans Supabase (voir README).");
          return;
        }
        var map = {};
        (res.data || []).forEach(function (row) {
          map[row.id] = { hidden: row.hidden, title: row.title, author: row.author, genre: row.genre };
        });
        state.overrides = map;
        saveLocalOverrides();
        refreshAll();
      })
      .catch(function () {});
  }

  // ---------- supabase ----------
  var supabase = null;
  function initSupabase() {
    if (!window.supabase || !window.BD_SUPABASE_URL || !window.BD_SUPABASE_ANON_KEY) {
      if (IS_OWNER) setSyncNote("Synchronisation indisponible (config manquante) — mode local uniquement.");
      return;
    }
    try {
      supabase = window.supabase.createClient(window.BD_SUPABASE_URL, window.BD_SUPABASE_ANON_KEY);
      // les corrections concernent tout le monde (titres corrigés, fiches masquées)…
      fetchOverrides();
      // …les statuts et la synchro en direct, seulement le propriétaire
      if (IS_OWNER) {
        fetchRemoteFavorites();
        fetchRemoteVolumeStatus();
        subscribeRealtime();
      }
    } catch (e) {
      if (IS_OWNER) setSyncNote("Synchronisation indisponible — mode local uniquement.");
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
    // canal séparé : si la table bd_overrides n'existe pas encore, seul ce canal échoue
    // et la synchro des statuts continue de fonctionner.
    supabase.channel("bd_overrides_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bd_overrides" }, function (payload) {
        var row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || !row.id) return;
        if (payload.eventType === "DELETE") delete state.overrides[row.id];
        else state.overrides[row.id] = { hidden: row.hidden, title: row.title, author: row.author, genre: row.genre };
        saveLocalOverrides();
        refreshAll();
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

  function pushVolumeStatusBulk(titleId, indices, read) {
    if (!supabase) return;
    var now = new Date().toISOString();
    var rows = indices.map(function (i) {
      return { id: volKey(titleId, i), title_id: titleId, is_read: read, updated_at: now };
    });
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
        state.raw = data.entries;
        applyOverrides();
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
      var labels = (e._vis || []).map(function (i) { return e._labels[i]; }).join(" ");
      var orig = e._raw && e._raw.title !== e.title ? " " + e._raw.title : "";
      e._qTitle = " " + normalize(e.title) + " ";
      e._qAll = " " + normalize(e.title + orig + " " + labels) + " ";
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
    state.activeVolIdx = entry._vis.length ? entry._vis[0] : 0;
    state.editVol = null;
    closeEditor();
    refreshSheet();
    els.overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  // Remplit la fiche ouverte à partir de l'état courant (appelé aussi après une correction).
  function refreshSheet() {
    var entry = currentEntry();
    if (!entry) return;
    if (entry._vis.indexOf(state.activeVolIdx) === -1 && !(IS_OWNER && entry._hidVols.indexOf(state.activeVolIdx) !== -1)) {
      state.activeVolIdx = entry._vis.length ? entry._vis[0] : 0;
    }
    els.sheetTitle.textContent = entry.title;
    els.sheetAuthor.textContent = entry.author || "Auteur non renseigné";
    els.sheetMeta.textContent = (entry.one_shot ? "One-shot · album unique" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome")) + (entry.parent_series ? " · série liée à " + entry.parent_series : "");
    var orig = document.getElementById("sheet-orig");
    if (orig) {
      var r = entry._raw, bits = [];
      if (r.title !== entry.title) bits.push("titre « " + r.title + " »");
      if ((r.author || "") !== (entry.author || "")) bits.push("auteur « " + (r.author || "non renseigné") + " »");
      if (!sameGenres(r.genre, entry.genre)) bits.push("genres « " + ((r.genre || []).join(", ") || "aucun") + " »");
      orig.textContent = bits.length ? "Corrigé par toi — d'origine : " + bits.join(", ") : "";
      orig.hidden = !bits.length;
    }
    renderSheetGenres(entry);
    setActiveCover(entry, state.activeVolIdx);
    renderVolumeList();
    renderSheetActions();
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
    var alt = entry.title + (vol ? " — " + (entry._labels ? entry._labels[idx] : vol.label) : "");
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
    // visiteur : tomes visibles seulement ; propriétaire : tous, les masqués grisés
    var order = IS_OWNER ? entry.volumes.map(function (_, i) { return i; }) : entry._vis;
    var pos = 0;
    order.forEach(function (i) {
      var hiddenVol = entry._hidVols.indexOf(i) !== -1;
      if (!hiddenVol) pos++;
      var li = document.createElement("li");
      li.className = "vol-row" + (IS_OWNER && !hiddenVol && isVolumeRead(entry.id, i) ? " is-read" : "") +
                     (hiddenVol ? " is-hidden" : "") + (i === state.activeVolIdx ? " active" : "");

      if (IS_OWNER && !hiddenVol) {
        var check = document.createElement("button");
        check.type = "button";
        check.className = "vol-check";
        check.setAttribute("aria-label", "Marquer ce tome comme lu");
        check.textContent = isVolumeRead(entry.id, i) ? "✓" : "";
        check.addEventListener("click", function (e) {
          e.stopPropagation();
          toggleVolumeRead(entry.id, i);
        });
        li.appendChild(check);
      } else if (IS_OWNER) {
        var gap = document.createElement("span"); gap.className = "vol-check-gap"; li.appendChild(gap);
      }

      var num = document.createElement("span"); num.className = "num";
      num.textContent = hiddenVol ? "––" : String(pos).padStart(2, "0");
      var label = document.createElement("span"); label.className = "vol-label";
      label.textContent = entry._labels[i] + (hiddenVol ? "  (masqué)" : "");
      li.appendChild(num);
      li.appendChild(label);

      if (IS_OWNER) {
        var pen = document.createElement("button");
        pen.type = "button";
        pen.className = "vol-edit";
        pen.setAttribute("aria-label", "Corriger ou masquer ce tome");
        pen.title = "Corriger ou masquer ce tome";
        pen.textContent = "✎";
        pen.addEventListener("click", function (e) {
          e.stopPropagation();
          state.editVol = state.editVol === i ? null : i;
          renderVolumeList();
        });
        li.appendChild(pen);
      }
      li.addEventListener("click", function () {
        setActiveCover(entry, i);
        renderVolumeList();
      });
      els.volumeList.appendChild(li);
      if (IS_OWNER && state.editVol === i) els.volumeList.appendChild(renderVolEditor(entry, i, hiddenVol));
    });
  }

  // Petit éditeur sous un tome (propriétaire) : libellé, rétablir, masquer / ré-afficher.
  function renderVolEditor(entry, i, hiddenVol) {
    var key = volKey(entry.id, i);
    var o = state.overrides[key] || {};
    var original = entry.volumes[i].label;
    var li = document.createElement("li");
    li.className = "vol-editor";
    li.innerHTML =
      '<form class="vol-editor-form">' +
      '<input type="text" class="owner-input vol-editor-input" aria-label="Titre du tome">' +
      '<button type="submit" class="btn">Enregistrer</button>' +
      '<button type="button" class="btn btn-ghost" data-act="cancel">Annuler</button></form>' +
      '<div class="vol-editor-row"></div>' +
      '<p class="edit-orig"></p>';
    var input = li.querySelector("input");
    input.value = entry._labels[i];
    input.placeholder = original;
    var row = li.querySelector(".vol-editor-row");
    if (o.title) {
      li.querySelector(".edit-orig").textContent = "Sur le disque : « " + original + " »";
      var rb = document.createElement("button"); rb.type = "button"; rb.className = "btn btn-ghost"; rb.textContent = "Rétablir le titre d'origine";
      rb.addEventListener("click", function () { state.editVol = null; saveOverride(key, { title: null }, function () { toast("Titre du tome rétabli."); }); });
      row.appendChild(rb);
    }
    if (!entry.one_shot) {
      var hb = document.createElement("button"); hb.type = "button";
      hb.className = hiddenVol ? "btn" : "btn btn-danger";
      hb.textContent = hiddenVol ? "Ré-afficher ce tome" : "Masquer ce tome";
      hb.addEventListener("click", function () {
        state.editVol = null;
        saveOverride(key, { hidden: hiddenVol ? null : true }, function () {
          toast(hiddenVol ? "Tome ré-affiché." : "Tome masqué.", hiddenVol ? null : "Annuler",
                function () { saveOverride(key, { hidden: null }); });
        });
      });
      row.appendChild(hb);
    }
    li.querySelector('[data-act="cancel"]').addEventListener("click", function () { state.editVol = null; renderVolumeList(); });
    li.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = input.value.trim();
      state.editVol = null;
      saveOverride(key, { title: (!v || v === original) ? null : v }, function () { toast("Titre du tome enregistré."); });
    });
    setTimeout(function () { input.focus(); input.select(); }, 0);
    return li;
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
    closeEditor();
    state.editVol = null;
    if (!els.zoomOverlay.hidden) closeZoom();
    els.overlay.hidden = true;
    state.activeId = null;
    document.body.style.overflow = "";
  }

  function toggleAllVolumesRead() {
    var entry = currentEntry();
    if (!entry) return;
    var makeRead = !isTitleRead(entry);
    entry._vis.forEach(function (i) {
      var key = volKey(entry.id, i);
      if (makeRead) state.volumeRead[key] = true;
      else delete state.volumeRead[key];
    });
    saveLocalVolumeRead();
    renderVolumeList();
    renderSheetActions();
    renderGrid();
    pushVolumeStatusBulk(entry.id, entry._vis, makeRead);
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

  // ---------- édition d'une fiche (propriétaire) ----------
  var edit = {
    box: document.getElementById("sheet-edit"),
    form: document.getElementById("edit-form"),
    title: document.getElementById("edit-title"),
    author: document.getElementById("edit-author"),
    g1: document.getElementById("edit-genre1"),
    g2: document.getElementById("edit-genre2"),
    reset: document.getElementById("edit-reset"),
    cancel: document.getElementById("edit-cancel"),
    hide: document.getElementById("edit-hide"),
    confirm: document.getElementById("edit-hide-confirm"),
    yes: document.getElementById("edit-hide-yes"),
    no: document.getElementById("edit-hide-no"),
    btn: document.getElementById("btn-edit"),
  };
  [edit.g1, edit.g2].forEach(function (sel) {
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "— aucun —"; sel.appendChild(o0);
    GENRES.forEach(function (g) { var o = document.createElement("option"); o.value = g; o.textContent = g; sel.appendChild(o); });
  });
  function closeEditor() {
    if (!edit.box) return;
    edit.box.hidden = true;
    edit.confirm.hidden = true;
    edit.hide.hidden = false;
    if (edit.btn) edit.btn.setAttribute("data-on", "false");
  }
  function openEditor() {
    var entry = currentEntry();
    if (!entry) return;
    edit.title.value = entry.title;     edit.title.placeholder = entry._raw.title;
    edit.author.value = entry.author || ""; edit.author.placeholder = entry._raw.author || "Auteur";
    edit.g1.value = entry.genre[0] || ""; edit.g2.value = entry.genre[1] || "";
    edit.reset.hidden = !entry._edited;
    edit.confirm.hidden = true; edit.hide.hidden = false;
    edit.box.hidden = false;
    edit.btn.setAttribute("data-on", "true");
    edit.title.focus();
  }
  edit.btn.addEventListener("click", function () { if (edit.box.hidden) openEditor(); else closeEditor(); });
  edit.cancel.addEventListener("click", closeEditor);
  edit.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var entry = currentEntry(); if (!entry) return;
    var r = entry._raw;
    var t = edit.title.value.trim(), a = edit.author.value.trim();
    var g = [edit.g1.value, edit.g2.value].filter(function (x, i, arr) { return x && arr.indexOf(x) === i; });
    closeEditor();
    saveOverride(entry.id, {
      title: (!t || t === r.title) ? null : t,
      author: (!a || a === (r.author || "")) ? null : a,
      genre: sameGenres(g, r.genre) ? null : g
    }, function () { toast("Modifications enregistrées."); });
  });
  edit.reset.addEventListener("click", function () {
    var entry = currentEntry(); if (!entry) return;
    closeEditor();
    saveOverride(entry.id, { title: null, author: null, genre: null }, function () { toast("Fiche rétablie telle que sur le disque."); });
  });
  edit.hide.addEventListener("click", function () {
    var entry = currentEntry(); if (!entry) return;
    edit.confirm.querySelector(".confirm-title").textContent = entry.title;
    edit.hide.hidden = true; edit.confirm.hidden = false;
  });
  edit.no.addEventListener("click", function () { edit.confirm.hidden = true; edit.hide.hidden = false; });
  edit.yes.addEventListener("click", function () {
    var entry = currentEntry(); if (!entry) return;
    var id = entry.id, title = entry.title;
    var before = (state.overrides[id] || {}).hidden;
    before = (before === true || before === false) ? before : null;
    closeSheet();
    saveOverride(id, { hidden: true }, function () {
      toast("« " + title + " » est masquée.", "Annuler", function () { saveOverride(id, { hidden: before }); });
    });
  });

  // ---------- message temporaire (avec action facultative) ----------
  var toastEl = document.getElementById("toast"), toastTimer = null;
  function toast(msg, actionLabel, action) {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.innerHTML = "";
    var span = document.createElement("span"); span.textContent = msg; toastEl.appendChild(span);
    if (actionLabel && action) {
      var b = document.createElement("button"); b.type = "button"; b.className = "toast-btn"; b.textContent = actionLabel;
      b.addEventListener("click", function () { toastEl.hidden = true; action(); });
      toastEl.appendChild(b);
    }
    toastEl.hidden = false;
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, actionLabel ? 8000 : 3500);
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
      html += '<p class="owner-status on">Mode propriétaire actif sur cet appareil : tu peux corriger un titre, masquer une fiche et cocher les statuts. Tes visiteurs, eux, ne voient que la bibliothèque.</p>' +
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

  function renderHiddenList() {
    var box = document.getElementById("hidden-list");
    if (!box || !IS_OWNER) return;
    box.innerHTML = "";
    if (!state.hiddenList.length) { box.innerHTML = '<p class="settings-hint">Aucune fiche masquée.</p>'; return; }
    var ul = document.createElement("ul"); ul.className = "hidden-list";
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

  function openSettings() {
    if (window.BD_THEMES) window.BD_THEMES.loadAllFonts();
    renderThemeGrid();
    renderOwnerPanel();
    renderHiddenList();
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
  state.overrides = loadLocalOverrides();
  if (IS_OWNER) {
    state.favorites = loadLocalFavorites();
    state.volumeRead = loadLocalVolumeRead();
  }
  loadCatalog();
  initSupabase();
})();
