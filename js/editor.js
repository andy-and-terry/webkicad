// Browser schematic editor: SVG view of a Schematic, touch + mouse + keyboard tools.
import { Schematic, xform, snap, GRID } from "./schematic.js";
import { find, findAll, str, num } from "./sexpr.js";

const NS = "http://www.w3.org/2000/svg";
const S = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
const H = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : String(k));
  return e;
};
const at = (l) => { const a = find(l, "at"); return [num(a[1]), num(a[2]), a.length > 3 ? num(a[3]) : 0]; };
const hidden = (l) => { const e = find(l, "effects"); return !!(e && e.includes("hide")) || (find(l, "hide") && str(find(l, "hide")[1]) !== "no"); };
const fontSize = (l) => { const e = find(l, "effects"); const f = e && find(e, "font"); const s = f && find(f, "size"); return s ? num(s[1]) : 1.27; };
const POWER = ["GND", "+3V3", "+5V", "+12V", "VCC", "PWR_FLAG"];

export class Editor {
  constructor({ host, api, notify, loadSymbol, searchSymbols, onClose }) {
    Object.assign(this, { host, api, notify, loadSymbol, searchSymbols, onClose });
    this.undoStack = []; this.redoStack = [];
    this.mode = "select"; this.sel = null; this.dirty = false;
    this.view = { x: 0, y: 0, w: 297, h: 210 };
    this.pointers = new Map();
    this._key = (e) => this.onKey(e);
  }

  // ---------- lifecycle ----------
  open(name, text) {
    this.name = name;
    const proj = name.split("/").slice(-1)[0].replace(/\.kicad_sch$/, "");
    this.s = new Schematic(text, { projectName: name.startsWith("proj/") ? name.split("/")[1] : proj });
    this.undoStack = []; this.redoStack = []; this.sel = null; this.dirty = false;
    this.buildUI();
    this.fit();
    this.render();
    document.addEventListener("keydown", this._key);
  }
  close() {
    if (this.dirty && !confirm("Discard unsaved changes?")) return;
    document.removeEventListener("keydown", this._key);
    this.host.replaceChildren();
    this.onClose?.();
  }

