// EasyList / EasyPrivacy (.txt) -> rules.json, cosmetic.css, cosmetic-specific.json
// Usage: node build-rules.js

const fs = require("fs");
const path = require("path");
const { convertLists, selectorsToCss } = require("./filters.js");

const LISTS = ["easylist.txt", "easyprivacy.txt", "peterlowe.txt"];
const MAX_RULES = 30000; // Edge/Chromium guaranteed static rule limit

const texts = LISTS.map((file) => fs.readFileSync(path.join(__dirname, file), "utf8"));
const { rules, genericSelectors, specificCosmetic, stats } = convertLists(texts, { maxRules: MAX_RULES });

fs.writeFileSync(path.join(__dirname, "rules.json"), JSON.stringify(rules));
fs.writeFileSync(path.join(__dirname, "cosmetic.css"), selectorsToCss(genericSelectors));
fs.writeFileSync(path.join(__dirname, "cosmetic-specific.json"), JSON.stringify(specificCosmetic));

console.log(`Allow rules:        ${stats.allowRules}`);
console.log(`Blocked domains:    ${stats.blockedDomains} (in 1 rule)`);
console.log(`Other block rules:  ${stats.otherBlockRules}`);
console.log(`Written to rules.json: ${stats.writtenRules} / ${stats.totalRules} (limit ${MAX_RULES})`);
console.log(`Generic selectors:  ${stats.genericSelectors} -> cosmetic.css`);
console.log(`Site selectors:     ${stats.specificSelectors} on ${stats.specificDomains} sites -> cosmetic-specific.json`);
