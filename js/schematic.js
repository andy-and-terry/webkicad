// Schematic data model on top of the s-expression tree.
// The tree IS the document: untouched nodes keep their original text (see sexpr.js),
// so loading + saving without edits returns the file byte-for-byte.
// Edits go through Schematic methods, which mark changed lists with touch().
import { parse, dumpFile, find, findAll, str, num, q, L, fmt, touch } from "./sexpr.js";
import { symbolForKicad8 } from "./downconvert.js";

export const GRID = 1.27;
export const snap = (v) => Math.round(v / GRID) * GRID;
const r4 = (v) => Math.round(v * 10000) / 10000;
const uuid = () => crypto.randomUUID();
const font = () => L("effects", L("font", L("size", 1.27, 1.27)));

// lib coords (y up) -> sheet offset (y down), KiCad order: rotate (CCW on screen), then mirror.
// Verified against real KiCad schematics (tests/js/schematic.test.mjs).
export function xform(px, py, angle = 0, mirror = null) {
  let x = px, y = -py;
  switch (((angle % 360) + 360) % 360) {
    case 90: [x, y] = [y, -x]; break;
    case 180: [x, y] = [-x, -y]; break;
    case 270: [x, y] = [-y, x]; break;
  }
  if (mirror === "x") y = -y;
  if (mirror === "y") x = -x;
  return [x + 0, y + 0];  // normalise -0
}

const kids = (l, k) => findAll(l, k);
const atOf = (l) => { const a = find(l, "at"); return [num(a[1]), num(a[2]), a.length > 3 ? num(a[3]) : 0]; };
function setAt(l, x, y, a) {
  const at = find(l, "at");
  at.length = 1;
  at.push(fmt(r4(x)), fmt(r4(y)));
  if (a !== undefined) at.push(fmt(a));
  touch(at, l);
}

export class Schematic {
  constructor(text, { projectName = "project" } = {}) {
    this.root = parse(text);
    if (this.root[0] !== "kicad_sch") throw new Error("not a .kicad_sch file");
    this.projectName = projectName;
    this.version = num(find(this.root, "version")[1]);
    if (!find(this.root, "lib_symbols")) this._insert(L("lib_symbols"), "lib_symbols");
  }

  static empty(projectName = "project") {
    const t = `(kicad_sch (version 20231120) (generator "eeschema") (generator_version "8.0") (uuid "${uuid()}") (paper "A4") (lib_symbols) (sheet_instances (path "/" (page "1"))))`;
    const s = new Schematic(t, { projectName });
    s.root.raw = undefined;  // serialize in KiCad layout, not as the one-liner above
    return s;
  }

  get uuid() { return str(find(this.root, "uuid")[1]); }
  get libSymbols() { return find(this.root, "lib_symbols"); }
  text() { return dumpFile(this.root); }

  // ---------- queries ----------
  items(kind) { return kids(this.root, kind); }
  symbols() { return this.items("symbol"); }
  libSymbol(libId) { return kids(this.libSymbols, "symbol").find((s) => str(s[1]) === libId) || null; }
  uuidOf(item) { const u = find(item, "uuid"); return u ? str(u[1]) : null; }
  byUuid(id) { return this.root.find((c) => Array.isArray(c) && this.uuidOf(c) === id) || null; }
  prop(item, key) { const p = kids(item, "property").find((p) => str(p[1]) === key); return p ? str(p[2]) : null; }
  reference(sym) {
    const inst = this._instancePath(sym);
    return inst ? str(find(inst, "reference")[1]) : this.prop(sym, "Reference");
  }

  // connection points of a placed symbol: [{number, name, type, x, y}]
  pins(sym) {
    const lib = this.libSymbol(str(find(sym, "lib_id")[1]));
    if (!lib) return [];
    const [X, Y, A] = atOf(sym);
    const m = find(sym, "mirror") ? str(find(sym, "mirror")[1]) : null;
    const unit = num(find(sym, "unit")?.[1] ?? 1);
    const out = [];
    for (const sub of kids(lib, "symbol")) {
      const [u, st] = str(sub[1]).split("_").slice(-2).map(Number);
      if ((u !== 0 && u !== unit) || st > 1) continue;
      for (const p of kids(sub, "pin")) {
        const [px, py] = atOf(p);
        const [dx, dy] = xform(px, py, A, m);
        out.push({ number: str(find(p, "number")[1]), name: str(find(p, "name")[1]), type: String(p[1]), x: r4(X + dx), y: r4(Y + dy) });
      }
    }
    return out;
  }

  // ---------- low-level edit helpers ----------
  _insert(node, before = "sheet_instances") {
    // KiCad order: header, lib_symbols, graphical items..., symbols, sheet_instances
    let i = this.root.findIndex((c) => Array.isArray(c) && c[0] === before);
    if (i < 0) i = this.root.length;
    this.root.splice(i, 0, node);
    touch(this.root);
    return node;
  }
  remove(item) {
    const i = this.root.indexOf(item);
    if (i >= 0) { this.root.splice(i, 1); touch(this.root); }
  }

