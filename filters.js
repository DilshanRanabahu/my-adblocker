// Shared EasyList parser, used by build-rules.js (Node) and background.js (service worker)

(function (root) {
  const TYPE_MAP = {
    script: "script",
    image: "image",
    stylesheet: "stylesheet",
    subdocument: "sub_frame",
    xmlhttprequest: "xmlhttprequest",
    media: "media",
    font: "font",
    object: "object",
    ping: "ping",
    websocket: "websocket",
    other: "other",
  };

  // "domains##selector", "domains#@#selector" (exception), "#?#" / "#$#" / "#%#" (extended, unsupported)
  const COSMETIC = /^([a-z0-9.,~*-]*)#(@?)([?$%]?)#(.+)$/i;
  // Adblock Plus / uBlock-only pseudo classes that browsers don't understand
  const EXTENDED_CSS = /:(-abp-|has-text|xpath|matches-|upward|remove|style|min-text-length|watch-attr|others)/;

  const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

  function parseDomains(value) {
    const include = [];
    const exclude = [];
    for (let d of value.split("|")) {
      d = d.trim().toLowerCase();
      const neg = d.startsWith("~");
      if (neg) d = d.slice(1);
      // DNR doesn't support wildcard domains like "example.*"
      if (!d || d.includes("*") || !isAscii(d)) return null;
      (neg ? exclude : include).push(d);
    }
    return { include, exclude };
  }

  // Returns a DNR rule (without id) or null if the filter can't be converted
  function convertNetworkFilter(line) {
    let allow = false;
    if (line.startsWith("@@")) {
      allow = true;
      line = line.slice(2);
    }

    // Regex filters aren't supported here
    if (line.startsWith("/") && line.endsWith("/")) return null;

    let pattern = line;
    let options = [];
    const dollar = line.lastIndexOf("$");
    if (dollar !== -1 && /^[\w~,=|.\-*]+$/i.test(line.slice(dollar + 1))) {
      pattern = line.slice(0, dollar);
      options = line.slice(dollar + 1).split(",");
    }

    if (!pattern || pattern === "*" || pattern.startsWith("||*")) return null;
    if (!isAscii(pattern)) return null;

    const condition = { urlFilter: pattern };
    const types = [];
    const excludedTypes = [];

    for (const raw of options) {
      const opt = raw.toLowerCase();
      const neg = opt.startsWith("~");
      const name = neg ? opt.slice(1) : opt;

      if (name === "third-party" || name === "3p") {
        condition.domainType = neg ? "firstParty" : "thirdParty";
      } else if (name === "first-party" || name === "1p") {
        condition.domainType = neg ? "thirdParty" : "firstParty";
      } else if (name === "match-case") {
        condition.isUrlFilterCaseSensitive = true;
      } else if (name.startsWith("domain=")) {
        const d = parseDomains(raw.slice(raw.indexOf("=") + 1));
        if (!d) return null;
        if (d.include.length) condition.initiatorDomains = d.include;
        if (d.exclude.length) condition.excludedInitiatorDomains = d.exclude;
      } else if (TYPE_MAP[name]) {
        (neg ? excludedTypes : types).push(TYPE_MAP[name]);
      } else {
        // popup, csp, redirect, rewrite, document, elemhide, etc. -> skip
        return null;
      }
    }

    if (types.length) condition.resourceTypes = [...new Set(types)];
    if (excludedTypes.length) condition.excludedResourceTypes = [...new Set(excludedTypes)];

    return {
      priority: allow ? 2 : 1,
      action: { type: allow ? "allow" : "block" },
      condition,
    };
  }

  // Positive domains of a cosmetic filter ("a.com,~b.a.com" -> ["a.com"]); negations are ignored
  function cosmeticDomains(value) {
    return value
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d && !d.startsWith("~") && !d.includes("*"));
  }

  function addTo(map, domain, selector) {
    if (!map.has(domain)) map.set(domain, new Set());
    map.get(domain).add(selector);
  }

  /**
   * texts: contents of the .txt lists
   * returns { rules, genericSelectors, specificCosmetic, stats }
   *   rules            - DNR rules with ids starting at firstId (at most maxRules)
   *   genericSelectors - "##selector" rules, applied on every site
   *   specificCosmetic - { "example.com": ["selector", ...] }
   */
  function convertLists(texts, { maxRules = Infinity, firstId = 1 } = {}) {
    const allowRules = [];
    const blockedDomains = new Set(); // plain "||domain^" rules, merged into one rule
    const otherBlockRules = [];
    const genericSelectors = new Set();
    const hide = new Map();
    const unhide = new Map();
    const seen = new Set();

    for (const text of texts) {
      for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith("!") || line.startsWith("[")) continue;
        if (seen.has(line)) continue;
        seen.add(line);

        const cosmetic = COSMETIC.exec(line);
        if (cosmetic) {
          const [, domains, exception, extended, selector] = cosmetic;
          if (extended || !isAscii(selector) || EXTENDED_CSS.test(selector)) continue;

          if (!domains) {
            if (!exception) genericSelectors.add(selector);
            continue;
          }
          for (const d of cosmeticDomains(domains)) addTo(exception ? unhide : hide, d, selector);
          continue;
        }

        const rule = convertNetworkFilter(line);
        if (!rule) continue;

        if (rule.action.type === "allow") allowRules.push(rule);
        else if (/^\|\|[a-z0-9.-]+\^$/i.test(rule.condition.urlFilter) && Object.keys(rule.condition).length === 1)
          blockedDomains.add(rule.condition.urlFilter.slice(2, -1).toLowerCase());
        else otherBlockRules.push(rule);
      }
    }

    // One rule with requestDomains covers every "||domain^" filter (and its subdomains)
    const domainRule = {
      priority: 1,
      action: { type: "block" },
      condition: { requestDomains: [...blockedDomains] },
    };

    // Allow (exception) rules first so sites don't break, then domain blocks, then the rest
    const allRules = [...allowRules, domainRule, ...otherBlockRules];
    const rules = allRules.slice(0, maxRules).map((r, i) => ({ id: firstId + i, ...r }));

    const specificCosmetic = {};
    let specificCount = 0;
    for (const [domain, selectors] of hide) {
      const skip = unhide.get(domain);
      const list = [...selectors].filter((s) => !skip || !skip.has(s));
      if (list.length) {
        specificCosmetic[domain] = list;
        specificCount += list.length;
      }
    }

    return {
      rules,
      genericSelectors: [...genericSelectors],
      specificCosmetic,
      stats: {
        allowRules: allowRules.length,
        blockedDomains: blockedDomains.size,
        otherBlockRules: otherBlockRules.length,
        totalRules: allRules.length,
        writtenRules: rules.length,
        genericSelectors: genericSelectors.size,
        specificDomains: Object.keys(specificCosmetic).length,
        specificSelectors: specificCount,
      },
    };
  }

  // One CSS rule per selector so a single unsupported selector can't break the rest
  function selectorsToCss(selectors) {
    return selectors.map((s) => `${s} { display: none !important; }`).join("\n");
  }

  root.FilterLists = { convertLists, selectorsToCss };
  if (typeof module !== "undefined") module.exports = root.FilterLists;
})(globalThis);
