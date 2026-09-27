// ===== Wiki-Masters Auto Pack - content script =====
const DEFAULTS = {
  enabled: true,
  selector: "",                          // sélecteur CSS précis (prioritaire si rempli)
  keywords: "ouvrir,open,claim,récupérer",// textes des boutons à cliquer
  minDelay: 800,                         // délai aléatoire avant clic (ms)
  maxDelay: 2000,
  reloadMinutes: 0,                      // recharger /pulls toutes les N min (0 = jamais)
  autoReveal: true,                      // faire défiler les cartes après l'ouverture
  nextButton: "",                        // sélecteur du bouton "suivant" (vide = flèche droite)
  revealMinDelay: 500,
  revealMaxDelay: 1100,
  autoContinue: true,                    // cliquer sur "Continuer" après la dernière carte
  continueButton: "",                    // sélecteur (vide = bouton dont le texte est "Continuer")
  showSummary: true,                     // encart récap en bas à droite sur /pulls
  rarityZone: "",                        // sélecteur de l'élément affichant rareté/vues (optionnel)
  testHumanCheck: false,                 // TEST dev : valider la modale « Vérification rapide »
  opened: 0,
  rarityCounts: {},                      // { C, PC, R, SR, UR, L, "?" }
  lastPack: [],
  packLimitUntil: 0                      // limite quotidienne : pas d'ouverture auto avant cette date (ms)
};

let cfg = { ...DEFAULTS };
let busy = false;
let revealing = false;
let reloadTimer = null;

const log = (...a) => console.log("%c[AutoPack]", "color:#8b5cf6;font-weight:bold", ...a);
const onPullsPage = () => location.pathname.startsWith("/pulls");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

function isClickable(el) {
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
  if (el.classList.contains("disabled")) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"
         && s.pointerEvents !== "none";
}

// Refuse tout élément qui ouvrirait un nouvel onglet ou une autre page
function isSafeToClick(el) {
  const a = el.closest("a[href]");
  if (!a) return !el.closest("[target='_blank']");
  if (a.target && a.target !== "_self") return false;
  try { return new URL(a.href).origin === location.origin && new URL(a.href).pathname === location.pathname; }
  catch { return false; }
}

// Est-ce que cet élément (ou un parent) est un bouton d'ouverture de pack ?
// Exposé pour collection.js (les content scripts partagent le même "monde").
function matchesPackButton(target) {
  if (!target || !target.closest) return false;
  if (cfg.selector.trim()) {
    try { return !!target.closest(cfg.selector); } catch { return false; }
  }
  const el = target.closest("button, [role='button']");
  if (!el || !isSafeToClick(el)) return false;
  const words = cfg.keywords.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
  const t = (el.innerText || el.textContent || "").trim().toLowerCase();
  return !!t && t.length < 60 && words.some(w => t.includes(w));
}
window.__wmMatchesPackButton = matchesPackButton;
window.__wmOnPullsPage = onPullsPage;

// ===================== Raretés =====================
const RARITY_TIERS = [
  { k: "C",  min: 0,     label: "< 50 vues/mois",    color: "#9ca3af" },
  { k: "PC", min: 50,    label: "50+ vues/mois",     color: "#22c55e" },
  { k: "R",  min: 250,   label: "250+ vues/mois",    color: "#3b82f6" },
  { k: "SR", min: 1000,  label: "1 000+ vues/mois",  color: "#a855f7" },
  { k: "UR", min: 5000,  label: "5 000+ vues/mois",  color: "#ef4444" },
  { k: "L",  min: 20000, label: "20 000+ vues/mois", color: "#f59e0b" }
];
const TIER_KEYS = RARITY_TIERS.map(t => t.k);
const rarityFromViews = v => RARITY_TIERS.reduce((r, t) => (v >= t.min ? t.k : r), "C");

