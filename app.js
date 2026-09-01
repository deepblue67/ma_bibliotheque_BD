(function () {
  "use strict";

  var state = {
    catalog: [],
    status: {},        // id -> { is_read, is_favorite }
    filters: { title: "", author: "", read: false, unread: false, fav: false },
    activeId: null,
  };

  function coverUrl(filename) {
    if (!filename) return "";
    return (window.BD_IMAGE_BASE || "covers/") + filename;
  }

  var els = {
    grid: document.getElementById("grid"),
    empty: document.getElementById("empty-state"),
    stats: document.getElementById("stats"),
    searchTitle: document.getElementById("search-title"),
    searchAuthor: document.getElementById("search-author"),
    filterRead: document.getElementById("filter-read"),
    filterUnread: document.getElementById("filter-unread"),
    filterFav: document.getElementById("filter-fav"),
    overlay: document.getElementById("overlay"),
    sheetClose: document.getElementById("sheet-close"),
    sheetCover: document.getElementById("sheet-cover"),
    sheetTitle: document.getElementById("sheet-title"),
    sheetAuthor: document.getElementById("sheet-author"),
    sheetMeta: document.getElementById("sheet-meta"),
    volumeList: document.getElementById("sheet-volume-list"),
    btnRead: document.getElementById("btn-read"),
    btnFav: document.getElementById("btn-fav"),
    syncNote: document.getElementById("sync-note"),
  };

  // ---------- local cache ----------
  var LOCAL_KEY = "bd_status_cache_v1";
  function loadLocalStatus() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveLocalStatus() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state.status)); } catch (e) {}
  }

  // ---------- supabase ----------
  var supabase = null;
  function initSupabase() {
    if (!window.supabase || !window.BD_SUPABASE_URL || !window.BD_SUPABASE_ANON_KEY) {
      setSyncNote("Synchronisation indisponible (config manquante) — mode local uniquement.");
      return;
    }
    try {
      supabase = window.supabase.createClient(window.BD_SUPABASE_URL, window.BD_SUPABASE_ANON_KEY);
      fetchRemoteStatus();
      subscribeRealtime();
    } catch (e) {
      setSyncNote("Synchronisation indisponible — mode local uniquement.");
    }
  }

  function setSyncNote(text) {
    els.syncNote.textContent = text || "";
  }

  function fetchRemoteStatus() {
    supabase.from("bd_status").select("id,is_read,is_favorite,updated_at")
      .then(function (res) {
        if (res.error) { setSyncNote("Synchro : hors ligne (données locales conservées)."); return; }
        (res.data || []).forEach(function (row) {
          state.status[row.id] = { is_read: !!row.is_read, is_favorite: !!row.is_favorite };
        });
        saveLocalStatus();
        renderGrid();
        setSyncNote("");
      })
      .catch(function () { setSyncNote("Synchro : hors ligne (données locales conservées)."); });
  }

  function subscribeRealtime() {
    supabase.channel("bd_status_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bd_status" }, function (payload) {
        var row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || !row.id) return;
        if (payload.eventType === "DELETE") { delete state.status[row.id]; }
        else { state.status[row.id] = { is_read: !!row.is_read, is_favorite: !!row.is_favorite }; }
        saveLocalStatus();
        renderGrid();
        if (state.activeId === row.id) renderSheetActions();
      })
      .subscribe();
  }

  function pushStatus(id) {
    if (!supabase) return;
    var s = state.status[id] || { is_read: false, is_favorite: false };
    supabase.from("bd_status").upsert({
      id: id, is_read: s.is_read, is_favorite: s.is_favorite, updated_at: new Date().toISOString()
    }).then(function (res) {
      if (res.error) setSyncNote("Dernière modification pas encore synchronisée (réessaiera).");
    }).catch(function () {});
  }

  // ---------- data ----------
  function loadCatalog() {
    fetch("data/catalog.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.catalog = data.entries;
        els.stats.textContent = data.generated_count + " séries · " + data.total_volumes + " albums";
        renderGrid();
      })
      .catch(function () {
        els.empty.hidden = false;
        els.empty.textContent = "Impossible de charger le catalogue (data/catalog.json).";
      });
  }

  // ---------- filtering ----------
  function normalize(s) {
    return (s || "").toString().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function matches(entry) {
    var st = state.status[entry.id] || { is_read: false, is_favorite: false };
    if (state.filters.title && normalize(entry.title).indexOf(normalize(state.filters.title)) === -1) return false;
    if (state.filters.author && normalize(entry.author || "").indexOf(normalize(state.filters.author)) === -1) return false;
    if (state.filters.read && !st.is_read) return false;
    if (state.filters.unread && st.is_read) return false;
    if (state.filters.fav && !st.is_favorite) return false;
    return true;
  }

  // ---------- render ----------
  function renderGrid() {
    var list = state.catalog.filter(matches);
    els.grid.innerHTML = "";
    els.empty.hidden = list.length > 0;
    var frag = document.createDocumentFragment();
    list.forEach(function (entry) {
      frag.appendChild(renderCard(entry));
    });
    els.grid.appendChild(frag);
  }

  function renderCard(entry) {
    var st = state.status[entry.id] || {};
    var card = document.createElement("div");
    card.className = "card";
    card.setAttribute("data-id", entry.id);

    var coverWrap = document.createElement("div");
    coverWrap.className = "card-cover-wrap";
    var img = document.createElement("img");
    img.loading = "lazy";
    img.alt = entry.title;
    img.src = coverUrl(entry.cover);
    if (!entry.cover) img.style.display = "none";
    coverWrap.appendChild(img);

    var badges = document.createElement("div");
    badges.className = "card-badges";
    if (st.is_favorite) {
      var bf = document.createElement("span"); bf.className = "badge fav"; bf.textContent = "★"; badges.appendChild(bf);
    }
    if (st.is_read) {
      var br = document.createElement("span"); br.className = "badge read"; br.textContent = "Lu"; badges.appendChild(br);
    }
    coverWrap.appendChild(badges);

    var info = document.createElement("div");
    info.className = "card-info";
    var t = document.createElement("div"); t.className = "card-title"; t.textContent = entry.title;
    var a = document.createElement("div"); a.className = "card-author"; a.textContent = entry.author || "Auteur non renseigné";
    var c = document.createElement("div"); c.className = "card-count"; c.textContent = entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome");
    info.appendChild(t); info.appendChild(a); info.appendChild(c);

    card.appendChild(coverWrap);
    card.appendChild(info);
    card.addEventListener("click", function () { openSheet(entry.id); });
    return card;
  }

  // ---------- detail sheet ----------
  function openSheet(id) {
    var entry = state.catalog.find(function (e) { return e.id === id; });
    if (!entry) return;
    state.activeId = id;
    els.sheetCover.src = coverUrl(entry.cover);
    els.sheetCover.alt = entry.title;
    els.sheetTitle.textContent = entry.title;
    els.sheetAuthor.textContent = entry.author || "Auteur non renseigné";
    els.sheetMeta.textContent = entry.volume_count + (entry.volume_count > 1 ? " tomes" : " tome") + (entry.parent_series ? " · série liée à " + entry.parent_series : "");
    els.volumeList.innerHTML = "";
    entry.volumes.forEach(function (v, i) {
      var li = document.createElement("li");
      var num = document.createElement("span"); num.className = "num";
      num.textContent = String(i + 1).padStart(2, "0");
      var label = document.createElement("span"); label.textContent = v;
      li.appendChild(num); li.appendChild(label);
      els.volumeList.appendChild(li);
    });
    renderSheetActions();
    els.overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function renderSheetActions() {
    var st = state.status[state.activeId] || { is_read: false, is_favorite: false };
    els.btnRead.setAttribute("data-on", st.is_read ? "true" : "false");
    els.btnRead.textContent = st.is_read ? "✓ Marqué comme lu" : "Marquer comme lu";
    els.btnFav.setAttribute("data-on", st.is_favorite ? "true" : "false");
    els.btnFav.textContent = st.is_favorite ? "★ Dans les favoris" : "★ Ajouter aux favoris";
  }

  function closeSheet() {
    els.overlay.hidden = true;
    state.activeId = null;
    document.body.style.overflow = "";
  }

  function toggleStatus(field) {
    var id = state.activeId;
    if (!id) return;
    var s = state.status[id] || { is_read: false, is_favorite: false };
    s[field] = !s[field];
    state.status[id] = s;
    saveLocalStatus();
    renderSheetActions();
    renderGrid();
    pushStatus(id);
  }

  // ---------- wiring ----------
  els.searchTitle.addEventListener("input", function () { state.filters.title = els.searchTitle.value; renderGrid(); });
  els.searchAuthor.addEventListener("input", function () { state.filters.author = els.searchAuthor.value; renderGrid(); });

  function toggleChip(el, key) {
    el.addEventListener("click", function () {
      state.filters[key] = !state.filters[key];
      el.setAttribute("data-active", state.filters[key] ? "true" : "false");
      renderGrid();
    });
  }
  toggleChip(els.filterRead, "read");
  toggleChip(els.filterUnread, "unread");
  toggleChip(els.filterFav, "fav");

  els.sheetClose.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", function (e) { if (e.target === els.overlay) closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  els.btnRead.addEventListener("click", function () { toggleStatus("is_read"); });
  els.btnFav.addEventListener("click", function () { toggleStatus("is_favorite"); });

  // ---------- boot ----------
  state.status = loadLocalStatus();
  loadCatalog();
  initSupabase();
})();
