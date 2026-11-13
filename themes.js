/* Thèmes visuels de l'appli.
 *
 * Chargé de façon BLOQUANTE dans <head>, avant style.css : le thème choisi est posé
 * sur <html data-theme="…"> avant le premier affichage, ce qui évite de voir
 * l'appli s'afficher une fraction de seconde dans le thème par défaut.
 *
 * Les couleurs, bordures et ombres de chaque thème sont dans style.css (blocs
 * [data-theme="…"]). Ici, il n'y a que le nom, les polices Google Fonts à charger et la
 * couleur de barre d'état (meta theme-color, utilisée sur iPhone/Android).
 *
 * Le choix est mémorisé par appareil (localStorage), pas synchronisé entre appareils.
 */
(function () {
  "use strict";

  var THEMES = [
    { id: "kiosque",       name: "Kiosque BD",      desc: "Comic pulpe, l'original",       bar: "#c1272d",
      fonts: ["Bangers", "Archivo:wght@500;600;700;800"] },
    { id: "atelier-noir",  name: "Atelier noir",    desc: "Sombre, encre et ambre",        bar: "#14120f",
      fonts: ["Bebas+Neue", "Archivo:wght@500;600;700;800"] },
    { id: "bibliotheque",  name: "Bibliothèque",    desc: "Épuré, sobre et clair",         bar: "#2f3e4e",
      fonts: ["Playfair+Display:wght@700;800", "Source+Sans+3:wght@400;600;700;800"] },
    { id: "fiche-archive", name: "Fiche d'archive", desc: "Papier manille et machine à écrire", bar: "#6d5537",
      fonts: ["Special+Elite", "IBM+Plex+Sans:wght@400;500;600;700"] },
    { id: "ligne-claire",  name: "Ligne claire",    desc: "Aplats nets à la franco-belge", bar: "#1b5fa8",
      fonts: ["Fredoka:wght@500;600;700", "Nunito:wght@500;600;700;800"] },
    { id: "manga",         name: "Manga",           desc: "Noir et blanc, trame et rouge", bar: "#111111",
      fonts: ["Anton", "Archivo:wght@500;600;700;800"] },
    { id: "comics-us",     name: "Comics US",       desc: "Pop, jaune et points Ben-Day",  bar: "#ffd400",
      fonts: ["Luckiest+Guy", "Archivo:wght@500;600;700;800"] },
    { id: "western",       name: "Western",         desc: "Sépia, cuir et rouille",        bar: "#7a2e14",
      fonts: ["Rye", "Lora:wght@500;600;700"] },
    { id: "neon-sf",       name: "Néon SF",         desc: "Nuit bleue et cyan électrique", bar: "#0a0f1f",
      fonts: ["Exo+2:wght@500;600;700;800"] },
    { id: "pastel",        name: "Pastel jeunesse", desc: "Doux, rose et menthe",          bar: "#ffb3c8",
      fonts: ["Baloo+2:wght@600;700;800", "Nunito:wght@500;600;700;800"] }
  ];

  var KEY = "bd_theme_v1";
  var GF = "https://fonts.googleapis.com/css2?";

  function find(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }
  function fontHref(families) {
    return GF + families.map(function (f) { return "family=" + f; }).join("&") + "&display=swap";
  }
  function setLink(id, href) {
    var l = document.getElementById(id);
    if (!l) {
      l = document.createElement("link");
      l.id = id; l.rel = "stylesheet";
      document.head.appendChild(l);
    }
    if (l.getAttribute("href") !== href) l.setAttribute("href", href);
  }

  function applyTheme(id, persist) {
    var t = find(id);
    document.documentElement.setAttribute("data-theme", t.id);
    setLink("theme-fonts", fontHref(t.fonts));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t.bar);
    if (persist) { try { localStorage.setItem(KEY, t.id); } catch (e) {} }
    return t;
  }

  // Les aperçus de la page Réglages affichent chaque thème dans sa propre police :
  // on charge toutes les polices, mais seulement à l'ouverture des réglages.
  function loadAllFonts() {
    var all = [];
    THEMES.forEach(function (t) {
      t.fonts.forEach(function (f) { if (all.indexOf(f) === -1) all.push(f); });
    });
    setLink("theme-fonts-all", fontHref(all));
  }

  function currentId() {
    return document.documentElement.getAttribute("data-theme") || THEMES[0].id;
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  applyTheme(saved, false);

  window.BD_THEMES = { list: THEMES, apply: applyTheme, loadAllFonts: loadAllFonts, current: currentId };
})();

