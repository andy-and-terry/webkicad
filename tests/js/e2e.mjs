// Headless browser test of the web app against the mock val.
// Usage: node tests/js/e2e.mjs [path/to/jszip.min.js]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import assert from "node:assert/strict";
import { startMockVal } from "./mock_val.mjs";
import { startStatic } from "./static_server.mjs";

const ROOT = process.cwd();
const JSZIP = process.argv[2];
const { store } = await startMockVal(8788);
await startStatic(ROOT, 8787);
const browser = await chromium.launch();
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, e.message.split("\n").slice(0,6).join(" / ")]); await page?.screenshot({ path: `/tmp/fail-${results.length}.png` }).catch(()=>{}); } };

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && page.consoleErrors.push(m.text()));
  page.on("pageerror", (e) => page.consoleErrors.push("pageerror: " + e.message));
  await page.route("https://kicanvas.org/**", (r) => r.abort());   // not reachable from this sandbox
  await page.route("https://cdnjs.cloudflare.com/**", (r) => JSZIP ? r.fulfill({ path: JSZIP, contentType: "text/javascript" }) : r.abort());
  page.answers = [];
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(page.answers.shift() ?? "") : d.accept()));
  return page;
}
const openProj = (page, n) => page.$$eval("details.project", (ds, n) => ds.forEach((d) => { if (d.querySelector("b").textContent === n) d.open = true; }), n);
const toast = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });

const page = await newPage({ width: 1280, height: 800 });
await page.goto("http://localhost:8787/");

