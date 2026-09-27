// ===== Wiki-Masters Auto Pack - pseudo du compte =====
// Le site utilise Supabase : la session (cookie ou localStorage « sb-<projet>-auth-token »)
// contient le pseudo choisi à l'inscription (user_metadata.username). Il sert à la synchro des stats.
(() => {
  const log = (...a) => console.log("%c[Compte]", "color:#f59e0b;font-weight:bold", ...a);

  function b64urlDecode(s) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
    return new TextDecoder().decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)));
  }

  function parseSession(raw) {
    if (!raw) return null;
    try {
      const text = raw.startsWith("base64-") ? b64urlDecode(raw.slice(7)) : raw;
      return JSON.parse(text);
    } catch { return null; }
  }

  // Sessions trouvées : cookies (éventuellement découpés en .0, .1…) puis localStorage
  function sessions() {
    const found = [];
    const chunks = {};
    for (const part of document.cookie.split(/;\s*/)) {
      const eq = part.indexOf("=");
      const m = part.slice(0, eq).match(/^(sb-.+-auth-token)(?:\.(\d+))?$/);
      if (!m) continue;
      let value = part.slice(eq + 1);
      try { value = decodeURIComponent(value); } catch {}
      (chunks[m[1]] ||= [])[m[2] === undefined ? 0 : +m[2]] = value;
    }
    for (const parts of Object.values(chunks)) found.push(parseSession(parts.join("")));
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k)) found.push(parseSession(localStorage.getItem(k)));
      }
    } catch {}
    return found.filter(Boolean);
  }

  function usernameFrom(session) {
    const s = Array.isArray(session) ? { access_token: session[0] } : session;   // ancien format : [jeton, …]
    const direct = s.user?.user_metadata?.username;
    if (direct) return direct;
    try { return JSON.parse(b64urlDecode(s.access_token.split(".")[1])).user_metadata?.username || null; }
    catch { return null; }
  }

  function detect() {
    const username = sessions().map(usernameFrom).find(Boolean)?.trim();
    if (!username) return;
    chrome.storage.local.get({ siteUsername: "" }, st => {
      if (st.siteUsername === username) return;
      chrome.storage.local.set({ siteUsername: username });
      log("Pseudo détecté :", username);
    });
  }

  detect();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) detect(); });
  setInterval(detect, 5 * 60_000);
})();