/* 3.9 : STYLE (Réglages → Style), réglé appareil par appareil comme le thème.
 * Chaque aspect s'ajoute au thème : sa valeur par défaut garde l'aspect du thème, et
 * seuls les choix différents du défaut sont posés en attributs sur <html>
 * (data-hdrpolice="anton", data-cartes="douces"…), lus par le bloc « 3.9 : STYLE » de
 * style.css. Posés ici, avant le premier affichage : pas d'éclair du mauvais style.
 * Mémorisés dans localStorage (bd_style_v1, un objet { aspect: valeur }) ; une valeur
 * inconnue revient au défaut. Les polices nécessaires sont chargées à la demande. */
(function () {
  "use strict";
  var KEY = "bd_style_v1";
  var GF = "https://fonts.googleapis.com/css2?";
  // police Google Fonts de chaque choix (famille CSS, paramètre de chargement)
  var FONTS = {
    bd:        ["'Bangers', Impact, cursive", "Bangers"],
    affiche:   ["'Anton', Impact, sans-serif", "Anton"],
    classique: ["'Fraunces', Georgia, serif", "Fraunces:wght@700;800"],
    prestige:  ["'Abril Fatface', Georgia, serif", "Abril+Fatface"],
    elegant:   ["'Spectral', Georgia, serif", "Spectral:ital,wght@1,700"],
    moderne:   ["'Space Grotesk', system-ui, sans-serif", "Space+Grotesk:wght@700"],
    sobre:     ["'Archivo', system-ui, sans-serif", "Archivo:wght@800"],
    machine:   ["'Special Elite', 'Courier New', monospace", "Special+Elite"],
    manuscrit: ["'Caveat', 'Segoe Script', cursive", "Caveat:wght@700"]
  };
  var GROUPS = [
    { id: "bandeau", name: "Bandeau", items: [
      { key: "hdrpolice", name: "Police du titre", def: "titres", fonts: true, opts: [
        ["titres", "Comme les titres"], ["bd", "BD"], ["affiche", "Affiche"], ["classique", "Classique"], ["prestige", "Prestige"],
        ["elegant", "Élégant"], ["moderne", "Moderne"], ["sobre", "Sobre"], ["machine", "Machine à écrire"], ["manuscrit", "Manuscrit"]] },
      { key: "hdrcasse", name: "Écriture du titre", def: "maj", opts: [["maj", "MAJUSCULES"], ["normale", "Normale"]] },
      { key: "hdrombre", name: "Ombre du titre", def: "theme", opts: [["theme", "Thème"], ["decalee", "Décalée"], ["douce", "Douce"], ["aucune", "Aucune"]] },
      { key: "hdrfond", name: "Fond du bandeau", def: "theme", opts: [["theme", "Thème"], ["trame", "Trame BD"], ["uni", "Uni"], ["degrade", "Dégradé"]] },
      { key: "hdrchamps", name: "Champs de recherche", def: "theme", opts: [["theme", "Thème"], ["doux", "Doux"], ["arrondis", "Arrondis"], ["soulignes", "Soulignés"]] },
      { key: "hdrpuces", name: "Puces de filtre", def: "theme", opts: [["theme", "Thème"], ["douces", "Douces"], ["contour", "Contour"]] },
      { key: "hdrbouton", name: "Bouton Réglages", def: "theme", opts: [["theme", "Thème"], ["doux", "Doux"], ["contour", "Contour"], ["discret", "Discret"]] }
    ] },
    { id: "pages", name: "Pages", items: [
      { key: "titres", name: "Police des titres", def: "theme", fonts: true, opts: [["theme", "Thème"], ["bd", "BD"], ["classique", "Classique"], ["moderne", "Moderne"]] },
      { key: "cartes", name: "Vignettes et fiche", def: "theme", opts: [["theme", "Thème"], ["douces", "Douces"], ["epurees", "Épurées"]] },
      { key: "pastilles", name: "Pastilles", def: "theme", opts: [["theme", "Thème"], ["douces", "Douces"], ["plates", "Plates"]] },
      { key: "commandes", name: "Boutons, cases et champs", def: "theme", opts: [["theme", "Thème"], ["doux", "Doux"]] },
      { key: "panneaux", name: "Panneaux", def: "theme", opts: [["theme", "Thème"], ["doux", "Doux"], ["bd", "BD"]] }
    ] }
  ];
  var PRESETS = [
    { id: "origine", name: "D'origine", desc: "l'aspect du thème", v: {} },
    { id: "doux", name: "Doux", desc: "traits fins, ombres légères",
      v: { hdrombre: "douce", hdrchamps: "doux", hdrpuces: "douces", hdrbouton: "doux", cartes: "douces", pastilles: "douces", commandes: "doux", panneaux: "doux" } },
    { id: "elegant", name: "Élégant", desc: "titres classiques, dégradé",
      v: { hdrpolice: "prestige", hdrcasse: "normale", hdrombre: "douce", hdrfond: "degrade", hdrchamps: "arrondis", hdrpuces: "contour",
           hdrbouton: "contour", titres: "classique", cartes: "douces", pastilles: "plates", commandes: "doux", panneaux: "doux" } },
    { id: "epure", name: "Épuré", desc: "à plat, sans ombre",
      v: { hdrpolice: "sobre", hdrcasse: "normale", hdrombre: "aucune", hdrfond: "uni", hdrchamps: "soulignes", hdrpuces: "contour",
           hdrbouton: "discret", titres: "moderne", cartes: "epurees", pastilles: "plates", commandes: "doux", panneaux: "doux" } },
    { id: "bd", name: "Tout BD", desc: "traits épais et Bangers",
      v: { hdrpolice: "bd", hdrombre: "decalee", hdrfond: "trame", titres: "bd", panneaux: "bd" } }
  ];
  var ITEMS = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { ITEMS[it.key] = it; }); });

  function clean(obj) {                      // ne garde que les valeurs connues et différentes du défaut
    var out = {};
    Object.keys(ITEMS).forEach(function (k) {
      var it = ITEMS[k], v = obj && obj[k];
      if (v && v !== it.def && it.opts.some(function (o) { return o[0] === v; })) out[k] = v;
    });
    return out;
  }
  var cur = {};
  try { cur = clean(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { cur = {}; }

  function setLink(id, href) {
    var l = document.getElementById(id);
    if (!href) { if (l) l.parentNode.removeChild(l); return; }
    if (!l) { l = document.createElement("link"); l.id = id; l.rel = "stylesheet"; document.head.appendChild(l); }
    if (l.getAttribute("href") !== href) l.setAttribute("href", href);
  }
  function fontsHref(keys) {
    var fam = [];
    keys.forEach(function (k) { var f = FONTS[k]; if (f && fam.indexOf(f[1]) === -1) fam.push(f[1]); });
    return fam.length ? GF + fam.map(function (f) { return "family=" + f; }).join("&") + "&display=swap" : "";
  }
  function apply() {
    var html = document.documentElement;
    Object.keys(ITEMS).forEach(function (k) {
      if (cur[k]) html.setAttribute("data-" + k, cur[k]); else html.removeAttribute("data-" + k);
    });
    setLink("style-fonts", fontsHref([cur.hdrpolice, cur.titres].filter(Boolean)));
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }
  function get(k) { return cur[k] || ITEMS[k].def; }
  function set(k, v) { if (!ITEMS[k]) return; var n = JSON.parse(JSON.stringify(cur)); n[k] = v; cur = clean(n); save(); apply(); }
  function applyPreset(id) {
    var p = PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!p) return; cur = clean(p.v); save(); apply();
  }
  function presetOf() {                      // préréglage correspondant exactement, sinon null (« personnalisé »)
    var s = JSON.stringify(cur);
    var p = PRESETS.filter(function (x) { return JSON.stringify(clean(x.v)) === s; })[0];
    return p ? p.id : null;
  }
  // pour les boutons « Police du titre » de la page Réglages, écrits chacun dans sa police
  function loadAllFonts() { setLink("style-fonts-all", fontsHref(Object.keys(FONTS))); }
  function fontFamily(v) { return FONTS[v] ? FONTS[v][0] : ""; }

  apply();
  window.BD_STYLE = { groups: GROUPS, presets: PRESETS, get: get, set: set, applyPreset: applyPreset,
                      presetOf: presetOf, loadAllFonts: loadAllFonts, fontFamily: fontFamily };
})();
