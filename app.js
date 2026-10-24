(function () {
  "use strict";

  // Liste fixe de genres (voir README) — s'agrandira au fil des ajouts, mais reste
  // une liste fermée : pas de saisie libre, uniquement ces valeurs dans catalog.json.
  var GENRES = [
    "Aventure", "Biographie", "Documentaire", "Drame / Chronique sociale",
    "Fantastique / Horreur", "Fantasy", "Guerre", "Historique", "Humour",
    "Jeunesse", "Policier / Thriller", "Science-fiction", "Super-héros", "Western"
  ];

  // Version de la livraison — à augmenter à CHAQUE livraison (+0.1 pour une livraison
  // ordinaire, +1.0 pour une refonte), avec le même numéro dans les quatre ?v= de
  // index.html et une ligne dans l'historique « Versions » du README.
  var APP_VERSION = "2.1";
  var APP_VERSION_DATE = "2026-10-24";

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
    overrides: {},     // corrections : "id" ou "id::index" -> { hidden, title, author, genre, merged_into }
                       //   + décisions « pas un doublon » : "nodup:clé1|clé2" -> { not_dup: true }
    mergedList: [],    // fiches fusionnées dans une autre (propriétaire : Réglages)
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
  // Chaque tome affiché garde la clé de SA fiche d'origine ("idFiche::index d'origine"),
  // même quand il est masqué ou que sa fiche a été fusionnée dans une autre :
  // entry._keys[i] est cette clé, et c'est elle qu'on lit/écrit dans bd_volume_status.
  function isKeyRead(key) { return state.volumeRead[key] === true; }
  function isVolumeRead(entry, i) { return isKeyRead(entry._keys[i]); }
  function titleOfKey(key) { return key.slice(0, key.lastIndexOf("::")); }
  // entry._vis = positions des tomes visibles (les masqués gardent leur place).
  function isTitleRead(entry) {
    var v = entry._vis || [];
    if (!v.length) return false;
    for (var k = 0; k < v.length; k++) {
      if (!isVolumeRead(entry, v[k])) return false;
    }
    return true;
  }
  function countRead(entry) {
    var v = entry._vis || [], n = 0;
    for (var k = 0; k < v.length; k++) {
      if (isVolumeRead(entry, v[k])) n++;
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

  function isRawHidden(r) {
    var o = state.overrides[r.id] || {};
    return (o.hidden === true || o.hidden === false) ? o.hidden : !!r.hidden;
  }

  // Fiche d'accueil réelle d'une fiche fusionnée (suit les chaînes A→B→C). Renvoie null
  // si la fiche n'est pas fusionnée, ou si la cible n'existe plus (réimport) ou boucle :
  // la fiche réapparaît alors normalement, rien n'est jamais perdu.
  function mergeTarget(id, byId) {
    var seen = {}, cur = id, hops = 0;
    while (true) {
      var o = state.overrides[cur];
      if (!o || !o.merged_into || o.merged_into === cur) break;
      if (seen[cur] || ++hops > 8) return null;
      seen[cur] = true;
      cur = o.merged_into;
      if (!byId[cur]) return null;
    }
    return cur === id ? null : cur;     // cible masquée : la fiche fusionnée l'est avec elle
  }

  function applyOverrides() {
    var list = [], hidden = [], merged = [];
    var byId = {}, absorbed = {};      // id cible -> [fiches brutes fusionnées dedans]
    state.raw.forEach(function (r) { byId[r.id] = r; });
    var target = {};
    state.raw.forEach(function (r) {
      var t = mergeTarget(r.id, byId);
      if (t) { target[r.id] = t; (absorbed[t] = absorbed[t] || []).push(r); }
    });
    var cmp = function (a, b) { return a.title.localeCompare(b.title, "fr", { sensitivity: "base", numeric: true }); };
    state.raw.forEach(function (r) {
      if (target[r.id]) {
        merged.push({ id: r.id, title: (state.overrides[r.id] || {}).title || r.title, into: target[r.id], _raw: r });
        return;
      }
      var o = state.overrides[r.id] || {};
      var srcs = [r].concat((absorbed[r.id] || []).sort(function (a, b) { return cmp(a, b); }));
      var vols = [], keys = [], labels = [], vis = [], hid = [];
      srcs.forEach(function (sr) {
        (sr.volumes || []).forEach(function (v, i) {
          var k = volKey(sr.id, i), vo = state.overrides[k] || {};
          var pos = vols.length;
          vols.push(v); keys.push(k); labels.push(vo.title || v.label);
          if (vo.hidden === true) hid.push(pos); else vis.push(pos);
        });
      });
      var first = vis.length ? vols[vis[0]] : null;
      var e = {
        id: r.id,
        title: o.title || r.title,
        author: o.author || r.author,
        genre: Array.isArray(o.genre) ? o.genre : (r.genre || []),
        one_shot: r.one_shot && srcs.length === 1,
        parent_series: r.parent_series,
        volumes: vols,
        cover: (first && first.cover) || null,
        volume_count: vis.length,
        _keys: keys, _labels: labels, _vis: vis, _hidVols: hid, _raw: r,
        _merged: srcs.slice(1),
        _edited: !!(o.title || o.author || Array.isArray(o.genre))
      };
      (isRawHidden(r) ? hidden : list).push(e);
    });
    list.sort(cmp); hidden.sort(cmp); merged.sort(cmp);
    buildSearchIndex(list);
    state.catalog = list;
    state.hiddenList = hidden;
    state.mergedList = merged;
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
    if (state.view === "settings") { renderHiddenList(); updateDupButton(); }
    if (state.view === "dups") renderDups();
  }

  // Enregistre une correction (fusionnée avec l'existante). Appliquée tout de suite à
  // l'écran, puis envoyée à Supabase ; en cas d'échec, on revient en arrière.
  function saveOverride(key, patch, onOk) {
    var prev = state.overrides[key] ? JSON.parse(JSON.stringify(state.overrides[key])) : null;
    var cur = { hidden: null, title: null, author: null, genre: null, merged_into: null, not_dup: null };
    if (prev) Object.keys(cur).forEach(function (k) { if (prev[k] !== undefined && prev[k] !== null) cur[k] = prev[k]; });
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    var empty = cur.hidden === null && !cur.title && !cur.author && !Array.isArray(cur.genre) && !cur.merged_into && !cur.not_dup;
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
    var row = { id: key, hidden: cur.hidden, title: cur.title || null,
          author: cur.author || null, genre: Array.isArray(cur.genre) ? cur.genre : null, updated_at: new Date().toISOString() };
    // colonnes ajoutées au lot « fusion » : envoyées seulement quand elles servent, pour que
    // les corrections simples marchent même si le script SQL du lot n'a pas encore été passé.
    ["merged_into", "not_dup"].forEach(function (k) {
      if (cur[k] || (prev && prev[k])) row[k] = cur[k] || null;
    });
    var q = empty
      ? supabase.from("bd_overrides").delete().eq("id", key)
      : supabase.from("bd_overrides").upsert(row);
    q.then(function (res) {
      var m = res.error ? (res.error.message || "erreur Supabase") : "";
      if (/merged_into|not_dup/.test(m)) m = "relance le script supabase_bd_overrides.sql dans Supabase (voir README).";
      if (res.error) rollback(m);
      else if (onOk) onOk();
    }).catch(function (err) { rollback((err && err.message) || "hors ligne"); });
  }

  function rowToOverride(row) {
    return { hidden: row.hidden, title: row.title, author: row.author, genre: row.genre,
             merged_into: row.merged_into || null, not_dup: row.not_dup || null };
  }

  function fetchOverrides() {
    supabase.from("bd_overrides").select("*")
      .then(function (res) {
        if (res.error) {
          if (IS_OWNER) setSyncNote("Corrections indisponibles : la table bd_overrides n'existe pas encore dans Supabase (voir README).");
          return;
        }
        var map = {};
        (res.data || []).forEach(function (row) {
          map[row.id] = rowToOverride(row);
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
        var act = state.activeId && currentEntry();
        if (act && act._keys.indexOf(row.id) !== -1) {
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
        else state.overrides[row.id] = rowToOverride(row);
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

  function pushVolumeStatus(key) {
    if (!supabase) return;
    supabase.from("bd_volume_status").upsert({
      id: key, title_id: titleOfKey(key), is_read: isKeyRead(key), updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res.error) setSyncNote("Dernière modification pas encore synchronisée (réessaiera).");
    }).catch(function () {});
  }

  function pushVolumeStatusBulk(keys, read) {
    if (!supabase || !keys.length) return;
    var now = new Date().toISOString();
    var rows = keys.map(function (k) {
      return { id: k, title_id: titleOfKey(k), is_read: read, updated_at: now };
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
        if (state.view === "settings") { renderHiddenList(); updateDupButton(); }
        else if (state.view === "dups") renderDups();
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
      (e._merged || []).forEach(function (m) { orig += " " + m.title; });
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
    renderMergedInfo(entry);
    renderSheetGenres(entry);
    setActiveCover(entry, state.activeVolIdx);
    renderVolumeList();
    renderSheetActions();
  }

  // Propriétaire : fiches fusionnées dans celle-ci, avec « Séparer » pour défaire.
  function renderMergedInfo(entry) {
    var box = document.getElementById("sheet-merged");
    if (!box) return;
    box.innerHTML = "";
    if (!IS_OWNER || !entry._merged.length) { box.hidden = true; return; }
    box.hidden = false;
    var lead = document.createElement("span");
    lead.textContent = entry._merged.length > 1 ? "Fiches fusionnées ici : " : "Fiche fusionnée ici : ";
    box.appendChild(lead);
    entry._merged.forEach(function (m, k) {
      var mt = (state.overrides[m.id] || {}).title || m.title;
      var item = document.createElement("span"); item.className = "merged-item";
      var name = document.createElement("span"); name.textContent = "« " + mt + " » (" + (m.volumes || []).length + ")";
      var b = document.createElement("button"); b.type = "button"; b.className = "link-btn"; b.textContent = "séparer";
      b.addEventListener("click", function () {
        saveOverride(m.id, { merged_into: null }, function () { toast("« " + mt + " » est de nouveau une fiche à part."); });
      });
      item.appendChild(name); item.appendChild(document.createTextNode(" ")); item.appendChild(b);
      if (k) box.appendChild(document.createTextNode(" · "));
      box.appendChild(item);
    });
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
      li.className = "vol-row" + (IS_OWNER && !hiddenVol && isVolumeRead(entry, i) ? " is-read" : "") +
                     (hiddenVol ? " is-hidden" : "") + (i === state.activeVolIdx ? " active" : "");

      if (IS_OWNER && !hiddenVol) {
        var check = document.createElement("button");
        check.type = "button";
        check.className = "vol-check";
        check.setAttribute("aria-label", "Marquer ce tome comme lu");
        check.textContent = isVolumeRead(entry, i) ? "✓" : "";
        check.addEventListener("click", function (e) {
          e.stopPropagation();
          toggleVolumeRead(entry, i);
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
    var key = entry._keys[i];
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

  function toggleVolumeRead(entry, i) {
    var key = entry._keys[i];
    if (state.volumeRead[key]) delete state.volumeRead[key];
    else state.volumeRead[key] = true;
    saveLocalVolumeRead();
    renderVolumeList();
    renderSheetActions();
    renderGrid();
    pushVolumeStatus(key);
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
      var key = entry._keys[i];
      if (makeRead) state.volumeRead[key] = true;
      else delete state.volumeRead[key];
    });
    saveLocalVolumeRead();
    renderVolumeList();
    renderSheetActions();
    renderGrid();
    pushVolumeStatusBulk(entry._vis.map(function (i) { return entry._keys[i]; }), makeRead);
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
    resetMergePicker();
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
  // ---------- fusion : intégrer une autre fiche dans celle-ci ----------
  var mp = {
    open: document.getElementById("merge-open"),
    box: document.getElementById("merge-picker"),
    q: document.getElementById("merge-q"),
    res: document.getElementById("merge-results"),
    confirm: document.getElementById("merge-confirm"),
    text: document.getElementById("merge-confirm-text"),
    yes: document.getElementById("merge-yes"),
    no: document.getElementById("merge-no"),
    pick: null,
  };
  function resetMergePicker() {
    if (!mp.box) return;
    mp.box.hidden = true; mp.confirm.hidden = true; mp.open.hidden = false;
    mp.q.value = ""; mp.res.innerHTML = ""; mp.pick = null;
  }
  function mergeDesc(e) {
    return e.one_shot ? "one-shot" : e.volume_count + (e.volume_count > 1 ? " tomes" : " tome");
  }
  function renderMergeResults() {
    var entry = currentEntry(); if (!entry) return;
    mp.res.innerHTML = "";
    var q = mp.q.value.trim();
    if (normalize(q).length < 2) return;
    var hits = state.catalog.filter(function (e) { return e.id !== entry.id && hasAllWords(e._qTitle, q); }).slice(0, 8);
    if (!hits.length) { mp.res.innerHTML = '<li class="merge-none">Aucune fiche ne correspond.</li>'; return; }
    hits.forEach(function (e) {
      var li = document.createElement("li");
      var b = document.createElement("button"); b.type = "button"; b.className = "merge-hit";
      b.textContent = e.title + " — " + mergeDesc(e) + (e.author ? " — " + e.author : "");
      b.addEventListener("click", function () { askMerge(e, entry); });
      li.appendChild(b); mp.res.appendChild(li);
    });
  }
  function askMerge(src, dst) {
    mp.pick = { src: src.id, dst: dst.id };
    mp.text.textContent = "Ajouter les " + src.volumes.length + " tome(s) de « " + src.title + " » à la fin de « " +
      dst.title + " » ? « " + src.title + " » disparaîtra de la grille (tu pourras séparer à nouveau).";
    mp.confirm.hidden = false;
  }
  // Fusionne la fiche srcId dans dstId (utilisé aussi par l'écran des doublons).
  function doMerge(srcId, dstId, srcTitle, dstTitle) {
    saveOverride(srcId, { merged_into: dstId }, function () {
      toast("« " + srcTitle + " » est fusionnée dans « " + dstTitle + " ».", "Annuler",
            function () { saveOverride(srcId, { merged_into: null }); });
    });
  }
  if (mp.open) {
    mp.open.addEventListener("click", function () {
      mp.open.hidden = true; mp.box.hidden = false; mp.q.focus();
    });
    mp.q.addEventListener("input", function () { mp.confirm.hidden = true; renderMergeResults(); });
    mp.no.addEventListener("click", function () { mp.confirm.hidden = true; mp.pick = null; });
    document.getElementById("merge-cancel").addEventListener("click", resetMergePicker);
    mp.yes.addEventListener("click", function () {
      if (!mp.pick) return;
      var src = state.catalog.find(function (e) { return e.id === mp.pick.src; });
      var dst = currentEntry();
      if (!src || !dst) return;
      closeEditor();
      doMerge(src.id, dst.id, src.title, dst.title);
    });
  }

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
    if (!state.hiddenList.length && !state.mergedList.length) { box.innerHTML = '<p class="settings-hint">Aucune fiche masquée ni fusionnée.</p>'; return; }
    var ul = document.createElement("ul"); ul.className = "hidden-list";
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

  // =====================================================================
  // DOUBLONS PROBABLES (propriétaire)
  // Calculés à la volée sur le catalogue affiché (corrections et fusions comprises),
  // donc toujours à jour après un réimport. Trois familles :
  //   1. deux fiches au titre très proche (et auteurs compatibles) ;
  //   2. dans une même fiche, plusieurs tomes au libellé identique ;
  //   3. un one-shot qui porte le titre d'un tome d'une série (auteurs compatibles).
  // « Pas un doublon » est mémorisé (ligne "nodup:clé1|clé2", not_dup = true) et la
  // suggestion ne revient plus.
  // =====================================================================
  var DUP_STOP = { bis: 1, integrale: 1, hd: 1, tome: 1, t: 1 };
  var AUTH_SKIP = { collectif: 1, "inconnu e": 1, inconnu: 1, anonyme: 1 };
  function dnorm(s) { return normalize((s || "").replace(/['’]/g, " ")); }
  function dupBase(title) {
    var s = dnorm((title || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
    // marqueurs de rangement de Christophe : « MANQUE … », « CDS »/« CDS99 », « a renommer ».
    // On les retire pour qu'une version « complète » et sa version « MANQUE CDS » se
    // ressemblent et remontent ensemble dans les doublons probables.
    s = s.replace(/\bmanque\b.*$/, " ").replace(/\bcds\d*\b/g, " ").replace(/\ba renommer\b/g, " ");
    return s.split(" ").filter(function (w) { return w && !DUP_STOP[w]; }).join(" ");
  }
  function authorSet(a) {
    var set = {};
    (a || "").split(/[,&;\/]| et /).forEach(function (x) { x = dnorm(x); if (x && !AUTH_SKIP[x]) set[x] = 1; });
    return set;
  }
  function authorsCompatible(a, b) {
    var A = authorSet(a), B = authorSet(b), ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return true;
    return ka.some(function (x) { return B[x]; });
  }
  function levenshtein(a, b) {
    var p = [], i, j;
    for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) {
      var c = [i];
      for (j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      p = c;
    }
    return p[b.length];
  }
  function titleSimilarity(a, b) {
    var sa = a.replace(/ /g, ""), sb = b.replace(/ /g, "");
    if (sa === sb) return 1;
    var r = 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length);
    var sh = a.length <= b.length ? a : b, lo = a.length <= b.length ? b : a;
    if (r < 0.85 && sh.split(" ").length >= 3 && (" " + lo + " ").indexOf(" " + sh + " ") !== -1 && sh.length / lo.length >= 0.6) r = 0.9;
    return r;
  }
  function pairKey(a, b) { return "nodup:" + [a, b].sort().join("|"); }
  function isDismissed(key) { return !!(state.overrides[key] && state.overrides[key].not_dup); }

  function computeDups() {
    var cat = state.catalog, out = { entries: [], tomes: [], oneshots: [] };
    // 1. fiches proches : on ne compare que les fiches qui partagent un mot rare du titre
    //    ou le même début (évite ~2 millions de comparaisons).
    var bases = cat.map(function (e) { return dupBase(e.title); });
    var buckets = {};
    bases.forEach(function (b, k) {
      if (b.length < 4) return;
      var keys = {};
      b.split(" ").forEach(function (w) { if (w.length >= 4) keys["w:" + w] = 1; });
      keys["p:" + b.replace(/ /g, "").slice(0, 6)] = 1;
      Object.keys(keys).forEach(function (x) { (buckets[x] = buckets[x] || []).push(k); });
    });
    var seen = {};
    Object.keys(buckets).forEach(function (x) {
      var L = buckets[x];
      if (L.length > 60) return;
      for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) {
        var a = L[i], b = L[j], id = a < b ? a + "," + b : b + "," + a;
        if (seen[id]) continue;
        seen[id] = 1;
        var ea = cat[a], eb = cat[b];
        if (!authorsCompatible(ea.author, eb.author)) continue;
        var r = titleSimilarity(bases[a], bases[b]);
        if (r < 0.85) continue;
        var key = pairKey(ea.id, eb.id);
        if (!isDismissed(key)) out.entries.push({ key: key, a: ea, b: eb, score: r });
      }
    });
    out.entries.sort(function (x, y) { return y.score - x.score || x.a.title.localeCompare(y.a.title, "fr"); });

    // 2. tomes au libellé identique dans une même fiche
    var tomeIndex = {};
    cat.forEach(function (e) {
      var groups = {};
      e._vis.forEach(function (i) {
        var n = dnorm(e._labels[i]);
        if (!n) return;
        (groups[n] = groups[n] || []).push(i);
        if (!e.one_shot && n.length >= 4) (tomeIndex[n] = tomeIndex[n] || []).push({ e: e, i: i });
      });
      Object.keys(groups).forEach(function (n) {
        var pos = groups[n];
        if (pos.length < 2) return;
        var key = "nodup:" + pos.map(function (i) { return e._keys[i]; }).sort().join("|");
        if (!isDismissed(key)) out.tomes.push({ key: key, e: e, pos: pos });
      });
    });

    // 3. one-shot = tome d'une série
    cat.forEach(function (os) {
      if (!os.one_shot) return;
      (tomeIndex[dnorm(os.title)] || []).forEach(function (t) {
        if (t.e.id === os.id || !authorsCompatible(os.author, t.e.author)) return;
        var key = pairKey(os.id, t.e._keys[t.i]);
        if (!isDismissed(key)) out.oneshots.push({ key: key, os: os, e: t.e, i: t.i });
      });
    });
    return out;
  }

  var dupEls = {
    body: document.getElementById("dups-body"),
    count: document.getElementById("dups-count"),
  };

  function dupCount(d) { return d.entries.length + d.tomes.length + d.oneshots.length; }
  function updateDupButton() {
    if (!IS_OWNER || !dupEls.count || !state.catalog.length) return;
    var n = dupCount(computeDups());
    dupEls.count.textContent = n ? n + " à examiner" : "rien à examiner";
  }

  function el(tag, cls, text) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined) x.textContent = text;
    return x;
  }
  function dupThumb(cover, alt) {
    var w = el("button", "dup-thumb");
    w.type = "button";
    w.setAttribute("aria-label", "Agrandir la couverture");
    if (cover) {
      var im = document.createElement("img"); im.alt = "";
      lazyImage(im, coverUrl(cover)); w.appendChild(im);
      w.addEventListener("click", function () { openZoom(coverUrl(cover), alt); });
    } else { w.disabled = true; w.appendChild(el("span", "dup-nocover", "pas de couverture")); }
    return w;
  }
  function entryDesc(e) {
    return (e.one_shot ? "One-shot" : e.volume_count + (e.volume_count > 1 ? " tomes" : " tome")) + " · " + (e.author || "auteur non renseigné");
  }
  function hideEntryWithUndo(e) {
    var before = (state.overrides[e.id] || {}).hidden;
    before = (before === true || before === false) ? before : null;
    saveOverride(e.id, { hidden: true }, function () {
      toast("« " + e.title + " » est masquée.", "Annuler", function () { saveOverride(e.id, { hidden: before }); });
    });
  }
  function notDupButton(key) {
    var b = el("button", "btn btn-ghost", "Pas un doublon"); b.type = "button";
    b.addEventListener("click", function () {
      saveOverride(key, { not_dup: true }, function () {
        toast("Noté : cette suggestion ne reviendra plus.", "Annuler", function () { saveOverride(key, { not_dup: null }); });
      });
    });
    return b;
  }
  function dupSection(title, hint, items, render) {
    var sec = el("section", "dup-section");
    sec.appendChild(el("h3", "settings-h", title + " (" + items.length + ")"));
    sec.appendChild(el("p", "settings-hint", hint));
    if (!items.length) sec.appendChild(el("p", "dup-empty", "Rien à examiner."));
    items.forEach(function (it) { sec.appendChild(render(it)); });
    return sec;
  }

  function renderDups() {
    if (!IS_OWNER || !dupEls.body) return;
    var d = computeDups();
    var keepScroll = window.scrollY;
    dupEls.body.innerHTML = "";
    dupEls.body.appendChild(el("h2", "page-title", "Doublons probables"));
    dupEls.body.appendChild(el("p", "settings-hint",
      "Suggestions calculées automatiquement : à toi de trancher. Touche une couverture pour l'agrandir. " +
      "Rien n'est effacé : tout se défait depuis la fiche ou depuis Réglages → Fiches masquées et fusionnées."));

    dupEls.body.appendChild(dupSection("Fiches qui se ressemblent",
      "« Fusionner ici » ajoute les tomes de l'autre fiche à la fin de celle-ci, et l'autre disparaît de la grille. Entre deux one-shots, « Garder celle-ci » masque l'autre.",
      d.entries, function (it) {
        var box = el("div", "dup-item dup-pair");
        [[it.a, it.b], [it.b, it.a]].forEach(function (pr) {
          var e = pr[0], other = pr[1];
          var col = el("div", "dup-col");
          col.appendChild(dupThumb(e.cover, e.title));
          var info = el("div", "dup-info");
          info.appendChild(el("div", "dup-title", e.title));
          info.appendChild(el("div", "dup-meta", entryDesc(e)));
          var firsts = e._vis.slice(0, 3).map(function (i) { return e._labels[i]; }).join(" · ");
          if (!e.one_shot && firsts) info.appendChild(el("div", "dup-tomes", firsts + (e._vis.length > 3 ? " …" : "")));
          // deux one-shots : on garde l'un et on masque l'autre (une fusion ferait une
          // « série » de deux fois le même album) ; un one-shot face à une série : on peut
          // le fusionner dans la série, ou le masquer ; deux séries : fusion.
          var b;
          if (e.one_shot && other.one_shot) {
            b = el("button", "btn", "Garder celle-ci");
            b.title = "Masquer « " + other.title + " »";
            b.addEventListener("click", function () { hideEntryWithUndo(other); });
          } else if (e.one_shot) {
            b = el("button", "btn btn-danger", "Masquer celle-ci");
            b.addEventListener("click", function () { hideEntryWithUndo(e); });
          } else {
            b = el("button", "btn", "Fusionner ici");
            b.title = "Ajouter les tomes de « " + other.title + " » à « " + e.title + " »";
            b.addEventListener("click", function () { doMerge(other.id, e.id, other.title, e.title); });
          }
          b.type = "button";
          info.appendChild(b);
          col.appendChild(info);
          box.appendChild(col);
        });
        var foot = el("div", "dup-foot"); foot.appendChild(notDupButton(it.key)); box.appendChild(foot);
        return box;
      }));

    dupEls.body.appendChild(dupSection("Tomes en double dans une même fiche",
      "Même libellé plusieurs fois dans la même série. Masque celui ou ceux en trop ; la coche « lu » d'un tome masqué est conservée.",
      d.tomes, function (it) {
        var box = el("div", "dup-item");
        box.appendChild(el("div", "dup-title", it.e.title));
        var row = el("div", "dup-row");
        it.pos.forEach(function (i) {
          var pos = it.e._vis.indexOf(i) + 1;
          var c = el("div", "dup-tome");
          c.appendChild(dupThumb(it.e.volumes[i].cover, it.e._labels[i]));
          c.appendChild(el("div", "dup-meta", "n° " + String(pos).padStart(2, "0") + (isVolumeRead(it.e, i) ? " · lu" : "")));
          c.appendChild(el("div", "dup-label", it.e._labels[i]));
          var b = el("button", "btn btn-danger", "Masquer"); b.type = "button";
          b.addEventListener("click", function () {
            var key = it.e._keys[i];
            saveOverride(key, { hidden: true }, function () {
              toast("Tome masqué.", "Annuler", function () { saveOverride(key, { hidden: null }); });
            });
          });
          c.appendChild(b);
          row.appendChild(c);
        });
        box.appendChild(row);
        var foot = el("div", "dup-foot"); foot.appendChild(notDupButton(it.key)); box.appendChild(foot);
        return box;
      }));

    dupEls.body.appendChild(dupSection("One-shots qui sont peut-être un tome d'une série",
      "Le one-shot porte le titre d'un tome de la série. Si c'est le même album, masque le one-shot.",
      d.oneshots, function (it) {
        var box = el("div", "dup-item dup-pair");
        var c1 = el("div", "dup-col");
        c1.appendChild(dupThumb(it.os.cover, it.os.title));
        var i1 = el("div", "dup-info");
        i1.appendChild(el("div", "dup-title", it.os.title));
        i1.appendChild(el("div", "dup-meta", entryDesc(it.os)));
        var bh = el("button", "btn btn-danger", "Masquer le one-shot"); bh.type = "button";
        bh.addEventListener("click", function () { hideEntryWithUndo(it.os); });
        i1.appendChild(bh); c1.appendChild(i1); box.appendChild(c1);
        var c2 = el("div", "dup-col");
        c2.appendChild(dupThumb(it.e.volumes[it.i].cover, it.e._labels[it.i]));
        var i2 = el("div", "dup-info");
        i2.appendChild(el("div", "dup-title", it.e.title + " — tome " + String(it.e._vis.indexOf(it.i) + 1).padStart(2, "0")));
        i2.appendChild(el("div", "dup-meta", it.e._labels[it.i]));
        i2.appendChild(el("div", "dup-meta", it.e.author || "auteur non renseigné"));
        c2.appendChild(i2); box.appendChild(c2);
        var foot = el("div", "dup-foot"); foot.appendChild(notDupButton(it.key)); box.appendChild(foot);
        return box;
      }));
    if (state.view === "dups") window.scrollTo(0, keepScroll);
    if (dupEls.count) dupEls.count.textContent = dupCount(d) ? dupCount(d) + " à examiner" : "rien à examiner";
  }

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
  };
  var viewScroll = {};
  state.view = "home";

  function viewFromHash() {
    var h = location.hash || "#/";
    if (h === "#/reglages") return "settings";
    if (h === "#/doublons") {
      if (IS_OWNER) return "dups";
      try { history.replaceState(null, "", "#/reglages"); } catch (e) {}
      return "settings";
    }
    return "home";
  }

  function renderSettingsPage() {
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
      if (!els.zoomOverlay.hidden) closeZoom();
      if (state.activeId) closeSheet();
    }
    state.view = v;
    Object.keys(views).forEach(function (k) { if (views[k]) views[k].hidden = k !== v; });
    document.documentElement.classList.toggle("view-page", v !== "home");
    if (v === "settings") renderSettingsPage();
    else if (v === "dups") renderDups();
    window.scrollTo(0, viewScroll[v] || 0);
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

  var versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = "Ma Bibliothèque BD — version " + APP_VERSION + " du " +
    APP_VERSION_DATE.split("-").reverse().join("/");

  els.sheetClose.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", function (e) { if (e.target === els.overlay) closeSheet(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!els.zoomOverlay.hidden) closeZoom();
    else if (state.activeId) closeSheet();
    else if (state.view === "dups") location.hash = "#/reglages";
    else if (state.view === "settings") location.hash = "#/";
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
  route();
  loadCatalog();
  initSupabase();
})();
