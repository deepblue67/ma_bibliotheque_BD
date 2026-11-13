// Ma Bibliothèque BD — app.js (1/7) : socle : état, copies locales, corrections, titres, dates d'ajout, Supabase, connexion, données, filtres, chargement des vignettes. Voir README, « Organisation du code ».
"use strict";

  // Liste fixe de genres (voir README) — s'agrandira au fil des ajouts, mais reste
  // une liste fermée : pas de saisie libre, uniquement ces valeurs dans catalog.json.
  var GENRES = [
    "Aventure", "Biographie", "Documentaire", "Drame / Chronique sociale",
    "Fantastique / Horreur", "Fantasy", "Guerre", "Historique", "Humour",
    "Jeunesse", "Policier / Thriller", "Science-fiction", "Super-héros", "Western"
  ];

  // Version de la livraison — à augmenter à CHAQUE livraison (+0.1 pour une livraison
  // ordinaire, +1.0 pour une refonte), avec le même numéro dans tous les ?v= de
  // index.html (un par fichier : themes, style, config et les 7 fichiers du code, depuis
  // la 3.8) et de uploader.html, et une ligne dans l'historique « Versions » du README.
  var APP_VERSION = "3.9";
  var APP_VERSION_DATE = "2026-11-13";

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
    sheetNav: document.getElementById("sheet-nav"),           // 3.5 : fiche précédente / suivante
    sheetPrev: document.getElementById("sheet-prev"),
    sheetNext: document.getElementById("sheet-next"),
    sheetPos: document.getElementById("sheet-pos"),
    sheetLive: document.getElementById("sheet-live"),
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
    saveLocalReadAt();
  }
  // 3.7 : date à laquelle chaque tome a été coché lu (updated_at de bd_volume_status), pour le
  // tri « Lus récemment » du propriétaire. Copie locale bd_lu_dates_v1, comme les coches.
  var LOCAL_READAT_KEY = "bd_lu_dates_v1";
  function loadLocalReadAt() {
    if (!IS_OWNER) return {};
    try { return JSON.parse(localStorage.getItem(LOCAL_READAT_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveLocalReadAt() {
    if (!IS_OWNER || !state.readAt) return;
    try { localStorage.setItem(LOCAL_READAT_KEY, JSON.stringify(state.readAt)); } catch (e) {}
  }
  state.readAt = loadLocalReadAt();

  // ---------- mon avis (3.6) ----------
  // Un avis par fiche (série ou one-shot) : note sur 10 (facultative), date de lecture et
  // commentaire. Propriétaire seulement : table Supabase bd_avis, lisible et modifiable par
  // la seule session du propriétaire (supabase_avis.sql). Copie locale sur l'appareil du
  // propriétaire (bd_avis_v1) pour l'affichage hors ligne ; effacée sur un appareil visiteur
  // et quand on quitte le mode propriétaire.
  var AVIS_KEY = "bd_avis_v1", AVIS_MAX = 4000;
  function loadLocalAvis() {
    if (!IS_OWNER) { try { localStorage.removeItem(AVIS_KEY); } catch (e) {} return {}; }
    try { return JSON.parse(localStorage.getItem(AVIS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveLocalAvis() {
    if (!IS_OWNER) return;
    try { localStorage.setItem(AVIS_KEY, JSON.stringify(state.avis)); } catch (e) {}
  }
  function rowToAvis(r) {
    return { note: (r.note === null || r.note === undefined) ? null : +r.note, lu_le: r.lu_le || null,
             commentaire: r.commentaire || "", updated_at: r.updated_at || null };
  }
  state.avis = loadLocalAvis();      // id de fiche -> { note, lu_le, commentaire, updated_at }
  state.avisEdit = false;            // formulaire « Mon avis » ouvert dans la fiche

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

  // ---------- présentations de la bibliothèque (3.4) ----------
  // Cinq façons d'afficher la grille, comme dans l'appli ebooks : grille (vignettes, celle
  // d'avant), éventail (les premières couvertures d'une série déployées en éventail),
  // étagère (les tomes debout sur une planche), mur (couvertures seules, piles pour les
  // séries) et liste (une ligne par fiche).
  // Chaque appareil choisit la sienne (Réglages → Présentation, clé bd_presentation_v1) ;
  // « Par défaut » suit celle que le propriétaire a choisie pour ses visiteurs, gardée dans
  // la table Supabase bd_reglages (ligne « presentation », lisible par tous, modifiable par
  // le propriétaire seul : supabase_reglages.sql). Elle est mise en cache sur l'appareil
  // (bd_reglages_site_v1) pour s'afficher tout de suite à la visite suivante.
  var PRESENTATIONS = [
    { id: "grille", name: "Grille" },
    { id: "eventail", name: "Éventail" },
    { id: "etagere", name: "Étagère" },
    { id: "mur", name: "Mur" },
    { id: "liste", name: "Liste" }
  ];
  var PRES_KEY = "bd_presentation_v1", SITE_KEY = "bd_reglages_site_v1";
  function presOk(v) { return PRESENTATIONS.some(function (p) { return p.id === v; }); }
  function presNom(v) { var p = PRESENTATIONS.find(function (x) { return x.id === v; }); return p ? p.name : "Grille"; }
  state.presDevice = null;
  try { var pd0 = localStorage.getItem(PRES_KEY); if (presOk(pd0)) state.presDevice = pd0; } catch (e) {}
  state.site = {};
  try { state.site = JSON.parse(localStorage.getItem(SITE_KEY) || "{}") || {}; } catch (e) { state.site = {}; }
  function presSite() { return presOk(state.site.presentation) ? state.site.presentation : null; }
  function presentation() { return state.presDevice || presSite() || "grille"; }

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
    // 3.7 : Þór se range à « Thor », Søren à « Soren » (et non après le Z)
    var sk = function (x) { return x._sk || (x._sk = foldLetters(x.title.toLowerCase())); };
    var cmp = function (a, b) { return sk(a).localeCompare(sk(b), "fr", { sensitivity: "base", numeric: true }); };
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
    if (state.view === "carnet") renderCarnet();
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
    if (!supa) { rollback("synchronisation indisponible."); return; }
    var row = { id: key, hidden: cur.hidden, title: cur.title || null,
          author: cur.author || null, genre: Array.isArray(cur.genre) ? cur.genre : null, updated_at: new Date().toISOString() };
    // colonnes ajoutées au lot « fusion » : envoyées seulement quand elles servent, pour que
    // les corrections simples marchent même si le script SQL du lot n'a pas encore été passé.
    ["merged_into", "not_dup", "owner_only"].forEach(function (k) {
      if (cur[k] || (prev && prev[k])) row[k] = cur[k] || null;
    });
    var q = empty
      ? supa.from("bd_overrides").delete().eq("id", key)
      : supa.from("bd_overrides").upsert(row);
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
    supa.from("bd_overrides").select("*")
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

  // 3.4 : réglages du site (présentation par défaut des visiteurs), table bd_reglages
  function fetchReglages() {
    supa.from("bd_reglages").select("cle,valeur")
      .then(function (res) {
        if (res.error) { state.siteMissing = true; if (state.view === "settings") renderPresBlock(); return; }
        state.siteMissing = false;
        var before = presentation(), site = {};
        (res.data || []).forEach(function (r) { if (r && r.cle) site[r.cle] = r.valeur; });
        state.site = site;
        try { localStorage.setItem(SITE_KEY, JSON.stringify(site)); } catch (e) {}
        if (presentation() !== before) renderGrid();
        if (state.view === "settings") renderPresBlock();
      })
      .catch(function () {});
  }

  // ---------- supabase ----------
  var supa = null;
  function initSupabase() {
    if (!window.supabase || !window.BD_SUPABASE_URL || !window.BD_SUPABASE_ANON_KEY) {
      markOvReady();
      if (IS_OWNER) setSyncNote("Synchronisation indisponible (config manquante) — mode local uniquement.");
      return;
    }
    try {
      supa = window.supabase.createClient(window.BD_SUPABASE_URL, window.BD_SUPABASE_ANON_KEY);
      initAuth();
      // les corrections concernent tout le monde (titres corrigés, fiches masquées)…
      fetchOverrides();
      fetchReglages();                     // 3.4 : présentation par défaut des visiteurs
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
    if (!supa || !supa.auth) return;
    supa.auth.getSession().then(function (res) {
      state.auth.session = (res && res.data && res.data.session) || null;
      state.auth.ready = true;
      // propriétaire dont la session gardée n'est plus valable (supabase-js l'a effacée) : visiteur
      if (IS_OWNER && !state.auth.session && !storedSession()) { lostSession(); return; }
      renderAuthBox();
      syncStatuses();
    }).catch(function () { state.auth.ready = true; renderAuthBox(); });
    supa.auth.onAuthStateChange(function (event, session) {
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
    if (!supa || !supa.auth) {
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
      supa.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
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
    if (!supa || hasSession()) return false;   // sans Supabase : comportement d'avant
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
    if (!IS_OWNER || !supa || !hasSession() || state.statusSynced) return;
    state.statusSynced = true;
    fetchRemoteFavorites();
    fetchRemoteVolumeStatus();
    fetchRemoteAvis();                       // 3.6
  }

  // Quitter le mode propriétaire déconnecte aussi de Supabase (appareil prêté, par exemple).
  function signOutLocal() {
    if (!supa || !supa.auth) return Promise.resolve();
    return supa.auth.signOut({ scope: "local" }).catch(function () {});
  }

  function setSyncNote(text) {
    els.syncNote.textContent = text || "";
  }

  function fetchRemoteFavorites() {
    supa.from("bd_status").select("id,is_favorite,updated_at")
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
    supa.from("bd_volume_status").select("id,is_read,updated_at")
      .then(function (res) {
        if (res.error) { setSyncNote("Synchro : hors ligne (données locales conservées)."); return; }
        (res.data || []).forEach(function (row) {
          if (row.is_read) { state.volumeRead[row.id] = true; if (row.updated_at) state.readAt[row.id] = row.updated_at; }
          else { delete state.volumeRead[row.id]; delete state.readAt[row.id]; }
        });
        saveLocalVolumeRead();
        renderGrid();
        if (state.activeId) { renderVolumeList(); renderSheetActions(); }
        setSyncNote("");
      })
      .catch(function () { setSyncNote("Synchro : hors ligne (données locales conservées)."); });
  }

  function subscribeRealtime() {
    supa.channel("bd_status_changes")
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
        if (payload.eventType === "DELETE" || !row.is_read) { delete state.volumeRead[row.id]; delete state.readAt[row.id]; }
        else { state.volumeRead[row.id] = true; if (row.updated_at) state.readAt[row.id] = row.updated_at; }
        saveLocalVolumeRead();
        renderGrid();
        var act = state.activeId && currentEntry();
        if (act && act._keys.indexOf(row.id) !== -1) {
          renderVolumeList();
          renderSheetActions();
        }
      })
      .subscribe();
    // 3.6 : avis, canal séparé (la table peut ne pas encore exister)
    supa.channel("bd_avis_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bd_avis" }, function (payload) {
        var row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || !row.id) return;
        if (payload.eventType === "DELETE") delete state.avis[row.id];
        else state.avis[row.id] = rowToAvis(row);
        saveLocalAvis();
        if (state.activeId === row.id && state.avisEdit) return;      // ne pas écraser une saisie en cours
        refreshAvisViews(true);
      })
      .subscribe();
    // canal séparé : si la table bd_overrides n'existe pas encore, seul ce canal échoue
    // et la synchro des statuts continue de fonctionner.
    supa.channel("bd_overrides_changes")
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
    if (!supa) return;
    var f = state.favorites[titleId] || { is_favorite: false }, was = !f.is_favorite;
    supa.from("bd_status").upsert({
      id: titleId, is_favorite: f.is_favorite, updated_at: new Date().toISOString()
    }).then(function (res) {
      afterStatusWrite(res, function () { state.favorites[titleId] = { is_favorite: was }; saveLocalFavorites(); });
    }).catch(function () {});
  }

  function pushVolumeStatus(key) {
    if (!supa) return;
    var now = isKeyRead(key);
    supa.from("bd_volume_status").upsert({
      id: key, title_id: titleOfKey(key), is_read: now, updated_at: new Date().toISOString()
    }).then(function (res) {
      afterStatusWrite(res, function () { if (now) delete state.volumeRead[key]; else state.volumeRead[key] = true; saveLocalVolumeRead(); });
    }).catch(function () {});
  }

  function pushVolumeStatusBulk(keys, read, before) {
    if (!supa || !keys.length) return;
    var now = new Date().toISOString();
    var rows = keys.map(function (k) {
      return { id: k, title_id: titleOfKey(k), is_read: read, updated_at: now };
    });
    supa.from("bd_volume_status").upsert(rows).then(function (res) {
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
  // 3.7 : lettres que la décomposition Unicode ne ramène pas à une lettre simple
  // (Søren, Łukasz, Straße, Đorđević, Þór, Iğdır…) : ø → o, ß → ss, ł → l, đ/ð → d, þ → th, ı → i.
  var FOLD_RE = /[øßłđðþı]/g, FOLD = { "ø": "o", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
  function foldLetters(s) { return s.replace(FOLD_RE, function (c) { return FOLD[c]; }); }
  function normalize(s) {
    return foldLetters((s || "").toString().toLowerCase())
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

