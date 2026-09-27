// ===== Wiki-Masters Auto Pack - scan complet de la collection =====
// Lancé à la main depuis la page collection : revient à la page 1, lit les cartes de chaque page
// (titre, rareté, quantité si affichée) en cliquant sur « Suivant », puis enregistre un instantané
// que le service worker envoie à l'API (il y remplace le précédent).
// Les cartes du site ne sont pas des liens : une carte est identifiée par son titre.
(() => {
  const SDEF = { collectionPath: "/collection" };
  const MAX_DURATION = 15 * 60_000;
  const MAX_PAGES = 2000;
  const PAGE_WAIT_MS = 10_000;               // délai max pour qu'une nouvelle page s'affiche
  const PAGE_RE = /^Page\s+(\d+)\s*\/\s*(\d+)$/i;
  const QTY_RE = /^[x×]\s?(\d{1,4})$/i;
  const RARITY_KEYS = ["C", "PC", "R", "SR", "UR", "L"];

  let s = { ...SDEF };
  let running = false, stopAsked = false;

  const log = (...a) => console.log("%c[Scan]", "color:#0ea5e9;font-weight:bold", ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const onCollectionPage = () => location.pathname.startsWith(s.collectionPath);
  const text = el => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const ownUi = el => el.closest("#wm-scan-panel, #wm-summary, #wm-pull-toast");

  // --- Lecture d'une page ---
  function cardElements() {
    const main = document.querySelector("main") || document.body;
    const cards = new Set();
    for (const h3 of main.querySelectorAll("h3")) {
      const card = h3.closest('[class*="glow-"]') || h3.closest(".rounded-2xl");
      if (card && !ownUi(card)) cards.add(card);
    }
    return [...cards];
  }

  function rarityOf(card) {
    const glow = [...card.classList].map(c => c.match(/^glow-([a-z]+)$/)?.[1]?.toUpperCase()).find(k => RARITY_KEYS.includes(k));
    if (glow) return glow;
    for (const el of card.querySelectorAll("div, span")) {            // badge « L », « UR »…
      if (!el.childElementCount && RARITY_KEYS.includes(text(el).toUpperCase())) return text(el).toUpperCase();
    }
    return null;
  }

  function readCard(card) {
    const name = text(card.querySelector("h3"));
    if (!name) return null;
    let qty = 1;
    for (const el of card.querySelectorAll("div, span, p")) {
      const m = !el.childElementCount && text(el).match(QTY_RE);
      if (m) { qty = parseInt(m[1], 10); break; }
    }
    return { id: name.toLowerCase().slice(0, 200), name: name.slice(0, 200), qty, rarity: rarityOf(card) };
  }

  const readPage = () => cardElements().map(readCard).filter(Boolean);
  const signature = cards => cards.map(c => c.id).join("|");

  // --- Pagination « ← Précédent · Page X / Y · Suivant → » ---
  function pager() {
    const label = [...document.querySelectorAll("main span, main div, main p")]
      .find(el => !el.childElementCount && PAGE_RE.test(text(el)));
    if (!label) return null;
    const [, page, pages] = text(label).match(PAGE_RE);
    const buttons = [...(label.parentElement?.querySelectorAll("button") || [])];
    return {
      page: +page, pages: +pages,
      prev: buttons.find(b => /précédent|previous/i.test(text(b))),
      next: buttons.find(b => /suivant|next/i.test(text(b)))
    };
  }

  // Clique puis attend que le numéro de page et les cartes aient changé
  async function turnPage(button, fromPage, fromSig) {
    button.click();
    const end = Date.now() + PAGE_WAIT_MS;
    while (Date.now() < end) {
      await sleep(250);
      if (stopAsked) throw new Error("scan arrêté");
      const p = pager();
      if (p && p.page !== fromPage && signature(readPage()) !== fromSig) {
        await sleep(300);   // laisse finir le rendu
        return p;
      }
    }
    throw new Error(`la page ${fromPage} ne change pas`);
  }

  // --- Panneau ---
  const style = document.createElement("style");
  style.textContent = `
    #wm-scan-panel { position: fixed; left: 20px; bottom: 20px; z-index: 2147483646; display: flex; align-items: center;
      gap: 10px; padding: 10px 12px; border-radius: 12px; background: #1f1a2e; color: #fff;
      font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.4); border-left: 4px solid #0ea5e9; }
    #wm-scan-panel button { border: 0; border-radius: 8px; padding: 7px 12px; font: 600 13px system-ui, sans-serif;
      cursor: pointer; background: #0ea5e9; color: #fff; }
    #wm-scan-panel button.stop { background: #dc2626; }
    #wm-scan-panel .msg { max-width: 280px; }
    @media (max-width: 767px) { #wm-scan-panel { bottom: 90px; left: 10px; right: 10px; } }
  `;
  document.documentElement.appendChild(style);

  function panel() {
    let p = document.getElementById("wm-scan-panel");
    if (!onCollectionPage()) { if (!running) p?.remove(); return null; }
    if (!p) {
      p = document.createElement("div");
      p.id = "wm-scan-panel";
      p.innerHTML = '<span class="msg"></span><button type="button"></button>';
      // Le bouton agit selon ce qu'il affiche : « Arrêter » ne relance jamais un scan
      p.querySelector("button").addEventListener("click", e => {
        const b = e.currentTarget;
        if (b.dataset.mode === "stop") {
          stopAsked = true;
          b.disabled = true;
          p.querySelector(".msg").textContent = "Arrêt en cours…";
        } else if (!running) scan();
      });
      document.body.appendChild(p);
      setPanel("", false);
    }
    return p;
  }
  function setPanel(msg, busy) {
    const p = document.getElementById("wm-scan-panel");
    if (!p) return;
    p.querySelector(".msg").textContent = msg;
    const b = p.querySelector("button");
    if (busy && stopAsked) return;   // garde « Arrêt en cours… » jusqu'à la fin
    b.textContent = busy ? "Arrêter" : "📚 Scanner ma collection";
    b.className = busy ? "stop" : "";
    b.dataset.mode = busy ? "stop" : "start";
    b.disabled = false;
  }

  // Appels à l'extension : impossibles si elle a été rechargée sans recharger la page
  const CONTEXT_LOST = "extension rechargée : recharger la page (F5) puis relancer le scan";
  function sendToExtension(msg) {
    try { chrome.runtime.sendMessage(msg)?.catch?.(() => {}); } catch {}
  }
  function saveScan(cards) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set({ collectionScan: { scannedAt: Date.now(), cards } }, () =>
          chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve());
      } catch { reject(new Error(CONTEXT_LOST)); }
    });
  }

  async function readAllPages(pages) {
    const start = Date.now();
    const check = () => {
      if (stopAsked) throw new Error("scan arrêté");
      if (Date.now() - start > MAX_DURATION) throw new Error("durée maximale dépassée");
    };
    let p = pager();
    if (!p) {
      pages.set(1, readPage());              // pas de pagination : une seule page
      return;
    }
    while (p.page > 1 && p.prev && !p.prev.disabled) {   // retour à la page 1
      check();
      setPanel(`Retour à la page 1… (${p.page}/${p.pages})`, true);
      p = await turnPage(p.prev, p.page, signature(readPage()));
    }
    const lastPage = p.pages;
    while (true) {
      check();
      const cards = readPage();
      pages.set(p.page, cards);
      const total = [...pages.values()].reduce((n, c) => n + c.length, 0);
      setPanel(`Scan : page ${p.page}/${lastPage} · ${total} carte(s)…`, true);
      if (p.page >= lastPage || !p.next || p.next.disabled || pages.size >= MAX_PAGES) break;
      p = await turnPage(p.next, p.page, signature(cards));
    }
    if (pages.size < lastPage) throw new Error(`seulement ${pages.size} page(s) lue(s) sur ${lastPage}`);
  }

  async function scan() {
    if (running) return;
    running = true; stopAsked = false;
    const pages = new Map();                 // n° de page -> cartes lues (chaque page lue une seule fois)
    try {
      await readAllPages(pages);

      // Une carte présente plusieurs fois (exemplaires affichés séparément) : quantité = nombre d'apparitions,
      // sauf si le site affiche lui-même une quantité plus grande (« ×3 »)
      const found = new Map();
      for (const card of [...pages.values()].flat()) {
        const prev = found.get(card.id);
        if (!prev) found.set(card.id, { ...card, seen: 1 });
        else { prev.seen++; prev.qty = Math.max(prev.qty, card.qty); prev.rarity ||= card.rarity; }
      }
      const cards = [...found.values()].map(({ seen, ...c }) => ({ ...c, qty: Math.max(c.qty, seen) }));
      if (!cards.length) throw new Error("aucune carte trouvée sur cette page");

      setPanel(`Enregistrement de ${cards.length} cartes…`, true);
      await saveScan(cards);
      sendToExtension({ type: "stats-sync-now" });

      const copies = cards.reduce((n, c) => n + c.qty, 0);
      const unknown = cards.filter(c => !c.rarity).length;
      const byRarity = RARITY_KEYS.map(k => [k, cards.filter(c => c.rarity === k).length]).filter(([, n]) => n)
        .map(([k, n]) => `${k} ${n}`).join(", ");
      running = false;
      setPanel(`✓ ${cards.length} cartes (${copies} ex.)${unknown ? `, ${unknown} sans rareté` : ""} · envoi à la synchro`, false);
      log(`Scan terminé : ${pages.size} page(s), ${cards.length} cartes, ${copies} exemplaires`);
      sendToExtension({ type: "log", ok: true, name: "Scan collection",
        msg: `${pages.size} page(s), ${cards.length} cartes (${copies} ex.) : ${byRarity}${unknown ? `, ? ${unknown}` : ""}` });
    } catch (e) {
      const msg = /context invalidated/i.test(e.message) ? CONTEXT_LOST : e.message;
      running = false;
      setPanel(`✕ ${msg} : rien n'a été envoyé.`, false);
      log("Scan interrompu :", e);
      sendToExtension({ type: "log", ok: false, name: "Scan collection",
        msg: `${msg} après ${pages.size} page(s), rien n'a été envoyé` });
    } finally {
      running = false;
      stopAsked = false;
      const b = document.querySelector("#wm-scan-panel button");
      if (b?.dataset.mode === "stop") setPanel("Scan terminé.", false);   // filet de sécurité
    }
  }

  chrome.storage.local.get(SDEF, st => {
    s = { ...SDEF, ...st };
    panel();
    if (onCollectionPage() && new URLSearchParams(location.search).has("wmscan")) setTimeout(scan, 1500);
  });
  chrome.storage.onChanged.addListener(ch => {
    for (const k of Object.keys(SDEF)) if (ch[k]) s[k] = ch[k].newValue;
  });
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; panel(); } }, 500);
})();
