// ===== Wiki-Masters Auto Pack - mise en vente / relance =====
// Ne fait rien sauf si l'URL contient ?wmsell=1 (page de carte) ou ?wmrelist=1 (page "mes ventes").
(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.has("wmsell") ? "sell" : params.has("wmrelist") ? "relist" : null;
  if (!mode) return;

  const SDEF = {
    dryRun: true,
    avgPrice: "texte:prix moyen,moyenne,average",
    sellButton: "texte:vendre,mettre en vente,sell",
    priceInput: "input[type=number]",
    confirmButton: "texte:confirmer,valider,mettre en vente,confirm",
    priceMultiplier: 1,
    minPrice: 1,
    qtySelector: "",
    keepMin: 1,
    expiredKeywords: "expirée,expiré,non vendue,expired",
    rowSelector: "",
    reclaimButton: "",
    cardPattern: "/cards?/([^/?#]+)"
  };
  let c;
  const log = (...a) => console.log("%c[Vente]", "color:#f59e0b;font-weight:bold", ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let reported = false;
  const report = (ok, msg, extra = {}) => {
    if (reported) return; reported = true;
    log(ok ? "OK" : "ÉCHEC", msg);
    chrome.runtime.sendMessage({ type: mode === "sell" ? "sell-done" : "relist-done", ok, msg, ...extra });
  };

  async function waitFor(fn, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const r = fn(); if (r) return r; await sleep(300); }
    return null;
  }
  function isVisible(el) {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }
  // "spec" = sélecteur CSS, ou "texte:mot1,mot2" pour chercher un bouton par son texte
  function find(spec, { root = document, exclude = null } = {}) {
    spec = (spec || "").trim(); if (!spec) return null;
    let els;
    if (spec.startsWith("texte:")) {
      const words = spec.slice(6).split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
      els = [...root.querySelectorAll("button, [role='button'], a, input[type=submit]")].filter(el => {
        const t = (el.innerText || el.value || "").trim().toLowerCase();
        return t && t.length < 60 && words.some(w => t.includes(w));
      });
    } else {
      try { els = [...root.querySelectorAll(spec)]; } catch { return null; }
    }
    return els.find(el => el !== exclude && !el.disabled && isVisible(el)) || null;
  }
  // Cherche d'abord dans une fenêtre modale ouverte
  function findPreferDialog(spec, exclude) {
    const dialogs = [...document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open], .modal")].filter(isVisible);
    for (const d of dialogs.reverse()) { const r = find(spec, { root: d, exclude }); if (r) return r; }
    return find(spec, { exclude });
  }

  function parseNumber(text) {
    const m = (text || "").replace(/[\u202f\u00a0]/g, " ").match(/\d[\d .,]*/);
    if (!m) return null;
    let s = m[0].trim().replace(/ /g, "");
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function getAvgPrice() {
    const spec = c.avgPrice.trim();
    if (!spec.startsWith("texte:")) {
      try { const el = document.querySelector(spec); return el ? parseNumber(el.innerText || el.textContent) : null; }
      catch { return null; }
    }
    const words = spec.slice(6).split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const txt = walker.currentNode.textContent.toLowerCase();
      const w = words.find(w => txt.includes(w));
      if (!w) continue;
      // nombre après le mot-clé, dans l'élément puis dans ses parents proches
      let el = walker.currentNode.parentElement;
      for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
        const t = (el.innerText || "").toLowerCase();
        const idx = t.indexOf(w);
        const n = parseNumber(idx >= 0 ? t.slice(idx + w.length) : t);
        if (n != null) return n;
      }
    }
    return null;
  }

  function setInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, String(value)); // compatible React/Vue
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---------- Mise en vente d'une carte ----------
  async function sell() {
    await sleep(2500);   // laisse la page se charger (rendu JS)
    const avg = await waitFor(getAvgPrice, 10000);
    if (!avg) return report(false, "prix moyen introuvable");

    if (c.qtySelector.trim()) {
      let qty = null;
      try { const el = document.querySelector(c.qtySelector); qty = el ? parseNumber(el.innerText) : null; } catch {}
      if (qty != null && qty <= c.keepMin) return report(false, `seulement ${qty} exemplaire(s), conservé`);
    }

    const price = Math.round(avg * c.priceMultiplier);
    if (price < c.minPrice) return report(false, `prix calculé ${price} < minimum ${c.minPrice}`);

    const sellBtn = await waitFor(() => find(c.sellButton), 8000);
    if (!sellBtn) return report(false, "bouton de vente introuvable");
    sellBtn.click();

    const input = await waitFor(() => findPreferDialog(c.priceInput), 8000);
    if (!input) return report(false, "champ de prix introuvable");
    input.focus();
    setInputValue(input, price);
    await sleep(600);

    const confirm = await waitFor(() => findPreferDialog(c.confirmButton, sellBtn), 6000);
    if (!confirm) return report(false, "bouton de confirmation introuvable");

    if (c.dryRun) {
      confirm.style.outline = "4px solid #f59e0b";
      return report(true, `SIMULATION : aurait vendu à ${price} (moy. ${avg})`, { price, dry: true });
    }
    confirm.click();
    await sleep(2500);
    report(true, `mise en vente à ${price} (moy. ${avg})`, { price });
  }

  // ---------- Détection des ventes expirées ----------
  async function relist() {
    await sleep(3500);
    const words = c.expiredKeywords.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
    const rowSel = c.rowSelector.trim() ||
      "tr, li, article, [class*='row'], [class*='item'], [class*='listing'], [class*='card']";
    const cardRe = new RegExp(c.cardPattern);
    const isCardLink = a => { try { return cardRe.test(new URL(a.href).pathname); } catch { return false; } };

    const rows = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const txt = walker.currentNode.textContent.toLowerCase();
      if (!words.some(w => txt.includes(w))) continue;
      // remonte jusqu'à la "ligne" qui contient un lien de carte
      let el = walker.currentNode.parentElement?.closest(rowSel);
      while (el && ![...el.querySelectorAll("a[href]")].some(isCardLink)) el = el.parentElement?.closest(rowSel);
      if (el) rows.add(el);
    }

    const items = [];
    for (const row of rows) {
      const link = [...row.querySelectorAll("a[href]")].find(isCardLink);
      if (!link) continue;
      if (c.reclaimButton.trim() && !c.dryRun) {
        const b = find(c.reclaimButton, { root: row });
        if (b) {
          b.click(); await sleep(1500);
          const ok = findPreferDialog(c.confirmButton, b);
          if (ok) { ok.click(); await sleep(1500); }
        }
      }
      const name = (link.innerText || link.querySelector("img")?.alt || link.pathname).trim().split("\n")[0];
      items.push({ href: link.href, name, reason: "relance" });
    }
    report(true, `${items.length} vente(s) expirée(s) trouvée(s)`, { items });
  }

  chrome.storage.local.get(SDEF, s => {
    c = { ...SDEF, ...s };
    (mode === "sell" ? sell() : relist()).catch(e => report(false, "erreur : " + e.message));
  });
})();