await step("settings dialog opens when unconfigured", async () => { await page.waitForSelector("dialog#settings[open]"); });
await step("bad key shows visible error", async () => {
  await page.fill("#set-url", "http://localhost:8788");
  await page.fill("#set-key", "wrong");
  await page.click("#settings-form button[type=submit]");
  await page.waitForFunction(() => /Bad API key/.test(document.querySelector("#set-msg").textContent));
});
await step("good key connects", async () => {
  await page.fill("#set-key", "testkey");
  await page.click("#settings-form button[type=submit]");
  await page.waitForSelector("dialog#settings:not([open])", { state: "attached" });
  await page.waitForSelector("text=No projects yet");
});
await step("key stored only in localStorage", async () => {
  assert.equal(await page.evaluate(() => localStorage.getItem("kicad.apiKey")), "testkey");
});
await step("create project", async () => {
  page.answers.push("demo");
  await page.click("#btn-new");
  await page.waitForSelector("details.project >> text=demo");
  assert.ok(store.has("proj/demo/demo.kicad_pro"));
});
await step("invalid project name rejected", async () => {
  page.answers.push("bad name/x");
  await page.click("#btn-new");
  await toast(page, /letters, digits/);
});
await step("upload zip into new project", async () => {
  if (!JSZIP) throw new Error("skipped: no jszip");
  const zipB64 = await page.evaluate(async () => {
    const z = new JSZip();
    z.file("board/board.kicad_pro", "{}\n");
    z.file("board/notes.txt", "hello\n");
    z.file("board/img.png", "binary");
    return z.generateAsync({ type: "base64" });
  });
  fs.writeFileSync("/tmp/up.zip", Buffer.from(zipB64, "base64"));
  page.answers.push("board");
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btn-upload")]);
  await fc.setFiles("/tmp/up.zip");
  await page.waitForSelector("details.project >> text=board");
  assert.ok(store.has("proj/board/board.kicad_pro") && store.has("proj/board/notes.txt") && !store.has("proj/board/img.png"));
});
await step("duplicate project renames files", async () => {
  page.answers.push("demo2");
  await openProj(page, "demo");
  await page.click("details.project:has(b:text-is('demo')) button:text('Duplicate')");
  await page.waitForSelector("details.project >> b:text-is('demo2')");
  assert.ok(store.has("proj/demo2/demo2.kicad_pro"));
  assert.match(store.get("proj/demo2/demo2.kicad_pro").text, /demo2\.kicad_pro/);
});
await step("rename project", async () => {
  page.answers.push("renamed");
  await openProj(page, "demo2");
  await page.click("details.project:has(b:text-is('demo2')) button:text('Rename')");
  await page.waitForSelector("details.project >> b:text-is('renamed')");
  assert.ok(store.has("proj/renamed/renamed.kicad_pro") && !store.has("proj/demo2/demo2.kicad_pro"));
});
await step("download project zip", async () => {
  if (!JSZIP) throw new Error("skipped: no jszip");
  await openProj(page, "board");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("details.project:has(b:text-is('board')) button:text('Zip')")]);
  assert.equal(dl.suggestedFilename(), "board.zip");
  const names = await page.evaluate(async (b64) => Object.values((await JSZip.loadAsync(b64, { base64: true })).files).filter((f) => !f.dir).map((f) => f.name), fs.readFileSync(await dl.path()).toString("base64"));
  assert.deepEqual(names.sort(), ["board/board.kicad_pro", "board/notes.txt"]);
});
await step("delete project", async () => {
  await openProj(page, "renamed");
  await page.click("details.project:has(b:text-is('renamed')) button:text('Delete')");
  await page.waitForFunction(() => ![...document.querySelectorAll("details.project b")].some((b) => b.textContent === "renamed"));
  assert.ok(![...store.keys()].some((k) => k.startsWith("proj/renamed/")));
});
await step("last modified shown", async () => {
  const t = await page.textContent("details.project:has(b:text-is('demo')) summary .meta");
  assert.match(t, /1 file\(s\) · \w+/);
  assert.ok(!t.includes("—"));
});
await step("library search from index.json", async () => {
  await page.fill("#lib-q", "pinheader_1x05 2.54");
  await page.waitForSelector("#lib-results button:text-is('PinHeader_1x05_P2.54mm_Vertical')");
  const groups = await page.$$eval("#lib-results details.libgroup summary", (s) => s.map((x) => x.textContent));
  assert.ok(groups.some((g) => g.includes("Gen_Connector_PinHeader_2.54mm")) && groups.some((g) => g.includes("Connector_PinHeader_2.54mm")), groups.join("|"));
});
await step("footprint preview builds valid kicad_pcb (KiCanvas blocked -> visible fallback)", async () => {
  await page.click("#lib-results details:has(summary:has-text('Gen_Connector_PinHeader_2.54mm')) button:text-is('PinHeader_1x05_P2.54mm_Vertical')");
  await page.waitForSelector("#viewer .placeholder.error", { timeout: 20000 });
  const txt = await page.textContent("#viewer pre.raw");
  assert.match(txt, /^\(kicad_pcb/);
  assert.equal((txt.match(/\(pad "/g) || []).length, 5);
  await toast(page, /KiCanvas viewer could not be loaded/);
});
await step("symbol preview (extends resolution) + footprint link + datasheet", async () => {
  await page.fill("#lib-q", "Device:LED_Small");
  await page.selectOption("#lib-src", "kicad");
  await page.click("#lib-results button:text-is('LED_Small')").catch(async () => {
    await page.fill("#lib-q", "LED");
    await page.click("#lib-results button:text-is('LED')");
  });
  await page.waitForFunction(() => /^\(kicad_sch/.test(document.querySelector("#viewer pre.raw")?.textContent || ""));
  const txt = await page.textContent("#viewer pre.raw");
  assert.match(txt, /\(lib_symbols/);
  assert.match(txt, /\(pin /);
  await page.selectOption("#lib-src", "gen");
  await page.fill("#lib-q", "Gen_Device R resistor");
  await page.click("#lib-results button:text-is('R')");
  await page.waitForSelector("#viewer-info >> text=Resistor_SMD:R_0603_1608Metric");
});
await step("network failure is visible", async () => {
  await page.evaluate(() => localStorage.setItem("kicad.apiUrl", "http://localhost:1"));
  await page.click("[data-tab=projects]").catch(() => {});
  await page.click("#btn-refresh");
  await toast(page, /Cannot reach/);
});
await step("no unexpected console errors", async () => {
  const unexpected = page.consoleErrors.filter((e) => !/kicanvas|ERR_FAILED|ERR_CONNECTION_REFUSED|Failed to load resource|404/i.test(e));
  assert.deepEqual(unexpected, []);
});

// phone layout
const phone = await newPage({ width: 390, height: 844 });
await phone.addInitScript(() => { localStorage.setItem("kicad.apiUrl", "http://localhost:8788"); localStorage.setItem("kicad.apiKey", "testkey"); });
await phone.goto("http://localhost:8787/");
await step("phone: tab bar, one pane, no horizontal scroll", async () => {
  await phone.waitForSelector("details.project >> text=demo");
  assert.ok(await phone.isVisible(".tabs"));
  assert.ok(!(await phone.isVisible("#pane-library")));
  const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 390, `scrollWidth ${sw}`);
  await phone.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/phone-projects.png` : "/tmp/phone-projects.png" });
  await phone.click("[data-tab=library]");
  await phone.fill("#lib-q", "Conn_01x04");
  await phone.waitForSelector("#lib-results button:text-is('Conn_01x04_Pin')");
  assert.ok(!(await phone.isVisible("#pane-projects")));
  await phone.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/phone-library.png` : "/tmp/phone-library.png" });
});

for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
