// Down-convert a library symbol from KiCad 9/10 syntax to KiCad 8 (symbol format 20231120)
// so it can be embedded in a KiCad 8 .kicad_sch (lib_symbols) or .kicad_sym.
// Input must already be flattened (no `extends`; see preview.js extractSymbol).
// Throws if anything remains that KiCad 8 is not known to accept, instead of guessing.
import { str, find } from "./sexpr.js";

// Lists dropped outright: KiCad 9/10-only metadata with no KiCad 8 equivalent.
const DROP = new Set(["in_pos_files", "duplicate_pin_numbers_are_jumpers", "jumper_pin_groups",
  "embedded_fonts", "embedded_files", "show_name", "do_not_autoplace"]);
// (key yes) -> bare key, (key no) -> removed.  KiCad 8 used bare flags for these.
const FLAG = new Set(["hide", "bold", "italic"]);

// Every list head KiCad 8's symbol parser accepts inside a symbol (sch_io_kicad_sexpr_parser, 8.0).
export const KICAD8_TOKENS = new Set([
  "symbol", "power", "pin_numbers", "pin_names", "offset", "exclude_from_sim", "in_bom", "on_board",
  "property", "at", "effects", "font", "size", "thickness", "justify", "href", "face", "color", "line_spacing",
  "rectangle", "start", "end", "stroke", "width", "type", "fill", "polyline", "pts", "xy", "arc", "mid",
  "circle", "center", "radius", "bezier", "text", "text_box", "margins", "pin", "length", "name", "number",
  "alternate", "unit_name", "id", "private",
]);

export function toKicad8(node, warnings = []) {
  if (!Array.isArray(node)) return node;
  const out = [];
  for (const c of node) {
    if (!Array.isArray(c)) { out.push(c); continue; }
    const k = String(c[0]);
    if (DROP.has(k)) {
      if (k === "show_name" && str(c[1]) === "yes") warnings.push(`dropped (show_name yes): field name will not be shown in KiCad 8`);
      continue;
    }
    if (FLAG.has(k) && c.length === 2) {
      if (str(c[1]) === "yes") out.push(k);
      continue;
    }
    out.push(toKicad8(c, warnings));
  }
  // KiCad 10 puts (hide yes) directly on a property; KiCad 8 expects `hide` inside (effects ...).
  if (node[0] === "property") {
    const i = out.indexOf("hide");
    if (i > 2) {
      out.splice(i, 1);
      let eff = find(out, "effects");
      if (!eff) { eff = ["effects", ["font", ["size", "1.27", "1.27"]]]; out.push(eff); }
      if (!eff.includes("hide")) eff.push("hide");
    }
  }
  return out;
}

export function checkKicad8(node, path = []) {
  if (!Array.isArray(node)) return;
  const k = String(node[0]);
  if (path.length && !KICAD8_TOKENS.has(k)) throw new Error(`token '${k}' not supported by KiCad 8 at ${path.join(">")}`);
  for (const c of node) if (Array.isArray(c)) checkKicad8(c, [...path, k]);
}

// Convert + verify. Returns {symbol, warnings}.
export function symbolForKicad8(sym) {
  if (find(sym, "extends")) throw new Error("flatten `extends` before converting");
  const warnings = [];
  const out = toKicad8(sym, warnings);
  checkKicad8(out);
  return { symbol: out, warnings };
}
