// Ma Bibliothèque BD — carnet.js (6/7) : statistiques, mon avis, carnet de lecture. Voir README, « Organisation du code ».
"use strict";
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
      var cb = st("a", "btn st-go", "Ouvrir le carnet de lecture (" + fmt(Object.keys(state.avis).length) + " avis)"); cb.href = "#/carnet";
      sec.appendChild(cb);

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

  // ---------- mon avis : lecture, écriture, fiche (3.6) ----------
  function avisMissingErr(e) {
    var m = ((e && (e.message || "")) || "") + "";
    return !!e && (e.code === "42P01" || e.code === "PGRST205" || /could not find the table|does not exist/i.test(m));
  }
  function fetchRemoteAvis() {
    supa.from("bd_avis").select("id,note,lu_le,commentaire,updated_at")
      .then(function (res) {
        if (res.error) { if (avisMissingErr(res.error)) state.avisMissing = true; refreshAvisViews(); return; }
        state.avisMissing = false;
        var map = {};
        (res.data || []).forEach(function (r) { if (r && r.id) map[r.id] = rowToAvis(r); });
        var same = JSON.stringify(map) === JSON.stringify(state.avis);   // rien de neuf : pas de grille à redessiner
        state.avis = map;
        saveLocalAvis();
        refreshAvisViews(!same);
      })
      .catch(function () {});
  }
  // après un changement d'avis : vignettes, fiche ouverte, carnet
  function refreshAvisViews(grid) {
    if (grid) renderGrid();
    if (state.activeId) renderAvis();
    if (state.view === "carnet") renderCarnet();
  }
  function todayIso() { return isoDay(new Date()); }
  function noteText(n) { return (n === null || n === undefined) ? "" : n + "/10"; }

  function renderAvis() {
    var box = document.getElementById("sheet-avis");
    if (!box) return;
    var entry = currentEntry();
    if (!IS_OWNER || !entry) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    var a = state.avis[entry.id] || null;
    box.innerHTML = "";
    var head = st("div", "sheet-volumes-label", "Mon avis");
    box.appendChild(head);
    if (state.avisMissing && !a) {
      box.appendChild(st("p", "settings-hint", "Pour donner ton avis, lance d'abord supabase_avis.sql dans Supabase (voir README)."));
      return;
    }
    if (!state.avisEdit) {
      if (a) {
        var line = st("div", "avis-line");
        if (a.note !== null) { var n = st("span", "avis-note", noteText(a.note)); n.setAttribute("aria-label", "Note : " + a.note + " sur 10"); line.appendChild(n); }
        if (a.lu_le) line.appendChild(st("span", "avis-date", "lu le " + frDate(a.lu_le)));
        box.appendChild(line);
        if (a.commentaire) box.appendChild(st("p", "avis-com", a.commentaire));
      }
      var b = st("button", "btn btn-outline avis-btn", a ? "✎ Modifier mon avis" : "＋ Donner mon avis");
      b.type = "button"; b.id = "avis-open";
      b.addEventListener("click", function () {
        if (needLogin()) return;
        state.avisEdit = true; state.avisDraft = { note: a ? a.note : null, lu_le: (a && a.lu_le) || todayIso(), commentaire: a ? a.commentaire : "" };
        state.avisConfirm = false;
        renderAvis();
        var f = document.getElementById("avis-com"); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
      });
      box.appendChild(b);
      return;
    }
    // --- édition ---
    var d = state.avisDraft || { note: null, lu_le: todayIso(), commentaire: "" };
    var form = st("form", "avis-form"); form.id = "avis-form"; form.setAttribute("autocomplete", "off");
    var nl = st("div", "avis-lab", "Note sur 10 (touche à nouveau pour l'enlever)"); nl.id = "avis-note-lab";
    form.appendChild(nl);
    var chips = st("div", "avis-chips"); chips.setAttribute("role", "radiogroup"); chips.setAttribute("aria-labelledby", "avis-note-lab");
    for (var i = 0; i <= 10; i++) (function (v) {
      var c = st("button", "avis-chip", String(v)); c.type = "button";
      c.setAttribute("role", "radio"); c.setAttribute("aria-checked", d.note === v ? "true" : "false");
      c.setAttribute("aria-label", v + " sur 10");
      c.addEventListener("click", function () {
        d.note = d.note === v ? null : v;
        Array.prototype.forEach.call(chips.children, function (x, k) { x.setAttribute("aria-checked", d.note === k ? "true" : "false"); });
      });
      chips.appendChild(c);
    })(i);
    form.appendChild(chips);
    var dl = st("label", "edit-field avis-field"); dl.appendChild(st("span", null, "Lu le"));
    var di = st("input", "owner-input"); di.type = "date"; di.id = "avis-date"; di.value = d.lu_le || ""; di.max = todayIso();
    di.addEventListener("input", function () { d.lu_le = di.value || null; });
    dl.appendChild(di); form.appendChild(dl);
    var cl = st("label", "edit-field avis-field"); cl.appendChild(st("span", null, "Commentaire"));
    var ta = st("textarea", "owner-input avis-text"); ta.id = "avis-com"; ta.rows = 4; ta.maxLength = AVIS_MAX; ta.value = d.commentaire || "";
    ta.placeholder = "Ce que tu en as pensé…";
    ta.addEventListener("input", function () { d.commentaire = ta.value; });
    cl.appendChild(ta); form.appendChild(cl);
    var bts = st("div", "edit-buttons");
    var sv = st("button", "btn", "Enregistrer"); sv.type = "submit";
    var cc = st("button", "btn btn-ghost", "Annuler"); cc.type = "button";
    cc.addEventListener("click", function () { state.avisEdit = false; state.avisConfirm = false; renderAvis(); });
    bts.appendChild(sv); bts.appendChild(cc);
    if (a) {
      var del = st("button", "btn btn-ghost", "Effacer mon avis"); del.type = "button"; del.id = "avis-del";
      del.addEventListener("click", function () { state.avisConfirm = true; renderAvis(); });
      bts.appendChild(del);
    }
    form.appendChild(bts);
    if (state.avisConfirm) {
      var cf = st("div", "edit-confirm avis-confirm");
      cf.appendChild(st("p", null, "Effacer cet avis ? La note, la date et le commentaire seront supprimés."));
      var y = st("button", "btn", "Oui, effacer"); y.type = "button"; y.id = "avis-del-yes";
      var no = st("button", "btn btn-ghost", "Non"); no.type = "button";
      y.addEventListener("click", function () { deleteAvis(entry.id); });
      no.addEventListener("click", function () { state.avisConfirm = false; renderAvis(); });
      cf.appendChild(y); cf.appendChild(no); form.appendChild(cf);
    }
    var msg = st("p", "settings-hint avis-msg"); msg.id = "avis-msg"; msg.setAttribute("role", "status"); form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var com = (d.commentaire || "").trim();
      if (d.note === null && !com) { msg.textContent = "Donne une note ou écris un commentaire (ou touche Annuler)."; return; }
      saveAvis(entry.id, { note: d.note, lu_le: d.lu_le || null, commentaire: com });
    });
    box.appendChild(form);
  }

  function avisFail(e, rollback) {
    rollback();
    if (avisMissingErr(e)) { state.avisMissing = true; toast("Non enregistré : lance d'abord supabase_avis.sql dans Supabase (voir README)."); }
    else toast("Non enregistré : " + (e && e.message === "vide" ? "la base a refusé (reconnecte-toi dans Réglages → Mode propriétaire)." : refusedText(e)));
  }
  function saveAvis(id, v) {
    if (needLogin()) return;
    var prev = state.avis[id] ? JSON.parse(JSON.stringify(state.avis[id])) : null;
    var now = new Date().toISOString();
    state.avis[id] = { note: v.note, lu_le: v.lu_le, commentaire: v.commentaire, updated_at: now };
    state.avisEdit = false; state.avisConfirm = false;
    saveLocalAvis(); refreshAvisViews(true);
    function rollback() {
      if (prev) state.avis[id] = prev; else delete state.avis[id];
      saveLocalAvis(); refreshAvisViews(true);
    }
    if (!supa) return;
    supa.from("bd_avis").upsert({ id: id, note: v.note, lu_le: v.lu_le, commentaire: v.commentaire || null, updated_at: now }).select()
      .then(function (res) {
        if (res.error) avisFail(res.error, rollback);
        else if (!res.data || !res.data.length) avisFail({ message: "vide" }, rollback);
        else toast("Avis enregistré.");
      })
      .catch(function (err) { avisFail(err || { message: "hors ligne" }, rollback); });
  }
  function deleteAvis(id) {
    if (needLogin()) return;
    var prev = state.avis[id] ? JSON.parse(JSON.stringify(state.avis[id])) : null;
    if (!prev) return;
    delete state.avis[id];
    state.avisEdit = false; state.avisConfirm = false;
    saveLocalAvis(); refreshAvisViews(true);
    function rollback() { state.avis[id] = prev; saveLocalAvis(); refreshAvisViews(true); }
    if (!supa) return;
    supa.from("bd_avis").delete().eq("id", id).select()
      .then(function (res) {
        if (res.error) avisFail(res.error, rollback);
        else if (!res.data || !res.data.length) avisFail({ message: "vide" }, rollback);
        else toast("Avis effacé.");
      })
      .catch(function (err) { avisFail(err || { message: "hors ligne" }, rollback); });
  }

  // ---------- carnet de lecture (3.6, #/carnet, propriétaire) ----------
  // Tous les avis : chiffres, répartition des notes, avis par mois, note moyenne par genre,
  // puis la liste, avec recherche, filtres (note, genre, année) et tri, et l'export CSV.
  // Les filtres ne touchent que la liste ; les graphiques portent sur tous les avis.
  var carnetBody = document.getElementById("carnet-body");
  state.carnetF = { q: "", note: "all", genre: "", year: "", sort: "date" };
  function avisEntries() {
    return Object.keys(state.avis).map(function (id) {
      var a = state.avis[id], e = state.catalog.find(function (x) { return x.id === id; }), via = null;
      if (!e) {                                            // fiche fusionnée : sa fiche d'accueil
        var m = state.mergedList.find(function (x) { return x.id === id; });
        if (m) { e = state.catalog.find(function (x) { return x.id === m.into; }); via = m; }
      }
      var hid = false;
      if (!e) {                                            // masquée : on la cherche dans les masquées
        var h = state.hiddenList.find(function (x) { return x.id === id; });
        if (h) { e = h; hid = true; }
      }
      return { id: id, a: a, e: e || null, title: via ? via.title : e ? e.title : id.replace(/_/g, " "), author: e ? (e.author || "") : "",
               genre: e ? (e.genre || []) : [], cover: e ? e.cover : null, gone: !e, merged: !!via, hidden: hid };
    });
  }
  var MOIS_COURT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
  function frNote(x) { return (Math.round(x * 10) / 10).toLocaleString("fr-FR"); }
  function carnetSection(title, hint) {
    var sec = st("section", "st-sec");
    sec.appendChild(st("h3", "st-h", title));
    if (hint) sec.appendChild(st("p", "settings-hint", hint));
    carnetBody.appendChild(sec);
    return sec;
  }
  // colonnes verticales, une seule série (couleur du thème), valeur au-dessus, libellé dessous
  function carnetColumns(sec, cols, aria, onPick) {
    var max = cols.reduce(function (m, c) { return Math.max(m, c.v); }, 0) || 1;
    var box = st("div", "cv-cols"); box.setAttribute("role", "group"); box.setAttribute("aria-label", aria);
    cols.forEach(function (c) {
      var col = st(onPick ? "button" : "div", "cv-col" + (c.v ? "" : " zero"));
      if (onPick) { col.type = "button"; col.addEventListener("click", function () { onPick(c); }); }
      col.title = c.tip;
      col.setAttribute("aria-label", c.tip);
      col.appendChild(st("span", "cv-val", c.v ? fmt(c.v) : ""));
      var bar = st("span", "cv-bar"); bar.style.height = (c.v ? Math.max(4, c.v * 100 / max) : 0) + "%";
      var wrap = st("span", "cv-barwrap"); wrap.appendChild(bar); col.appendChild(wrap);
      col.appendChild(st("span", "cv-lab", c.label));
      box.appendChild(col);
    });
    sec.appendChild(box);
  }
  function renderCarnet() {
    if (!carnetBody) return;
    carnetBody.innerHTML = "";
    if (!IS_OWNER) return;
    if (!state.raw.length) { carnetBody.appendChild(st("p", "settings-hint", "Chargement du catalogue…")); return; }
    var all = avisEntries();
    if (state.avisMissing) carnetBody.appendChild(st("p", "settings-hint avis-warn", "La table bd_avis n'existe pas encore dans Supabase : lance supabase_avis.sql (voir README) pour pouvoir donner ton avis."));
    if (!all.length) {
      var s0 = carnetSection("Ton carnet est vide");
      s0.appendChild(st("p", "settings-hint", "Ouvre la fiche d'une BD que tu as lue et touche « ＋ Donner mon avis » : une note sur 10, la date de lecture et ce que tu en as pensé. Tes avis s'afficheront ici, avec leurs statistiques."));
      return;
    }
    var noted = all.filter(function (x) { return x.a.note !== null; });
    var avg = noted.length ? noted.reduce(function (t, x) { return t + x.a.note; }, 0) / noted.length : 0;
    var year = String(new Date().getFullYear());
    var sec = carnetSection("En chiffres");
    statTilesIn(sec, [["avis", fmt(all.length)], ["note moyenne", noted.length ? frNote(avg) + "/10" : "—"],
      ["avec commentaire", fmt(all.filter(function (x) { return x.a.commentaire; }).length)],
      ["lus en " + year, fmt(all.filter(function (x) { return (x.a.lu_le || "").slice(0, 4) === year; }).length)]]);

    if (noted.length) {
      sec = carnetSection("Répartition des notes", "Nombre d'avis pour chaque note. Touche une note pour voir les avis correspondants.");
      var cnt = []; for (var i = 0; i <= 10; i++) cnt.push(0);
      noted.forEach(function (x) { cnt[x.a.note]++; });
      carnetColumns(sec, cnt.map(function (v, k) { return { v: v, label: String(k), tip: k + "/10 : " + v + (v > 1 ? " avis" : " avis"), k: k }; }),
        "Répartition des notes de 0 à 10", function (c) { setCarnetFilter({ note: "eq:" + c.k }); });
    }

    var dated = all.filter(function (x) { return x.a.lu_le; });
    if (dated.length) {
      sec = carnetSection("Lectures par mois", "Avis par mois de lecture, sur les 12 derniers mois.");
      var now = new Date(), months = [];
      for (var mm = 11; mm >= 0; mm--) {
        var dt = new Date(now.getFullYear(), now.getMonth() - mm, 1);
        months.push({ key: dt.getFullYear() + "-" + pad2(dt.getMonth() + 1), m: dt.getMonth(), y: dt.getFullYear(), v: 0 });
      }
      dated.forEach(function (x) { var mo = months.find(function (o) { return o.key === x.a.lu_le.slice(0, 7); }); if (mo) mo.v++; });
      carnetColumns(sec, months.map(function (o) {
        return { v: o.v, label: MOIS_COURT[o.m] + (o.m === 0 || o === months[0] ? " " + String(o.y).slice(2) : ""),
                 tip: MOIS[o.m] + " " + o.y + " : " + o.v + " avis" };
      }), "Avis par mois de lecture");
    }

    var byG = {};
    noted.forEach(function (x) { x.genre.forEach(function (g) { (byG[g] = byG[g] || { n: 0, t: 0 }); byG[g].n++; byG[g].t += x.a.note; }); });
    var gl = Object.keys(byG).filter(function (g) { return byG[g].n >= 2; });
    if (gl.length) {
      sec = carnetSection("Note moyenne par genre", "Genres qui ont au moins 2 avis notés. Touche un genre pour voir ses avis.");
      statBarsIn(sec, gl.map(function (g) {
        var m = byG[g].t / byG[g].n;
        return { label: g, v: m, text: frNote(m) + "/10 · " + byG[g].n + " avis", go: function () { setCarnetFilter({ genre: g }); } };
      }).sort(function (a, b) { return b.v - a.v || a.label.localeCompare(b.label, "fr"); }), "/10", 10);
    }

    // --- la liste ---
    sec = carnetSection("Mes avis");
    sec.id = "carnet-liste";
    var F = state.carnetF, bar = st("div", "cv-filters");
    var q = st("input", "owner-input cv-q"); q.type = "search"; q.id = "carnet-q"; q.placeholder = "Titre, auteur ou commentaire…"; q.value = F.q;
    q.setAttribute("aria-label", "Chercher dans le carnet");
    q.addEventListener("input", function () { F.q = q.value; renderCarnetList(); });
    bar.appendChild(q);
    function sel(id, label, opts, val, key) {
      var s = st("select", "owner-input cv-sel"); s.id = id; s.setAttribute("aria-label", label);
      opts.forEach(function (o) {
        if (o.group) { var og = document.createElement("optgroup"); og.label = o.group; o.items.forEach(function (it) { var op = st("option", null, it[1]); op.value = it[0]; og.appendChild(op); }); s.appendChild(og); }
        else { var op = st("option", null, o[1]); op.value = o[0]; s.appendChild(op); }
      });
      s.value = val;
      s.addEventListener("change", function () { F[key] = s.value; renderCarnetList(); });
      bar.appendChild(s);
    }
    var eq = []; for (var k2 = 10; k2 >= 0; k2--) eq.push(["eq:" + k2, k2 + "/10"]);
    sel("carnet-note", "Filtrer par note", [["all", "Toutes les notes"], { group: "Au moins", items: [["ge:9", "9 et plus"], ["ge:8", "8 et plus"], ["ge:7", "7 et plus"], ["ge:5", "5 et plus"]] },
      { group: "Exactement", items: eq }, ["lt:5", "Moins de 5"], ["none", "Sans note"]], F.note, "note");
    var gs = {}; all.forEach(function (x) { x.genre.forEach(function (g) { gs[g] = true; }); });
    sel("carnet-genre", "Filtrer par genre", [["", "Tous les genres"]].concat(Object.keys(gs).sort(function (a, b) { return a.localeCompare(b, "fr"); }).map(function (g) { return [g, g]; })), F.genre, "genre");
    var ys = {}; all.forEach(function (x) { if (x.a.lu_le) ys[x.a.lu_le.slice(0, 4)] = true; });
    sel("carnet-year", "Filtrer par année de lecture", [["", "Toutes les années"]].concat(Object.keys(ys).sort().reverse().map(function (y) { return [y, "Lus en " + y]; })), F.year, "year");
    sel("carnet-sort", "Trier", [["date", "Plus récents d'abord"], ["note", "Meilleures notes"], ["note-asc", "Moins bonnes notes"], ["title", "Titre (A → Z)"]], F.sort, "sort");
    sec.appendChild(bar);
    var meta = st("div", "cv-meta");
    var count = st("span", "cv-count"); count.id = "carnet-count"; count.setAttribute("aria-live", "polite"); meta.appendChild(count);
    var reset = st("button", "btn btn-ghost cv-reset", "Tout afficher"); reset.type = "button"; reset.id = "carnet-reset";
    reset.addEventListener("click", function () { state.carnetF = { q: "", note: "all", genre: "", year: "", sort: F.sort }; renderCarnet(); });
    meta.appendChild(reset);
    var ex = st("button", "btn cv-export", "Exporter (CSV)"); ex.type = "button"; ex.id = "carnet-export";
    ex.addEventListener("click", exportCarnet);
    meta.appendChild(ex);
    sec.appendChild(meta);
    var ul = st("ul", "cv-list"); ul.id = "carnet-list"; sec.appendChild(ul);
    renderCarnetList();
  }
  function statTilesIn(sec, tiles) {
    var g = st("div", "st-tiles");
    tiles.forEach(function (t) { var d = st("div", "st-tile"); d.appendChild(st("div", "st-num", t[1])); d.appendChild(st("div", "st-lab", t[0])); g.appendChild(d); });
    sec.appendChild(g);
  }
  function statBarsIn(sec, rows, unit, max) {
    var box = st("div", "st-bars");
    rows.forEach(function (r) {
      var row = st("div", "st-row");
      var lab = st("button", "st-lab-btn", r.label); lab.type = "button"; lab.addEventListener("click", r.go);
      var track = st("span", "st-track"), fill = st("span", "st-fill");
      fill.style.width = Math.max(1.5, r.v * 100 / max) + "%";
      track.appendChild(fill); track.title = r.label + " : " + r.text; track.setAttribute("aria-hidden", "true");
      row.appendChild(lab); row.appendChild(track); row.appendChild(st("span", "st-val", r.text));
      box.appendChild(row);
    });
    sec.appendChild(box);
  }
  function setCarnetFilter(p) {
    Object.keys(p).forEach(function (k) { state.carnetF[k] = p[k]; });
    renderCarnet();
    var l = document.getElementById("carnet-liste");
    if (l) try { l.scrollIntoView({ block: "start" }); } catch (e) {}
  }
  function carnetFiltered() {
    var F = state.carnetF, q = normalize(F.q || "").trim();
    var list = avisEntries().filter(function (x) {
      var n = x.a.note;
      if (F.note === "none" && n !== null) return false;
      if (/^ge:/.test(F.note) && !(n !== null && n >= +F.note.slice(3))) return false;
      if (/^eq:/.test(F.note) && n !== +F.note.slice(3)) return false;
      if (F.note === "lt:5" && !(n !== null && n < 5)) return false;
      if (F.genre && x.genre.indexOf(F.genre) === -1) return false;
      if (F.year && (x.a.lu_le || "").slice(0, 4) !== F.year) return false;
      if (q && normalize(x.title + " " + x.author + " " + x.a.commentaire).indexOf(q) === -1) return false;
      return true;
    });
    var byTitle = function (a, b) { return a.title.localeCompare(b.title, "fr", { sensitivity: "base" }); };
    var dateOf = function (x) { return x.a.lu_le || (x.a.updated_at || "").slice(0, 10); };
    list.sort(F.sort === "title" ? byTitle
      : F.sort === "note" ? function (a, b) { return (b.a.note === null ? -1 : b.a.note) - (a.a.note === null ? -1 : a.a.note) || (dateOf(a) < dateOf(b) ? 1 : -1); }
      : F.sort === "note-asc" ? function (a, b) { return (a.a.note === null ? 99 : a.a.note) - (b.a.note === null ? 99 : b.a.note) || byTitle(a, b); }
      : function (a, b) { return dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : byTitle(a, b); });
    return list;
  }
  function renderCarnetList() {
    var ul = document.getElementById("carnet-list"), count = document.getElementById("carnet-count");
    if (!ul) return;
    var list = carnetFiltered(), total = Object.keys(state.avis).length, F = state.carnetF;
    var filtered = F.q || F.note !== "all" || F.genre || F.year;
    count.textContent = filtered ? fmt(list.length) + " sur " + fmt(total) + " avis" : fmt(total) + (total > 1 ? " avis" : " avis");
    var rs = document.getElementById("carnet-reset"); if (rs) rs.hidden = !filtered;
    ul.innerHTML = "";
    if (!list.length) { ul.appendChild(st("li", "cv-empty", "Aucun avis ne correspond.")); return; }
    list.forEach(function (x) {
      var li = st("li", "cv-item");
      var th = st("div", "cv-thumb");
      if (x.cover) { var im = st("img"); im.alt = ""; im.src = coverUrl(x.cover); im.loading = "lazy"; th.appendChild(im); }
      li.appendChild(th);
      var body = st("div", "cv-body");
      var top = st("div", "cv-top");
      var t = (x.gone || x.hidden) ? st("span", "cv-title gone", x.title) : st("button", "cv-title st-lab-btn", x.title);
      if (!x.gone && !x.hidden) { t.type = "button"; t.addEventListener("click", function () { openSheet(x.e.id); }); }
      top.appendChild(t);
      if (x.a.note !== null) { var nb = st("span", "avis-note", noteText(x.a.note)); nb.setAttribute("aria-label", "Note : " + x.a.note + " sur 10"); top.appendChild(nb); }
      body.appendChild(top);
      var sub = [];
      if (x.author) sub.push(x.author);
      if (x.a.lu_le) sub.push("lu le " + frDate(x.a.lu_le));
      if (x.gone) sub.push("fiche disparue du catalogue");
      else if (x.hidden) sub.push("fiche masquée");
      else if (x.merged) sub.push("fusionnée dans « " + x.e.title + " »");
      body.appendChild(st("div", "cv-sub", sub.join(" · ")));
      if (x.a.commentaire) body.appendChild(st("p", "avis-com cv-com", x.a.commentaire));
      li.appendChild(body);
      ul.appendChild(li);
    });
  }
  function csvCell(v) { v = v === null || v === undefined ? "" : String(v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCarnet() {
    var rows = [["Titre", "Auteur(s)", "Genres", "Note sur 10", "Lu le", "Commentaire", "Identifiant de la fiche"]];
    carnetFiltered().forEach(function (x) {
      rows.push([x.title, x.author, x.genre.join(", "), x.a.note === null ? "" : x.a.note, x.a.lu_le || "", x.a.commentaire, x.id]);
    });
    var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = "carnet_de_lecture_" + todayIso() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

