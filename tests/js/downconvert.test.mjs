import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse, dumps, find, findAll, str } from "../../js/sexpr.js";
import { extractSymbol } from "../../js/preview.js";
import { symbolForKicad8, toKicad8 } from "../../js/downconvert.js";

const idx = JSON.parse(fs.readFileSync("index.json", "utf8")).items.filter((e) => e.t === "sym");
const load = (e) => extractSymbol(fs.readFileSync(e.path, "utf8"), e.name,
  e.ext ? fs.readFileSync(e.path.replace(/[^/]+$/, `${e.ext}.kicad_sym`), "utf8") : null);

function* lists(n) { yield n; for (const c of n) if (Array.isArray(c)) yield* lists(c); }

test("every library symbol converts to KiCad 8 tokens only", () => {
  let n = 0;
  for (const e of idx) {
    const { symbol } = symbolForKicad8(load(e));
    for (const l of lists(symbol)) {
      if (["hide", "bold", "italic"].includes(String(l[0]))) assert.fail(`${e.lib}:${e.name} still has (${l[0]} ...)`);
    }
    assert.ok(!/\((hide|bold|italic) (yes|no)\)/.test(dumps(symbol)), e.name);
    n++;
  }
  assert.equal(n, idx.length);
});

test("geometry, pins and property values are unchanged", () => {
  for (const e of idx.filter((e) => e.src === "kicad")) {
    const before = load(e), after = symbolForKicad8(before).symbol;
    const pins = (s) => [...lists(s)].filter((l) => l[0] === "pin").map((p) => [str(find(p, "number")[1]), str(find(p, "name")[1]), ...find(p, "at").slice(1).map(String), String(p[1])].join("|")).sort();
    const props = (s) => findAll(s, "property").map((p) => `${str(p[1])}=${str(p[2])}`).sort();
    const geo = (s) => [...lists(s)].filter((l) => ["xy", "start", "end", "mid", "center", "radius"].includes(String(l[0]))).map((l) => l.map(String).join(" "));
    assert.deepEqual(pins(after), pins(before), e.name);
    assert.deepEqual(props(after), props(before), e.name);
    assert.deepEqual(geo(after), geo(before), e.name);
  }
});

test("hidden flags preserved", () => {
  const sym = parse(`(symbol "X" (pin_numbers (hide yes)) (pin_names (offset 0) (hide yes))
    (property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27) (italic yes))))
    (property "Value" "X" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide no)))
    (symbol "X_1_1" (pin passive line (at 0 0 0) (length 2.54) (hide yes) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))))`);
  const out = dumps(symbolForKicad8(sym).symbol);
  assert.match(out, /\(pin_numbers hide\)/);
  assert.match(out, /\(pin_names\s*\(offset 0\)\s*hide\s*\)/);
  assert.match(out, /\(property "Footprint" ""[\s\S]*?\(effects[\s\S]*?italic[\s\S]*?hide\s*\)/);
  assert.match(out, /\(length 2.54\)\s*hide\b/);
  assert.ok(!/show_name|\(hide no\)/.test(out));
  assert.match(out, /\(property "Value" "X"\s*\(at 0 0 0\)\s*\(effects\s*\(font\s*\(size 1.27 1.27\)\s*\)\s*\)/);
});

test("unknown KiCad 10 construct is rejected, not guessed", () => {
  assert.throws(() => symbolForKicad8(parse(`(symbol "X" (some_future_thing 1))`)), /not supported by KiCad 8/);
});
