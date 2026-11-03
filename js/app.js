import { api, settings, ApiError } from "./api.js";
import { extractSymbol, symbolToSch, footprintToPcb } from "./preview.js";

// ---------- config ----------
export const GH = {
  user: "andy-and-terry", repo: "webkicad", branch: "main",
  symbolsDir: "kicad-symbols", footprintsDir: "kicad-footprints",
};
const PROJ = "proj/";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$/;
const TEXT_EXT = /\.(kicad_(sch|pcb|pro|sym|mod|prl|dru|wks)|json|txt|csv|md|net|xml)$/i;

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : String(k));
  return e;
};

// ---------- status / errors ----------
export function notify(msg, kind = "info", ms = kind === "error" ? 0 : 4000) {
  const box = $("#toasts");
  const t = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, h("span", {}, msg),
    h("button", { class: "x", "aria-label": "Dismiss", onclick: () => t.remove() }, "×"));
  box.append(t);
  if (ms) setTimeout(() => t.remove(), ms);
  if (kind === "error") console.warn("[kicad-online]", msg);
}
function fail(e, what) {
  const msg = e instanceof ApiError ? e.message : `${e?.message || e}`;
  notify(`${what}: ${msg}`, "error");
  if (e instanceof ApiError && (e.kind === "auth" || e.kind === "config")) openSettings();
}
async function busy(label, fn) {
  const b = $("#busy");
  b.textContent = label + "…";
  b.hidden = false;
  try { return await fn(); } finally { b.hidden = true; }
}
const fmtSize = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

// ---------- settings ----------
function openSettings() {
  const d = $("#settings");
  $("#set-url").value = settings.url;
  $("#set-key").value = settings.key;
  if (!d.open) d.showModal();
}
async function saveSettings(ev) {
  ev.preventDefault();
  const url = $("#set-url").value.trim();
  if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    $("#set-msg").textContent = "URL must start with https://";
    return;
  }
  settings.url = url;
  settings.key = $("#set-key").value;
  $("#set-msg").textContent = "Testing…";
  try {
    const l = await api.list();
    $("#set-msg").textContent = `Connected. ${l.length} file(s) stored.`;
    $("#settings").close();
    loadProjects();
  } catch (e) {
    $("#set-msg").textContent = e.message;
  }
}

// ---------- viewer ----------
let kicanvasReady = null;
function waitKiCanvas() {
  kicanvasReady ??= Promise.race([
    customElements.whenDefined("kicanvas-embed").then(() => true),
    new Promise((r) => setTimeout(() => r(false), 15000)),
  ]);
  return kicanvasReady;
}
export async function view(filename, text, info = "") {
  showPane("viewer");
  $("#viewer-title").textContent = filename;
  $("#viewer-info").replaceChildren(...(Array.isArray(info) ? info : [info]));
  const host = $("#viewer");
  host.replaceChildren(h("div", { class: "placeholder" }, "Loading viewer…"));
  if (!/\.kicad_(sch|pcb)$/i.test(filename)) {
    host.replaceChildren(h("pre", { class: "raw" }, text.slice(0, 200000)));
    return;
  }
  if (!(await waitKiCanvas())) {
    host.replaceChildren(h("div", { class: "placeholder error" },
      "KiCanvas failed to load from kicanvas.org (offline or blocked). Showing raw file instead."),
      h("pre", { class: "raw" }, text.slice(0, 200000)));
    notify("KiCanvas viewer could not be loaded", "error");
    return;
  }
  const src = h("kicanvas-source", { name: filename.split("/").pop() });
  src.textContent = text;
  const emb = h("kicanvas-embed", { controls: "full", controlslist: "nodownload" }, src);
  host.replaceChildren(emb);
}

// ---------- projects ----------
let files = [];
function groupProjects() {
  const projects = new Map(), loose = [];
  for (const f of files) {
    if (f.name.startsWith(PROJ)) {
      const [, p, ...rest] = f.name.split("/");
      if (!p || !rest.length) { loose.push(f); continue; }
      const g = projects.get(p) || { name: p, files: [], modified: null, size: 0 };
      g.files.push(f);
      g.size += f.size || 0;
      if (f.lastModified && (!g.modified || f.lastModified > g.modified)) g.modified = f.lastModified;
      projects.set(p, g);
    } else loose.push(f);
  }
  return { projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)), loose };
}