  // ---------- library symbols ----------
  ensureLibSymbol(libId, sym) {
    if (this.libSymbol(libId)) return this.libSymbol(libId);
    const { symbol, warnings } = symbolForKicad8(sym);
    symbol[1] = q(libId);
    const ls = this.libSymbols;
    ls.push(symbol);
    touch(ls, this.root);
    this.lastWarnings = warnings;
    return symbol;
  }

  nextReference(prefix) {
    let max = 0;
    const re = new RegExp(`^${prefix.replace(/[^\w#]/g, "\\$&")}(\\d+)$`);
    for (const s of this.symbols()) {
      const m = re.exec(this.reference(s) || "");
      if (m) max = Math.max(max, +m[1]);
    }
    return `${prefix}${prefix.startsWith("#") ? String(max + 1).padStart(2, "0") : max + 1}`;
  }

  _instancePath(sym) {
    const inst = find(sym, "instances");
    if (!inst) return null;
    for (const p of kids(inst, "project")) for (const path of kids(p, "path")) return path;
    return null;
  }

  // ---------- placement ----------
  placeSymbol(libId, libSym, x, y, { unit = 1, angle = 0, reference } = {}) {
    const lib = this.ensureLibSymbol(libId, libSym);
    x = snap(x); y = snap(y);
    const props = Object.fromEntries(kids(lib, "property").map((p) => [str(p[1]), p]));
    const isPower = !!find(lib, "power");
    const prefix = str(props.Reference?.[2] ?? (isPower ? "#PWR" : "U")).replace(/\?$/, "");
    const ref = reference || this.nextReference(prefix);
    const node = L("symbol", L("lib_id", q(libId)), L("at", r4(x), r4(y), angle), L("unit", unit),
      L("exclude_from_sim", "no"), L("in_bom", isPower ? "no" : "yes"), L("on_board", isPower ? "no" : "yes"),
      L("dnp", "no"), L("uuid", q(uuid())));
    for (const key of ["Reference", "Value", "Footprint", "Datasheet", "Description"]) {
      const lp = props[key];
      const val = key === "Reference" ? ref : lp ? str(lp[2]) : "";
      const [px, py, pa] = lp ? atOf(lp) : [0, 0, 0];
      const [dx, dy] = xform(px, py, angle, null);
      const hidden = key === "Reference" ? isPower : lp ? find(lp, "effects")?.includes("hide") ?? false : true;
      const eff = font();
      if (hidden) eff.push("hide");
      node.push(L("property", q(key), q(val), L("at", r4(x + dx), r4(y + dy), pa), eff));
    }
    for (const p of this._libPinNumbers(lib, unit)) node.push(L("pin", q(p), L("uuid", q(uuid()))));
    node.push(L("instances", L("project", q(this.projectName),
      L("path", q("/" + this.uuid), L("reference", q(ref)), L("unit", unit)))));
    return this._insert(node);
  }

  _libPinNumbers(lib, unit) {
    const nums = [];
    for (const sub of kids(lib, "symbol")) {
      const [u, st] = str(sub[1]).split("_").slice(-2).map(Number);
      if ((u !== 0 && u !== unit) || st > 1) continue;
      for (const p of kids(sub, "pin")) nums.push(str(find(p, "number")[1]));
    }
    return nums;
  }

  // ---------- transforms on any item ----------
  move(item, dx, dy) {
    dx = snap(dx); dy = snap(dy);
    if (item[0] === "wire") {
      for (const xy of kids(find(item, "pts"), "xy")) {
        const v = [num(xy[1]) + dx, num(xy[2]) + dy].map(r4);
        xy.length = 1; xy.push(fmt(v[0]), fmt(v[1])); touch(xy);
      }
      touch(find(item, "pts"), item);
      return;
    }
    const [x, y, a] = atOf(item);
    setAt(item, x + dx, y + dy, find(item, "at").length > 3 ? a : undefined);
    for (const p of kids(item, "property")) {
      const [px, py, pa] = atOf(p);
      setAt(p, px + dx, py + dy, pa);
    }
    touch(this.root);
  }

  rotate(item) {
    if (item[0] === "wire") return;
    const [x, y, a] = atOf(item);
    const na = (a + 90) % 360;
    setAt(item, x, y, na);
    if (item[0] === "symbol") {
      // rotate fields around the symbol origin (CCW on screen), keep text upright-ish
      for (const p of kids(item, "property")) {
        const [px, py, pa] = atOf(p);
        const [ox, oy] = [px - x, py - y];
        setAt(p, x + oy, y - ox, (pa + 90) % 180);
      }
    }
    touch(this.root);
  }

