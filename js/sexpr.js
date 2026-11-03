// S-expression parser/serializer for KiCad files (browser + node).
// Model: arrays for lists, plain strings for bare atoms, Q objects for quoted strings.
// Every parsed list remembers its exact source text (non-enumerable `raw`), so
// dumps() reproduces untouched subtrees byte-for-byte; mark edited lists with touch().

export class Q {
  constructor(v) { this.v = String(v); }
  toString() { return this.v; }
}
export const q = (v) => new Q(v);
export const isQ = (a) => a instanceof Q;

const ESC = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"' };

export class SexprError extends Error {}

export function parse(text) {
  let i = 0;
  const n = text.length;
  const stack = [];
  let root = null;
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "(") {
      if (root && !stack.length) throw new SexprError(`data after top-level expression at ${i}`);
      const l = [];
      Object.defineProperty(l, "_start", { value: i, writable: true, enumerable: false });
      if (stack.length) stack[stack.length - 1].push(l);
      stack.push(l);
      i++;
    } else if (c === ")") {
      if (!stack.length) throw new SexprError(`unbalanced ')' at ${i}`);
      const l = stack.pop();
      Object.defineProperty(l, "raw", { value: text.slice(l._start, i + 1), writable: true, enumerable: false });
      if (!stack.length) root = l;
      i++;
    } else if (c === '"') {
      if (!stack.length) throw new SexprError(`string outside list at ${i}`);
      i++;
      let buf = "";
      for (;;) {
        if (i >= n) throw new SexprError("unterminated string");
        const d = text[i];
        if (d === "\\") { buf += ESC[text[i + 1]] ?? text[i + 1]; i += 2; }
        else if (d === '"') { i++; break; }
        else { buf += d; i++; }
      }
      stack[stack.length - 1].push(new Q(buf));
    } else {
      if (!stack.length) throw new SexprError(`atom outside list at ${i}`);
      let j = i;
      while (j < n && !' \t\r\n()"'.includes(text[j])) j++;
      stack[stack.length - 1].push(text.slice(i, j));
      i = j;
    }
  }
  if (stack.length) throw new SexprError(`${stack.length} unclosed '('`);
  if (!root) throw new SexprError("empty input");
  root._trailer = text.slice(text.lastIndexOf(")") + 1);
  return root;
}

const quote = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';

export function fmt(v) {
  if (typeof v === "number") {
    let s = v.toFixed(6).replace(/\.?0+$/, "");
    return s === "-0" || s === "" ? "0" : s;
  }
  return String(v);
}

function atom(a) {
  if (a instanceof Q) return quote(a.v);
  if (typeof a === "number") return fmt(a);
  return String(a);
}

// Mark a list (and all its ancestors via the path) as modified so dumps() re-serializes it.
export function touch(...lists) { for (const l of lists) if (Array.isArray(l)) l.raw = undefined; }

// Serialize. Untouched subtrees with a `raw` are emitted verbatim (indentation of
// the first line is supplied by the parent, the rest of raw is kept as-is).
export function dumps(node, indent = 0) {
  if (!Array.isArray(node)) return atom(node);
  if (node.raw !== undefined && !hasDirty(node)) return node.raw;
  if (node.every((c) => !Array.isArray(c))) return "(" + node.map(atom).join(" ") + ")";
  const pad = "\t".repeat(indent + 1);
  let k = 0;
  const head = [];
  while (k < node.length && !Array.isArray(node[k])) head.push(atom(node[k++]));
  let out = "(" + head.join(" ");
  for (; k < node.length; k++) out += "\n" + pad + dumps(node[k], indent + 1);
  return out + "\n" + "\t".repeat(indent) + ")";
}

function hasDirty(node) {
  // A list is clean only if it and every descendant list still carries raw text
  // and its children are unchanged in count (cheap structural check).
  for (const c of node) if (Array.isArray(c) && (c.raw === undefined || hasDirty(c))) return true;
  return false;
}

export function dumpFile(root) {
  return dumps(root) + (root._trailer ?? "\n");
}

// Build a list: JS strings -> bare atoms, numbers formatted, Q stays quoted.
export function L(...items) {
  return items.filter((x) => x !== null && x !== undefined).map((x) => (typeof x === "number" ? fmt(x) : x));
}

export const head = (l) => (Array.isArray(l) ? String(l[0]) : null);
export const find = (l, k) => l.find((c) => Array.isArray(c) && c[0] === k) || null;
export const findAll = (l, k) => l.filter((c) => Array.isArray(c) && c[0] === k);
export const str = (a) => (a instanceof Q ? a.v : a == null ? "" : String(a));
export const num = (a) => parseFloat(str(a));

export function deepClone(l) {
  if (!Array.isArray(l)) return l instanceof Q ? new Q(l.v) : l;
  return l.map(deepClone);
}
