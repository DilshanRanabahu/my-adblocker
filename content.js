// Runs in every page: asks for site-specific hiding rules and hides elements whose requests were blocked

chrome.runtime.sendMessage({ type: "cosmetic" }).catch(() => {});

const MEDIA = "img, iframe, frame, embed, object, video, audio, source";

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "collapse") return;
  for (const el of document.querySelectorAll(MEDIA)) {
    if (![el.src, el.currentSrc, el.data].includes(msg.url)) continue;
    const target = el.tagName === "SOURCE" ? el.parentElement : el;
    target.style.setProperty("display", "none", "important");
  }
});
