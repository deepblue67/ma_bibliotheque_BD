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
