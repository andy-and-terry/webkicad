// Headless test of the schematic editor: build a circuit by clicking, undo/redo, edit
// properties, save to the mock val, then run ERC on the saved file.
// Usage: node tests/js/e2e_editor.mjs [screenshot-dir]
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { startMockVal } from "./mock_val.mjs";
import { startStatic } from "./static_server.mjs";
import { Schematic } from "../../js/schematic.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const SHOTS = process.argv[2];
const { store } = await startMockVal(8790);
await startStatic(process.cwd(), 8789);
const browser = await chromium.launch();
const results = [];
let page;
const step = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n").slice(0, 4).join(" / ")]); if (SHOTS) await page.screenshot({ path: `${SHOTS}/fail-${results.length}.png` }).catch(() => {}); }
};

async function setup(viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/kicanvas|Failed to load resource|ERR_/.test(m.text()) && p.errors.push(m.text()));
  await p.route(/kicanvas\.org|cdnjs\.cloudflare\.com/, (r) => r.abort());
  p.answers = [];
  p.on("dialog", (d) => d.type() === "prompt" ? d.accept(p.answers.shift() ?? "") : d.accept());
  await p.addInitScript(() => { localStorage.setItem("kicad.apiUrl", "http://localhost:8790"); localStorage.setItem("kicad.apiKey", "testkey"); });
  await p.goto("http://localhost:8789/");
  return p;
}
// click at sheet coordinates (mm)
async function at(p, x, y, opts = {}) {
  const pt = await p.evaluate(([x, y]) => {
    const svg = document.querySelector(".ed-canvas"), m = svg.getScreenCTM();
    const q = svg.createSVGPoint(); q.x = x; q.y = y;
    const r = q.matrixTransform(m); return [r.x, r.y];
  }, [x, y]);
  await p.mouse.click(pt[0], pt[1], opts);
}
async function tool(p, title) { await p.click(`.ed-toolbar button[title^="${title}"]`); }
async function place(p, query, label, x, y) {
  await tool(p, "Place symbol");
  await p.fill("dialog.picker input", query);
  await p.click(`dialog.picker button:text-is("${label}")`);
  await at(p, x, y);
  await p.waitForFunction((l) => [...document.querySelectorAll(".ed-props .meta")].some((m) => m.textContent === l), label);
}
const saved = () => store.get("proj/led/led.kicad_sch")?.text;
async function wire(p, pts) {
  await tool(p, "Draw wire");
  for (const [x, y] of pts) await at(p, x, y);
  await p.click("button.finish");
}

page = await setup({ width: 1400, height: 900 });
store.set("proj/led/led.kicad_pro", { text: "{}\n", t: new Date().toISOString() });

