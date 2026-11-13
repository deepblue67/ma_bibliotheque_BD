// Ma Bibliothèque BD — doublons.js (5/7) : doublons probables (propriétaire). Voir README, « Organisation du code ».
"use strict";
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