  mirror(item, axis) {
    if (item[0] !== "symbol") return;
    const cur = find(item, "mirror");
    const [x, y] = atOf(item);
    if (cur && str(cur[1]) === axis) item.splice(item.indexOf(cur), 1);
    else if (cur) { cur[1] = axis; touch(cur); }
    else item.splice(item.indexOf(find(item, "at")) + 1, 0, L("mirror", axis));
    for (const p of kids(item, "property")) {
      const [px, py, pa] = atOf(p);
      setAt(p, axis === "y" ? 2 * x - px : px, axis === "x" ? 2 * y - py : py, pa);
    }
    touch(item, this.root);
  }

  setProperty(sym, key, value) {
    let p = kids(sym, "property").find((p) => str(p[1]) === key);
    if (!p) {
      const [x, y] = atOf(sym);
      const eff = font(); eff.push("hide");
      p = L("property", q(key), q(""), L("at", x, y, 0), eff);
      sym.splice(sym.indexOf(find(sym, "uuid")) + 1 + kids(sym, "property").length, 0, p);
    }
    p[2] = q(value);
    touch(p, sym, this.root);
    if (key === "Reference") {
      const path = this._instancePath(sym);
      if (path) { const r = find(path, "reference"); r[1] = q(value); touch(r); this._touchInstances(sym); }
    }
  }
  _touchInstances(sym) {
    const inst = find(sym, "instances");
    if (!inst) return;
    touch(inst);
    for (const p of kids(inst, "project")) { touch(p); for (const pa of kids(p, "path")) touch(pa); }
  }

  setLabelText(label, text) { label[1] = q(text); touch(label, this.root); }

  // ---------- wires, junctions, labels ----------
  addWire(x1, y1, x2, y2) {
    [x1, y1, x2, y2] = [x1, y1, x2, y2].map((v) => r4(snap(v)));
    if (x1 === x2 && y1 === y2) return null;
    const w = this._insert(L("wire", L("pts", L("xy", x1, y1), L("xy", x2, y2)),
      L("stroke", L("width", 0), L("type", "default")), L("uuid", q(uuid()))), this._firstOf("symbol"));
    this.autoJunctions();
    return w;
  }
  wireEnds(w) { return kids(find(w, "pts"), "xy").map((xy) => [num(xy[1]), num(xy[2])]); }

  addJunction(x, y) {
    x = r4(snap(x)); y = r4(snap(y));
    if (this.items("junction").some((j) => { const [jx, jy] = atOf(j); return jx === x && jy === y; })) return null;
    return this._insert(L("junction", L("at", x, y), L("diameter", 0), L("color", 0, 0, 0, 0), L("uuid", q(uuid()))), this._firstOf("symbol"));
  }

  addNoConnect(x, y) {
    return this._insert(L("no_connect", L("at", r4(snap(x)), r4(snap(y))), L("uuid", q(uuid()))), this._firstOf("symbol"));
  }

  addLabel(text, x, y, angle = 0) {
    const eff = font(); eff.push(L("justify", angle >= 180 ? "right" : "left", "bottom"));
    return this._insert(L("label", q(text), L("at", r4(snap(x)), r4(snap(y)), angle), eff, L("uuid", q(uuid()))), this._firstOf("symbol"));
  }

  addGlobalLabel(text, x, y, angle = 0, shape = "bidirectional") {
    x = r4(snap(x)); y = r4(snap(y));
    const eff = font(); eff.push(L("justify", angle >= 180 ? "right" : "left"));
    const ieff = font(); ieff.push(L("justify", "left"), "hide");
    return this._insert(L("global_label", q(text), L("shape", shape), L("at", x, y, angle), eff, L("uuid", q(uuid())),
      L("property", q("Intersheetrefs"), q("${INTERSHEET_REFS}"), L("at", x, y, 0), ieff)), this._firstOf("symbol"));
  }

  _firstOf(kind) {
    const s = this.root.find((c) => Array.isArray(c) && c[0] === kind);
    return s ? kind : "sheet_instances";
  }

  // Add junctions where a wire end lands on the interior of another wire, or where 3+ wire ends meet.
  autoJunctions() {
    const wires = this.items("wire").map((w) => this.wireEnds(w));
    const key = (x, y) => `${r4(x)},${r4(y)}`;
    const count = new Map();
    for (const [a, b] of wires) for (const p of [a, b]) count.set(key(...p), (count.get(key(...p)) || 0) + 1);
    // symbol pins count as an end too
    for (const s of this.symbols()) for (const p of this.pins(s)) if (count.has(key(p.x, p.y))) count.set(key(p.x, p.y), count.get(key(p.x, p.y)) + 1);
    const want = new Set([...count].filter(([, n]) => n >= 3).map(([k]) => k));
    for (const [a, b] of wires) {
      for (const [c, d] of wires) {
        if (a === c) continue;
        for (const p of [c, d]) if (onSegmentInterior(p, a, b)) want.add(key(...p));
      }
    }
    for (const k of want) { const [x, y] = k.split(",").map(Number); this.addJunction(x, y); }
  }
}

function onSegmentInterior(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot > 1e-6 && dot < len2 - 1e-6;
}
