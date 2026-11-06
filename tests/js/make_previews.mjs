// Write the preview .kicad_sch the web app would build for every symbol in index.json.
import fs from "node:fs";
import path from "node:path";
import { extractSymbol, symbolToSch } from "../../js/preview.js";
const out = process.argv[2];
const idx = JSON.parse(fs.readFileSync("index.json", "utf8")).items.filter((e) => e.t === "sym");
let n = 0, fail = 0;
for (const e of idx) {
  try {
    const text = fs.readFileSync(e.path, "utf8");
    const parent = e.ext ? fs.readFileSync(e.path.replace(/[^/]+$/, `${e.ext}.kicad_sym`), "utf8") : null;
    const sch = symbolToSch(extractSymbol(text, e.name, parent), e.lib);
    fs.writeFileSync(path.join(out, `${e.src}__${e.lib}__${e.name.replace(/[^\w.+-]/g, "_")}.kicad_sch`), sch);
    n++;
  } catch (err) { fail++; console.log(`FAIL ${e.lib}:${e.name}: ${err.message}`); }
}
console.log(`wrote ${n} preview schematics, ${fail} failed`);
