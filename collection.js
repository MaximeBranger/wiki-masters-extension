// ===== Wiki-Masters Auto Pack - suivi de collection =====
// 1. Page collection : mémorise les cartes (et leur quantité si affichée, ex. "x3").
// 2. Ouverture de pack : ajoute les cartes tirées, compte les doublons.
// 3. Page de carte : badge possédée / doublon / pas encore.
// 4. Partout : pastilles ✓ / ✕ / ★ nouvelle / ×N doublon sur les liens de cartes.
(() => {
  const CDEF = {
    collectionPath: "/collection",
    cardPattern: "/cards?/([^/?#]+)",
    markLinks: true,
    affordableOnly: false,     // marketplace : masquer les offres au-dessus de mes moyens
    budget: 0,                 // solde saisi à la main (repli)
    balanceSelector: 'button[aria-label="Ouvrir la boutique WikiBidous"]',   // sélecteur de l'élément affichant mon solde (prioritaire)
    pullZone: "",
    pullWindow: 15,
    autoSellDupes: false,
    readCollectionQty: true,   // lire "x3" / "×3" à côté des cartes sur la page collection
    owned: [],
    counts: {}                 // id -> nombre d'exemplaires
  };
  let c = { ...CDEF };
  let owned = new Set();
  let counts = {};
  const newThisSession = new Set();
  const touched = new Set();   // ids modifiés localement, pas encore enregistrés
  let lastHref = "";

  const log = (...a) => console.log("%c[Collection]", "color:#10b981;font-weight:bold", ...a);
  const countOf = id => counts[id] ?? (owned.has(id) ? 1 : 0);

  function cardIdFrom(href) {
    try {
      const path = new URL(href, location.origin).pathname;
      const m = path.match(new RegExp(c.cardPattern));
      return m ? decodeURIComponent(m[1] || m[0]).toLowerCase() : null;
    } catch { return null; }
  }
  const onCollectionPage = () => location.pathname.startsWith(c.collectionPath);
  const onPullsPage = () => (window.__wmOnPullsPage ? window.__wmOnPullsPage() : location.pathname.startsWith("/pulls"));

  // Enregistrement : relit le stockage et n'écrit que les cartes modifiées ici
  // (évite d'écraser les mises à jour faites par le service worker après une vente).
  let saveTimer;
  function setCount(id, n) {
    if (n > 0) owned.add(id);
    counts[id] = n;
    touched.add(id);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.get({ owned: [], counts: {} }, s => {
        const o = new Set([...s.owned, ...owned]);
        const cs = { ...s.counts };
        for (const t of touched) cs[t] = counts[t];
        touched.clear();
        chrome.storage.local.set({ owned: [...o], counts: cs });
      });
    }, 400);
  }

  // --- Styles ---
  const style = document.createElement("style");
  style.textContent = `
    #wm-owned-badge { position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      padding: 10px 16px; border-radius: 999px; font: 600 14px system-ui, sans-serif;
      color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.35); pointer-events: none; }
    #wm-owned-badge.yes { background: #059669; }
    #wm-owned-badge.dup { background: #7c3aed; }
    #wm-owned-badge.no  { background: #dc2626; }
    #wm-owned-badge.unk { background: #6b7280; }
    .wm-mark { position: relative; }
    .wm-mark::after { position: absolute; top: 4px; right: 4px; z-index: 5; box-sizing: border-box;
      min-width: 20px; height: 20px; border-radius: 10px; display: grid; place-items: center;
      font: 700 12px system-ui; color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
    .wm-mark.wm-yes::after { content: "✓"; background: #059669; }
    .wm-mark.wm-no::after  { content: "✕"; background: #dc2626; }
    .wm-mark.wm-new::after { content: "★"; background: #f59e0b; }
    .wm-mark.wm-dup::after { content: "×" attr(data-wm-count); background: #7c3aed; padding: 0 6px; }
    /* Cartes déjà possédées : contenu grisé (lisible, mais clairement "pas recherché"), pastille intacte */
    .wm-mark.wm-yes > *, .wm-mark.wm-dup > *, a.wm-site-owned > * { filter: grayscale(1) opacity(.5) !important; }
    #wm-afford-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
      padding: 0 12px; min-height: 40px; border-radius: 8px; font: 500 13px system-ui, sans-serif;
      border: 1px solid rgba(128,128,128,.35); background: rgba(128,128,128,.08); color: inherit; }
    #wm-afford-switch.wm-float { position: fixed; right: 16px; bottom: 76px; z-index: 2147483000; background: #1f1a2e; color: #fff; }
    #wm-afford-switch input { display: none; }
    #wm-afford-switch .wm-track { width: 34px; height: 18px; border-radius: 9px; background: #6b7280; position: relative; transition: background .2s; flex: none; }
    #wm-afford-switch .wm-track i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .2s; }
    #wm-afford-switch input:checked + .wm-track { background: #059669; }
    #wm-afford-switch input:checked + .wm-track i { left: 18px; }
    [data-wm-hide] { display: none !important; }
    #wm-pull-toast { position: fixed; bottom: 20px; left: 20px; z-index: 2147483647;
      max-width: 300px; padding: 12px 16px; border-radius: 12px; background: #1f1a2e;
      color: #fff; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.4);
      border-left: 4px solid #f59e0b; transition: opacity .3s; }
    #wm-pull-toast b { color: #fbbf24; }
    #wm-pull-toast .dup { color: #c4b5fd; }
    #wm-pull-toast ul { margin: 6px 0 0; padding-left: 18px; }
  `;
  document.documentElement.appendChild(style);

  // Plus petit bloc autour du lien qui ne contient qu'une seule carte
  function cardBox(a, id) {
    let el = a;
    for (let i = 0; i < 4 && el.parentElement; i++) {
      const p = el.parentElement;
      const other = [...p.querySelectorAll("a[href]")].some(l => { const x = cardIdFrom(l.href); return x && x !== id; });
      if (other) break;
      el = p;
    }
    return el;
  }

  // --- 1. Apprentissage sur la page de collection ---
  function learnFromCollection() {
    let changed = 0;
    for (const a of document.querySelectorAll("a[href]")) {
      const id = cardIdFrom(a.href);
      if (!id) continue;
      let q = null;
      if (c.readCollectionQty) {
        const m = (cardBox(a, id).innerText || "").match(/(?:^|\s)[x×]\s?(\d{1,3})(?=\s|$)/i);
        if (m) q = parseInt(m[1], 10);
      }
      if (q && q !== counts[id]) { setCount(id, q); changed++; }
      else if (!owned.has(id)) { setCount(id, 1); changed++; }
    }
    if (changed) log(`${changed} carte(s) mises à jour depuis la collection, total : ${owned.size}`);
  }

  // --- 2. Capture des cartes tirées dans un pack ---
  let watchUntil = 0;
  let before = new WeakMap();    // élément -> href au moment de l'ouverture
  let counted = new WeakMap();   // élément -> href déjà compté
  let round = null;

  function startPackWatch() {
    before = new WeakMap();
    for (const a of document.querySelectorAll("a[href]")) before.set(a, a.href);
    counted = new WeakMap();
    watchUntil = Date.now() + c.pullWindow * 1000;
    round = { total: 0, fresh: [], dupes: [] };
    log("Ouverture de pack détectée, capture des cartes…");
  }

  document.addEventListener("click", e => {
    if (!onPullsPage()) return;
    if (window.__wmMatchesPackButton?.(e.target)) startPackWatch();
    // Chaque carte suivante prolonge la fenêtre de capture
    else if (round && window.__wmIsNextButton?.(e.target))
      watchUntil = Math.max(watchUntil, Date.now() + c.pullWindow * 1000);
  }, true);

  function scanPulls() {
    if (!round || Date.now() > watchUntil) return;
    let roots = [document];
    if (c.pullZone.trim()) {
      try { roots = [...document.querySelectorAll(c.pullZone)]; } catch { roots = [document]; }
    }
    let changed = false;
    const toSell = [];
    for (const root of roots) {
      for (const a of root.querySelectorAll("a[href]")) {
        if (before.get(a) === a.href || counted.get(a) === a.href) continue;
        const id = cardIdFrom(a.href);
        if (!id) continue;
        counted.set(a, a.href);
        round.total++;
        const name = (a.innerText || a.getAttribute("title") || a.querySelector("img")?.alt || id).trim().split("\n")[0];
        const n = countOf(id);
        if (n === 0) {
          setCount(id, 1);
          newThisSession.add(id);
          round.fresh.push({ id, name });
        } else {
          setCount(id, n + 1);
          round.dupes.push({ id, name, count: n + 1 });
          if (c.autoSellDupes) toSell.push({ id, href: a.href, name, reason: "doublon" });
        }
        changed = true;
      }
    }
    if (toSell.length) { try { chrome.runtime.sendMessage({ type: "enqueue", items: toSell }); } catch {} }
    if (changed) {
      showToast();
      log(`Tirage : ${round.total} carte(s), ${round.fresh.length} nouvelle(s), ${round.dupes.length} doublon(s)`);
    }
  }

  const esc = s => s.replace(/[<>&]/g, "");
  let toastTimer;
  function showToast() {
    let el = document.getElementById("wm-pull-toast");
    if (!el) { el = document.createElement("div"); el.id = "wm-pull-toast"; document.body.appendChild(el); }
    el.style.opacity = "1";
    const f = round.fresh, d = round.dupes;
    const list = (arr, fmt) => `<ul>${arr.slice(0, 5).map(fmt).join("")}${arr.length > 5 ? `<li>… et ${arr.length - 5} autre(s)</li>` : ""}</ul>`;
    el.innerHTML = `🎴 ${round.total} carte(s) tirée(s)` +
      `<br><b>★ ${f.length} nouvelle(s)</b>` + (f.length ? list(f, x => `<li>${esc(x.name)}</li>`) : "") +
      `<br><span class="dup">🔁 ${d.length} doublon(s)${d.length && c.autoSellDupes ? " → mis en vente" : ""}</span>` +
      (d.length ? list(d, x => `<li class="dup">${esc(x.name)} (×${x.count})</li>`) : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 9000);
  }

  // --- 3. Badge sur une page de carte ---
  function updateBadge() {
    let badge = document.getElementById("wm-owned-badge");
    const id = onCollectionPage() ? null : cardIdFrom(location.href);
    if (!id) { badge?.remove(); return; }
    if (!badge) { badge = document.createElement("div"); badge.id = "wm-owned-badge"; document.body.appendChild(badge); }
    const n = countOf(id);
    if (!owned.size)  { badge.className = "unk"; badge.textContent = "Collection non synchronisée"; }
    else if (n >= 2)  { badge.className = "dup"; badge.textContent = `🔁 Doublon · ×${n} (${n - 1} en trop)`; }
    else if (n === 1) { badge.className = "yes"; badge.textContent = "✓ Dans ta collection"; }
    else              { badge.className = "no";  badge.textContent = "✕ Pas encore possédée"; }
  }

  // --- 4. Pastilles sur les liens de cartes ---
  function markLinks() {
    const inCollection = onCollectionPage() || /^\/(collection|inventory)(\/|$)/i.test(location.pathname);
    const active = c.markLinks && owned.size && !inCollection;
    for (const a of document.querySelectorAll("a[href]")) {
      a.classList.remove("wm-mark", "wm-yes", "wm-no", "wm-new", "wm-dup", "wm-site-owned");
      a.removeAttribute("data-wm-count");
      // Marketplace : les liens pointent vers une annonce (pas un id de carte), mais le site
      // affiche déjà son propre tag « Possédée » -> on s'appuie dessus.
      if (c.markLinks && !inCollection && a.querySelector('[title="Dans ta collection"]')) {
        a.classList.add("wm-mark", "wm-yes", "wm-site-owned");
        continue;
      }
      const id = active ? cardIdFrom(a.href) : null;
      if (!id || a.href === location.href) continue;
      const n = countOf(id);
      let cls = n >= 2 ? "wm-dup" : newThisSession.has(id) ? "wm-new" : n === 1 ? "wm-yes" : "wm-no";
      if (cls === "wm-dup") a.setAttribute("data-wm-count", n);
      a.classList.add("wm-mark", cls);
    }
  }

  // --- 5. Marketplace : n'afficher que les offres dans mes moyens ---
  const toNum = txt => {
    const m = String(txt || "").replace(/[\s  ]/g, "").match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(",", ".")) : NaN;
  };
  function myBalance() {
    if (c.balanceSelector.trim()) {
      try { const n = toNum(document.querySelector(c.balanceSelector)?.textContent); if (n >= 0) return n; } catch {}
    }
    return c.budget > 0 ? c.budget : NaN;
  }
  // Prix de l'offre : le nombre qui suit le libellé (« Mise actuelle », « Prix de départ »…) dans la carte
  function offerPrice(a) {
    for (const l of a.querySelectorAll("span")) {
      if (/mise|prix|d[ée]part/i.test(l.textContent) && !l.firstElementChild?.matches?.("span")) {
        const n = toNum(l.nextElementSibling?.textContent);
        if (n >= 0) return n;
      }
    }
    return NaN;
  }
  function hideBox(a) {   // remonte tant que le parent ne contient que cette carte (évite un trou dans la grille)
    let el = a;
    for (let i = 0; i < 3 && el.parentElement && el.parentElement !== document.body
         && el.parentElement.querySelectorAll("a[href]").length === 1; i++) el = el.parentElement;
    return el;
  }
  function filterAffordable() {
    document.querySelectorAll("[data-wm-hide]").forEach(el => el.removeAttribute("data-wm-hide"));
    if (!c.affordableOnly || onCollectionPage()) return;
    const bal = myBalance();
    if (isNaN(bal)) return;
    for (const a of document.querySelectorAll("a[href]")) {
      const p = offerPrice(a);
      if (p > bal) hideBox(a).setAttribute("data-wm-hide", "1");
    }
  }

  // Interrupteur intégré à l'interface du marketplace (synchronisé avec l'option du popup)
  function ensureSwitch() {
    let sw = document.getElementById("wm-afford-switch");
    if (!/^\/marketplace\/?$/.test(location.pathname)) { sw?.remove(); return; }
    if (!sw) {
      sw = document.createElement("label");
      sw.id = "wm-afford-switch";
      sw.innerHTML = '<input type="checkbox"><span class="wm-track"><i></i></span><span class="wm-txt">Dans mes moyens</span>';
      sw.querySelector("input").addEventListener("change", e => {
        c.affordableOnly = e.target.checked;
        chrome.storage.local.set({ affordableOnly: c.affordableOnly });
        filterAffordable();
        updateSwitchTitle();
      });
    }
    const host = document.querySelector("main select")?.parentElement;
    sw.classList.toggle("wm-float", !host);
    const target = host || document.body;
    if (sw.parentElement !== target) target.appendChild(sw);
    sw.querySelector("input").checked = !!c.affordableOnly;
    updateSwitchTitle();
  }
  function updateSwitchTitle() {
    const sw = document.getElementById("wm-afford-switch");
    if (!sw) return;
    const bal = myBalance();
    sw.title = isNaN(bal) ? "Solde introuvable : renseigne-le dans la configuration avancée"
                          : `Masque les offres au-dessus de ${bal} wikibidous`;
  }

  function refresh() {
    if (onCollectionPage()) learnFromCollection();
    scanPulls();
    updateBadge();
    markLinks();
    filterAffordable();
    ensureSwitch();
  }

  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(refresh, 300); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; refresh(); } }, 500);

  chrome.storage.local.get(CDEF, s => {
    c = { ...CDEF, ...s };
    owned = new Set(c.owned);
    counts = { ...c.counts };
    log(`${owned.size} carte(s) connues`);
    refresh();
  });

  chrome.storage.onChanged.addListener(ch => {
    for (const [k, { newValue }] of Object.entries(ch)) {
      if (k === "owned") {
        if (!newValue || !newValue.length) { owned.clear(); counts = {}; newThisSession.clear(); }
        else for (const id of newValue) owned.add(id);
      } else if (k === "counts") {
        const local = {};
        for (const id of touched) local[id] = counts[id];   // garde les modifs pas encore enregistrées
        counts = { ...(newValue || {}), ...local };
      } else if (k in CDEF) c[k] = newValue;
    }
    clearTimeout(t); t = setTimeout(refresh, 100);
  });
})();
