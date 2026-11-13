// Ma Bibliothèque BD — fiche.js (3/7) : fiche, zoom, édition et fusion (propriétaire), message temporaire. Voir README, « Organisation du code ».
"use strict";
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
  // opts (3.5, passage à la fiche voisine) : dir = -1 / 1 (petit glissement de la fiche),
  // keepFocus = le focus reste sur le bouton ‹ › qu'on vient d'utiliser.
  function openSheetUI(id, opts) {
    opts = opts || {};
    var entry = state.catalog.find(function (e) { return e.id === id; });
    if (!entry) return;
    if (els.overlay.hidden) state.lastFocus = document.activeElement;
    state.activeId = id;
    state.activeVolIdx = entry._ord.length ? entry._ord[0] : 0;
    state.editVol = null;
    state.avisEdit = false; state.avisConfirm = false;    // 3.6
    closeEditor();
    refreshSheet();
    els.overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (opts.dir) {
      var sh = document.getElementById("sheet"), body = sh && sh.querySelector(".sheet-body");
      if (sh) sh.scrollTop = 0;
      if (body) {
        body.classList.remove("slide-next", "slide-prev");
        void body.offsetWidth;                            // relance l'animation
        body.classList.add(opts.dir > 0 ? "slide-next" : "slide-prev");
      }
    }
    if (opts.keepFocus) {
      // bouton devenu inactif (première ou dernière fiche) : le focus passe à l'autre
      var a = document.activeElement;
      if (a && a.disabled) { var o = a === els.sheetPrev ? els.sheetNext : els.sheetPrev; try { (o && !o.disabled ? o : els.sheetTitle).focus({ preventScroll: true }); } catch (e) {} }
      return;
    }
    // 2.8 : le focus va dans la fiche (lecteurs d'écran, clavier)
    setTimeout(function () { try { els.sheetTitle.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }

  // Remplit la fiche ouverte à partir de l'état courant (appelé aussi après une correction).
  function refreshSheet() {
    var entry = currentEntry();
    if (!entry) return;
    updateSheetNav();
    renderAvis();                                          // 3.6
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
    if (state.volumeRead[key]) { delete state.volumeRead[key]; delete state.readAt[key]; }
    else { state.volumeRead[key] = true; state.readAt[key] = new Date().toISOString(); }
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
    // 3.5 : après un passage de fiche en fiche, la grille se place sur la dernière vue
    if (state.navMoved && back && back.classList && back.classList.contains("card") && state.view === "home") {
      var r = back.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < 70 || r.bottom > vh) window.scrollTo(0, Math.max(0, window.scrollY + r.top - (vh - r.height) / 2));
      sweepSoon();
    }
    state.navMoved = false;
  }

  function toggleAllVolumesRead() {
    var entry = currentEntry();
    if (!entry || needLogin()) return;
    var makeRead = !isTitleRead(entry), before = {};
    entry._vis.forEach(function (i) { before[entry._keys[i]] = isKeyRead(entry._keys[i]); });
    entry._vis.forEach(function (i) {
      var key = entry._keys[i];
      if (makeRead) { state.volumeRead[key] = true; state.readAt[key] = new Date().toISOString(); }
      else { delete state.volumeRead[key]; delete state.readAt[key]; }
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