// "1 234 vues/mois", "< 50 vues/mois", "1 000+ vues / mois", "12,3k vues/mois" ou un badge "SR"
function parseRarityText(text) {
  const t = (text || "").replace(/[\u00a0\u202f]/g, " ");
  const m = t.match(/(<\s*)?(\d[\d .,]*)\s*([km])?\s*\+?\s*vues?\s*(?:\/|par)\s*mois/i);
  if (m) {
    if (m[1]) return "C";
    const raw = m[2].trim().replace(/ /g, "");
    const mult = { k: 1e3, m: 1e6 }[(m[3] || "").toLowerCase()];
    const v = mult ? parseFloat(raw.replace(",", ".")) * mult : parseInt(raw.replace(/[.,]/g, ""), 10);
    if (!isNaN(v)) return rarityFromViews(v);
  }
  const b = t.trim().toUpperCase();
  return TIER_KEYS.includes(b) ? b : null;
}

const OWN_UI = "#wm-summary, #wm-limit, #wm-pull-toast, #wm-owned-badge";
function rarityCandidates() {
  const out = [], seen = new Set();
  const push = (el, r) => {
    if (!el || seen.has(el) || el.closest(OWN_UI)) return;
    seen.add(el); out.push({ el, r, text: el.innerText });
  };
  const zone = cfg.rarityZone.trim();
  if (zone) {
    try { for (const el of document.querySelectorAll(zone)) { const r = parseRarityText(el.innerText); if (r) push(el, r); } } catch {}
    return out;
  }
  // 1) textes "… vues/mois"
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    if (!/vues?/i.test(w.currentNode.textContent)) continue;
    let el = w.currentNode.parentElement;
    for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
      const r = parseRarityText(el.innerText);
      if (r) { push(el, r); break; }
    }
  }
  // 2) sinon, badges "C", "PC", "R", "SR", "UR", "L"
  if (!out.length) {
    for (const el of document.querySelectorAll("span, div, p, b, strong")) {
      if (el.childElementCount) continue;
      const t = (el.textContent || "").trim().toUpperCase();
      if (t.length <= 2 && TIER_KEYS.includes(t)) push(el, t);
    }
  }
  return out;
}

// Ce qui est déjà affiché avant l'ouverture (légende, etc.) est ignoré
let raritySnapshot = new WeakMap();
function snapshotRarities() {
  raritySnapshot = new WeakMap();
  for (const c of rarityCandidates()) raritySnapshot.set(c.el, c.text);
}
function isShown(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
  if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  return true;
}
const freshCards = () => rarityCandidates().filter(c => raritySnapshot.get(c.el) !== c.text && isShown(c.el));

// Carte affichée au centre du carrousel
function currentCard() {
  const cs = freshCards();
  if (!cs.length) return null;
  const d = c => { const r = c.el.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2); };
  return cs.sort((a, b) => d(a) - d(b))[0];
}
const currentCardRarity = () => currentCard()?.r || null;

