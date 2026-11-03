// Wrap a library symbol / footprint into a minimal .kicad_sch / .kicad_pcb so
// KiCanvas (which only renders schematics and boards) can preview it.
import { parse, dumps, find, findAll, str, num, q, L, deepClone, Q } from "./sexpr.js";

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Find symbol `name` in a .kicad_sym text. `parentText` resolves `extends` (KiCad symdir
// stores the parent in its own file). Returns a self-contained symbol list (no extends).
export function extractSymbol(text, name, parentText) {
  const lib = parse(text);
  const sym = findAll(lib, "symbol").find((s) => str(s[1]) === name);
  if (!sym) throw new Error(`symbol ${name} not found`);
  const ext = find(sym, "extends");
  if (!ext) return deepClone(sym);
  if (!parentText) throw new Error(`symbol ${name} extends ${str(ext[1])}; parent not loaded`);
  const parent = extractSymbol(parentText, str(ext[1]));
  const out = [sym[0], new Q(name)];
  const childProps = findAll(sym, "property");
  const childKeys = new Set(childProps.map((p) => str(p[1])));
  for (const c of parent.slice(2)) {
    if (Array.isArray(c) && c[0] === "property" && childKeys.has(str(c[1]))) continue;
    if (Array.isArray(c) && c[0] === "symbol") {
      const sub = deepClone(c);
      sub[1] = new Q(str(sub[1]).replace(str(parent[1]), name));
      out.push(sub);
    } else out.push(deepClone(c));
  }
  for (const p of childProps) out.splice(2, 0, deepClone(p));
  return out;
}

export function unitCount(sym) {
  let m = 1;
  for (const s of findAll(sym, "symbol")) {
    const u = parseInt(str(s[1]).split("_").slice(-2)[0], 10);
    if (u > m) m = u;
  }
  return m;
}

const prop = (k, v, x, y, hide) =>
  L("property", q(k), q(v), L("at", x, y, 0), L("effects", L("font", L("size", 1.27, 1.27)), hide ? "hide" : null));

export function symbolToSch(sym, libName) {
  const name = str(sym[1]);
  const libId = `${libName}:${name}`;
  const libSym = deepClone(sym);
  libSym[1] = q(libId);
  const props = Object.fromEntries(findAll(sym, "property").map((p) => [str(p[1]), str(p[2])]));
  const root = uuid();
  const units = unitCount(sym);
  const insts = [], ncs = [];
  const isPower = !!find(sym, "power");
  const ref = isPower ? "#PWR01" : (props.Reference || "U").replace(/\?$/, "") + "1";
  for (let u = 1; u <= units; u++) {
    const x = 50.8 + (u - 1) * 50.8, y = 76.2, id = uuid();
    // previews are stand-alone: flag every pin as intentionally unconnected (body style 1 only)
    for (const sub of findAll(sym, "symbol")) {
      const [su, st] = str(sub[1]).split("_").slice(-2).map(Number);
      if ((su !== 0 && su !== u) || st > 1) continue;
      for (const pin of findAll(sub, "pin")) {
        const at = find(pin, "at");
        ncs.push(L("no_connect", L("at", +(x + num(at[1])).toFixed(4), +(y - num(at[2])).toFixed(4)), L("uuid", q(uuid()))));
      }
    }
    insts.push(L("symbol", L("lib_id", q(libId)), L("at", x, y, 0), L("unit", u),
      L("exclude_from_sim", "no"), L("in_bom", "yes"), L("on_board", "yes"), L("dnp", "no"), L("uuid", q(id)),
      prop("Reference", ref, x, y - 12.7, false), prop("Value", props.Value || name, x, y + 12.7, false),
      prop("Footprint", props.Footprint || "", x, y, true), prop("Datasheet", props.Datasheet || "", x, y, true),
      L("instances", L("project", q("preview"), L("path", q("/" + root), L("reference", q(ref)), L("unit", u))))));
  }
  const t = L("kicad_sch", L("version", "20231120"), L("generator", q("eeschema")), L("generator_version", q("8.0")),
    L("uuid", q(root)), L("paper", q("A4")), L("lib_symbols", libSym), ...ncs, ...insts,
    L("sheet_instances", L("path", q("/"), L("page", q("1")))));
  return dumps(t) + "\n";
}

const PCB_LAYERS = [
  [0, "F.Cu", "signal"], [31, "B.Cu", "signal"], [32, "B.Adhes", "user", "B.Adhesive"], [33, "F.Adhes", "user", "F.Adhesive"],
  [34, "B.Paste", "user"], [35, "F.Paste", "user"], [36, "B.SilkS", "user", "B.Silkscreen"], [37, "F.SilkS", "user", "F.Silkscreen"],
  [38, "B.Mask", "user"], [39, "F.Mask", "user"], [40, "Dwgs.User", "user", "User.Drawings"], [41, "Cmts.User", "user", "User.Comments"],
  [44, "Edge.Cuts", "user"], [45, "Margin", "user"], [46, "B.CrtYd", "user", "B.Courtyard"], [47, "F.CrtYd", "user", "F.Courtyard"],
  [48, "B.Fab", "user"], [49, "F.Fab", "user"],
];

export function footprintToPcb(text, libName) {
  const fp = parse(text);
  const name = str(fp[1]);
  const out = [fp[0], q(`${libName}:${name}`)];
  for (const c of fp.slice(2)) {
    if (Array.isArray(c) && ["version", "generator", "generator_version"].includes(c[0])) continue;
    out.push(deepClone(c));
  }
  // place at (100,100), keep layer first
  out.splice(3, 0, L("uuid", q(uuid())), L("at", 100, 100));
  const layers = L("layers", ...PCB_LAYERS.map(([n, nm, ty, alias]) => L(String(n), q(nm), ty, alias ? q(alias) : null)));
  const t = L("kicad_pcb", L("version", "20240108"), L("generator", q("pcbnew")), L("generator_version", q("8.0")),
    L("general", L("thickness", 1.6), L("legacy_teardrops", "no")), L("paper", q("A4")), layers,
    L("setup", L("pad_to_mask_clearance", 0)), L("net", 0, q("")), out);
  return dumps(t) + "\n";
}