export async function loadProjects() {
  const list = $("#projects");
  if (!settings.configured) {
    list.replaceChildren(h("p", { class: "empty" }, "Storage not configured. ", h("button", { onclick: openSettings }, "Open Settings")));
    return;
  }
  list.replaceChildren(h("p", { class: "empty" }, "Loading…"));
  try {
    files = await api.list();
  } catch (e) {
    list.replaceChildren(h("p", { class: "empty error" }, e.message, " ", h("button", { onclick: loadProjects }, "Retry")));
    fail(e, "Loading projects");
    return;
  }
  renderProjects();
}

const openState = new Set();
function renderProjects() {
  const { projects, loose } = groupProjects();
  const list = $("#projects");
  const items = projects.map((p) => projectCard(p));
  if (loose.length) items.push(projectCard({ name: null, files: loose, modified: null }));
  list.replaceChildren(...(items.length ? items : [h("p", { class: "empty" }, "No projects yet. Create one or upload files.")]));
}

function projectCard(p) {
  const det = h("details", { class: "project", open: openState.has(p.name ?? "") });
  det.addEventListener("toggle", () => (det.open ? openState.add(p.name ?? "") : openState.delete(p.name ?? "")));
  const actions = p.name ? h("div", { class: "actions" },
    h("button", { onclick: () => uploadTo(p.name), title: "Upload files or .zip" }, "Upload"),
    h("button", { onclick: () => downloadZip(p) }, "Zip"),
    h("button", { onclick: () => renameProject(p) }, "Rename"),
    h("button", { onclick: () => duplicateProject(p) }, "Duplicate"),
    h("button", { class: "danger", onclick: () => deleteProject(p) }, "Delete")) : null;
  det.append(
    h("summary", {}, h("b", {}, p.name ?? "Other files"),
      h("span", { class: "meta" }, `${p.files.length} file(s) · ${fmtDate(p.modified)}`)),
    actions,
    h("ul", { class: "files" }, p.files.sort((a, b) => a.name.localeCompare(b.name)).map((f) => {
      const short = p.name ? f.name.slice(PROJ.length + p.name.length + 1) : f.name;
      return h("li", {},
        h("button", { class: "link", onclick: () => openFile(f.name) }, short),
        h("span", { class: "meta" }, `${fmtSize(f.size)} · ${fmtDate(f.lastModified)}`),
        h("span", { class: "fileacts" },
          h("button", { onclick: () => downloadFile(f.name), "aria-label": `Download ${short}` }, "⤓"),
          h("button", { class: "danger", onclick: () => deleteFile(f.name), "aria-label": `Delete ${short}` }, "✕")));
    })));
  return det;
}

async function openFile(name) {
  try {
    const text = await busy(`Loading ${name}`, () => api.get(name));
    const info = [];
    if (/\.kicad_sch$/i.test(name) && window.KiCadEditor) {
      info.push(h("button", { onclick: () => window.KiCadEditor.open(name, text) }, "Edit schematic"));
    }
    view(name, text, info);
  } catch (e) { fail(e, `Opening ${name}`); }
}

function saveBlob(name, blob) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function downloadFile(name) {
  try { saveBlob(name.split("/").pop(), new Blob([await api.get(name)], { type: "text/plain" })); }
  catch (e) { fail(e, `Downloading ${name}`); }
}
async function deleteFile(name) {
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
  try { await busy("Deleting", () => api.del(name)); notify(`Deleted ${name}`); loadProjects(); }
  catch (e) { fail(e, `Deleting ${name}`); }
}

function askName(msg, def = "") {
  const n = prompt(msg, def);
  if (n == null) return null;
  if (!NAME_RE.test(n)) { notify("Use letters, digits, _ . - (max 64 chars).", "error"); return null; }
  if (groupProjects().projects.some((p) => p.name === n)) { notify(`Project ${n} already exists`, "error"); return null; }
  return n;
}

function minimalPro(name) {
  return JSON.stringify({ meta: { filename: `${name}.kicad_pro`, version: 1 }, board: {}, schematic: {}, libraries: {},
    sheets: [], text_variables: {} }, null, 2) + "\n";
}

async function newProject() {
  const n = askName("New project name:");
  if (!n) return;
  try {
    await busy("Creating", () => api.put(`${PROJ}${n}/${n}.kicad_pro`, minimalPro(n)));
    openState.add(n);
    notify(`Created project ${n}`);
    loadProjects();
  } catch (e) { fail(e, "Creating project"); }
}

