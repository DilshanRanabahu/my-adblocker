// Keeps blocking rules and cosmetic CSS in sync with { enabled, whitelist } in storage,
// counts blocked requests per tab, and keeps the filter lists up to date.

importScripts("filters.js");

const RULESET_ID = "easylist";
const COSMETIC_ID = "cosmetic";
const WHITELIST_RULE_ID = 1;
const DISABLED_RULE_ID = 2;
const LIST_RULE_START_ID = 1000; // dynamic rules from downloaded lists use ids >= this
const LIST_URLS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
  // Whole-domain blocks for ad servers EasyList only blocks by path (doubleclick.net, google-analytics.com, ...)
  "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext",
];
const UPDATE_ALARM = "update-lists";
const UPDATE_PERIOD_MINUTES = 24 * 60;

// ---------- Settings: on/off and whitelist ----------

async function getState() {
  const { enabled = true, whitelist = [] } = await chrome.storage.local.get(["enabled", "whitelist"]);
  return { enabled, whitelist };
}

async function applyState() {
  const { enabled, whitelist } = await getState();
  const { listsUpdatedAt } = await chrome.storage.local.get("listsUpdatedAt");

  // The bundled ruleset is only used until downloaded lists replace it
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    listsUpdatedAt ? { disableRulesetIds: [RULESET_ID] } : { enableRulesetIds: [RULESET_ID] }
  );

  const addRules = [];
  // Whitelisted sites: allow every request made by pages on these domains
  if (whitelist.length) {
    addRules.push({
      id: WHITELIST_RULE_ID,
      priority: 100,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: whitelist, resourceTypes: ["main_frame", "sub_frame"] },
    });
  }
  // Turned off: allow everything, which overrides both bundled and downloaded rules
  if (!enabled) {
    addRules.push({
      id: DISABLED_RULE_ID,
      priority: 1000,
      action: { type: "allowAllRequests" },
      condition: { resourceTypes: ["main_frame", "sub_frame"] },
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [WHITELIST_RULE_ID, DISABLED_RULE_ID],
    addRules,
  });

  // Grey icon while paused
  const icon = enabled ? "icon" : "icon-off";
  await chrome.action.setIcon({ path: { 16: `icons/${icon}-16.png`, 32: `icons/${icon}-32.png` } });

  // Cosmetic CSS + content script: re-register so excluded sites stay up to date
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [COSMETIC_ID] });
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [COSMETIC_ID] });

  if (enabled) {
    const script = {
      id: COSMETIC_ID,
      matches: ["<all_urls>"],
      css: ["cosmetic.css"],
      js: ["content.js"],
      runAt: "document_start",
      allFrames: true,
    };
    if (whitelist.length) script.excludeMatches = whitelist.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
    await chrome.scripting.registerContentScripts([script]);
  }
}

// Run one update at a time so register/unregister calls don't overlap
let queue = Promise.resolve();
function scheduleApply() {
  queue = queue.then(applyState).catch((err) => console.error("applyState failed:", err));
  return queue;
}

// ---------- Site-specific cosmetic rules ----------

let specificCosmeticPromise = null;
function loadSpecificCosmetic() {
  specificCosmeticPromise ??= chrome.storage.local.get("specificCosmetic").then(async ({ specificCosmetic }) => {
    if (specificCosmetic) return specificCosmetic;
    const res = await fetch(chrome.runtime.getURL("cosmetic-specific.json"));
    return res.json();
  });
  return specificCosmeticPromise;
}

// "ads.news.example.com" matches rules for itself, "news.example.com" and "example.com"
function selectorsFor(map, hostname) {
  const selectors = [];
  let host = hostname.toLowerCase();
  while (host) {
    if (map[host]) selectors.push(...map[host]);
    const dot = host.indexOf(".");
    if (dot === -1) break;
    host = host.slice(dot + 1);
  }
  return selectors;
}

async function injectSpecificCosmetic(sender) {
  if (!sender.tab || !sender.url) return;
  let hostname;
  try {
    hostname = new URL(sender.url).hostname;
  } catch {
    return;
  }
  const selectors = selectorsFor(await loadSpecificCosmetic(), hostname);
  if (!selectors.length) return;
  await chrome.scripting.insertCSS({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    css: FilterLists.selectorsToCss(selectors),
    origin: "USER",
  });
}

// ---------- Blocked request counter (badge) ----------

const counts = new Map();
let countsLoaded = null;
let saveTimer = null;

function loadCounts() {
  countsLoaded ??= chrome.storage.session.get("counts").then(({ counts: saved = {} }) => {
    for (const [tabId, n] of Object.entries(saved)) {
      counts.set(Number(tabId), (counts.get(Number(tabId)) || 0) + n);
    }
  });
  return countsLoaded;
}

async function setCount(tabId, update) {
  await loadCounts();
  const n = update(counts.get(tabId) || 0);
  counts.set(tabId, n);
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});

  // Survive service worker restarts without writing on every single request
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.session.set({ counts: Object.fromEntries(counts) }), 500);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) setCount(details.tabId, () => 0);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.error !== "net::ERR_BLOCKED_BY_CLIENT" || details.tabId < 0) return;
    setCount(details.tabId, (n) => n + 1);

    // Ask the page to hide the element that tried to load this URL
    if (details.type === "main_frame") return;
    const frameId = details.type === "sub_frame" ? details.parentFrameId : details.frameId;
    chrome.tabs.sendMessage(details.tabId, { type: "collapse", url: details.url }, { frameId }).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  loadCounts().then(() => counts.delete(tabId));
});

// ---------- Filter list auto-update ----------

async function updateLists() {
  const texts = await Promise.all(
    LIST_URLS.map(async (url) => {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.text();
    })
  );

  const { rules, specificCosmetic, stats } = FilterLists.convertLists(texts, { firstId: LIST_RULE_START_ID });

  // Leave room for the whitelist / off rules
  const maxRules = (chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES ?? 5000) - 10;
  if (rules.length > maxRules) throw new Error(`Too many rules (${rules.length}, limit ${maxRules})`);

  const current = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.filter((r) => r.id >= LIST_RULE_START_ID).map((r) => r.id),
    addRules: rules,
  });

  specificCosmeticPromise = Promise.resolve(specificCosmetic);
  await chrome.storage.local.set({ listsUpdatedAt: Date.now(), listsError: null, specificCosmetic, listStats: stats });
  return stats;
}

let updating = null;
function runUpdate() {
  updating ??= updateLists()
    .catch(async (err) => {
      console.error("List update failed:", err);
      await chrome.storage.local.set({ listsError: String(err.message || err) });
      throw err;
    })
    .finally(() => (updating = null));
  return updating;
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(UPDATE_ALARM))) {
    chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: UPDATE_PERIOD_MINUTES, periodInMinutes: UPDATE_PERIOD_MINUTES });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) runUpdate().catch(() => {});
});

// ---------- Events ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
  ensureAlarm();
  scheduleApply();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  scheduleApply();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("enabled" in changes || "whitelist" in changes || "listsUpdatedAt" in changes)) {
    scheduleApply();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "cosmetic") {
    injectSpecificCosmetic(sender).catch(() => {});
    return;
  }
  if (msg.type === "getBlockedCount") {
    loadCounts().then(() => sendResponse(counts.get(msg.tabId) || 0));
    return true;
  }
  if (msg.type === "updateLists") {
    runUpdate().then(
      (stats) => sendResponse({ ok: true, stats }),
      (err) => sendResponse({ ok: false, error: String(err.message || err) })
    );
    return true;
  }
});
