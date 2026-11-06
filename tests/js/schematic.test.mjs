import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Schematic, xform } from "../../js/schematic.js";
import { parse, find, findAll, str, num } from "../../js/sexpr.js";
import { buildDemo } from "./demo_circuit.mjs";

const FIX = "tests/fixtures/sch";
const fixtures = fs.readdirSync(FIX).map((f) => path.join(FIX, f));

test("load + save without edits is byte-identical (real KiCad files)", () => {
  for (const f of fixtures) {
    const t = fs.readFileSync(f, "utf8");
    assert.equal(new Schematic(t).text(), t, f);
  }
});

test("pin transform matches real KiCad files (pins land on wires/labels)", () => {
  let hit = 0, tot = 0;
  for (const f of fixtures) {
    const s = new Schematic(fs.readFileSync(f, "utf8"));
    const pts = new Set();
    const k = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    for (const w of s.items("wire")) for (const [x, y] of s.wireEnds(w)) pts.add(k(x, y));
    for (const tag of ["label", "global_label", "hierarchical_label", "no_connect"])
      for (const l of s.items(tag)) { const a = find(l, "at"); pts.add(k(num(a[1]), num(a[2]))); }
    for (const sym of s.symbols()) if (find(sym, "mirror") || num(find(sym, "at")[3] ?? 0) % 180)
      for (const p of s.pins(sym)) { tot++; hit += pts.has(k(p.x, p.y)); }
  }
  assert.ok(tot > 500 && hit / tot > 0.9, `${hit}/${tot}`);
});

test("xform: rotate then mirror", () => {
  assert.deepEqual(xform(3.81, 0, 90), [0, -3.81]);
  assert.deepEqual(xform(0, 3.81, 0, "x"), [0, 3.81]);
  assert.deepEqual(xform(3.81, 0, 0, "y"), [-3.81, 0]);
});

test("editing one item leaves every other item's text untouched", () => {
  const f = fixtures.find((x) => x.includes("complex_hierarchy__complex_hierarchy"));
  const t = fs.readFileSync(f, "utf8");
  const s = new Schematic(t);
  const sym = s.symbols()[0];
  const others = s.symbols().slice(1).map((x) => x.raw);
  s.move(sym, 2.54, 0);
  const out = s.text();
  for (const r of others) assert.ok(out.includes(r));
  const re = new Schematic(out);
  const x0 = num(find(parse(t).find((c) => Array.isArray(c) && c[0] === "symbol"), "at")[1]);
  assert.ok(Math.abs(num(find(re.symbols()[0], "at")[1]) - (x0 + 2.54)) < 1e-9);
});

test("demo circuit: structure, references, pins, junction-free", () => {
  const { s, r, d } = buildDemo();
  const re = new Schematic(s.text());
  assert.equal(re.symbols().length, 6);
  assert.deepEqual(re.symbols().map((x) => re.reference(x)), ["#PWR01", "#FLG01", "R1", "D1", "#PWR02", "#FLG02"]);
  assert.deepEqual(s.pins(r).map((p) => [p.number, p.x, p.y]), [["1", 50.8, 46.99], ["2", 50.8, 54.61]]);
  const led = Object.fromEntries(s.pins(d).map((p) => [p.name, [p.x, p.y]]));
  assert.deepEqual(led, { K: [50.8, 67.31], A: [50.8, 59.69] });
  assert.equal(str(find(find(re.symbols()[2], "instances"), "project")[1]), "demo");
  assert.equal(num(find(re.root, "version")[1]), 20231120);
});

test("rotate x4 and mirror x2 return to start", () => {
  const { s, r } = buildDemo();
  const before = JSON.stringify(s.pins(r));
  for (let i = 0; i < 4; i++) s.rotate(r);
  s.mirror(r, "y"); s.mirror(r, "y");
  assert.equal(JSON.stringify(s.pins(r)), before);
  s.mirror(r, "x");
  assert.deepEqual(s.pins(r).map((p) => p.y), [54.61, 46.99]);
});

test("T-junction is added automatically", () => {
  const s = Schematic.empty("t");
  s.addWire(0, 0, 10.16, 0);
  s.addWire(5.08, 0, 5.08, 5.08);
  assert.deepEqual(s.items("junction").map((j) => [num(find(j, "at")[1]), num(find(j, "at")[2])]), [[5.08, 0]]);
});

test("demo circuit passes ERC (tools/erc.py)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erc-"));
  const f = path.join(dir, "demo.kicad_sch");
  fs.writeFileSync(f, buildDemo().s.text());
  const out = execFileSync("python3", ["tools/erc.py", f], { encoding: "utf8" });
  console.log(out);
  assert.match(out, /0 error\(s\), 0 warning\(s\)/);
});