// copy every file of project p to newName (renaming files named after the project)
async function copyProject(p, newName, progress) {
  let i = 0;
  for (const f of p.files) {
    const rel = f.name.slice(PROJ.length + p.name.length + 1);
    let target = rel;
    const base = rel.split("/").pop();
    if (base.startsWith(p.name + ".") || base.startsWith(p.name + "-")) target = rel.slice(0, rel.length - base.length) + newName + base.slice(p.name.length);
    let text = await api.get(f.name);
    if (/\.kicad_pro$/.test(target)) text = text.replace(`"${p.name}.kicad_pro"`, `"${newName}.kicad_pro"`);
    await api.put(`${PROJ}${newName}/${target}`, text);
    progress(++i, p.files.length);
  }
}
async function duplicateProject(p) {
  const n = askName(`Duplicate ${p.name} as:`, `${p.name}-copy`);
  if (!n) return;
  try {
    await busy("Duplicating", () => copyProject(p, n, (i, t) => ($("#busy").textContent = `Copying ${i}/${t}…`)));
    notify(`Duplicated to ${n}`);
    loadProjects();
  } catch (e) { fail(e, "Duplicating"); loadProjects(); }
}
async function renameProject(p) {
  const n = askName(`Rename ${p.name} to:`, p.name);
  if (!n) return;
  try {
    await busy("Renaming", async () => {
      await copyProject(p, n, (i, t) => ($("#busy").textContent = `Copying ${i}/${t}…`));
      for (const f of p.files) await api.del(f.name);   // only after every copy succeeded
    });
    notify(`Renamed ${p.name} → ${n}`);
    loadProjects();
  } catch (e) { fail(e, "Renaming (original kept)"); loadProjects(); }
}
async function deleteProject(p) {
  if (!confirm(`Delete project ${p.name} and its ${p.files.length} file(s)? This cannot be undone.`)) return;
  try {
    await busy("Deleting", async () => { for (const f of p.files) await api.del(f.name); });
    notify(`Deleted ${p.name}`);
    loadProjects();
  } catch (e) { fail(e, "Deleting project"); loadProjects(); }
}

function needZip() {
  if (window.JSZip) return true;
  notify("JSZip library failed to load (offline or CDN blocked); zip features unavailable.", "error");
  return false;
}
async function downloadZip(p) {
  if (!needZip()) return;
  try {
    const zip = new JSZip();
    await busy("Zipping", async () => {
      for (const f of p.files) zip.file(`${p.name}/${f.name.slice(PROJ.length + p.name.length + 1)}`, await api.get(f.name));
    });
    saveBlob(`${p.name}.zip`, await zip.generateAsync({ type: "blob" }));
  } catch (e) { fail(e, "Creating zip"); }
}

function pickFiles(accept) {
  return new Promise((res) => {
    const i = h("input", { type: "file", multiple: true, accept });
    i.addEventListener("change", () => res([...i.files]));
    i.click();
  });
}
async function uploadTo(project) {
  const picked = await pickFiles(".kicad_sch,.kicad_pcb,.kicad_pro,.kicad_sym,.kicad_mod,.kicad_prl,.kicad_dru,.zip");
  if (!picked.length) return;
  const items = [];
  for (const f of picked) {
    if (/\.zip$/i.test(f.name)) {
      if (!needZip()) return;
      const z = await JSZip.loadAsync(f);
      const names = Object.keys(z.files).filter((n) => !z.files[n].dir && TEXT_EXT.test(n) && !n.startsWith("__MACOSX"));
      // strip a single common top folder
      const tops = new Set(names.map((n) => n.split("/")[0]));
      const strip = tops.size === 1 && names.every((n) => n.includes("/"));
      for (const n of names) items.push([strip ? n.slice(n.indexOf("/") + 1) : n, await z.files[n].async("string")]);
    } else if (TEXT_EXT.test(f.name)) items.push([f.name, await f.text()]);
    else notify(`Skipped ${f.name} (not a KiCad text file)`, "warn");
  }
  if (!project) {
    const pro = items.find(([n]) => /\.kicad_pro$/.test(n));
    project = askName("Upload into new project named:", pro ? pro[0].split("/").pop().replace(/\.kicad_pro$/, "") : "");
    if (!project) return;
  }
  try {
    await busy("Uploading", async () => {
      let i = 0;
      for (const [n, text] of items) {
        await api.put(`${PROJ}${project}/${n}`, text);
        $("#busy").textContent = `Uploading ${++i}/${items.length}…`;
      }
    });
    openState.add(project);
    notify(`Uploaded ${items.length} file(s) to ${project}`);
    loadProjects();
  } catch (e) { fail(e, "Upload"); loadProjects(); }
}

