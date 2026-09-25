// ===== Wiki-Masters Auto Pack - service worker =====
// Gère la file des cartes à vendre : ouvre chaque page de carte dans un onglet
// en arrière-plan (?wmsell=1), sell.js y fait la mise en vente, puis l'onglet est fermé.
// Vérifie aussi périodiquement la page "mes ventes" (?wmrelist=1) pour relancer les invendus.
const ORIGIN = "https://www.wiki-masters.com";
const TAB_TIMEOUT = 90_000;
const RELIST_COOLDOWN = 60 * 60_000;   // ne pas relancer la même carte plus d'une fois par heure

const S = keys => chrome.storage.local.get(keys);
const W = obj => chrome.storage.local.set(obj);

const LOG_TTL = 7 * 24 * 3600_000;   // les logs plus vieux que 7 jours sont purgés

// Les logs sont des { t, s } ; les anciennes entrées (simple texte) sont datées à la première purge.
async function pruneLogs() {
  const { sellLog = [] } = await S({ sellLog: [] });
  const now = Date.now();
  const kept = sellLog.map(e => typeof e === "string" ? { t: now, s: e } : e).filter(e => now - e.t < LOG_TTL);
  if (kept.length !== sellLog.length || sellLog.some(e => typeof e === "string")) await W({ sellLog: kept });
}

async function addLog(ok, name, msg) {
  const { sellLog = [] } = await S({ sellLog: [] });
  const t = Date.now();
  const time = new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  sellLog.unshift({ t, s: `${time} ${ok ? "✓" : "✕"} ${name} — ${msg}` });
  await W({ sellLog: sellLog.slice(0, 200) });
}

async function enqueue(items) {
  const { sellQueue = [] } = await S({ sellQueue: [] });
  for (const it of items) {
    if (!sellQueue.some(q => q.href === it.href && q.reason === it.reason)) sellQueue.push({ ...it, addedAt: Date.now() });
  }
  await W({ sellQueue });
  processQueue();
}

async function closeTab(id) { try { await chrome.tabs.remove(id); } catch {} }

async function processQueue() {
  const { sellQueue = [], sellCurrent = null } = await S({ sellQueue: [], sellCurrent: null });
  if (sellCurrent) {
    if (Date.now() - sellCurrent.startedAt < TAB_TIMEOUT) return;   // une vente est en cours
    await closeTab(sellCurrent.tabId);
    await addLog(false, sellCurrent.name, "délai dépassé");
    await W({ sellCurrent: null, sellQueue: sellQueue.filter(q => q.href !== sellCurrent.href) });
    return processQueue();
  }
  if (!sellQueue.length) return;
  // N'ouvre des onglets que si l'option correspondante est activée
  const { autoSellDupes = false, autoRelist = false } = await S({ autoSellDupes: false, autoRelist: false });
  const allowed = q => (q.reason === "doublon" && autoSellDupes) || (q.reason === "relance" && autoRelist);
  if (!allowed(sellQueue[0])) {
    const kept = sellQueue.filter(allowed);
    await W({ sellQueue: kept });
    if (!kept.length) return;
    return processQueue();
  }
  const item = sellQueue[0];
  // Sécurité : ne jamais vendre en dessous du nombre d'exemplaires à garder
  if (item.reason === "doublon" && item.id) {
    const { counts = {}, keepMin = 1 } = await S({ counts: {}, keepMin: 1 });
    if ((counts[item.id] ?? 1) <= keepMin) {
      await addLog(false, item.name, `plus de doublon (×${counts[item.id] ?? 1}), vente annulée`);
      await W({ sellQueue: sellQueue.slice(1) });
      return processQueue();
    }
  }
  const url = new URL(item.href, ORIGIN);
  url.searchParams.set("wmsell", "1");
  await addLog(true, item.name, `onglet de vente ouvert (${item.reason})`);
  const tab = await chrome.tabs.create({ url: url.href, active: false });
  await W({ sellCurrent: { ...item, tabId: tab.id, startedAt: Date.now() } });
}