await step("new schematic opens editor", async () => {
  await page.click("details.project summary");
  await page.click("button:text('+ Schematic')");
  await page.waitForSelector("#pane-editor .ed-canvas");
  assert.ok(saved()?.startsWith("(kicad_sch"));
});
await step("zoom to a known area", async () => {
  await page.evaluate(() => { const svg = document.querySelector(".ed-canvas"); svg.setAttribute("viewBox", "20 30 60 50"); });
  // keep editor's internal view in sync by a no-op wheel then re-set
  await page.evaluate(() => {});
});
// The editor keeps its own view; set it through a fit after first placement instead.
await step("place R, LED (rotated), power, PWR_FLAG", async () => {
  await place(page, "Gen_Device R", "Gen_Device:R", 50.8, 50.8);
  await page.click(".ed-toolbar button:text('Fit')");
  await place(page, "Gen_Device LED", "Gen_Device:LED", 50.8, 63.5);
  await tool(page, "Rotate");
  await page.selectOption(".ed-toolbar select", "+3V3");
  await at(page, 50.8, 40.64);
  await page.selectOption(".ed-toolbar select", "GND");
  await at(page, 50.8, 72.39);
  await page.selectOption(".ed-toolbar select", "PWR_FLAG");
  await at(page, 45.72, 40.64);
  await at(page, 45.72, 72.39);
  await tool(page, "Select");
  const n = await page.$$eval(".ed-canvas .symbol", (e) => e.length);
  assert.equal(n, 6);
});
await step("draw wires (orthogonal, snapped)", async () => {
  await wire(page, [[50.8, 40.64], [50.8, 46.99]]);
  await wire(page, [[45.72, 40.64], [50.8, 40.64]]);
  await wire(page, [[50.8, 54.61], [50.8, 59.69]]);
  await wire(page, [[50.8, 67.31], [50.8, 72.39]]);
  await wire(page, [[45.72, 72.39], [50.8, 72.39]]);
  assert.equal(await page.$$eval(".ed-canvas .wire", (e) => e.length), 5);
});
await step("labels", async () => {
  page.answers.push("LED_A");
  await tool(page, "Net label");
  await at(page, 50.8, 57.15);
  page.answers.push("VLED");
  await tool(page, "Global label");
  await at(page, 50.8, 57.15);
  await tool(page, "Select");
  assert.equal(await page.$$eval(".ed-canvas .label, .ed-canvas .global_label", (e) => e.length), 2);
});
await step("undo / redo", async () => {
  await page.keyboard.press("Control+z");
  assert.equal(await page.$$eval(".ed-canvas .global_label", (e) => e.length), 0);
  await page.keyboard.press("Control+y");
  assert.equal(await page.$$eval(".ed-canvas .global_label", (e) => e.length), 1);
});
await step("select, edit Value and Footprint", async () => {
  await at(page, 50.8, 50.8);
  await page.waitForSelector(".ed-props input[data-prop=Value]");
  await page.fill(".ed-props input[data-prop=Value]", "330");
  await page.press(".ed-props input[data-prop=Value]", "Enter");
  await page.fill(".ed-props input[data-prop=Footprint]", "Resistor_SMD:R_0805_2012Metric");
  await page.press(".ed-props input[data-prop=Footprint]", "Enter");
  await page.waitForSelector(".ed-canvas .symbol.sel text.field:text-is('330')");
});
await step("move with drag, then undo restores position", async () => {
  const before = await page.$eval(".ed-canvas .symbol.sel", (e) => e.getBBox().x);
  const pt = async (x, y) => page.evaluate(([x, y]) => { const s = document.querySelector(".ed-canvas"), m = s.getScreenCTM(), q = s.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(m); return [r.x, r.y]; }, [x, y]);
  const a = await pt(50.8, 50.8), b = await pt(60.96, 50.8);
  await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 6 }); await page.mouse.up();
  const after = await page.$eval(".ed-canvas .symbol.sel", (e) => e.getBBox().x);
  assert.ok(Math.abs(after - before - 10.16) < 0.01, `${before} -> ${after}`);
  await page.keyboard.press("Control+z");
  const back = await page.$eval(".ed-canvas .symbol.sel", (e) => e.getBBox().x);
  assert.ok(Math.abs(back - before) < 0.01);
});
await step("mirror and delete via keyboard + undo", async () => {
  await page.keyboard.press("y");
  await page.keyboard.press("y");
  await page.keyboard.press("Delete");
  assert.equal(await page.$$eval(".ed-canvas .symbol", (e) => e.length), 5);
  await page.keyboard.press("Control+z");
  assert.equal(await page.$$eval(".ed-canvas .symbol", (e) => e.length), 6);
});
let savedText;
await step("save to storage", async () => {
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /Saved/.test(t.textContent)));
  savedText = saved();
  const s = new Schematic(savedText);
  assert.equal(s.symbols().length, 6);
  const r = s.symbols().find((x) => s.reference(x) === "R1");
  assert.equal(s.prop(r, "Value"), "330");
  assert.equal(s.prop(r, "Footprint"), "Resistor_SMD:R_0805_2012Metric");
});
await step("saved file passes ERC", async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "erc-")), "led.kicad_sch");
  fs.writeFileSync(f, savedText);
  if (SHOTS) fs.copyFileSync(f, `${SHOTS}/led.kicad_sch`);
  const out = execFileSync("python3", ["tools/erc.py", f], { encoding: "utf8" });
  console.log(out.trim());
  assert.match(out, / 0 error\(s\), 0 warning\(s\)/);
});
await step("reopen saved file, edit nothing, save -> identical bytes", async () => {
  await page.click(".ed-toolbar button:text('Close')");
  await page.click("[data-tab=projects]").catch(() => {});
  await page.click("ul.files button:text-is('led.kicad_sch')");
  await page.click("button:text('✎ Edit schematic')");
  await page.waitForSelector("#pane-editor .ed-canvas");
  await page.click(".ed-toolbar button:text('💾 Save')");
  await page.waitForFunction(() => [...document.querySelectorAll(".toast")].filter((t) => /Saved/.test(t.textContent)).length >= 1);
  assert.equal(saved(), savedText);
});
await step("place a vendored KiCad 10 symbol (down-converted)", async () => {
  await place(page, "Device R_Small", "Device:R_Small", 76.2, 50.8);
  await page.fill(".ed-props input[data-prop=Footprint]", "Resistor_SMD:R_0603_1608Metric");
  await page.press(".ed-props input[data-prop=Footprint]", "Enter");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  const tmp = new Schematic(saved());
  const r2 = tmp.symbols().find((x) => tmp.reference(x) === "R2");
  await tool(page, "No-connect");
  for (const p of tmp.pins(r2)) await at(page, p.x, p.y);
  await tool(page, "Select");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  const t = saved();
  assert.match(t, /\(symbol "Device:R_Small"/);
  assert.ok(!/\((hide|bold|italic) (yes|no)\)|show_name|in_pos_files|embedded_fonts/.test(t));
  const f2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "erc-")), "led2.kicad_sch");
  fs.writeFileSync(f2, t);
  if (SHOTS) fs.copyFileSync(f2, `${SHOTS}/led_with_rsmall.kicad_sch`);
  const out = execFileSync("python3", ["tools/erc.py", f2], { encoding: "utf8" });
  console.log(out.trim());
  assert.match(out, / 0 error\(s\), 0 warning\(s\)/);
});
if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-desktop.png` });
await step("no page errors (desktop)", async () => assert.deepEqual(page.errors, []));

// phone
page = await setup({ width: 390, height: 844 });
await step("phone: editor usable (toolbar scrolls, canvas visible, no page overflow)", async () => {
  await page.click("details.project summary");
  await page.click("ul.files button:text-is('led.kicad_sch')");
  await page.click("button:text('✎ Edit schematic')");
  await page.waitForSelector("#pane-editor .ed-canvas");
  const box = await page.$eval(".ed-canvas", (e) => e.getBoundingClientRect().height);
  assert.ok(box > 250, `canvas height ${box}`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 390, `scrollWidth ${sw}`);
  await page.tap(".ed-toolbar button[title^='Rotate']").catch(() => {});
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-phone.png` });
  assert.deepEqual(page.errors, []);
});

for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