// ---------- library ----------
let index = null, byKey = new Map();
async function loadIndex() {
  try {
    const r = await fetch("index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    index = j.items.map((e) => ({ ...e, hay: `${e.lib}:${e.name} ${e.d} ${e.k}`.toLowerCase() }));
    for (const e of index) byKey.set(`${e.t}:${e.lib}:${e.name}`, e);
    $("#lib-count").textContent = `${index.length} items`;
    searchLib();
  } catch (e) {
    $("#lib-results").replaceChildren(h("p", { class: "empty error" }, `Could not load index.json: ${e.message}`));
  }
}
const LIMIT = 300;
function searchLib() {
  if (!index) return;
  const terms = $("#lib-q").value.toLowerCase().split(/\s+/).filter(Boolean);
  const type = $("#lib-type").value, src = $("#lib-src").value;
  const hits = [];
  let total = 0;
  for (const e of index) {
    if (type && e.t !== type) continue;
    if (src && e.src !== src) continue;
    if (!terms.every((t) => e.hay.includes(t))) continue;
    total++;
    if (hits.length < LIMIT) hits.push(e);
  }
  const groups = new Map();
  for (const e of hits) {
    const k = `${e.t === "sym" ? "Symbols" : "Footprints"} · ${e.lib}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  const out = [h("p", { class: "meta" }, total > LIMIT ? `${total} matches, showing ${LIMIT}. Refine the search.` : `${total} match(es)`)];
  for (const [k, es] of groups) {
    out.push(h("details", { class: "libgroup", open: groups.size <= 6 || !!terms.length },
      h("summary", {}, k, h("span", { class: "meta" }, ` ${es.length}${es[0].src === "gen" ? " · generated" : " · KiCad"}`)),
      h("ul", {}, es.map((e) => h("li", {}, h("button", { class: "link", onclick: () => previewLib(e), title: e.d }, e.name),
        h("span", { class: "meta desc" }, e.d))))));
  }
  $("#lib-results").replaceChildren(...out);
}
let searchTimer;
const debouncedSearch = () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchLib, 80); };

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.text();
}
async function previewLib(e) {
  try {
    const info = [h("p", {}, h("b", {}, `${e.lib}:${e.name}`), e.src === "kicad" ? " (official KiCad library)" : " (generated)"),
      e.d ? h("p", {}, e.d) : null];
    if (e.ds) info.push(h("p", {}, h("a", { href: e.ds, target: "_blank", rel: "noopener" }, "Datasheet")));
    if (e.t === "sym") {
      const text = await busy("Loading symbol", () => fetchText(e.path));
      let parent = null;
      if (e.ext) parent = await fetchText(e.path.replace(/[^/]+$/, `${e.ext}.kicad_sym`));
      const sym = extractSymbol(text, e.name, parent);
      if (e.fp) {
        const fe = byKey.get(`fp:${e.fp}`);
        info.push(h("p", {}, "Footprint: ", fe ? h("button", { class: "link", onclick: () => previewLib(fe) }, e.fp) : `${e.fp} (not in library)`));
      }
      view(`${e.name}.kicad_sch`, symbolToSch(sym, e.lib), info);
    } else {
      const text = await busy("Loading footprint", () => fetchText(e.path));
      view(`${e.name}.kicad_pcb`, footprintToPcb(text, e.lib), info);
    }
  } catch (err) { notify(`Preview failed: ${err.message}`, "error"); }
}

// ---------- layout (phone tabs) ----------
function showPane(name) {
  document.body.dataset.pane = name;
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", b.dataset.tab === name);
}

// ---------- boot ----------
export function boot() {
  $("#btn-settings").addEventListener("click", openSettings);
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#set-cancel").addEventListener("click", () => $("#settings").close());
  $("#btn-new").addEventListener("click", newProject);
  $("#btn-upload").addEventListener("click", () => uploadTo(null));
  $("#btn-refresh").addEventListener("click", loadProjects);
  $("#lib-q").addEventListener("input", debouncedSearch);
  $("#lib-type").addEventListener("change", searchLib);
  $("#lib-src").addEventListener("change", searchLib);
  for (const b of document.querySelectorAll("[data-tab]")) b.addEventListener("click", () => showPane(b.dataset.tab));
  window.addEventListener("offline", () => notify("Network connection lost", "error"));
  window.addEventListener("online", () => notify("Back online"));
  window.addEventListener("unhandledrejection", (ev) => notify(`Unexpected error: ${ev.reason?.message || ev.reason}`, "error"));
  showPane("projects");
  loadProjects();
  loadIndex();
  if (!settings.configured) openSettings();
}
