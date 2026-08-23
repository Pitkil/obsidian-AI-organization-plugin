const fs = require("fs");
const path = require("path");

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const src = walk("src");
const i18n = fs.readFileSync("src/i18n.ts", "utf8");
const defs = new Set();
for (const m of i18n.matchAll(/^\s*"([a-zA-Z0-9.]+)":/gm)) defs.add(m[1]);

const missing = new Set();
for (const f of src) {
  if (f.endsWith("i18n.ts")) continue;
  const code = fs.readFileSync(f, "utf8");
  const re = /\bt(?:pl)?\(\s*"([a-zA-Z0-9.]+)"/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (!defs.has(m[1])) missing.add(m[1] + "  <-  " + f.replace(/\\/g, "/"));
  }
}

if (missing.size) {
  console.log("MISSING KEYS:\n" + [...missing].join("\n"));
} else {
  console.log("All referenced keys are defined. Defined keys: " + defs.size);
}
