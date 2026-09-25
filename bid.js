// ===== Wiki-Masters Auto Pack - renchère automatique =====
// Sur la page d'une enchère (/marketplace/<id>) : plafond de mise + renchère auto au minimum requis.
// Nécessite que l'onglet reste ouvert. Mode simulation activé par défaut (ne clique pas sur « Miser »).
(() => {
  const ID_RE = /^\/marketplace\/([^/?#]+)\/?$/;
  const CHECK_MS = 1500;
  const VERIFY_MS = 8000;      // délai pour constater qu'une mise a bien été prise en compte
  const STALE_RELOAD_MS = 30000;
  const MAX_FAILS = 3;

  let bids = {};               // id -> { max, on, last, at, fails }
  let opts = { bidDryRun: true, bidSnipe: 0 };
  let lastCur = null, lastChange = Date.now();
  let status = "";

  const toNum = t => { const m = String(t || "").replace(/[\s  ]/g, "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
  const listingId = () => (location.pathname.match(ID_RE) || [])[1] || null;
  const save = () => { try { chrome.storage.local.set({ autoBids: bids }); } catch {} };
  const log = (ok, msg) => {
    try { chrome.runtime.sendMessage({ type: "log", ok, name: document.querySelector("main h1")?.textContent?.trim() || "Enchère", msg }); } catch {}
  };

  // "1h 2m", "21m 03s", "2s" -> secondes ; NaN si terminée / illisible
  function parseDuration(txt) {
    if (!txt || /termin/i.test(txt)) return NaN;
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
    return {
      cur, min: toNum(minEl?.textContent), bal: toNum(balEl?.firstElementChild?.textContent),
      timeTxt: timeEl?.textContent || "", input, button
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
    if (!a || !a.on) { setStatus(a?.max ? "Renchère désactivée" : ""); return; }

    const p = readPage();
    if (!p || isNaN(p.cur)) return;
    if (p.cur !== lastCur) { lastCur = p.cur; lastChange = Date.now(); }

    const left = parseDuration(p.timeTxt);
    if (isNaN(left)) { setStatus("Enchère terminée"); a.on = false; save(); log(true, `renchère arrêtée : enchère terminée (mise finale ${p.cur})`); return; }

    // Ma mise a-t-elle été prise en compte ?
    if (a.last) {
      if (p.cur >= a.last) { /* je mène (ou surenchéri : géré plus bas) */ }
      else if (Date.now() - a.at > VERIFY_MS) {
        a.fails = (a.fails || 0) + 1; a.last = 0;
        if (a.fails >= MAX_FAILS) { a.on = false; save(); setStatus("Échec de mise, arrêt"); log(false, `renchère arrêtée : ${MAX_FAILS} mises non prises en compte`); return; }
        save();
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
    if (opts.bidDryRun) {
      a.last = 0;
      setStatus(`Simulation : miserait ${next}`);
      if (a.simFor !== p.cur) {   // une seule ligne de log par état de l'enchère
        a.simFor = p.cur;
        log(true, `simulation : aurait misé ${next} (max ${a.max}, actuelle ${p.cur})`);
      }
    } else {
      a.last = next;
      placeBid(p, next);
      setStatus(`Mise de ${next} envoyée`);
      log(true, `mise de ${next} envoyée (max ${a.max}, actuelle ${p.cur})`);
    }
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
    #wm-bid.wm-real { border-left-color: #dc2626; }
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
        <label><span>Simulation</span><input type="checkbox" id="wm-bid-dry"></label>
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
        cur.on = e.target.checked; cur.fails = 0; cur.last = 0; save();
        log(true, cur.on ? `renchère activée, max ${cur.max}${opts.bidDryRun ? " (simulation)" : ""}` : "renchère désactivée");
      });
      $("#wm-bid-dry").addEventListener("change", e => {
        if (!e.target.checked && !confirm("Désactiver la simulation ? Les mises seront réellement envoyées (wikibidous débités).")) { e.target.checked = true; return; }
        opts.bidDryRun = e.target.checked;
        chrome.storage.local.set({ bidDryRun: opts.bidDryRun });
      });
    }
    const a = bids[id] || {};
    const set = (s, fn) => { const n = el.querySelector(s); if (document.activeElement !== n) fn(n); };
    set("#wm-bid-max", n => n.value = a.max || "");
    set("#wm-bid-snipe", n => n.value = opts.bidSnipe);
    set("#wm-bid-on", n => n.checked = !!a.on);
    set("#wm-bid-dry", n => n.checked = !!opts.bidDryRun);
    el.classList.toggle("wm-real", !opts.bidDryRun);
  }
  function setStatus(s) {
    if (s === status) return;
    status = s;
    const n = document.getElementById("wm-bid-st");
    if (n) n.textContent = s;
  }

  chrome.storage.local.get({ autoBids: {}, bidDryRun: true, bidSnipe: 0 }, s => {
    bids = s.autoBids || {};
    opts = { bidDryRun: s.bidDryRun, bidSnipe: s.bidSnipe };
    setInterval(tick, CHECK_MS);
    tick();
  });
})();
