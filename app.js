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
  var APP_VERSION = "3.3";
  var APP_VERSION_DATE = "2026-11-08";

  // ---------- mode propriétaire (3.3) ----------
  // Propriétaire = appareil connecté à Supabase (Supabase Auth, e-mail + mot de passe ; voir
  // « Connexion sécurisée » dans le README). Depuis la 3.2, la base n'accepte les écritures,
  // et la lecture des favoris et des coches, que de cette session : c'est la vraie serrure.
  // On le sait dès le chargement, sans attendre le réseau : supabase-js garde la session dans
  // le localStorage (clé sb-<ref>-auth-token). Si elle s'avère invalide (compte recréé,
  // session révoquée), supabase-js l'efface et l'appli se recharge en visiteur (initAuth).
  // L'ancien code propriétaire (empreinte PBKDF2 BD_OWNER_HASH, versions 1.x à 3.2) n'existe plus.
  function authStorageKey() {
    try { return "sb-" + new URL(window.BD_SUPABASE_URL).hostname.split(".")[0] + "-auth-token"; } catch (e) { return ""; }
  }
  function storedSession() {
    try {
      var s = JSON.parse(localStorage.getItem(authStorageKey()) || "null");
      return s && (s.refresh_token || s.access_token) ? s : null;
    } catch (e) { return null; }
  }
  var IS_OWNER = !!storedSession();
  document.documentElement.classList.toggle("is-owner", IS_OWNER);
  try { localStorage.removeItem("bd_owner_v1"); } catch (e) {}   // empreinte de l'ancien code (≤ 3.2)
  var LOST_KEY = "bd_session_perdue";

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
    sort: "title",     // 3.0 : "title" (A → Z, barre alphabétique) ou "recent" (ajoutés récemment)
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
    sortBy: document.getElementById("sort-by"),
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

  // ---------- titres et libellés affichés (2.8 / 2.9) ----------
  // Les noms de dossiers gardent des marqueurs de rangement (« _CDS_ », « MANQUE LE 28 »,
  // « [HD] », « (68-95) », « (complet 13) »…). Les VISITEURS voient le titre nettoyé ; le
  // propriétaire voit le titre brut, pour repérer ce qui reste à renommer (sa fiche indique
  // le titre vu par les visiteurs). Une correction de titre l'emporte toujours.
  function cleanTitle(t) {
    var s = (t || "").replace(/_CDS_/g, " ")
      .replace(/\[HD\]|\(1DVD\)/gi, " ")
      .replace(/\((?:complet|manque)\s*\d*\)/gi, " ")
      .replace(/\bMANQUE\b.*$/i, " ")
      .replace(/\bCDS\d*\b/g, " ")
      .replace(/\ba renommer\b/gi, " ")
      .replace(/\(\s*\d{1,3}\s*-\s*\d{1,3}(?:\s*\+[^)]*)?\)/g, " ")
      .replace(/\s{2,}/g, " ").replace(/^[\s\-_]+|[\s\-_]+$/g, "");
    // « Donjon - Donjon Zénith » -> « Donjon Zénith » (sous-série rangée dans sa série)
    var m = /^(.+?)\s+-\s+(.+)$/.exec(s);
    if (m && normalize(m[1]) && normalize(m[2]).indexOf(normalize(m[1])) === 0) s = m[2];
    s = s.replace(/\s{2,}/g, " ").replace(/^[\s\-_]+|[\s\-_]+$/g, "");
    return s || t;
  }
  // Numéro d'un tome : champ « n » du catalogue (tiré du nom de fichier par les outils du
  // delta), sinon lu dans le libellé (« … Tome 03 … », « T03 », « 03 - … »).
  function labelNum(label) {
    var m = /(?:^|[\s_.\-])(?:Tome|T)\s*\.?\s*0*(\d{1,3})(?=$|[\s_.\-:])/i.exec(label || "") ||
            /^0*(\d{1,3})\s*[\-.:]\s/.exec(label || "");
    return m ? parseInt(m[1], 10) : null;
  }
  // Libellé affiché : sans le nom de la série répété devant, ni « Tome NN ».
  // « Les Piliers de la Terre Tome 01 Le Rêveur de cathédrales » -> « Le Rêveur de cathédrales ».
  function stripPrefix(label, titles) {
    var words = (label || "").split(/\s+/);
    for (var t = 0; t < titles.length; t++) {
      var tw = normalize(titles[t]).split(" ").filter(Boolean);
      if (!tw.length) continue;
      var j = 0, i = 0;
      while (i < words.length && j < tw.length) {
        var nw = normalize(words[i]).split(" ").filter(Boolean);
        if (!nw.length) { i++; continue; }
        var ok = nw.every(function (w, k) { return tw[j + k] === w; });
        if (!ok) break;
        j += nw.length; i++;
      }
      if (j >= tw.length && i < words.length) { words = words.slice(i); break; }
    }
    var s = words.join(" ");
    // Préfixe proche du titre mais pas identique (« Les Piliers de la Terre Tome 01 … » dans
    // la fiche « Les pilliers de la terre ») : on coupe avant « Tome NN » si au moins deux mots,
    // ou la moitié des mots, sont communs avec le titre.
    var m = /^(.+?)\s+(?:(?:Tome|T)\s*\.?\s*|-\s*)\d{1,3}\b\s*(?:-\s+)?(.*)$/i.exec(s);
    if (m) {
      var tw = {}; titles.forEach(function (t) { normalize(t).split(" ").forEach(function (w) { if (w) tw[w] = true; }); });
      var xw = normalize(m[1]).split(" ").filter(Boolean), common = xw.filter(function (w) { return tw[w]; }).length;
      if (common >= 2 || common * 2 >= xw.length) s = m[2];
    }
    s = s
      .replace(/^[\s\-:,.]*(?:Tome|T)\s*\.?\s*\d{1,3}\b[\s\-:,.]*/i, "")
      .replace(/^0*\d{1,3}\s*[\-.:]\s+/, "")
      .replace(/^[\s\-:,.]+/, "");
    return s;
  }

  // ---------- dates d'ajout, nouveautés, tomes manquants (3.0) ----------
  // Le catalogue note la date d'ajout (AAAA-MM-JJ) : "added" sur chaque fiche (son premier
  // import) et sur chaque tome ajouté plus tard à une fiche existante (outils_delta/4_fusion.py).
  // Les dates d'avant novembre 2026 ont été reprises de l'historique GitHub de data/catalog.json.
  // Pastille « Nouveau » / « +3 tomes » : ce qu'a apporté le DERNIER import (et ceux des 7 jours
  // qui le précèdent, quand un import se fait en plusieurs fois), affiché pendant 30 jours.
  // Sans cette limite, le premier mois aurait marqué « Nouveau » les 968 one-shots importés
  // d'un coup le 16 octobre 2026.
  var NEW_DAYS = 30, NEW_BURST_DAYS = 7;
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
              "septembre", "octobre", "novembre", "décembre"];
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoDay(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addDays(iso, n) { var p = iso.split("-"); return isoDay(new Date(+p[0], +p[1] - 1, +p[2] + n)); }
  function newCutoff() {
    var a = addDays(isoDay(new Date()), -NEW_DAYS);
    var b = state.latestAdd ? addDays(state.latestAdd, -NEW_BURST_DAYS) : a;
    return a > b ? a : b;
  }
  function frDate(iso) {
    var p = (iso || "").split("-");
    if (p.length !== 3) return iso || "";
    var j = parseInt(p[2], 10);
    return (j === 1 ? "1er" : j) + " " + MOIS[parseInt(p[1], 10) - 1] + " " + p[0];
  }
  // Pastille de la vignette : « Nouveau » pour une fiche arrivée depuis moins de NEW_DAYS jours,
  // « +3 tomes » pour une série existante qui a reçu des tomes pendant ce temps.
  function newInfo(e, cut) {
    if (!e._lastAdded || e._lastAdded < cut) return null;
    if (e._added && e._added >= cut) return { text: "Nouveau", aria: "nouveauté" };
    var n = e._vis.filter(function (p) { return e._adds[p] && e._adds[p] >= cut; }).length;
    if (!n) return null;
    return { text: "+" + n + (n > 1 ? " tomes" : " tome"), aria: n + (n > 1 ? " tomes ajoutés" : " tome ajouté") + " récemment" };
  }
  // Tomes manquants (propriétaire) : les numéros absents entre 1 et le plus grand numéro de
  // la fiche. Seulement quand les numéros sont sûrs (_realNums). On ne voit pas ce qui manque
  // APRÈS le dernier tome. Garde-fous : un numéro qui fait partie du titre (« 60 ans en BD »)
  // n'est pas un numéro de tome ; une numérotation à 100+ à côté de 1, 2, 3 (Donjon : 113 à
  // côté de 1 à 9) est laissée de côté, et une série qui commence à 101 démarre à 101.
  function missingTomes(title, nums, hss, positions) {
    var main = positions.filter(function (p) { return !hss[p] && nums[p] !== null && nums[p] > 0; })
                        .map(function (p) { return nums[p]; });
    if (main.some(function (x) { return x < 100; })) main = main.filter(function (x) { return x < 100; });
    if (!main.length) return [];
    var tn = " " + normalize(title) + " ";
    if (main.some(function (x) { return tn.indexOf(" " + x + " ") !== -1; })) return [];
    var have = {}, lo = Math.min.apply(null, main), hi = Math.max.apply(null, main), out = [];
    main.forEach(function (x) { have[x] = true; });
    for (var k = lo >= 100 ? lo : 1; k <= hi; k++) if (!have[k]) out.push(k);
    return out;
  }
  // [1,2,3,5,8,9,10] -> « 1 à 3, 5 et 8 à 10 »
  function rangesText(ns) {
    var parts = [], i = 0;
    while (i < ns.length) {
      var j = i;
      while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
      if (j === i) parts.push(String(ns[i]));
      else if (j === i + 1) { parts.push(String(ns[i])); parts.push(String(ns[j])); }
      else parts.push(ns[i] + " à " + ns[j]);
      i = j + 1;
    }
    return parts.length > 1 ? parts.slice(0, -1).join(", ") + " et " + parts[parts.length - 1] : parts[0] || "";
  }
  function missingText(ns) {
    if (!ns.length) return "";
    return (ns.length > 1 ? "Il manque les tomes " : "Il manque le tome ") + rangesText(ns) +
           (ns.length > 3 ? " (" + ns.length + " tomes)" : "") + ".";
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
      var vols = [], keys = [], labels = [], vis = [], hid = [], nums = [], hss = [], disp = [], adds = [];
      srcs.forEach(function (sr) {
        (sr.volumes || []).forEach(function (v, i) {
          var k = volKey(sr.id, i), vo = state.overrides[k] || {};
          // one-shot renommé : son unique tome prend le nouveau titre (sauf correction propre
          // au tome), pour que l'ancien nom n'apparaisse plus nulle part, ni à l'écran ni en recherche
          var so = state.overrides[sr.id] || {};
          var osTitle = (sr.one_shot && (sr.volumes || []).length === 1 && so.title) ? so.title : null;
          var pos = vols.length;
          vols.push(v); keys.push(k); labels.push(vo.title || osTitle || v.label);
          var n = typeof v.n === "number" ? v.n : labelNum(v.label);
          nums.push(n); hss.push(!!v.hs);
          adds.push(v.added || sr.added || null);           // 3.0 : date d'ajout du tome
          var d = vo.title || osTitle || stripPrefix(v.label, [sr.title, cleanTitle(sr.title), (sr.title.split(" - ").pop() || "")]);
          disp.push(d || (n !== null ? (v.hs ? "Hors-série " : "Tome ") + n : v.label));
          if (vo.hidden === true) hid.push(pos); else vis.push(pos);
        });
      });
      if (!IS_OWNER && o.owner_only) return;          // fiche réservée au propriétaire (2.9)
      // Numéros fiables (2.9) = chaque tome visible a un numéro, sans doublon hors hors-séries :
      // on affiche alors les vrais numéros et on range les tomes dans l'ordre (affichage seul,
      // les clés de lecture ne bougent pas). Sinon : 01, 02… comme avant.
      var seenN = {}, realNums = !r.one_shot && vis.length > 0 && vis.every(function (p) {
        if (nums[p] === null) return false;
        if (hss[p]) return true;
        if (seenN[nums[p]]) return false;
        seenN[nums[p]] = true; return true;
      });
      var sortKey = function (p) { return [hss[p] ? 1 : 0, nums[p] === null ? 1e6 : nums[p], p]; };
      var byNum = function (a, b) { var x = sortKey(a), y = sortKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
      var ord = realNums ? vis.slice().sort(byNum) : vis.slice();
      var ordAll = realNums ? vis.concat(hid).sort(byNum) : vols.map(function (_, i) { return i; });
      var first = ord.length ? vols[ord[0]] : null;
      var lastAdded = r.added || null;
      vis.forEach(function (p) { if (adds[p] && (!lastAdded || adds[p] > lastAdded)) lastAdded = adds[p]; });
      var e = {
        id: r.id,
        title: o.title || (IS_OWNER ? r.title : cleanTitle(r.title)),
        author: o.author || r.author,
        genre: Array.isArray(o.genre) ? o.genre : (r.genre || []),
        one_shot: r.one_shot && srcs.length === 1,
        parent_series: r.parent_series,
        volumes: vols,
        cover: (first && first.cover) || null,
        volume_count: vis.length,
        _keys: keys, _labels: labels, _vis: vis, _hidVols: hid, _raw: r,
        _nums: nums, _hs: hss, _disp: disp, _realNums: realNums, _ord: ord, _ordAll: ordAll,
        _private: !!o.owner_only, _publicTitle: o.title || cleanTitle(r.title),
        _adds: adds, _added: r.added || null, _lastAdded: lastAdded,
        _missing: realNums ? missingTomes(r.title, nums, hss, vis.concat(hid)) : [],
        _merged: srcs.slice(1),
        _edited: !!(o.title || o.author || Array.isArray(o.genre))
      };
      (isRawHidden(r) ? hidden : list).push(e);
    });
    list.sort(cmp); hidden.sort(cmp); merged.sort(cmp);
    state.latestAdd = list.reduce(function (m, e) { return e._lastAdded && e._lastAdded > m ? e._lastAdded : m; }, "") || null;
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
    if (state.view === "stats") renderStats();
  }

  // Enregistre une correction (fusionnée avec l'existante). Appliquée tout de suite à
  // l'écran, puis envoyée à Supabase ; en cas d'échec, on revient en arrière.
  function saveOverride(key, patch, onOk) {
    if (needLogin()) return;
    var prev = state.overrides[key] ? JSON.parse(JSON.stringify(state.overrides[key])) : null;
    var cur = { hidden: null, title: null, author: null, genre: null, merged_into: null, not_dup: null, owner_only: null };
    if (prev) Object.keys(cur).forEach(function (k) { if (prev[k] !== undefined && prev[k] !== null) cur[k] = prev[k]; });
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    var empty = cur.hidden === null && !cur.title && !cur.author && !Array.isArray(cur.genre) && !cur.merged_into && !cur.not_dup && !cur.owner_only;
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
    ["merged_into", "not_dup", "owner_only"].forEach(function (k) {
      if (cur[k] || (prev && prev[k])) row[k] = cur[k] || null;
    });
    var q = empty
      ? supabase.from("bd_overrides").delete().eq("id", key)
      : supabase.from("bd_overrides").upsert(row);
    q.then(function (res) {
      var m = res.error ? (res.error.message || "erreur Supabase") : "";
      if (/merged_into|not_dup|owner_only/.test(m)) m = "relance le script supabase_bd_overrides.sql dans Supabase (voir README).";
      else if (res.error && isRefused(res.error)) m = refusedText(res.error);
      if (res.error) rollback(m);
      else if (onOk) onOk();
    }).catch(function (err) { rollback((err && err.message) || "hors ligne"); });
  }

  function rowToOverride(row) {
    return { hidden: row.hidden, title: row.title, author: row.author, genre: row.genre,
             merged_into: row.merged_into || null, not_dup: row.not_dup || null, owner_only: row.owner_only || null };
  }

  // 3.1 : les corrections (dont les fiches réservées au propriétaire) doivent être connues
  // avant d'afficher quoi que ce soit à un visiteur qui n'a encore rien en cache : sinon une
  // fiche privée apparaissait une fraction de seconde (ou s'ouvrait depuis un lien) avant
  // l'arrivée de bd_overrides. Attente plafonnée à OV_WAIT ms (Supabase injoignable).
  var OV_WAIT = 4000, ovResolve, ovReadyP = new Promise(function (r) { ovResolve = r; });
  state.ovReady = false;
  function markOvReady() { if (!state.ovReady) { state.ovReady = true; ovResolve(); } }
  function whenOv() { return Promise.race([ovReadyP, new Promise(function (r) { setTimeout(r, OV_WAIT); })]); }
  // Ouvre la fiche d'une adresse #/fiche/<id> ; pour un visiteur, une fois les corrections connues.
  function openFromRouteSafe(fid) {
    if (IS_OWNER || state.ovReady) { openFromRoute(fid); return; }
    whenOv().then(function () { if (ficheFromHash() === fid && state.view === "home") openFromRoute(fid); });
  }
  function fetchOverrides() {
    supabase.from("bd_overrides").select("*")
      .then(function (res) {
        if (res.error) {
          markOvReady();
          if (IS_OWNER) setSyncNote("Corrections indisponibles : la table bd_overrides n'existe pas encore dans Supabase (voir README).");
          return;
        }
        var map = {};
        (res.data || []).forEach(function (row) {
          map[row.id] = rowToOverride(row);
        });
        state.overrides = map;
        saveLocalOverrides();
        markOvReady();
        refreshAll();
      })
      .catch(function () { markOvReady(); });
  }

  // ---------- supabase ----------
  var supabase = null;
  function initSupabase() {
    if (!window.supabase || !window.BD_SUPABASE_URL || !window.BD_SUPABASE_ANON_KEY) {
      markOvReady();
      if (IS_OWNER) setSyncNote("Synchronisation indisponible (config manquante) — mode local uniquement.");
      return;
    }
    try {
      supabase = window.supabase.createClient(window.BD_SUPABASE_URL, window.BD_SUPABASE_ANON_KEY);
      initAuth();
      // les corrections concernent tout le monde (titres corrigés, fiches masquées)…
      fetchOverrides();
      // …les statuts et la synchro en direct, seulement le propriétaire
      if (IS_OWNER) subscribeRealtime();   // statuts : lus par syncStatuses(), une fois connecté (3.2)
    } catch (e) {
      markOvReady();
      if (IS_OWNER) setSyncNote("Synchronisation indisponible — mode local uniquement.");
    }
  }

  // ---------- connexion Supabase (3.1) ----------
  // Première étape du lot sécurité : le propriétaire se connecte à Supabase avec son adresse
  // e-mail et son mot de passe (supabase.auth.signInWithPassword), une fois par appareil.
  // (Le code par e-mail a été écarté : sans serveur SMTP à soi, Supabase n'envoie qu'un lien,
  // qui sur l'iPhone s'ouvrirait dans Safari et pas dans l'appli de l'écran d'accueil.)
  // La session est gardée par supabase-js dans le localStorage (clé sb-<ref>-auth-token) et
  // renouvelée toute seule ; toutes les requêtes partent alors avec le jeton de la session au
  // lieu de la clé publique. Le mot de passe, lui, n'est gardé nulle part par l'appli.
  // En 3.1, les règles (RLS) ne changent pas : se connecter ne bloque ni ne débloque rien.
  // En 3.2, seules les requêtes d'une session connectée pourront écrire.
  // Les inscriptions sont fermées dans Supabase : seul l'utilisateur créé à la main existe.
  var AUTH_EMAIL_KEY = "bd_auth_email_v1";
  state.auth = { session: null, ready: false, email: "", msg: "", err: false, busy: false };
  try { state.auth.email = localStorage.getItem(AUTH_EMAIL_KEY) || ""; } catch (e) {}
  function initAuth() {
    if (!supabase || !supabase.auth) return;
    supabase.auth.getSession().then(function (res) {
      state.auth.session = (res && res.data && res.data.session) || null;
      state.auth.ready = true;
      // propriétaire dont la session gardée n'est plus valable (supabase-js l'a effacée) : visiteur
      if (IS_OWNER && !state.auth.session && !storedSession()) { lostSession(); return; }
      renderAuthBox();
      syncStatuses();
    }).catch(function () { state.auth.ready = true; renderAuthBox(); });
    supabase.auth.onAuthStateChange(function (event, session) {
      state.auth.session = session || null;
      state.auth.ready = true;
      if (event === "SIGNED_OUT") {
        state.statusSynced = false;
        if (IS_OWNER && !state.auth.leaving) { lostSession(); return; }
      }
      renderAuthBox();
      if (event === "SIGNED_IN") syncStatuses();
    });
  }
  function authErrorText(err) {
    var m = ((err && (err.message || err.msg || err.error_description)) || "") + "";
    var code = (err && (err.code || err.error_code)) || "";
    if (err && err.status === 429 || /rate limit|too many/i.test(m)) return "Trop d'essais rapprochés : attends quelques minutes avant de recommencer.";
    if (code === "invalid_credentials" || /invalid login credentials|invalid_grant/i.test(m)) return "Adresse ou mot de passe incorrect.";
    if (code === "email_not_confirmed" || /not confirmed/i.test(m)) return "Ce compte n'est pas confirmé dans Supabase (Authentication → Users).";
    if (/fetch|network/i.test(m)) return "Supabase ne répond pas (hors ligne ?). Réessaie dans un moment.";
    return "Connexion impossible : " + (m || "erreur inconnue");
  }
  // Réglages → Mode propriétaire, sur un appareil visiteur : formulaire de connexion.
  // Une connexion réussie recharge la page, qui s'ouvre alors en mode propriétaire.
  function renderAuthBox() {
    var box = document.getElementById("auth-box");
    if (!box) return;
    var a = state.auth, html = "";
    if (!supabase || !supabase.auth) {
      html = '<p class="settings-hint">Connexion indisponible : Supabase n\'a pas pu être chargé.</p>';
    } else if (a.session) {
      html = '<p class="owner-status on">Connexion réussie : ouverture du mode propriétaire…</p>';
    } else {
      html = '<form id="auth-form" class="owner-form auth-form" autocomplete="on">' +
             '<input type="email" id="auth-email" class="owner-input" autocomplete="username" placeholder="Adresse e-mail" aria-label="Adresse e-mail" required>' +
             '<input type="password" id="auth-pass" class="owner-input" autocomplete="current-password" placeholder="Mot de passe" aria-label="Mot de passe" required>' +
             '<button type="submit" class="btn"' + (a.busy ? ' disabled' : '') + '>Se connecter</button></form>';
    }
    html += '<p id="auth-msg" class="owner-msg' + (a.err ? ' err' : '') + '" role="status"></p>';
    box.innerHTML = html;
    document.getElementById("auth-msg").textContent = a.msg || "";
    var mail = document.getElementById("auth-email");
    if (mail) mail.value = a.email || "";
    var f = document.getElementById("auth-form");
    if (f) f.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (mail.value || "").trim(), pass = document.getElementById("auth-pass").value;
      if (!email || !pass) return;
      a.email = email; a.busy = true; a.msg = "Connexion…"; a.err = false;
      document.getElementById("auth-msg").textContent = a.msg;
      supabase.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
        a.busy = false;
        if (res && res.error) {
          a.msg = authErrorText(res.error); a.err = true; renderAuthBox();
          var pw = document.getElementById("auth-pass"); if (pw) pw.focus();
          return;
        }
        try { localStorage.setItem(AUTH_EMAIL_KEY, email); } catch (e2) {}
        a.session = (res.data && res.data.session) || a.session; a.msg = ""; a.err = false;
        renderAuthBox();
        location.reload();
      }).catch(function (err) { a.busy = false; a.msg = authErrorText(err); a.err = true; renderAuthBox(); });
    });
  }
  // Session perdue (compte recréé, session révoquée, expirée sans renouvellement possible) :
  // l'appareil repasse en visiteur ; le message s'affiche après le rechargement.
  function lostSession() {
    try { sessionStorage.setItem(LOST_KEY, "1"); } catch (e) {}
    location.reload();
  }

  // ---------- verrou des écritures (3.2) ----------
  // Depuis supabase_securite.sql, la base n'accepte les écritures (et la lecture des favoris
  // et des coches) que d'une session connectée. Sans connexion, l'appli prévient AVANT de
  // toucher à l'écran, plutôt que d'afficher une coche qui ne serait pas gardée ; si la base
  // refuse quand même (session expirée), la modification est annulée à l'écran.
  function hasSession() { return !!(state.auth && state.auth.session); }
  function goLogin() {
    location.hash = "#/reglages";
    setTimeout(function () {
      var f = document.getElementById("auth-email");
      if (!f) return;
      try { f.scrollIntoView({ block: "center" }); } catch (e) {}
      (f.value ? document.getElementById("auth-pass") : f).focus();
    }, 300);
  }
  // Propriétaire dont la session n'est pas (encore) confirmée : vérification en cours, ou
  // Supabase injoignable (hors ligne). On ne touche à rien plutôt que d'afficher un changement
  // qui ne serait pas gardé.
  function needLogin() {
    if (!supabase || hasSession()) return false;   // sans Supabase : comportement d'avant
    if (!state.auth.ready) toast("Vérification de la connexion en cours : réessaie dans un instant.");
    else toast("Pas enregistré : Supabase ne répond pas (hors ligne ?). Réessaie dans un moment.");
    return true;
  }
  function isRefused(err) {
    var m = ((err && (err.message || err.msg)) || "") + "";
    return !!err && (err.code === "42501" || err.code === "PGRST301" || err.status === 401 || err.status === 403 ||
                     /row-level security|permission denied|jwt/i.test(m));
  }
  function refusedText(err) {
    return isRefused(err) ? "la connexion à Supabase n'est plus valable : reconnecte-toi (Réglages → Mode propriétaire)."
                          : ((err && err.message) || "erreur Supabase");
  }
  // Favoris et coches du propriétaire : lus une fois connecté (la base ne les donne plus à la clé publique).
  function syncStatuses() {
    if (!IS_OWNER || !supabase || !hasSession() || state.statusSynced) return;
    state.statusSynced = true;
    fetchRemoteFavorites();
    fetchRemoteVolumeStatus();
  }

  // Quitter le mode propriétaire déconnecte aussi de Supabase (appareil prêté, par exemple).
  function signOutLocal() {
    if (!supabase || !supabase.auth) return Promise.resolve();
    return supabase.auth.signOut({ scope: "local" }).catch(function () {});
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

  // Écriture refusée par la base (3.2 : session expirée ou révoquée) : on remet l'écran
  // comme avant et on le dit. Autre erreur (réseau) : on garde la modification locale.
  function afterStatusWrite(res, undo) {
    if (!res || !res.error) return;
    if (isRefused(res.error)) {
      undo();
      renderGrid();
      if (state.activeId) { renderVolumeList(); renderSheetActions(); }
      toast("Non enregistré : " + refusedText(res.error));
    } else setSyncNote("Dernière modification pas encore synchronisée.");
  }
  function pushFavorite(titleId) {
    if (!supabase) return;
    var f = state.favorites[titleId] || { is_favorite: false }, was = !f.is_favorite;
    supabase.from("bd_status").upsert({
      id: titleId, is_favorite: f.is_favorite, updated_at: new Date().toISOString()
    }).then(function (res) {
      afterStatusWrite(res, function () { state.favorites[titleId] = { is_favorite: was }; saveLocalFavorites(); });
    }).catch(function () {});
  }

  function pushVolumeStatus(key) {
    if (!supabase) return;
    var now = isKeyRead(key);
    supabase.from("bd_volume_status").upsert({
      id: key, title_id: titleOfKey(key), is_read: now, updated_at: new Date().toISOString()
    }).then(function (res) {
      afterStatusWrite(res, function () { if (now) delete state.volumeRead[key]; else state.volumeRead[key] = true; saveLocalVolumeRead(); });
    }).catch(function () {});
  }

  function pushVolumeStatusBulk(keys, read, before) {
    if (!supabase || !keys.length) return;
    var now = new Date().toISOString();
    var rows = keys.map(function (k) {
      return { id: k, title_id: titleOfKey(k), is_read: read, updated_at: now };
    });
    supabase.from("bd_volume_status").upsert(rows).then(function (res) {
      afterStatusWrite(res, function () {
        keys.forEach(function (k) { if (before && before[k]) state.volumeRead[k] = true; else delete state.volumeRead[k]; });
        saveLocalVolumeRead();
      });
    }).catch(function () {});
  }

  // ---------- data ----------
  function loadCatalog() {
    // cache: "no-store" + un paramètre unique évitent qu'un navigateur (ou un cache
    // intermédiaire) serve une ancienne version de catalog.json après une mise à jour.
    // 2.8 : data/version.json (quelques octets, jamais mis en cache) donne l'empreinte du
    // catalogue, écrite par outils_delta/6_finir.py. Le catalogue (1,2 Mo) est demandé avec
    // cette empreinte : le navigateur le garde tant qu'il ne change pas, et le reprend dès
    // le delta suivant. Sans version.json (ancien dépôt), on le recharge à chaque fois.
    fetch("data/version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) {
        return v && v.catalog
          ? fetch("data/catalog.json?v=" + encodeURIComponent(v.catalog))
          : fetch("data/catalog.json?t=" + Date.now(), { cache: "no-store" });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // "hidden" : fiche masquée (ex : ancien dossier d'une série remplacé par un plus
        // complet). Elle reste dans le catalogue pour que le prochain import la reconnaisse
        // et ne la réinsère pas, mais elle n'est jamais affichée ni comptée.
        state.raw = data.entries;
        var show = function () {
          applyOverrides();
          renderGrid();
          if (state.view === "settings") { renderHiddenList(); updateDupButton(); }
          else if (state.view === "dups") renderDups();
          else if (state.view === "stats") renderStats();
          var fid = ficheFromHash();
          if (fid && state.view === "home") openFromRouteSafe(fid);
        };
        // visiteur sans corrections en cache (première visite) : on attend bd_overrides
        if (!IS_OWNER && !state.ovReady && !hadOvCache) whenOv().then(show); else show();
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

  // Sigles (version 2.7) : « I.R.$. », « W.I.T.C.H », « G.I. Joe » s'écrivent avec des points
  // entre des lettres isolées. normalize() en fait des lettres séparées (« i r »), qui se
  // retrouvent dans presque tous les titres : chercher « I.R.$ » noyait la série dans 1 500
  // résultats. Ici, une suite de lettres isolées séparées par des points est recollée
  // (« I.R.$ » → « irs », « G.I. Joe » → « gi joe ») et le signe $ compte comme un S.
  // L'index garde les deux formes, la requête est réduite à la forme recollée.
  var ACRONYM_RE = /(^|[^\p{L}\p{N}])((?:[\p{L}\p{N}]\.)+[\p{L}\p{N}])(?=\.|[^\p{L}\p{N}]|$)/gu;
  function normalizeQ(s) {
    s = (s || "").toString().replace(/\$/g, "s")
      .replace(ACRONYM_RE, function (m, before, acr) { return before + acr.replace(/\./g, ""); });
    return normalize(s);
  }
  function both(s) { var a = normalize(s), b = normalizeQ(s); return a === b ? a : a + " " + b; }

  // Index de recherche precalcule une fois au chargement : titre de la serie
  // + titres de tous ses tomes (on retrouve Thorgal en tapant « magicienne trahie »).
  // La recherche ne porte que sur ce qui est AFFICHÉ (version 2.4, demande de Christophe) :
  // titre (corrigé s'il l'a été), titres des tomes visibles (corrigés s'ils l'ont été) et
  // auteur affiché. Le titre d'origine d'une fiche ou d'un tome renommé ne répond plus : il
  // n'apparaît nulle part à l'écran. Seule exception, les fiches fusionnées dans celle-ci :
  // elles n'ont plus de vignette, on les retrouve donc par le nom affiché dans la ligne
  // « Fiche fusionnée ici » (leur titre corrigé s'il y en a un).
  function buildSearchIndex(entries) {
    entries.forEach(function (e) {
      var labels = (e._vis || []).map(function (i) { return e._disp[i]; }).join(" ");
      var merged = (e._merged || []).map(function (m) { return (state.overrides[m.id] || {}).title || m.title; }).join(" ");
      e._qTitle = " " + both(e.title) + " ";
      e._qAll = " " + both(e.title + " " + merged + " " + labels) + " ";
      e._qAuthor = " " + both(e.author || "") + " ";
    });
  }

  // Tous les mots tapes doivent se retrouver, dans n'importe quel ordre.
  // Un sigle tapé avec ses points ou son $ (« I.R.$ », « M.A.D ») doit être un mot entier :
  // sinon « irs » se retrouverait aussi dans « soirs ». Tapé sans points (« irs »), il garde
  // la recherche habituelle, à l'intérieur des mots.
  function hasAllWords(haystack, query) {
    var words = normalizeQ(query).split(" ");
    var plain = " " + normalize(query) + " ";
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      var acronym = w.length > 1 && plain.indexOf(" " + w + " ") === -1;
      if (haystack.indexOf(acronym ? " " + w + " " : w) === -1) return false;
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
  // Trois protections, pour qu'aucune vignette ne reste vide alors que sa couverture existe :
  //  1. un IntersectionObserver demande l'image quand la vignette approche de l'écran ;
  //  2. un filet de sécurité, après chaque défilement, saut de lettre ou nouvel affichage,
  //     demande toute vignette proche de l'écran restée en attente (certains navigateurs,
  //     Safari notamment, peuvent rater une notification après un défilement rapide) ;
  //  3. une image en échec (réseau, serveur sollicité par une rafale de demandes) est
  //     retentée deux fois, après 1,5 s puis 5 s, avec une adresse légèrement différente
  //     pour ne pas retomber sur un échec gardé en cache. Après le dernier échec, on montre
  //     le fond de la vignette plutôt qu'une icône d'image cassée.
  var LAZY_MARGIN = 800;
  var RETRY_DELAYS = [1500, 5000];
  var lazyObserver = ("IntersectionObserver" in window) ? new IntersectionObserver(function (items) {
    items.forEach(function (it) { if (it.isIntersecting) startLoad(it.target); });
  }, { rootMargin: LAZY_MARGIN + "px 0px" }) : null;

  function startLoad(im) {
    var url = im.getAttribute("data-src");
    if (!url) return;
    im.removeAttribute("data-src");
    if (lazyObserver) lazyObserver.unobserve(im);
    loadWithRetry(im, url, 0);
  }
  function loadWithRetry(im, base, attempt) {
    im.onload = function () { im.classList.remove("img-failed"); };
    im.onerror = function () {
      if (attempt >= RETRY_DELAYS.length) { im.classList.add("img-failed"); return; }
      setTimeout(function () {
        if (!im.isConnected) return;                 // la grille a été redessinée entre-temps
        loadWithRetry(im, base, attempt + 1);
      }, RETRY_DELAYS[attempt]);
    };
    im.src = attempt ? base + (base.indexOf("?") === -1 ? "?" : "&") + "r=" + attempt : base;
  }
  function lazyImage(img, url) {
    if (!url) return;
    img.setAttribute("data-src", url);
    if (lazyObserver) lazyObserver.observe(img);
    else startLoad(img);                              // navigateur ancien : chargement direct
  }

  var sweepTimer = null;
  function sweepSoon() { clearTimeout(sweepTimer); sweepTimer = setTimeout(sweepVisible, 120); }
  function sweepVisible() {
    if (state.view !== "home") return;
    var h = window.innerHeight || document.documentElement.clientHeight;
    if (!h) return;
    Array.prototype.forEach.call(els.grid.querySelectorAll("img[data-src]"), function (im) {
      var r = im.getBoundingClientRect();
      if (r.width > 0 && r.bottom > -LAZY_MARGIN && r.top < h + LAZY_MARGIN) startLoad(im);
    });
  }
  window.addEventListener("scroll", sweepSoon, { passive: true });
  window.addEventListener("resize", sweepSoon);

  var renderTimer = null;
  function renderGridSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderGrid, 150);
  }

  // ---------- barre alphabétique ----------
  // Comme dans l'appli ebooks : # puis A à Z, les lettres sans BD sont grisées, et un
  // séparateur de lettre précède le premier titre de chaque lettre dans la grille. Le saut
  // se fait par défilement, sans changer l'adresse (le retour arrière reste propre).
  // En dessous de AZ_MIN résultats (une recherche précise), barre et séparateurs
  // disparaissent : ils n'apporteraient rien.
  var AZ_LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  var AZ_MIN = 40;
  var azEl = document.getElementById("az");
  function initialOf(title) {
    var c = (title || "").trim().charAt(0);
    if (c === "Œ" || c === "œ") return "O";
    if (c === "Æ" || c === "æ") return "A";
    c = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  function letterHead(L) {
    var h = document.createElement("h2");
    h.className = "letter-head";
    h.id = "L-" + (L === "#" ? "num" : L);
    h.textContent = L === "#" ? "0-9 #" : L;
    return h;
  }
  function renderAz(present, show) {
    if (!azEl) return;
    azEl.hidden = !show;
    azEl.innerHTML = "";
    if (!show) return;
    AZ_LETTERS.forEach(function (L) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = L;
      if (present[L]) {
        b.setAttribute("aria-label", L === "#" ? "Aller aux titres commençant par un chiffre ou un signe" : "Aller à la lettre " + L);
        b.addEventListener("click", function () { jumpToLetter(L); });
      } else {
        b.disabled = true;
        b.className = "off";
      }
      azEl.appendChild(b);
    });
  }
  function jumpToLetter(L) {
    var t = document.getElementById("L-" + (L === "#" ? "num" : L));
    if (!t) return;
    // la barre reste collée en haut : on s'arrête juste en dessous pour ne pas cacher le séparateur
    var y = t.getBoundingClientRect().top + window.scrollY - (azEl ? azEl.offsetHeight : 0) - 10;
    window.scrollTo(0, Math.max(0, y));
    sweepSoon();
  }

  // ---------- render ----------
  // 3.0 : tri « Ajoutés récemment » : dernière date d'ajout d'abord (une série qui reçoit
  // de nouveaux tomes remonte), puis par titre ; un séparateur par date remplace les lettres.
  function dateHead(d) {
    var h = document.createElement("h2");
    h.className = "letter-head date-head";
    h.textContent = d ? "Ajoutés le " + frDate(d) : "Date d'ajout inconnue";
    return h;
  }
  function renderGrid() {
    var list = state.catalog.filter(matches);
    var recent = state.sort === "recent";
    if (recent) list = list.slice().sort(function (a, b) {        // tri stable : le titre départage
      var x = a._lastAdded || "", y = b._lastAdded || "";
      return x < y ? 1 : x > y ? -1 : 0;
    });
    if (lazyObserver) lazyObserver.disconnect();
    els.grid.innerHTML = "";
    els.empty.hidden = list.length > 0;
    var showAz = !recent && list.length >= AZ_MIN, present = {}, lastDay = null, cut = newCutoff();
    var frag = document.createDocumentFragment();
    list.forEach(function (entry) {
      if (recent) {
        var d = entry._lastAdded || "";
        if (d !== lastDay) { lastDay = d; frag.appendChild(dateHead(d)); }
      } else if (showAz) {
        var L = initialOf(entry.title);
        if (!present[L]) { present[L] = true; frag.appendChild(letterHead(L)); }
      }
      frag.appendChild(renderCard(entry, cut));
    });
    els.grid.appendChild(frag);
    renderAz(present, showAz);
    sweepSoon();
  }

  function renderCard(entry, cut) {
    var fav = state.favorites[entry.id] || {};
    var nw = newInfo(entry, cut || newCutoff());
    var read = isTitleRead(entry);
    var readCount = countRead(entry);
    var inProgress = isInProgress(entry);
    var card = document.createElement("div");
    card.className = "card" + (entry._private ? " is-private" : "");
    card.setAttribute("data-id", entry.id);
    // 2.8 : vignette utilisable au clavier (Tab, Entrée, Espace) et annoncée par VoiceOver
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", entry.title + ", " + (entry.one_shot ? "one-shot" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome")) +
      (entry.author ? ", " + entry.author : "") + (IS_OWNER && read ? ", lu" : IS_OWNER && inProgress ? ", " + readCount + " lus" : "") +
      (entry._private ? ", réservée au propriétaire" : "") + (nw ? ", " + nw.aria : ""));

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
    if (IS_OWNER && entry._private) {
      var bpv = document.createElement("span"); bpv.className = "badge private"; bpv.textContent = "Privé"; badges.appendChild(bpv);
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
    if (nw) {                                             // 3.0 : nouveauté (visible de tous)
      var bn = document.createElement("span"); bn.className = "badge new card-new"; bn.textContent = nw.text;
      coverWrap.appendChild(bn);
    }

    var info = document.createElement("div");
    info.className = "card-info";
    var t = document.createElement("div"); t.className = "card-title"; t.textContent = entry.title;
    var a = document.createElement("div"); a.className = "card-author"; a.textContent = entry.author || "Auteur non renseigné";
    var c = document.createElement("div"); c.className = "card-count" + (entry.one_shot ? " oneshot" : ""); c.textContent = entry.one_shot ? "One-shot" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome");
    info.appendChild(t); info.appendChild(a); info.appendChild(c);

    card.appendChild(coverWrap);
    card.appendChild(info);
    card.addEventListener("click", function () { openSheet(entry.id); });
    card.addEventListener("keydown", function (e) {
      if (e.target !== card) return;                     // Entrée sur la loupe : la loupe
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(entry.id); }
    });
    return card;
  }

  // ---------- detail sheet ----------
  function currentEntry() {
    return state.catalog.find(function (e) { return e.id === state.activeId; });
  }

  // 2.9 : chaque fiche a son adresse, #/fiche/<id>, qu'on peut partager. Ouvrir une fiche
  // depuis la grille change l'adresse (le bouton retour du téléphone la referme) ; c'est
  // route() qui l'affiche réellement (openSheetUI).
  var FICHE_PREFIX = "#/fiche/";
  function ficheFromHash() {
    var h = location.hash || "";
    if (h.indexOf(FICHE_PREFIX) !== 0) return null;
    try { return decodeURIComponent(h.slice(FICHE_PREFIX.length)); } catch (e) { return null; }
  }
  function ficheUrl(id) { return location.href.split("#")[0] + FICHE_PREFIX + encodeURIComponent(id); }
  function openSheet(id) {
    var h = FICHE_PREFIX + encodeURIComponent(id);
    if (location.hash === h) { openFromRoute(id); return; }
    state.sheetFromApp = true;
    location.hash = h;
  }
  function openFromRoute(id) {
    var entry = state.catalog.find(function (e) { return e.id === id; });
    if (!entry) {                                          // fiche fusionnée : sa fiche d'accueil
      var m = state.mergedList.find(function (x) { return x.id === id; });
      if (m) entry = state.catalog.find(function (e) { return e.id === m.into; });
    }
    if (!entry) {
      if (!state.raw.length) return;                       // catalogue pas encore chargé
      try { history.replaceState(null, "", "#/"); } catch (e) {}
      if (state.activeId) closeSheetUI();
      toast("Cette fiche n'est pas disponible.");
      return;
    }
    if (state.activeId !== entry.id || els.overlay.hidden) openSheetUI(entry.id);
  }
  function openSheetUI(id) {
    var entry = state.catalog.find(function (e) { return e.id === id; });
    if (!entry) return;
    if (els.overlay.hidden) state.lastFocus = document.activeElement;
    state.activeId = id;
    state.activeVolIdx = entry._ord.length ? entry._ord[0] : 0;
    state.editVol = null;
    closeEditor();
    refreshSheet();
    els.overlay.hidden = false;
    document.body.style.overflow = "hidden";
    // 2.8 : le focus va dans la fiche (lecteurs d'écran, clavier)
    setTimeout(function () { try { els.sheetTitle.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }

  // Remplit la fiche ouverte à partir de l'état courant (appelé aussi après une correction).
  function refreshSheet() {
    var entry = currentEntry();
    if (!entry) return;
    if (entry._vis.indexOf(state.activeVolIdx) === -1 && !(IS_OWNER && entry._hidVols.indexOf(state.activeVolIdx) !== -1)) {
      state.activeVolIdx = entry._ord.length ? entry._ord[0] : 0;
    }
    els.sheetTitle.textContent = entry.title;
    var pub = document.getElementById("sheet-public");
    if (pub) {
      var msg = [];
      if (entry._private) msg.push("Réservée au propriétaire : invisible pour les visiteurs.");
      else if (!(state.overrides[entry.id] || {}).title && entry._publicTitle !== entry.title)
        msg.push("Les visiteurs voient « " + entry._publicTitle + " ».");
      pub.textContent = msg.join(" ");
      pub.hidden = !msg.length;
    }
    els.sheetAuthor.textContent = entry.author || "Auteur non renseigné";
    els.sheetMeta.textContent = (entry.one_shot ? "One-shot · album unique" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome")) + (entry.parent_series ? " · série liée à " + entry.parent_series : "");
    var added = document.getElementById("sheet-added");
    if (added) {                                           // 3.0 : date d'ajout (tout le monde)
      var at = "";
      if (entry._added) {
        at = (entry.one_shot ? "Ajouté le " : "Fiche ajoutée le ") + frDate(entry._added);
        if (!entry.one_shot && entry._lastAdded && entry._lastAdded > entry._added) at += " · derniers tomes ajoutés le " + frDate(entry._lastAdded);
      }
      added.textContent = at; added.hidden = !at;
    }
    var miss = document.getElementById("sheet-missing");
    if (miss) {                                            // 3.0 : tomes manquants (propriétaire)
      var mt = IS_OWNER && !entry.one_shot ? missingText(entry._missing) : "";
      miss.textContent = mt; miss.hidden = !mt;
    }
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
    var alt = entry.title + (vol ? " — " + (entry._disp ? entry._disp[idx] : vol.label) : "");
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
    var order = IS_OWNER ? entry._ordAll : entry._ord;
    var pos = 0, cut = newCutoff(), fresh = !!(entry._added && entry._added >= cut);
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
      if (entry._realNums && entry._nums[i] !== null) {
        num.textContent = (entry._hs[i] ? "HS" : "") + String(entry._nums[i]).padStart(entry._hs[i] ? 1 : 2, "0");
        if (entry._hs[i]) num.classList.add("hs");
      } else num.textContent = hiddenVol ? "––" : String(pos).padStart(2, "0");
      var label = document.createElement("span"); label.className = "vol-label";
      label.textContent = entry._disp[i] + (hiddenVol ? "  (masqué)" : "");
      li.appendChild(num);
      li.appendChild(label);
      if (!fresh && !hiddenVol && entry._adds[i] && entry._adds[i] >= cut) {   // 3.0 : tome arrivé récemment
        var tn = document.createElement("span"); tn.className = "vol-new"; tn.textContent = "nouveau";
        tn.title = "Ajouté le " + frDate(entry._adds[i]);
        li.appendChild(tn);
      }

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
    var origDisp = stripPrefix(original, [entry._raw.title, cleanTitle(entry._raw.title)]) || original;
    input.value = entry._disp[i];
    input.placeholder = origDisp;
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
      saveOverride(key, { title: (!v || v === original || v === origDisp) ? null : v }, function () { toast("Titre du tome enregistré."); });
    });
    setTimeout(function () { input.focus(); input.select(); }, 0);
    return li;
  }

  function toggleVolumeRead(entry, i) {
    if (needLogin()) return;
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
    if (ficheFromHash() !== null) {
      if (state.sheetFromApp) { state.sheetFromApp = false; history.back(); return; }
      try { history.replaceState(null, "", "#/"); } catch (e) {}
    }
    closeSheetUI();
  }
  function closeSheetUI() {
    var id = state.activeId;
    closeEditor();
    state.editVol = null;
    if (!els.zoomOverlay.hidden) closeZoom();
    els.overlay.hidden = true;
    state.activeId = null;
    document.body.style.overflow = "";
    // 2.8 : le focus revient sur la vignette d'origine
    var back = null;
    try { back = id && els.grid.querySelector('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); } catch (e) {}
    back = back || state.lastFocus;
    state.lastFocus = null;
    if (back && back.focus && document.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
  }

  function toggleAllVolumesRead() {
    var entry = currentEntry();
    if (!entry || needLogin()) return;
    var makeRead = !isTitleRead(entry), before = {};
    entry._vis.forEach(function (i) { before[entry._keys[i]] = isKeyRead(entry._keys[i]); });
    entry._vis.forEach(function (i) {
      var key = entry._keys[i];
      if (makeRead) state.volumeRead[key] = true;
      else delete state.volumeRead[key];
    });
    saveLocalVolumeRead();
    renderVolumeList();
    renderSheetActions();
    renderGrid();
    pushVolumeStatusBulk(entry._vis.map(function (i) { return entry._keys[i]; }), makeRead, before);
  }

  function toggleFavorite() {
    var entry = currentEntry();
    if (!entry || needLogin()) return;
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
    priv: document.getElementById("edit-private"),
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
    edit.priv.textContent = entry._private ? "Rendre visible aux visiteurs" : "Réserver au propriétaire";
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
  // 2.9 : fiche réservée au propriétaire (couvertures adultes…) — invisible pour les visiteurs
  edit.priv.addEventListener("click", function () {
    var entry = currentEntry(); if (!entry) return;
    var id = entry.id, title = entry.title, on = !entry._private;
    closeEditor();
    saveOverride(id, { owner_only: on ? true : null }, function () {
      toast(on ? "« " + title + " » est réservée au propriétaire." : "« " + title + " » est de nouveau visible pour tous.",
            "Annuler", function () { saveOverride(id, { owner_only: on ? null : true }); });
    });
  });

  // 2.9 : partager une fiche (iPhone : feuille de partage ; ailleurs : lien copié)
  document.getElementById("btn-share").addEventListener("click", function () {
    var entry = currentEntry(); if (!entry) return;
    var url = ficheUrl(entry.id);
    var warn = entry._private ? " Fiche réservée : le lien ne s'ouvrira que sur tes appareils." : "";
    if (navigator.share) {
      navigator.share({ title: entry.title, url: url }).catch(function () {});
      if (warn) toast(warn.trim());
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("Lien copié." + warn); },
        function () { toast("Lien : " + url); });
    } else toast("Lien : " + url);
  });
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

  // 3.0 : tri de la grille, mémorisé sur l'appareil
  var SORT_KEY = "bd_tri_v1";
  try { if (localStorage.getItem(SORT_KEY) === "recent") state.sort = "recent"; } catch (e) {}
  function setSort(v) {
    state.sort = v === "recent" ? "recent" : "title";
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
        // 2.9 : même libellé mais numéros différents connus (« Un conte de Noël » 1 et 2) : pas un doublon
        var nn = pos.map(function (i) { return e._nums[i]; });
        if (nn.every(function (x) { return x !== null; }) && nn.filter(function (x, k) { return nn.indexOf(x) === k; }).length === nn.length) return;
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
  // STATISTIQUES (#/stats, 3.0) : ouverte depuis les Réglages, visible de tous. Calculée sur
  // les fiches affichées (sans les fiches masquées, ni les fiches privées pour un visiteur).
  // En plus pour le propriétaire : ses lectures et les séries incomplètes.
  // =====================================================================
  var statsBody = document.getElementById("stats-body");
  function st(tag, cls, text) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined) x.textContent = text;
    return x;
  }
  function fmt(n) { return n.toLocaleString("fr-FR"); }
  function statSection(title, hint) {
    var sec = st("section", "st-sec");
    sec.appendChild(st("h3", "st-h", title));
    if (hint) sec.appendChild(st("p", "settings-hint", hint));
    statsBody.appendChild(sec);
    return sec;
  }
  function statTiles(sec, tiles) {
    var g = st("div", "st-tiles");
    tiles.forEach(function (t) {
      var d = st("div", "st-tile");
      d.appendChild(st("div", "st-num", t[1]));
      d.appendChild(st("div", "st-lab", t[0]));
      g.appendChild(d);
    });
    sec.appendChild(g);
  }
  // Barres horizontales, une seule série : libellé (bouton s'il mène à la grille), barre, valeur.
  function statBars(sec, rows, unit) {
    var max = rows.reduce(function (m, r) { return Math.max(m, r.v); }, 0) || 1;
    var box = st("div", "st-bars");
    rows.forEach(function (r) {
      var row = st("div", "st-row");
      var lab = r.go ? st("button", "st-lab-btn", r.label) : st("span", "st-lab-txt", r.label);
      if (r.go) { lab.type = "button"; lab.addEventListener("click", r.go); }
      var track = st("span", "st-track"), fill = st("span", "st-fill");
      fill.style.width = Math.max(1.5, r.v * 100 / max) + "%";
      track.appendChild(fill);
      track.title = r.label + " : " + fmt(r.v) + " " + unit;
      track.setAttribute("aria-hidden", "true");
      row.appendChild(lab); row.appendChild(track); row.appendChild(st("span", "st-val", r.text || fmt(r.v)));
      box.appendChild(row);
    });
    sec.appendChild(box);
  }
  // Depuis les statistiques : afficher la grille filtrée (genre ou auteur), ou triée par ajout.
  function goGrid(apply) {
    apply();
    viewScroll.home = 0;
    location.hash = "#/";
  }
  function renderStats() {
    if (!statsBody) return;
    statsBody.innerHTML = "";
    if (!state.raw.length) { statsBody.appendChild(st("p", "settings-hint", "Chargement du catalogue…")); return; }
    var list = state.catalog, nOne = 0, nVol = 0, authors = {}, genres = {}, noGenre = 0, byDay = {};
    list.forEach(function (e) {
      if (e.one_shot) nOne++;
      nVol += e.volume_count;
      (e.author || "").split(/\s*,\s*/).forEach(function (a) {
        a = a.trim(); if (!a) return;
        var k = a.toLowerCase(), x = authors[k] || (authors[k] = { name: a, albums: 0, fiches: 0 });
        x.albums += e.volume_count; x.fiches++;
      });
      if (!(e.genre || []).length) noGenre++;
      (e.genre || []).forEach(function (g) { genres[g] = (genres[g] || 0) + 1; });
      if (e._added) (byDay[e._added] = byDay[e._added] || { fiches: 0, albums: 0 }).fiches++;
      e._vis.forEach(function (p) {
        var d = e._adds[p]; if (!d) return;
        (byDay[d] = byDay[d] || { fiches: 0, albums: 0 }).albums++;
      });
    });

    var sec = statSection("En chiffres");
    statTiles(sec, [["séries", fmt(list.length - nOne)], ["one-shots", fmt(nOne)], ["albums", fmt(nVol)], ["auteurs", fmt(Object.keys(authors).length)]]);

    if (IS_OWNER) {
      var albRead = 0, done = 0, going = 0, fresh = 0, favs = 0;
      list.forEach(function (e) {
        var c = countRead(e);
        albRead += c;
        if (e._vis.length && c === e._vis.length) done++;
        else if (c > 0) going++;
        else fresh++;
        if ((state.favorites[e.id] || {}).is_favorite) favs++;
      });
      var pct = nVol ? Math.round(albRead * 100 / nVol) : 0;
      sec = statSection("Tes lectures", "Visible seulement en mode propriétaire. Une fiche compte comme lue quand tous ses tomes visibles sont cochés.");
      var meter = st("div", "st-meter");
      meter.setAttribute("role", "img");
      meter.setAttribute("aria-label", pct + " % des albums lus");
      var mf = st("span", "st-meter-fill"); mf.style.width = pct + "%"; meter.appendChild(mf);
      sec.appendChild(st("p", "st-meter-lab", fmt(albRead) + (albRead > 1 ? " albums lus" : " album lu") + " sur " + fmt(nVol) + " (" + pct + " %)"));
      sec.appendChild(meter);
      statTiles(sec, [["fiches lues", fmt(done)], ["en cours", fmt(going)], ["pas commencées", fmt(fresh)], ["favoris", fmt(favs)]]);

      var inc = list.filter(function (e) { return !e.one_shot && e._missing.length; });
      var tot = inc.reduce(function (t, e) { return t + e._missing.length; }, 0);
      sec = statSection("Séries incomplètes",
        inc.length ? fmt(inc.length) + (inc.length > 1 ? " séries" : " série") + " · " + fmt(tot) + (tot > 1 ? " tomes manquants" : " tome manquant") +
          ". Calculé d'après les numéros de tome : ce qui manque après le dernier tome que tu as n'est pas compté."
        : "Aucun trou dans la numérotation des séries.");
      if (inc.length) {
        var ul = st("ul", "st-missing");
        inc.forEach(function (e) {
          var li = st("li");
          var b = st("button", "st-lab-btn", e.title); b.type = "button";
          b.addEventListener("click", function () { openSheet(e.id); });
          li.appendChild(b);
          li.appendChild(st("span", "st-miss-txt", (e._missing.length > 1 ? "tomes " : "tome ") + rangesText(e._missing)));
          ul.appendChild(li);
        });
        sec.appendChild(ul);
      }
    }

    var days = Object.keys(byDay).sort().reverse();
    sec = statSection("Ajouts", "Date de chaque import de nouvelles BD : albums ajoutés, dont ceux des nouvelles fiches.");
    var tb = st("table", "st-table"), thead = st("thead"), hr = st("tr");
    ["Date", "Albums", "Nouvelles fiches"].forEach(function (h) { hr.appendChild(st("th", null, h)); });
    thead.appendChild(hr); tb.appendChild(thead);
    var tbody = st("tbody");
    days.forEach(function (d) {
      var tr = st("tr");
      tr.appendChild(st("td", null, frDate(d)));
      tr.appendChild(st("td", "n", "+" + fmt(byDay[d].albums)));
      tr.appendChild(st("td", "n", byDay[d].fiches ? "+" + fmt(byDay[d].fiches) : "—"));
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody); sec.appendChild(tb);
    var rb = st("button", "btn st-go", "Voir les ajouts récents dans la bibliothèque"); rb.type = "button";
    rb.addEventListener("click", function () { goGrid(function () { setSort("recent"); renderGrid(); }); });
    sec.appendChild(rb);

    sec = statSection("Genres", "Nombre de fiches par genre ; une fiche peut avoir deux genres. Touche un genre pour voir ses BD.");
    var grows = GENRES.filter(function (g) { return genres[g]; }).map(function (g) {
      return { label: g, v: genres[g], go: function () { goGrid(function () { els.filterGenre.value = g; els.filterGenre.dispatchEvent(new Event("change")); }); } };
    }).sort(function (a, b) { return b.v - a.v || a.label.localeCompare(b.label, "fr"); });
    if (noGenre) grows.push({ label: "Sans genre", v: noGenre });
    statBars(sec, grows, "fiches");

    sec = statSection("Auteurs les plus présents", "Les 10 auteurs qui ont le plus d'albums. Touche un nom pour voir ses BD.");
    var top = Object.keys(authors).map(function (k) { return authors[k]; })
      .sort(function (a, b) { return b.albums - a.albums || b.fiches - a.fiches || a.name.localeCompare(b.name, "fr"); }).slice(0, 10);
    statBars(sec, top.map(function (a) {
      return { label: a.name, v: a.albums, text: fmt(a.albums) + " albums · " + fmt(a.fiches) + (a.fiches > 1 ? " fiches" : " fiche"),
               go: function () { goGrid(function () { els.searchAuthor.value = a.name; els.searchAuthor.dispatchEvent(new Event("input")); }); } };
    }), "albums");
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
    stats: document.getElementById("stats-page"),
  };
  var viewScroll = {};
  state.view = "home";

  function viewFromHash() {
    var h = location.hash || "#/";
    if (h.indexOf("#/fiche/") === 0) return "home";
    if (h === "#/reglages") return "settings";
    if (h === "#/stats") return "stats";
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
      if (state.activeId) closeSheetUI();
    }
    state.view = v;
    Object.keys(views).forEach(function (k) { if (views[k]) views[k].hidden = k !== v; });
    document.documentElement.classList.toggle("view-page", v !== "home");
    if (v === "settings") renderSettingsPage();
    else if (v === "dups") renderDups();
    else if (v === "stats") renderStats();
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
    else if (state.view === "dups" || state.view === "stats") location.hash = "#/reglages";
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
})();
