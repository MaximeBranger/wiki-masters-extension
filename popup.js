const DEFAULTS = {
  enabled: true, selector: "", keywords: "ouvrir,open,claim,récupérer",
  minDelay: 800, maxDelay: 2000, reloadMinutes: 0, opened: 0,
  autoReveal: true, nextButton: "", revealMinDelay: 500, revealMaxDelay: 1100,
  autoContinue: true, continueButton: "", showSummary: true, rarityZone: "",
  collectionPath: "/collection", cardPattern: "/cards?/([^/?#]+)", markLinks: true, affordableOnly: false, budget: 0, balanceSelector: 'button[aria-label="Ouvrir la boutique WikiBidous"]',
  pullZone: "", pullWindow: 15, owned: [], counts: {}, readCollectionQty: true,
  dryRun: true, autoSellDupes: false, priceMultiplier: 1, minPrice: 1,
  avgPrice: "texte:prix moyen,moyenne,average", sellButton: "texte:vendre,mettre en vente,sell",
  priceInput: "input[type=number]", confirmButton: "texte:confirmer,valider,mettre en vente,confirm",
  qtySelector: "", keepMin: 1,
  autoRelist: false, salesPath: "/market/my-sales", relistMinutes: 30,
  expiredKeywords: "expirée,expiré,non vendue,expired", rowSelector: "", reclaimButton: "",
  sellQueue: [], sellLog: [], soldCount: 0
};
const CHECKS = ["enabled", "autoReveal", "autoContinue", "showSummary", "markLinks", "affordableOnly", "readCollectionQty", "dryRun", "autoSellDupes", "autoRelist"];
const NUMS = ["minDelay", "maxDelay", "revealMinDelay", "revealMaxDelay", "reloadMinutes", "pullWindow", "priceMultiplier", "minPrice", "keepMin", "budget", "relistMinutes"];
const TEXTS = ["selector", "keywords", "nextButton", "continueButton", "rarityZone", "collectionPath", "cardPattern", "pullZone", "balanceSelector", "avgPrice", "sellButton",
  "priceInput", "confirmButton", "qtySelector", "salesPath", "expiredKeywords", "rowSelector", "reclaimButton"];
const $ = id => document.getElementById(id);

function renderStats(c) {
  $("opened").textContent = c.opened;
  $("ownedCount").textContent = c.owned.length;
  $("dupCount").textContent = Object.values(c.counts).filter(n => n >= 2).length;
  $("soldCount").textContent = c.soldCount;
  $("queueCount").textContent = c.sellQueue.length;
  $("log").textContent = c.sellLog.length ? c.sellLog.map(e => e.s ?? e).join("\n") : "Aucun log. (purge automatique après 7 jours)";
}

chrome.storage.local.get(DEFAULTS, c => {
  for (const k of CHECKS) $(k).checked = c[k];
  for (const k of [...NUMS, ...TEXTS]) $(k).value = c[k];
  renderStats(c);
});
chrome.storage.onChanged.addListener(() => chrome.storage.local.get(DEFAULTS, renderStats));

for (const k of CHECKS) $(k).addEventListener("change", e => {
  if (k === "dryRun" && !e.target.checked &&
      !confirm("Désactiver la simulation ? Les ventes seront réellement validées.")) {
    e.target.checked = true; return;
  }
  chrome.storage.local.set({ [k]: e.target.checked });
});

const show = v => { for (const id of ["main", "adv", "logs"]) $(id).hidden = id !== v; $("statsBox").hidden = v !== "main"; };
$("openAdv").onclick = () => show("adv");
$("openLogs").onclick = () => show("logs");
$("closeAdv").onclick = $("closeLogs").onclick = () => show("main");

$("save").addEventListener("click", () => {
  try { new RegExp($("cardPattern").value); }
  catch { $("save").textContent = "⚠ Regex invalide"; return; }
  const data = {};
  for (const k of TEXTS) data[k] = $(k).value.trim();
  for (const k of NUMS) data[k] = Math.max(0, parseFloat($(k).value) || DEFAULTS[k]);
  data.maxDelay = Math.max(data.minDelay, data.maxDelay);
  data.revealMaxDelay = Math.max(data.revealMinDelay, data.revealMaxDelay);
  data.relistMinutes = Math.max(5, data.relistMinutes);
  data.collectionPath ||= DEFAULTS.collectionPath;
  chrome.storage.local.set(data, () => {
    $("save").textContent = "✓ Enregistré";
    setTimeout(() => $("save").textContent = "Enregistrer", 1200);
  });
});

$("resetOpened").onclick = e => { e.preventDefault(); chrome.storage.local.set({ opened: 0, rarityCounts: {}, lastPack: [] }); };
$("resetOwned").onclick = e => { e.preventDefault(); if (confirm("Vider la collection mémorisée ?")) chrome.storage.local.set({ owned: [], counts: {} }); };
$("flushLogs").onclick = () => chrome.storage.local.set({ sellLog: [] });
$("clearQueue").onclick = e => { e.preventDefault(); chrome.storage.local.set({ sellQueue: [], sellCurrent: null }); };
$("relistNow").onclick = () => { chrome.runtime.sendMessage({ type: "relist-now" }); $("relistNow").textContent = "Vérification lancée…"; };