// Première carte : attend la fin de l'animation d'ouverture (carte immobile pendant SETTLE_MS)
const SETTLE_MS = 600, SETTLE_MAX_MS = 5000;
async function waitCardSettled() {
  const end = Date.now() + SETTLE_MAX_MS;
  let last = "", since = Date.now();
  while (Date.now() < end) {
    const c = currentCard();
    const r = c?.el.getBoundingClientRect();
    const key = r ? `${c.r}|${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : "";
    if (key !== last) { last = key; since = Date.now(); }
    else if (key && Date.now() - since >= SETTLE_MS) return;
    await sleep(100);
  }
}
// Attend que la rareté de la carte affichée soit lisible avant de poursuivre
const RARITY_WAIT_MS = 10000;
async function readCurrentRarity() {
  const end = Date.now() + RARITY_WAIT_MS;
  while (Date.now() < end) { const r = currentCardRarity(); if (r) return r; await sleep(200); }
  log(`Rareté illisible après ${RARITY_WAIT_MS / 1000} s, carte comptée « ? »`);
  return null;
}

function recordPack(rarities) {
  if (!rarities.length) return;
  chrome.storage.local.get({ rarityCounts: {} }, st => {
    const rc = { ...st.rarityCounts };
    for (const r of rarities) { const k = r || "?"; rc[k] = (rc[k] || 0) + 1; }
    chrome.storage.local.set({ rarityCounts: rc, lastPack: rarities.map(r => r || "?") });
  });
  log("Raretés du pack :", rarities.map(r => r || "?").join(" "));
}

// ===================== Encart récap =====================
const summaryStyle = document.createElement("style");
summaryStyle.textContent = `
  #wm-summary { position: fixed; bottom: 20px; right: 20px; z-index: 2147483646; width: 230px;
    background: #1b1728; color: #eee; border: 1px solid #3a3450; border-radius: 14px;
    font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 10px 28px rgba(0,0,0,.45); overflow: hidden; }
  #wm-summary .wm-hd { display: flex; align-items: center; gap: 6px; padding: 10px 12px;
    background: #241e36; cursor: pointer; user-select: none; font-weight: 600; font-size: 13px; }
  #wm-summary .wm-hd b { margin-left: auto; font-size: 16px; color: #c4b5fd; }
  #wm-summary .wm-reset { color: #888; font-size: 13px; padding: 0 2px; cursor: pointer; }
  #wm-summary .wm-reset:hover { color: #fff; }
  #wm-summary .wm-body { padding: 8px 12px 10px; }
  #wm-summary.min .wm-body { display: none; }
  #wm-summary .wm-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  #wm-summary .wm-tag { width: 28px; text-align: center; border-radius: 6px; padding: 1px 0;
    font-weight: 700; font-size: 11px; color: #fff; flex: none; }
  #wm-summary .wm-lbl { flex: 1; color: #aaa; font-size: 11px; }
  #wm-summary .wm-n { font-weight: 700; min-width: 28px; text-align: right; }
  #wm-summary .wm-pct { color: #777; font-size: 10px; min-width: 34px; text-align: right; }
  #wm-summary .wm-ft { margin-top: 6px; padding-top: 6px; border-top: 1px solid #3a3450; color: #999; font-size: 11px; }
  #wm-summary .wm-last { display: inline-flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  #wm-limit { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; width: 230px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border-radius: 12px;
    background: #3b2a0a; color: #fde68a; border: 1px solid #92400e; font: 12px/1.4 system-ui, sans-serif;
    box-shadow: 0 10px 28px rgba(0,0,0,.45); }
  #wm-limit span:first-child { font-weight: 700; color: #fbbf24; }
  #wm-limit b { color: #fff; font-variant-numeric: tabular-nums; }
  #wm-limit button { align-self: flex-start; margin-top: 3px; padding: 3px 8px; border: 1px solid #92400e; border-radius: 6px;
    background: transparent; color: #fde68a; font: 11px system-ui, sans-serif; cursor: pointer; }
  #wm-limit button:hover { background: #92400e; color: #fff; }
  #wm-summary .wm-last span { padding: 0 5px; border-radius: 4px; font-size: 10px; font-weight: 700; color: #fff; }
