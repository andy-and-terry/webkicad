// node --test tests/js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse, dumps, dumpFile, touch, find, Q, L, q } from "../../js/sexpr.js";

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.kicad_(sym|mod|sch|pcb)$/.test(e.name)) out.push(p);
  }
  return out;
}
const ALL = [...files("vendor"), ...files("kicad-symbols"), ...files("kicad-footprints"), ...(fs.existsSync("tests/fixtures") ? files("tests/fixtures") : [])];

test("byte-exact round trip of unedited files", () => {
  let n = 0;
  for (const f of ALL) {
    const t = fs.readFileSync(f, "utf8");
    assert.equal(dumpFile(parse(t)), t, f);
    n++;
  }
  assert.ok(n > 5000, `only ${n} files`);
});

test("edited file reparses to the edited structure", () => {
  const t = fs.readFileSync("kicad-symbols/Gen_Device.kicad_sym", "utf8");
  const root = parse(t);
  const sym = find(root, "symbol");
  const prop = sym.find((c) => Array.isArray(c) && c[0] === "property" && c[1].v === "Value");
  prop[2] = q("10k");
  touch(prop, sym, root);
  const out = dumpFile(root);
  assert.notEqual(out, t);
  const re = parse(out);
  const p2 = find(re, "symbol").find((c) => Array.isArray(c) && c[0] === "property" && c[1].v === "Value");
  assert.equal(p2[2].v, "10k");
  // untouched symbols still byte identical
  const second = root.filter((c) => Array.isArray(c) && c[0] === "symbol")[1];
  assert.ok(out.includes(second.raw));
});

test("errors", () => {
  for (const bad of ["(a", "a)", "(a))", '(a "b)', "", "(a)(b)"]) assert.throws(() => parse(bad));
});

test("escapes", () => {
  const r = parse('(a "x\\"y\\\\z\\nw")');
  assert.equal(r[1].v, 'x"y\\z\nw');
  assert.equal(dumps(L("a", r[1])), '(a "x\\"y\\\\z\\nw")');
  assert.ok(r[1] instanceof Q);
});