  // ---------- history ----------
  edit(fn) {
    const before = this.s.text();
    try { fn(); } catch (e) { this.notify(`Edit failed: ${e.message}`, "error"); this.s = this._reload(before); this.render(); return; }
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.render();
  }
  _reload(text) { return new Schematic(text, { projectName: this.s.projectName }); }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.s.text());
    this.s = this._reload(this.undoStack.pop());
    this.dirty = true; this.render();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.s.text());
    this.s = this._reload(this.redoStack.pop());
    this.dirty = true; this.render();
  }
  get selected() { return this.sel ? this.s.byUuid(this.sel) : null; }

  // ---------- UI ----------
  buildUI() {
    const tool = (m, label, title) => H("button", { "data-mode": m, title, onclick: () => this.setMode(m) }, label);
    const act = (label, title, fn, attrs = {}) => H("button", { title, onclick: fn, ...attrs }, label);
    this.powerSel = H("select", { "aria-label": "Power symbol", onchange: () => this.setMode("power") }, POWER.map((p) => H("option", { value: p }, p)));
    this.toolbar = H("div", { class: "ed-toolbar", role: "toolbar" },
      tool("select", "↖ Select", "Select / move (Esc)"),
      tool("wire", "╱ Wire", "Draw wire (W); tap points, double-tap or Finish to end"),
      tool("label", "Label", "Net label (L)"),
      tool("global", "Global", "Global label (G)"),
      tool("power", "⏚ Power", "Place power symbol (P)"), this.powerSel,
      tool("junction", "• Junction", "Junction (J)"),
      tool("noconnect", "✕ NC", "No-connect flag (Q)"),
      act("+ Symbol", "Place symbol from library (A)", () => this.pickSymbol()),
      H("span", { class: "sep" }),
      act("⟳", "Rotate (R)", () => this.rotateSel(), { "aria-label": "Rotate" }),
      act("⇋", "Mirror left/right (Y)", () => this.mirrorSel("y"), { "aria-label": "Mirror Y" }),
      act("⇵", "Mirror up/down (X)", () => this.mirrorSel("x"), { "aria-label": "Mirror X" }),
      act("🗑", "Delete (Del)", () => this.deleteSel(), { "aria-label": "Delete" }),
      H("span", { class: "sep" }),
      act("↶", "Undo (Ctrl+Z)", () => this.undo(), { "aria-label": "Undo" }),
      act("↷", "Redo (Ctrl+Y)", () => this.redo(), { "aria-label": "Redo" }),
      act("Fit", "Zoom to fit", () => { this.fit(); this.applyView(); }),
      H("span", { class: "sep" }),
      act("💾 Save", "Save to storage (Ctrl+S)", () => this.save(), { class: "primary" }),
      act("⤓", "Download .kicad_sch", () => this.download(), { "aria-label": "Download" }),
      act("Close", "Close editor", () => this.close()));
    this.finishBtn = H("button", { class: "finish", hidden: true, onclick: () => this.finishWire() }, "Finish wire");
    this.svg = S("svg", { class: "ed-canvas", tabindex: "0" });
    this.svg.addEventListener("pointerdown", (e) => this.onDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onUp(e));
    this.svg.addEventListener("pointercancel", (e) => this.onUp(e));
    this.svg.addEventListener("dblclick", () => this.mode === "wire" && this.finishWire());
    this.svg.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomAt(e, e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    this.props = H("aside", { class: "ed-props" });
    this.status = H("div", { class: "ed-status" });
    this.host.replaceChildren(H("div", { class: "ed-title" }, H("b", {}, this.name), this.status), this.toolbar,
      H("div", { class: "ed-body" }, H("div", { class: "ed-canvas-wrap" }, this.svg, this.finishBtn), this.props));
    this.setMode("select");
  }

  setMode(m) {
    if (this.mode === "wire" && m !== "wire") this.finishWire();
    this.mode = m;
    for (const b of this.toolbar.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", b.dataset.mode === m);
    this.svg.dataset.mode = m;
    this.updateStatus();
  }
  updateStatus() {
    const hint = { select: "Tap to select, drag to move, drag empty space to pan", wire: "Tap to add wire points", label: "Tap to place a net label",
      global: "Tap to place a global label", power: `Tap to place ${this.powerSel.value}`, junction: "Tap to place a junction",
      noconnect: "Tap a pin to mark it unconnected", place: `Tap to place ${this.pending?.name ?? ""}` }[this.mode];
    this.status.textContent = `${this.dirty ? "● unsaved · " : ""}${hint}`;
  }

  // ---------- view ----------
  fit() {
    const xs = [], ys = [];
    for (const s of this.s.symbols()) { const [x, y] = at(s); xs.push(x); ys.push(y); }
    for (const w of this.s.items("wire")) for (const [x, y] of this.s.wireEnds(w)) { xs.push(x); ys.push(y); }
    for (const k of ["label", "global_label", "junction"]) for (const l of this.s.items(k)) { const [x, y] = at(l); xs.push(x); ys.push(y); }
    if (!xs.length) { this.view = { x: 0, y: 0, w: 150, h: 100 }; return; }
    const pad = 15, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    this.view = { x: x0, y: y0, w: Math.max(60, Math.max(...xs) + pad - x0), h: Math.max(40, Math.max(...ys) + pad - y0) };
  }
  applyView() { const v = this.view; this.svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`); }
  toWorld(e) {
    const p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return [0, 0];
    const r = p.matrixTransform(m.inverse());
    return [r.x, r.y];
  }
  zoomAt(e, f) {
    const [wx, wy] = this.toWorld(e), v = this.view;
    this.view = { x: wx - (wx - v.x) * f, y: wy - (wy - v.y) * f, w: v.w * f, h: v.h * f };
    this.applyView();
  }

  // ---------- rendering ----------
  render() {
    this.applyView();
    const s = this.s;
    const g = S("g");
    // grid dots (only when zoomed in enough)
    if (this.view.w < 200) {
      const v = this.view, step = GRID * 2;
      const d = [];
      for (let x = Math.ceil(v.x / step) * step; x < v.x + v.w; x += step)
        for (let y = Math.ceil(v.y / step) * step; y < v.y + v.h; y += step) d.push(`M${x.toFixed(2)} ${y.toFixed(2)}h0`);
      g.append(S("path", { d: d.join(""), class: "grid" }));
    }
    for (const w of s.items("wire")) {
      const pts = s.wireEnds(w).map((p) => p.join(",")).join(" ");
      const id = s.uuidOf(w);
      g.append(S("g", { "data-uuid": id, class: "item wire" + (id === this.sel ? " sel" : "") },
        S("polyline", { points: pts, class: "wire-line" }), S("polyline", { points: pts, class: "hit" })));
    }
    for (const j of s.items("junction")) { const [x, y] = at(j); g.append(S("circle", { cx: x, cy: y, r: 0.5, class: "junction item", "data-uuid": s.uuidOf(j) })); }
    for (const n of s.items("no_connect")) {
      const [x, y] = at(n), d = 0.7;
      g.append(S("path", { d: `M${x - d} ${y - d}L${x + d} ${y + d}M${x + d} ${y - d}L${x - d} ${y + d}`, class: "nc item" + (s.uuidOf(n) === this.sel ? " sel" : ""), "data-uuid": s.uuidOf(n) }));
    }
    for (const kind of ["label", "global_label", "hierarchical_label"]) for (const l of s.items(kind)) g.append(this.drawLabel(l, kind));
    for (const sym of s.symbols()) g.append(this.drawSymbol(sym));
    if (this.wirePts?.length) {
      g.append(S("polyline", { points: this.wirePts.map((p) => p.join(",")).join(" ") + (this.cursor ? " " + this.ortho(this.wirePts.at(-1), this.cursor).map((p) => p.join(",")).join(" ") : ""), class: "wire-preview" }));
    }
    this.svg.replaceChildren(g);
    this.renderProps();
    this.updateStatus();
  }

  drawLabel(l, kind) {
    const [x, y, a] = at(l), t = str(l[1]), id = this.s.uuidOf(l), fs = fontSize(l);
    const grp = S("g", { "data-uuid": id, class: `item ${kind}` + (id === this.sel ? " sel" : "") });
    const right = a === 180 || a === 270;
    const vertical = a === 90 || a === 270;
    const tx = S("text", { x, y: kind === "label" ? y - 0.3 : y, "font-size": fs, "text-anchor": right ? "end" : "start",
      "dominant-baseline": kind === "label" ? "auto" : "middle", transform: vertical ? `rotate(-90 ${x} ${y})` : null }, t);
    if (kind !== "label") {
      const w = t.length * fs * 0.75 + fs * 1.5, h = fs * 1.6, dir = right ? -1 : 1;
      const pts = [[x, y], [x + dir * h / 2, y - h / 2], [x + dir * w, y - h / 2], [x + dir * w, y + h / 2], [x + dir * h / 2, y + h / 2]];
      grp.append(S("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "glabel", transform: vertical ? `rotate(-90 ${x} ${y})` : null }));
      tx.setAttribute("x", x + dir * h * 0.8);
    }
    grp.append(tx, S("circle", { cx: x, cy: y, r: 0.35, class: "anchor" }));
    return grp;
  }

  drawSymbol(sym) {
    const s = this.s, id = s.uuidOf(sym);
    const libId = str(find(sym, "lib_id")[1]);
    const lib = s.libSymbol(libId);
    const [X, Y, A] = at(sym);
    const m = find(sym, "mirror") ? str(find(sym, "mirror")[1]) : null;
    const unit = num(find(sym, "unit")?.[1] ?? 1);
    const ex = xform(1, 0, A, m), ey = xform(0, 1, A, m);
    const grp = S("g", { "data-uuid": id, class: "item symbol" + (id === this.sel ? " sel" : "") });
    // lib coords are y-up; the matrix (from xform) does the flip, rotation and mirror
    const body = S("g", { transform: `matrix(${ex[0]} ${ex[1]} ${ey[0]} ${ey[1]} ${X} ${Y})`, class: "body" });
    const P = (x, y) => xform(x, y, A, m).map((v, i) => v + (i ? Y : X));
    if (!lib) {
      grp.append(S("rect", { x: X - 2.54, y: Y - 2.54, width: 5.08, height: 5.08, class: "missing" }),
        S("text", { x: X, y: Y, "font-size": 1.27, "text-anchor": "middle" }, `? ${libId}`));
      return grp;
    }
    const pinNamesHidden = !!find(lib, "pin_names")?.includes("hide");
    const pinNumsHidden = !!find(lib, "pin_numbers")?.includes("hide");
    const nameOffset = num(find(find(lib, "pin_names") || [], "offset")?.[1] ?? 0.508);
    const texts = [];
    for (const sub of findAll(lib, "symbol")) {
      const [u, st] = str(sub[1]).split("_").slice(-2).map(Number);
      if ((u !== 0 && u !== unit) || st > 1) continue;
      for (const c of sub) {
        if (!Array.isArray(c)) continue;
        const fill = str(find(find(c, "fill") || [], "type")?.[1] ?? "none");
        const cls = `g fill-${fill}`;
        if (c[0] === "rectangle") {
          const [a, b] = [find(c, "start"), find(c, "end")].map((p) => [num(p[1]), num(p[2])]);
          body.append(S("rect", { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), class: cls }));
        } else if (c[0] === "polyline" || c[0] === "bezier") {
          const pts = findAll(find(c, "pts"), "xy").map((p) => `${num(p[1])},${num(p[2])}`).join(" ");
          body.append(S(fill === "none" ? "polyline" : "polygon", { points: pts, class: cls }));
        } else if (c[0] === "circle") {
          const ce = find(c, "center");
          body.append(S("circle", { cx: num(ce[1]), cy: num(ce[2]), r: num(find(c, "radius")[1]), class: cls }));
        } else if (c[0] === "arc") {
          const [a, mi, b] = ["start", "mid", "end"].map((k) => { const p = find(c, k); return [num(p[1]), num(p[2])]; });
          body.append(S("path", { d: arcPath(a, mi, b), class: cls }));
        } else if (c[0] === "text" && !hidden(c)) {
          const [tx, ty] = at(c);
          texts.push([P(tx, ty), str(c[1]), fontSize(c), "middle"]);
        } else if (c[0] === "pin" && !c.includes("hide")) {
          const [px, py, pa] = at(c), len = num(find(c, "length")[1]);
          const dx = Math.cos(pa * Math.PI / 180), dy = Math.sin(pa * Math.PI / 180);
          body.append(S("line", { x1: px, y1: py, x2: px + dx * len, y2: py + dy * len, class: "pin" }));
          const name = str(find(c, "name")[1]), number = str(find(c, "number")[1]);
          if (!pinNamesHidden && name && name !== "~") {
            const [ix, iy] = [px + dx * (len + nameOffset + 0.4), py + dy * (len + nameOffset + 0.4)];
            const [sx] = P(ix, iy), [ox] = P(px + dx * len, py + dy * len);
            texts.push([P(ix, iy), name, 1.0, Math.abs(sx - ox) < 0.01 ? "middle" : sx > ox ? "start" : "end"]);
          }
          if (!pinNumsHidden) {
            const mid = P(px + dx * len / 2 - dy * 0.5, py + dy * len / 2 + dx * 0.5);
            texts.push([mid, number, 0.9, "middle"]);
          }
        }
      }
    }
    grp.append(body);
    for (const [[x, y], t, size, anchor] of texts)
      grp.append(S("text", { x, y, "font-size": size, "text-anchor": anchor, "dominant-baseline": "middle", class: "pintext" }, t));
    for (const p of findAll(sym, "property")) {
      if (hidden(p)) continue;
      const [x, y] = at(p);
      let t = str(p[2]);
      if (str(p[1]) === "Reference") t = s.reference(sym) || t;
      grp.append(S("text", { x, y, "font-size": fontSize(p), "text-anchor": "middle", "dominant-baseline": "middle", class: "field" }, t));
    }
    return grp;
  }

  // ---------- properties panel ----------
  renderProps() {
    const it = this.selected;
    if (!it) { this.props.replaceChildren(H("p", { class: "meta" }, "Nothing selected.")); return; }
    const kind = String(it[0]);
    const rows = [];
    if (kind === "symbol") {
      const lib = str(find(it, "lib_id")[1]);
      rows.push(H("p", { class: "meta" }, lib));
      for (const key of ["Reference", "Value", "Footprint", "Datasheet"]) {
        const v = key === "Reference" ? this.s.reference(it) : this.s.prop(it, key) ?? "";
        const inp = H("input", { value: v, "aria-label": key, "data-prop": key });
        inp.addEventListener("change", () => this.edit(() => this.s.setProperty(this.selected, key, inp.value)));
        rows.push(H("label", {}, key, inp));
      }
      const units = this.unitCount(lib);
      if (units > 1) {
        const sel = H("select", { "aria-label": "Unit" }, Array.from({ length: units }, (_, i) => H("option", { value: i + 1, selected: num(find(it, "unit")[1]) === i + 1 }, `Unit ${String.fromCharCode(65 + i)}`)));
        sel.addEventListener("change", () => this.edit(() => this.s.setUnit(this.selected, +sel.value)));
        rows.push(H("label", {}, "Unit", sel));
      }
    } else if (kind.endsWith("label")) {
      const inp = H("input", { value: str(it[1]), "aria-label": "Label text" });
      inp.addEventListener("change", () => this.edit(() => this.s.setLabelText(this.selected, inp.value)));
      rows.push(H("label", {}, "Net name", inp));
    } else rows.push(H("p", { class: "meta" }, kind));
    this.props.replaceChildren(H("h3", {}, kind.replace("_", " ")), ...rows);
  }
  unitCount(libId) {
    const lib = this.s.libSymbol(libId);
    let n = 1;
    for (const sub of findAll(lib || [], "symbol")) n = Math.max(n, +str(sub[1]).split("_").slice(-2)[0]);
    return n;
  }
  // ---------- selection ops ----------
  rotateSel() { const it = this.selected; if (it) this.edit(() => this.s.rotate(it)); }
  mirrorSel(ax) { const it = this.selected; if (it) this.edit(() => this.s.mirror(it, ax)); }
  deleteSel() {
    const it = this.selected;
    if (!it) return;
    this.sel = null;
    this.edit(() => this.s.remove(it));
  }

  // ---------- pointer ----------
  hitItem(e) {
    const el = e.target.closest?.("[data-uuid]");
    return el ? el.dataset.uuid : null;
  }
  onDown(e) {
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this.pinch = this.pinchDist(); this.drag = null; return; }
    const [wx, wy] = this.toWorld(e), sx = snap(wx), sy = snap(wy);
    if (this.mode === "select") {
      const id = this.hitItem(e);
      if (id) {
        this.sel = id;
        this.drag = { kind: "move", start: [wx, wy], moved: [0, 0], before: this.s.text() };
      } else {
        this.sel = null;
        this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, view: { ...this.view } };
      }
      this.render();
      return;
    }
    this.drag = { kind: "tap", sx: e.clientX, sy: e.clientY, view: { ...this.view }, world: [sx, sy] };
  }
  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinch) {
      const d = this.pinchDist();
      const c = [...this.pointers.values()].reduce((a, p) => ({ clientX: a.clientX + p.x / 2, clientY: a.clientY + p.y / 2 }), { clientX: 0, clientY: 0 });
      this.zoomAt(c, this.pinch / d);
      this.pinch = d;
      return;
    }
    const [wx, wy] = this.toWorld(e);
    if (this.mode === "wire" && this.wirePts?.length) { this.cursor = [snap(wx), snap(wy)]; this.render(); }
    const d = this.drag;
    if (!d) return;
    if (d.kind === "pan" || (d.kind === "tap" && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8)) {
      d.kind = "pan";
      const r = this.svg.getBoundingClientRect();
      const k = d.view.w / r.width;
      this.view = { ...d.view, x: d.view.x - (e.clientX - d.sx) * k, y: d.view.y - (e.clientY - d.sy) * k };
      this.applyView();
    } else if (d.kind === "move") {
      const want = [snap(wx - d.start[0]), snap(wy - d.start[1])];
      if (want[0] !== d.moved[0] || want[1] !== d.moved[1]) {
        const it = this.selected;
        if (it) this.s.move(it, want[0] - d.moved[0], want[1] - d.moved[1]);
        d.moved = want;
        this.render();
      }
    }
  }
  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === "move" && (d.moved[0] || d.moved[1])) {
      this.undoStack.push(d.before); this.redoStack = []; this.dirty = true;
      this.edit(() => this.s.autoJunctions());
      this.undoStack.pop();  // autoJunctions belongs to the same undo step
    } else if (d.kind === "tap") this.tap(...d.world);
  }
  pinchDist() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }

  ortho(a, b) { return a[0] === b[0] || a[1] === b[1] ? [b] : [[b[0], a[1]], b]; }

  tap(x, y) {
    switch (this.mode) {
      case "wire":
        if (!this.wirePts) this.wirePts = [[x, y]];
        else {
          const last = this.wirePts.at(-1);
          if (last[0] === x && last[1] === y) { this.finishWire(); return; }
          this.wirePts.push(...this.ortho(last, [x, y]));
        }
        this.finishBtn.hidden = false;
        this.render();
        break;
      case "label": case "global": {
        const t = prompt(this.mode === "label" ? "Net label:" : "Global label:", this.lastLabel || "");
        if (!t) return;
        this.lastLabel = t;
        this.edit(() => (this.mode === "label" ? this.s.addLabel(t, x, y) : this.s.addGlobalLabel(t, x, y)));
        break;
      }
      case "junction": this.edit(() => this.s.addJunction(x, y)); break;
      case "noconnect": this.edit(() => this.s.addNoConnect(x, y)); break;
      case "power": this.placeFromLib("Gen_power", this.powerSel.value, x, y); break;
      case "place": if (this.pending) this.placeFromLib(this.pending.lib, this.pending.name, x, y, this.pending); break;
    }
  }
  finishWire() {
    const pts = this.wirePts;
    this.wirePts = null; this.cursor = null; this.finishBtn.hidden = true;
    if (pts && pts.length > 1) this.edit(() => { for (let i = 1; i < pts.length; i++) this.s.addWire(...pts[i - 1], ...pts[i]); });
    else this.render();
  }

  async placeFromLib(lib, name, x, y, entry) {
    try {
      const sym = await this.loadSymbol(entry || { lib, name });
      let placed;
      this.edit(() => { placed = this.s.placeSymbol(`${lib}:${name}`, sym, x, y); });
      if (placed) this.sel = this.s.uuidOf(placed);
      for (const w of this.s.lastWarnings || []) this.notify(`${lib}:${name}: ${w}`, "warn");
      this.s.lastWarnings = [];
      this.render();
    } catch (e) { this.notify(`Cannot place ${lib}:${name}: ${e.message}`, "error"); }
  }

  pickSymbol() {
    const dlg = H("dialog", { class: "picker" });
    const list = H("ul", { class: "picker-list" });
    const inp = H("input", { type: "search", placeholder: "Search symbols (e.g. Device R, Conn_01x04)", "aria-label": "Search symbols" });
    const show = () => {
      list.replaceChildren(...this.searchSymbols(inp.value, 60).map((e) => H("li", {}, H("button", { class: "link", onclick: () => {
        this.pending = e; dlg.close(); dlg.remove(); this.setMode("place");
      } }, `${e.lib}:${e.name}`), H("span", { class: "meta desc" }, e.d))));
    };
    inp.addEventListener("input", show);
    dlg.append(H("h3", {}, "Place symbol"), inp, list, H("div", { class: "actions" }, H("button", { onclick: () => { dlg.close(); dlg.remove(); } }, "Cancel")));
    document.body.append(dlg);
    dlg.showModal();
    show();
    inp.focus();
  }

  // ---------- keyboard ----------
  onKey(e) {
    if (e.target.closest?.("input, select, textarea, dialog")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); this.redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); this.save(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { r: () => this.rotateSel(), x: () => this.mirrorSel("x"), y: () => this.mirrorSel("y"), delete: () => this.deleteSel(),
      backspace: () => this.deleteSel(), w: () => this.setMode("wire"), l: () => this.setMode("label"), g: () => this.setMode("global"),
      p: () => this.setMode("power"), j: () => this.setMode("junction"), q: () => this.setMode("noconnect"), a: () => this.pickSymbol(),
      escape: () => { this.mode === "wire" && this.wirePts ? this.finishWire() : this.setMode("select"); }, enter: () => this.mode === "wire" && this.finishWire() };
    if (map[k]) { e.preventDefault(); map[k](); }
  }

  // ---------- persistence ----------
  async save() {
    try {
      await this.api.put(this.name, this.s.text());
      this.dirty = false; this.updateStatus();
      this.notify(`Saved ${this.name}. Run ERC (tools/erc.py) on it before ordering boards.`);
    } catch (e) { this.notify(`Save failed: ${e.message}. Your edits are still here; use Download to keep a copy.`, "error"); }
  }
  download() {
    const a = H("a", { href: URL.createObjectURL(new Blob([this.s.text()], { type: "text/plain" })), download: this.name.split("/").pop() });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
}

// SVG arc through three points (start, mid, end) in y-down coords.
function arcPath(a, m, b) {
  const [ax, ay] = a, [bx, by] = m, [cx, cy] = b;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return `M${ax} ${ay}L${cx} ${cy}`;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const sweep = cross > 0 ? 1 : 0;
  const large = 0; // mid point given: choose large-arc by checking angle span
  const ang = (x, y) => Math.atan2(y - uy, x - ux);
  let span = ang(cx, cy) - ang(ax, ay);
  if (sweep) { while (span < 0) span += 2 * Math.PI; } else { while (span > 0) span -= 2 * Math.PI; }
  return `M${ax} ${ay}A${r} ${r} 0 ${Math.abs(span) > Math.PI ? 1 : large} ${sweep} ${cx} ${cy}`;
}
