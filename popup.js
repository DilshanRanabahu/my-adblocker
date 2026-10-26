const enabledInput = document.getElementById("enabled");
const statusEl = document.getElementById("status");
const siteEl = document.getElementById("site");
const countEl = document.getElementById("count");
const hintEl = document.getElementById("hint");
const siteButton = document.getElementById("toggle-site");
const listsInfoEl = document.getElementById("lists-info");
const updateButton = document.getElementById("update-lists");

let tab = null;
let domain = null;

async function getState() {
  const { enabled = true, whitelist = [] } = await chrome.storage.local.get(["enabled", "whitelist"]);
  return { enabled, whitelist };
}

function render({ enabled, whitelist }) {
  enabledInput.checked = enabled;
  statusEl.textContent = enabled ? "Blocking ads" : "Paused";

  if (!domain) {
    siteEl.textContent = "Not available on this page";
    countEl.textContent = "";
    hintEl.textContent = "Open a website and try again.";
    siteButton.textContent = "Allow ads on this site";
    siteButton.disabled = true;
    return;
  }

  const allowed = whitelist.includes(domain);
  siteEl.textContent = domain;
  hintEl.textContent = allowed ? "Ads are allowed on this site." : "Site not working? Allow ads here.";
  siteButton.textContent = allowed ? "Block ads on this site again" : "Allow ads on this site";
  siteButton.classList.toggle("allowed", allowed);
  siteButton.disabled = !enabled;
}

async function renderCount() {
  if (!domain) return;
  const n = await chrome.runtime.sendMessage({ type: "getBlockedCount", tabId: tab.id });
  countEl.innerHTML = `<strong>${n}</strong> ${n === 1 ? "request" : "requests"} blocked on this page`;
}

async function renderLists() {
  const { listsUpdatedAt, listsError } = await chrome.storage.local.get(["listsUpdatedAt", "listsError"]);
  listsInfoEl.classList.toggle("error", Boolean(listsError));
  if (listsError) {
    listsInfoEl.textContent = "Last update failed";
    listsInfoEl.title = listsError;
  } else {
    listsInfoEl.textContent = listsUpdatedAt
      ? `Lists updated ${new Date(listsUpdatedAt).toLocaleString()}`
      : "Using built-in lists";
    listsInfoEl.title = "";
  }
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      domain = url.hostname.replace(/^www\./, "");
    }
  } catch {
    domain = null;
  }
  render(await getState());
  renderCount();
  renderLists();
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: enabledInput.checked });
  render(await getState());
  chrome.tabs.reload(tab.id);
});

siteButton.addEventListener("click", async () => {
  const { whitelist } = await getState();
  const next = whitelist.includes(domain) ? whitelist.filter((d) => d !== domain) : [...whitelist, domain];
  await chrome.storage.local.set({ whitelist: next });
  render(await getState());
  chrome.tabs.reload(tab.id);
});

updateButton.addEventListener("click", async () => {
  updateButton.disabled = true;
  updateButton.textContent = "Updating…";
  await chrome.runtime.sendMessage({ type: "updateLists" });
  updateButton.disabled = false;
  updateButton.textContent = "Update now";
  renderLists();
});

init();
