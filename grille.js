// Ma Bibliothèque BD — grille.js (2/7) : barre alphabétique, grille et vignettes (5 présentations). Voir README, « Organisation du code ».
"use strict";
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
    c = foldLetters(c.toLowerCase()).charAt(0).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
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
  // 3.7 : tri « Nombre de tomes » (tous) et « Lus récemment » (propriétaire), avec leurs
  // séparateurs : tranches de nombre de tomes, mois de la dernière lecture.
  function tomesBand(e) {
    var n = e.volume_count;
    if (e.one_shot) return { k: "os", t: "One-shots" };
    if (n >= 20) return { k: "20", t: "20 tomes et plus" };
    if (n >= 10) return { k: "10", t: "10 à 19 tomes" };
    if (n >= 5) return { k: "5", t: "5 à 9 tomes" };
    if (n >= 2) return { k: "2", t: "2 à 4 tomes" };
    return { k: "1", t: "Séries d'un seul tome" };
  }
  // dernière lecture d'une fiche : tome coché lu le plus récent, ou date de lecture de mon avis
  function lastReadOf(e) {
    var best = "";
    (e._vis || []).forEach(function (i) {
      var k = e._keys[i];
      if (isKeyRead(k)) { var d = state.readAt[k]; if (d) { d = isoDay(new Date(d)); if (d > best) best = d; } }
    });
    var a = state.avis && state.avis[e.id];
    if (a && a.lu_le && a.lu_le > best) best = a.lu_le;
    return best;
  }
  function textHead(t) {
    var h = document.createElement("h2");
    h.className = "letter-head date-head";
    h.textContent = t;
    return h;
  }
  function renderGrid() {
    var list = state.catalog.filter(matches);
    var recent = state.sort === "recent", tomes = state.sort === "tomes", lus = state.sort === "lus" && IS_OWNER;
    if (recent) list = list.slice().sort(function (a, b) {        // tri stable : le titre départage
      var x = a._lastAdded || "", y = b._lastAdded || "";
      return x < y ? 1 : x > y ? -1 : 0;
    });
    else if (tomes) list = list.slice().sort(function (a, b) {    // séries d'abord, les plus longues en tête
      return (a.one_shot ? 1 : 0) - (b.one_shot ? 1 : 0) || b.volume_count - a.volume_count;
    });
    else if (lus) {
      list.forEach(function (e) { e._lastRead = lastReadOf(e); });
      list = list.slice().sort(function (a, b) { return a._lastRead < b._lastRead ? 1 : a._lastRead > b._lastRead ? -1 : 0; });
    }
    if (lazyObserver) lazyObserver.disconnect();
    var pres = presentation();                                  // 3.4
    els.grid.setAttribute("data-pres", pres);
    state.shelfMax = shelfMaxNow();
    els.grid.innerHTML = "";
    state.gridOrder = list.map(function (e) { return e.id; });   // 3.5 : fiche précédente / suivante
    els.empty.hidden = list.length > 0;
    var showAz = !recent && !tomes && !lus && list.length >= AZ_MIN, present = {}, lastDay = null, cut = newCutoff();
    var frag = document.createDocumentFragment();
    list.forEach(function (entry) {
      if (recent) {
        var d = entry._lastAdded || "";
        if (d !== lastDay) { lastDay = d; frag.appendChild(dateHead(d)); }
      } else if (tomes) {
        var bd = tomesBand(entry);
        if (bd.k !== lastDay) { lastDay = bd.k; frag.appendChild(textHead(bd.t)); }
      } else if (lus) {
        var mo = entry._lastRead ? entry._lastRead.slice(0, 7) : "";
        if (mo !== lastDay) {
          lastDay = mo;
          frag.appendChild(textHead(mo ? "Lus en " + MOIS[+mo.slice(5, 7) - 1] + " " + mo.slice(0, 4) : "Pas encore lus"));
        }
      } else if (showAz) {
        var L = initialOf(entry.title);
        if (!present[L]) { present[L] = true; frag.appendChild(letterHead(L)); }
      }
      frag.appendChild(renderCard(entry, cut, pres));
    });
    els.grid.appendChild(frag);
    renderAz(present, showAz);
    sweepSoon();
  }

  // 3.4 : couvertures des tomes visibles d'une fiche, dans l'ordre (éventail, étagère, mur)
  function coversOf(entry, max) {
    var seen = {}, out = [];
    (entry._ord || []).forEach(function (i) {
      var v = entry.volumes && entry.volumes[i], f = v && v.cover;
      if (f && !seen[f]) { seen[f] = true; out.push(f); }
    });
    if (!out.length && entry.cover) out.push(entry.cover);
    return max ? out.slice(0, max) : out;
  }
  function coverImg(file, cls, alt) {
    var im = document.createElement("img");
    if (cls) im.className = cls;
    im.alt = alt || "";
    lazyImage(im, coverUrl(file));
    return im;
  }
  function countText(entry) {
    return entry.one_shot ? "One-shot" : entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome");
  }
  function infoBlock(entry, cls) {
    var info = document.createElement("div");
    info.className = cls || "card-info";
    var t = document.createElement("div"); t.className = "card-title"; t.textContent = entry.title;
    var a = document.createElement("div"); a.className = "card-author"; a.textContent = entry.author || "Auteur non renseigné";
    var c = document.createElement("div"); c.className = "card-count" + (entry.one_shot ? " oneshot" : ""); c.textContent = countText(entry);
    info.appendChild(t); info.appendChild(a); info.appendChild(c);
    return info;
  }
  var SHELF_H = [100, 93, 97, 90, 95, 92];   // hauteurs (%) des tomes sur l'étagère, pour un rang moins sage

  function renderCard(entry, cut, pres) {
    pres = pres || presentation();
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
      (entry._private ? ", réservée au propriétaire" : "") + (nw ? ", " + nw.aria : "") +
      (IS_OWNER && state.avis[entry.id] && state.avis[entry.id].note !== null ? ", noté " + state.avis[entry.id].note + " sur 10" : ""));

    // pastilles (communes à toutes les présentations ; la loupe seulement en grille et en mur)
    var badges = document.createElement("div");
    badges.className = "card-badges";
    if (entry.cover && (pres === "grille" || pres === "mur")) {
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
    var av = IS_OWNER && state.avis[entry.id];             // 3.6 : ma note
    if (av && av.note !== null) {
      var bno = document.createElement("span"); bno.className = "badge note"; bno.textContent = av.note + "/10"; badges.appendChild(bno);
    }
    if (!IS_OWNER) {
      // visiteur : pas de pastille de statut
    } else if (read) {
      var br = document.createElement("span"); br.className = "badge read"; br.textContent = "Lu"; badges.appendChild(br);
    } else if (inProgress) {
      var bp = document.createElement("span"); bp.className = "badge inprogress"; bp.textContent = readCount + "/" + entry.volume_count + " lus"; badges.appendChild(bp);
    }
    var bn = null;
    if (nw) {                                             // 3.0 : nouveauté (visible de tous)
      bn = document.createElement("span"); bn.className = "badge new card-new"; bn.textContent = nw.text;
    }

    if (pres === "liste") {
      card.className += " row";
      var rc = document.createElement("div"); rc.className = "row-cover";
      if (entry.cover) rc.appendChild(coverImg(entry.cover, "", entry.title));
      card.appendChild(rc);
      card.appendChild(infoBlock(entry, "row-info"));
      badges.className = "row-badges";
      if (bn) { bn.className = "badge new"; badges.insertBefore(bn, badges.firstChild); }
      card.appendChild(badges);
    } else if (pres === "etagere") {
      card.className += " shelf";
      var books = document.createElement("div"); books.className = "shelf-books";
      var max = state.shelfMax || 6, files = coversOf(entry, max), total = (entry._ord || []).length;
      files.forEach(function (f, i) {
        var b = coverImg(f, "shelf-b", i ? "" : entry.title);
        b.style.setProperty("--h", SHELF_H[i % SHELF_H.length] + "%");
        books.appendChild(b);
      });
      if (!files.length) { var ph = document.createElement("span"); ph.className = "shelf-b shelf-ph"; books.appendChild(ph); }
      if (total > files.length && files.length) {
        var more = document.createElement("span"); more.className = "shelf-more"; more.textContent = "+" + (total - files.length);
        books.appendChild(more);
      }
      books.appendChild(badges);
      if (bn) books.appendChild(bn);
      card.appendChild(books);
      var plank = document.createElement("div"); plank.className = "shelf-plank"; card.appendChild(plank);
      var st = document.createElement("div"); st.className = "shelf-title"; st.textContent = entry.title;
      card.appendChild(st);
    } else if (pres === "mur") {
      var nv = (entry._ord || []).length;
      card.className += " mur" + (nv >= 3 ? " pile2" : nv === 2 ? " pile1" : "") + (entry.cover ? "" : " no-cover");
      var mw = document.createElement("div"); mw.className = "card-cover-wrap";
      if (entry.cover) mw.appendChild(coverImg(entry.cover, "", entry.title));
      mw.appendChild(badges);
      if (bn) mw.appendChild(bn);
      var cap = document.createElement("div"); cap.className = "mur-cap";
      var mt = document.createElement("span"); mt.className = "mur-title"; mt.textContent = entry.title;
      var mc = document.createElement("span"); mc.className = "mur-count"; mc.textContent = countText(entry);
      cap.appendChild(mt); cap.appendChild(mc); mw.appendChild(cap);
      card.appendChild(mw);
    } else if (pres === "eventail") {
      var fw = document.createElement("div");
      var fl = coversOf(entry, 4), n = fl.length;
      fw.className = "card-cover-wrap fan" + (n < 2 ? " solo" : "");
      fl.forEach(function (f, k) {
        var im = coverImg(f, "fan-i", k ? "" : entry.title);
        im.style.setProperty("--k", (k - (n - 1) / 2).toFixed(2));
        im.style.zIndex = String(n - k);
        fw.appendChild(im);
      });
      fw.appendChild(badges);
      if (bn) fw.appendChild(bn);
      card.appendChild(fw);
      card.appendChild(infoBlock(entry));
    } else {
      var coverWrap = document.createElement("div");
      coverWrap.className = "card-cover-wrap";
      var img = document.createElement("img");
      img.alt = entry.title;
      // Chargement differe : avec ~2000 vignettes, tout charger a l'ouverture pesait
      // ~140 Mo. On n'utilise PAS loading="lazy" (natif), qui s'etait revele peu fiable
      // ici (vignettes jamais chargees), mais un IntersectionObserver explicite.
      lazyImage(img, coverUrl(entry.cover));
      if (!entry.cover) img.style.display = "none";
      coverWrap.appendChild(img);
      coverWrap.appendChild(badges);
      if (bn) coverWrap.appendChild(bn);
      card.appendChild(coverWrap);
      card.appendChild(infoBlock(entry));
    }
    card.addEventListener("click", function () { openSheet(entry.id); });
    card.addEventListener("keydown", function (e) {
      if (e.target !== card) return;                     // Entrée sur la loupe : la loupe
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(entry.id); }
    });
    return card;
  }
  // l'étagère montre 4 tomes sur téléphone, 6 ailleurs : on redessine en franchissant le seuil
  function shelfMaxNow() { return (window.innerWidth || 1000) < 560 ? 4 : 6; }
  window.addEventListener("resize", function () {
    if (presentation() === "etagere" && state.shelfMax && shelfMaxNow() !== state.shelfMax) renderGridSoon();
  });

