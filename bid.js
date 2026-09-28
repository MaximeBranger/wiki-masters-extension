// ===== Wiki-Masters Auto Pack - renchère automatique =====
// Sur la page d'une enchère (/marketplace/<id>) : plafond de mise + renchère auto au minimum requis.
// Nécessite que l'onglet reste ouvert. Les mises sont réelles dès l'activation.
(() => {
  const ID_RE = /^\/marketplace\/([^/?#]+)\/?$/;
  const CHECK_MS = 1500;
  const VERIFY_MS = 8000;      // délai pour constater qu'une mise a bien été prise en compte
  const STALE_RELOAD_MS = 30000;
  const MAX_FAILS = 3;
  const ENDED_CONFIRM_MS = 5000; // la fin doit être constatée pendant 5 s avant d'arrêter la renchère
  const ENDED_KEEP_MS = 7 * 24 * 3600_000;   // réglages des enchères terminées gardés 7 jours

  let bids = {};               // id -> { max, on, last, at, fails }
  let opts = { bidSnipe: 0 };
  let lastCur = null, lastChange = Date.now();
  let endedSince = 0;
  let status = "";

  const toNum = t => { const m = String(t || "").replace(/[\s  ]/g, "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
  const listingId = () => (location.pathname.match(ID_RE) || [])[1] || null;
  const save = () => { try { chrome.storage.local.set({ autoBids: bids }); } catch {} };
  const log = (ok, msg) => {
    try { chrome.runtime.sendMessage({ type: "log", ok, name: document.querySelector("main h1")?.textContent?.trim() || "Enchère", msg }); } catch {}
  };

  // "1h 2m", "Se termine dans 21m 03s", "2s" -> secondes ; NaN si illisible
  function parseDuration(txt) {
    if (!txt) return NaN;
    let s = 0, found = false;
    for (const [, n, u] of txt.matchAll(/(\d+)\s*([jdhms])/gi)) {
      found = true;
      s += parseInt(n, 10) * ({ j: 86400, d: 86400, h: 3600, m: 60, s: 1 })[u.toLowerCase()];
    }
    return found ? s : NaN;
  }

  function readPage() {
    const main = document.querySelector("main");
    if (!main) return null;
    const spans = [...main.querySelectorAll("span")];
    const byLabel = re => spans.find(s => re.test(s.textContent) && !s.querySelector("span"));
    const cur = toNum(byLabel(/^\s*mise actuelle\s*$/i)?.nextElementSibling?.textContent);
    const minEl = spans.find(s => /mise minimum/i.test(s.textContent) && !s.firstElementChild);
    const balEl = spans.find(s => /votre solde/i.test(s.textContent) && s.firstElementChild);
    const timeEl = byLabel(/temps restant/i)?.parentElement?.querySelector("span.tabular-nums");
    const input = main.querySelector('input[aria-label="Montant de la mise"]');
    const button = [...main.querySelectorAll("button")].find(b => b.textContent.trim() === "Miser");
    // Fin explicite : « Terminée » à la place du temps restant, ou message de fin dans la page
    const timeTxt = timeEl?.textContent || "";
    const ended = (/termin/i.test(timeTxt) && !/dans/i.test(timeTxt)) ||
      [...main.querySelectorAll("p, span, div, h2, h3")].some(el => !el.childElementCount &&
        /^(cette |l'|l’)?(enchère|vente) (est )?(terminée|clôturée|expirée)|^enchère terminée|a pris fin/i.test(el.textContent.trim()));
    return {
      cur, min: toNum(minEl?.textContent), bal: toNum(balEl?.firstElementChild?.textContent),
      timeTxt, ended, input, button
    };
  }

  function placeBid(page, amount) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(page.input, String(amount));
    page.input.dispatchEvent(new Event("input", { bubbles: true }));
    page.input.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => page.button.click(), 250);   // laisse React prendre la valeur en compte
  }

  function tick() {
    const id = listingId();
    ensurePanel(id);
    if (!id) return;
    const a = bids[id];
    if (!a || !a.on) { setStatus(a?.endedAt ? "Enchère terminée" : a?.max ? "Renchère désactivée" : ""); return; }

    const p = readPage();
    if (!p || isNaN(p.cur)) return;
    if (p.cur !== lastCur) { lastCur = p.cur; lastChange = Date.now(); }

    // Page pas encore chargée (après une actualisation) : on attend, sans rien désactiver
    const left = parseDuration(p.timeTxt);
    if (p.ended) {
      endedSince ||= Date.now();
      if (Date.now() - endedSince < ENDED_CONFIRM_MS) { setStatus("Fin d'enchère détectée, vérification…"); return; }
      a.on = false; a.endedAt = Date.now(); save();
      setStatus("Enchère terminée");
      log(true, `renchère arrêtée : enchère terminée (mise finale ${p.cur})`);
      return;
    }
    endedSince = 0;
    if (isNaN(left)) { setStatus(`Renchère active (max ${a.max}) · lecture du temps restant…`); return; }

    // Ma mise a-t-elle été prise en compte ?
    if (a.last) {
      if (p.cur >= a.last) { /* je mène (ou surenchéri : géré plus bas) */ }
      else if (Date.now() - a.at > VERIFY_MS) {
        a.fails = (a.fails || 0) + 1; a.last = 0;
        if (a.fails >= MAX_FAILS) { a.on = false; save(); setStatus("Échec de mise, arrêt"); log(false, `renchère arrêtée : ${MAX_FAILS} mises non prises en compte`); return; }
        save();
      } else {
        // Mise envoyée pas encore visible : on attend, sans renvoyer la même mise
        setStatus(`Mise de ${a.last} envoyée, en attente de confirmation…`);
        return;
      }
    }
    if (a.last && p.cur === a.last) { setStatus(`Je mène à ${p.cur}`); staleReload(left); return; }

    const next = p.min;
    if (isNaN(next)) return;
    if (next > a.max) { a.on = false; save(); setStatus(`Plafond atteint (${a.max})`); log(true, `plafond atteint : mise minimum ${next} > max ${a.max}`); return; }
    if (next > p.bal) { a.on = false; save(); setStatus("Solde insuffisant"); log(false, `solde insuffisant (${p.bal}) pour miser ${next}`); return; }
    if (opts.bidSnipe > 0 && left > opts.bidSnipe) { setStatus(`Surveille… mise à T-${opts.bidSnipe}s (reste ${left}s)`); staleReload(left); return; }
    if (Date.now() - (a.at || 0) < 3000) return;   // anti double-clic
    if (!p.input || !p.button || p.button.disabled) return;

    a.at = Date.now();
    a.last = next;
    placeBid(p, next);
    setStatus(`Mise de ${next} envoyée`);
    log(true, `mise de ${next} envoyée (max ${a.max}, actuelle ${p.cur})`);
    save();
  }

  // Si la page ne se met pas à jour toute seule, on la recharge de temps en temps
  function staleReload(left) {
    if (Date.now() - lastChange > STALE_RELOAD_MS && left > 3) location.reload();
  }

  // --- Panneau ---
  const style = document.createElement("style");
  style.textContent = `
    #wm-bid { position: fixed; right: 16px; bottom: 76px; z-index: 2147483000; width: 230px; box-sizing: border-box;
      padding: 10px 12px; border-radius: 12px; background: #1f1a2e; color: #fff; font: 12px/1.4 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.4); border-left: 4px solid #8b5cf6; }
    #wm-bid b { display: block; margin-bottom: 6px; font-size: 13px; }
    #wm-bid label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
    #wm-bid input[type=number] { width: 70px; padding: 3px 6px; border-radius: 6px; border: 1px solid #3a3450; background: #16131f; color: #fff; }
    #wm-bid .st { margin-top: 8px; color: #c4b5fd; min-height: 1.4em; }
  `;
  document.documentElement.appendChild(style);

  function ensurePanel(id) {
    let el = document.getElementById("wm-bid");
    if (!id) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "wm-bid";
      el.innerHTML = `<b>🔨 Renchère auto</b>
        <label>Mise max <input type="number" min="1" id="wm-bid-max"></label>
        <label>Miser à T-… s (0 = direct) <input type="number" min="0" id="wm-bid-snipe"></label>
        <label><span>Activer</span><input type="checkbox" id="wm-bid-on"></label>
        <div class="st" id="wm-bid-st"></div>`;
      document.body.appendChild(el);
      const $ = s => el.querySelector(s);
      $("#wm-bid-max").addEventListener("change", e => {
        const cur = bids[listingId()] ||= {};
        cur.max = Math.max(0, parseInt(e.target.value, 10) || 0); save();
      });
      $("#wm-bid-snipe").addEventListener("change", e => {
        opts.bidSnipe = Math.max(0, parseInt(e.target.value, 10) || 0);
        chrome.storage.local.set({ bidSnipe: opts.bidSnipe });
      });
      $("#wm-bid-on").addEventListener("change", e => {
        const cur = bids[listingId()] ||= {};
        if (e.target.checked && !(cur.max > 0)) { e.target.checked = false; setStatus("Renseigne d'abord une mise max"); return; }
        cur.on = e.target.checked; cur.fails = 0; cur.last = 0; delete cur.endedAt; save();
        log(true, cur.on ? `renchère activée, max ${cur.max}` : "renchère désactivée");
      });
    }
    const a = bids[id] || {};
    const set = (s, fn) => { const n = el.querySelector(s); if (document.activeElement !== n) fn(n); };
    set("#wm-bid-max", n => n.value = a.max || "");
    set("#wm-bid-snipe", n => n.value = opts.bidSnipe);
    set("#wm-bid-on", n => n.checked = !!a.on);
  }
  function setStatus(s) {
    if (s === status) return;
    status = s;
    const n = document.getElementById("wm-bid-st");
    if (n) n.textContent = s;
  }

  chrome.storage.local.remove("bidDryRun");   // ancienne option (mode simulation retiré)
  chrome.storage.local.get({ autoBids: {}, bidSnipe: 0 }, s => {
    bids = s.autoBids || {};
    // Purge des enchères terminées depuis plus de 7 jours
    const now = Date.now();
    const kept = Object.fromEntries(Object.entries(bids).filter(([, b]) => !(b.endedAt && now - b.endedAt > ENDED_KEEP_MS)));
    if (Object.keys(kept).length !== Object.keys(bids).length) { bids = kept; save(); }
    opts = { bidSnipe: s.bidSnipe };
    setInterval(tick, CHECK_MS);
    tick();
  });

  // Réglages modifiés dans un autre onglet (ou par la popup) : on les reprend
  chrome.storage.onChanged.addListener(ch => {
    if (ch.autoBids) bids = ch.autoBids.newValue || {};
    if (ch.bidSnipe) opts.bidSnipe = ch.bidSnipe.newValue;
  });
})();