`;
document.documentElement.appendChild(summaryStyle);

function renderSummary() {
  let el = document.getElementById("wm-summary");
  if (!cfg.showSummary || !onPullsPage()) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "wm-summary";
    el.addEventListener("click", e => {
      if (e.target.closest(".wm-reset")) {
        e.stopPropagation();
        if (confirm("Remettre le récap à zéro ?")) chrome.storage.local.set({ opened: 0, rarityCounts: {}, lastPack: [] });
      } else if (e.target.closest(".wm-hd")) el.classList.toggle("min");
    });
    document.body.appendChild(el);
  }
  const rc = cfg.rarityCounts || {};
  const total = TIER_KEYS.reduce((a, k) => a + (rc[k] || 0), 0) + (rc["?"] || 0);
  const color = k => RARITY_TIERS.find(t => t.k === k)?.color || "#4b5563";
  const rows = RARITY_TIERS.map(t => {
    const n = rc[t.k] || 0;
    return `<div class="wm-row"><span class="wm-tag" style="background:${t.color}">${t.k}</span>` +
      `<span class="wm-lbl">${t.label}</span><span class="wm-n">${n}</span>` +
      `<span class="wm-pct">${total ? (n / total * 100).toFixed(1) + "%" : ""}</span></div>`;
  }).join("");
  const last = (cfg.lastPack || []).length
    ? `<div>Dernier pack :</div><div class="wm-last">${cfg.lastPack.map(k => `<span style="background:${color(k)}">${k}</span>`).join("")}</div>`
    : "";
  el.innerHTML =
    `<div class="wm-hd">🎴 Packs ouverts <span class="wm-reset" title="Remettre à zéro">↺</span><b>${cfg.opened || 0}</b></div>` +
    `<div class="wm-body">${rows}<div class="wm-ft">${total} carte(s)` +
    (rc["?"] ? ` · ${rc["?"]} non identifiée(s)` : "") + `${last ? "<br>" + last : ""}</div></div>`;
}
let lastPath = "";
setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; renderSummary(); renderLimit(); } }, 700);

// ----- Bouton "carte suivante" (flèche droite du carrousel) -----
const NEXT_POINTS = "9 18 15 12 9 6";
// Chevron droit : ancienne icône (polyline), icône Lucide récente (path), ou libellé accessible
function looksLikeNext(b) {
  return !!b.querySelector(`polyline[points="${NEXT_POINTS}"], path[d="m9 18 6-6-6-6"], svg.lucide-chevron-right`)
    || /^(suivant|carte suivante|next)$/i.test((b.getAttribute("aria-label") || "").trim());
}
function findNextButton() {
  let els = [];
  const sel = cfg.nextButton.trim();
  if (sel) { try { els = [...document.querySelectorAll(sel)]; } catch {} }
  else els = [...document.querySelectorAll("button")].filter(looksLikeNext);
  return els.find(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null;
}
function isNextButton(target) {
  const b = target?.closest?.("button");
  if (!b) return false;
  const sel = cfg.nextButton.trim();
  if (sel) { try { return b.matches(sel); } catch { return false; } }
  return looksLikeNext(b);
}
window.__wmIsNextButton = isNextButton;

// ----- Bouton "Continuer" (fin de l'ouverture) -----
function findContinueButton() {
  let els = [];
  const sel = cfg.continueButton.trim();
  if (sel) { try { els = [...document.querySelectorAll(sel)]; } catch {} }
  else els = [...document.querySelectorAll("button")]
    .filter(b => (b.innerText || b.textContent || "").trim().toLowerCase() === "continuer");
  return els.find(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled; }) || null;
}

async function clickContinue() {
  if (!cfg.autoContinue) return;
  await sleep(800);                                      // laisse le temps de capter la dernière carte
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const btn = findContinueButton();
    if (btn) {
      await sleep(rand(cfg.revealMinDelay, cfg.revealMaxDelay));
      btn.click();
      log("Clic sur « Continuer »");
      await sleep(1000);
      return;
    }
    await sleep(300);
  }
  log("Bouton « Continuer » introuvable");
}

async function revealCards() {
  const start = Date.now();
  let lastAction = Date.now();
  let steps = 0;
  const packRarities = [];
  while (Date.now() - start < 120000 && steps < 100) {
    const btn = findNextButton();
    if (btn && !btn.disabled) {
      if (steps === 0) {                                // 1re carte : laisser finir l'animation, puis la montrer
        await waitCardSettled();
        await sleep(rand(cfg.revealMinDelay, cfg.revealMaxDelay));
      }
      packRarities.push(await readCurrentRarity());    // carte affichée avant de passer à la suivante
      btn.click();
      steps++;
      lastAction = Date.now();
      await sleep(rand(cfg.revealMinDelay, cfg.revealMaxDelay));
      continue;
    }
    if (btn && btn.disabled && steps > 0) break;       // dernière carte atteinte
    if (Date.now() - lastAction > 6000) break;         // pas de carrousel
    await sleep(300);
  }
  if (steps > 0) packRarities.push(await readCurrentRarity());   // dernière carte
  else {
    // Pas de carrousel : toutes les cartes sont visibles d'un coup
    const all = freshCards();
    packRarities.push(...(all.length ? all.map(c => c.r) : [await readCurrentRarity()]));
  }
  recordPack(packRarities);
  log(`Défilement terminé : ${steps} carte(s) passée(s)`);
  await clickContinue();
  return packRarities;
}

function newUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;   // UUID v4
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ----- Limite quotidienne : « Limite quotidienne de paquets atteinte. Réessayez plus tard. » -----
// La date du prochain essai est enregistrée : elle survit à l'actualisation et vaut pour tous les onglets.
const LIMIT_PAUSE_MS = 30 * 60 * 1000;         // nouvel essai d'ouverture auto après 30 min
const limitActive = () => Date.now() < (cfg.packLimitUntil || 0);
function setLimitPause(until) {
  cfg.packLimitUntil = until;
  chrome.storage.local.set({ packLimitUntil: until });
  renderLimit();
}

function fmtDelay(ms) {
  const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// Compte à rebours au-dessus de l'encart récap
let limitTimer = null;
function renderLimit() {
  let el = document.getElementById("wm-limit");
  const until = cfg.packLimitUntil || 0;
  if (until && Date.now() >= until) {        // pause écoulée : nouvel essai
    cfg.packLimitUntil = 0;
    chrome.storage.local.set({ packLimitUntil: 0 });
    tryOpen();
  }
  if (!limitActive() || !onPullsPage()) {
    el?.remove();
    clearInterval(limitTimer); limitTimer = null;
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "wm-limit";
    el.innerHTML = '<span>⏸ Limite quotidienne</span><span>Prochaine tentative dans <b></b></span><button type="button">Réessayer maintenant</button>';
    el.querySelector("button").addEventListener("click", () => { setLimitPause(0); tryOpen(); });
    document.body.appendChild(el);
  }
  const at = new Date(cfg.packLimitUntil).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  el.querySelector("b").textContent = `${fmtDelay(cfg.packLimitUntil - Date.now())} (à ${at})`;
  const summary = document.getElementById("wm-summary");
  el.style.bottom = `${summary ? summary.offsetHeight + 28 : 20}px`;
  limitTimer ||= setInterval(renderLimit, 1000);
}

function dailyLimitShown() {
  return [...document.querySelectorAll("div, p, span")].some(el =>
    !el.childElementCount && /limite quotidienne/i.test(el.textContent || "") && isShown(el));
}

// Ouverture d'un pack (auto ou manuelle) : comptée seulement si le site l'accepte
async function openPack() {
  revealing = true;
  try {
    await sleep(1200);                                   // animation d'ouverture du pack
    if (dailyLimitShown()) {
      setLimitPause(Date.now() + LIMIT_PAUSE_MS);
      log(`Limite quotidienne atteinte : pack non compté, ouverture auto en pause ${LIMIT_PAUSE_MS / 60000} min`);
      return;
    }
    cfg.opened = (cfg.opened || 0) + 1;
    chrome.storage.local.set({ opened: cfg.opened });
    // Journal pour la synchro des stats : un UUID par pack, indépendant du compteur remis à zéro.
    // Rien ici ne doit empêcher le défilement des cartes.
    const t = Date.now();
    let rarities = [];
    try {
      if (cfg.autoReveal) rarities = await revealCards();
    } finally {
      try { chrome.runtime.sendMessage({ type: "pack-opened", pack: { id: newUuid(), t, rarities } }); }
      catch (e) { log("Pack non journalisé pour la synchro :", e); }
    }
  } finally {
    revealing = false;
  }
}

document.addEventListener("click", e => {
  if (!onPullsPage() || !matchesPackButton(e.target) || e.target.closest(OWN_UI) || revealing) return;
  snapshotRarities();                        // avant que le site n'affiche les cartes
  openPack();
}, true);

function findPackButtons() {
  let candidates;
  if (cfg.selector.trim()) {
    try { candidates = [...document.querySelectorAll(cfg.selector)]; }
    catch (e) { log("Sélecteur invalide :", cfg.selector); return []; }
  } else {
    const words = cfg.keywords.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
    candidates = [...document.querySelectorAll("button, [role='button']")]
      .filter(el => {
        const t = (el.innerText || el.textContent || "").trim().toLowerCase();
        return t && t.length < 60 && words.some(w => t.includes(w));
      });
  }
  return candidates.filter(el => isClickable(el) && isSafeToClick(el));
}

// ----- TEST dev : modale anti-robot « Vérification rapide » -----
// Coche la case visible (jamais le champ piège caché "website") puis clique sur « Continuer ».
function findHumanCheck() {
  const title = [...document.querySelectorAll("p")]
    .find(p => (p.textContent || "").trim().toLowerCase() === "vérification rapide");
  const box = title?.parentElement;
  if (!box) return null;
  const checkbox = [...box.querySelectorAll("input[type=checkbox]")]
    .find(i => !i.closest("[aria-hidden='true']") && isShown(i));
  const button = [...box.querySelectorAll("button")]
    .find(b => (b.innerText || b.textContent || "").trim().toLowerCase() === "continuer");
  return checkbox && button ? { checkbox, button } : null;
}

let humanCheckLogged = false;
async function passHumanCheck(hc) {
  if (!cfg.testHumanCheck) {
    if (!humanCheckLogged) log("Vérification anti-robot affichée : en attente de validation manuelle");
    humanCheckLogged = true;
    return;
  }
  humanCheckLogged = false;
  log("[TEST] Vérification anti-robot détectée, validation…");
  await sleep(rand(cfg.minDelay, cfg.maxDelay));
  if (!hc.checkbox.checked) hc.checkbox.click();
  const end = Date.now() + 5000;
  while (Date.now() < end && hc.button.disabled) await sleep(100);
  if (hc.button.disabled) { log("[TEST] « Continuer » reste désactivé après avoir coché la case"); return; }
  await sleep(rand(cfg.revealMinDelay, cfg.revealMaxDelay));
  hc.button.click();
  log("[TEST] Vérification validée");
  await sleep(1500);
}

async function tryOpen() {
  if (!cfg.enabled || busy || revealing || !onPullsPage() || limitActive()) return;
  const hc = findHumanCheck();
  if (hc) {
    busy = true;
    try { await passHumanCheck(hc); } finally { busy = false; }
    return;
  }
  humanCheckLogged = false;
  const buttons = findPackButtons();
  if (!buttons.length) return;

  busy = true;
  try {
    const btn = buttons[0];
    await sleep(rand(cfg.minDelay, cfg.maxDelay));
    if (!isClickable(btn) || !document.contains(btn)) return;
    log("Clic sur :", (btn.innerText || "").trim() || btn);
    btn.click();
    await sleep(800);
    while (revealing) await sleep(300);   // attend la fin du défilement des cartes
    await sleep(1000);
  } finally {
    busy = false;
  }
}

function setupReload() {
  clearInterval(reloadTimer);
  if (cfg.enabled && cfg.reloadMinutes > 0 && onPullsPage()) {
    reloadTimer = setInterval(() => {
      if (!busy && !findPackButtons().length) location.reload();
    }, cfg.reloadMinutes * 60 * 1000);
  }
}

// Réagit aux changements du DOM (pack qui devient disponible, timer qui se termine…)
let debounce;
new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(tryOpen, 300);
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true,
  attributeFilter: ["disabled", "class", "aria-disabled"] });

// Filet de sécurité : vérification régulière
setInterval(tryOpen, 5000);

chrome.storage.local.get(DEFAULTS, stored => {
  cfg = { ...DEFAULTS, ...stored };
  log("Chargé. Actif :", cfg.enabled);
  renderSummary();
  renderLimit();
  setupReload();
  tryOpen();
});

chrome.storage.onChanged.addListener(changes => {
  for (const [k, { newValue }] of Object.entries(changes)) cfg[k] = newValue;
  if (["opened", "rarityCounts", "lastPack", "showSummary"].some(k => k in changes)) renderSummary();
  if ("packLimitUntil" in changes || "showSummary" in changes) renderLimit();
  setupReload();
  tryOpen();
});