async function openRelistCheck(force = false) {
  const { salesPath = "/market/my-sales", autoRelist = false } = await S({ salesPath: "/market/my-sales", autoRelist: false });
  if (!autoRelist && !force) return;
  await addLog(true, "Ventes expirées", "onglet de vérification ouvert");
  const url = new URL(salesPath, ORIGIN);
  url.searchParams.set("wmrelist", "1");
  await chrome.tabs.create({ url: url.href, active: false });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  (async () => {
    if (msg.type === "log") return addLog(!!msg.ok, msg.name || "Enchère", msg.msg || "");
    if (msg.type === "enqueue") return enqueue(msg.items || []);

    if (msg.type === "sell-done") {
      const { sellQueue = [], sellCurrent = null } = await S({ sellQueue: [], sellCurrent: null });
      const name = sellCurrent?.name || "carte";
      await addLog(msg.ok, name, msg.msg);
      await W({
        sellCurrent: null,
        sellQueue: sellQueue.filter(q => q.href !== sellCurrent?.href),
        ...(msg.ok && !msg.dry ? { soldCount: ((await S({ soldCount: 0 })).soldCount || 0) + 1 } : {})
      });
      // Un doublon réellement mis en vente quitte la collection : -1 exemplaire
      if (msg.ok && !msg.dry && sellCurrent?.reason === "doublon" && sellCurrent.id) {
        const { counts = {} } = await S({ counts: {} });
        counts[sellCurrent.id] = Math.max(1, (counts[sellCurrent.id] ?? 2) - 1);
        await W({ counts });
      }
      if (sender.tab) setTimeout(() => closeTab(sender.tab.id), 1500);
      setTimeout(processQueue, 3000 + Math.random() * 3000);   // petite pause entre deux ventes
    }

    if (msg.type === "relist-done") {
      if (sender.tab) closeTab(sender.tab.id);
      const { relistSeen = {} } = await S({ relistSeen: {} });
      const now = Date.now();
      const fresh = (msg.items || []).filter(it => !(relistSeen[it.href] > now - RELIST_COOLDOWN));
      fresh.forEach(it => relistSeen[it.href] = now);
      for (const k in relistSeen) if (relistSeen[k] < now - 24 * 3600_000) delete relistSeen[k];
      await W({ relistSeen });
      await addLog(msg.ok, "Ventes expirées", msg.msg + (fresh.length ? ` → ${fresh.length} à remettre` : ""));
      if (fresh.length) enqueue(fresh);
    }

    if (msg.type === "relist-now") openRelistCheck(true);
    if (msg.type === "process-now") processQueue();
  })();
});

async function setupAlarms() {
  const { autoRelist = false, relistMinutes = 30 } = await S({ autoRelist: false, relistMinutes: 30 });
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  chrome.alarms.create("logs-prune", { periodInMinutes: 60, delayInMinutes: 1 });
  await chrome.alarms.clear("relist");
  if (autoRelist) chrome.alarms.create("relist", { periodInMinutes: Math.max(5, relistMinutes), delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === "tick") processQueue();
  if (a.name === "logs-prune") pruneLogs();
  if (a.name === "relist") openRelistCheck();
});
// L'icône (et la popup) ne sont actives que sur wiki-masters.com
function setupActionRules() {
  if (!chrome.declarativeContent) return;
  chrome.action.disable();
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({ pageUrl: { schemes: ["https"], hostEquals: "wiki-masters.com" } }),
        new chrome.declarativeContent.PageStateMatcher({ pageUrl: { schemes: ["https"], hostSuffix: ".wiki-masters.com" } })
      ],
      actions: [new chrome.declarativeContent.ShowAction()]
    }]);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(["rarityStats", "rarities", "raritySelector"]);   // ancienne option
  setupActionRules();
  setupAlarms();
});
chrome.runtime.onStartup.addListener(setupAlarms);
chrome.storage.onChanged.addListener(ch => {
  if (ch.autoRelist || ch.relistMinutes) setupAlarms();
});
