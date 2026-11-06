# KiCad Online

View and manage KiCad projects from any device (phone included). It is a static
web app, not KiCad itself. It is served by GitHub Pages, stores project files on
val.town, and renders them with [KiCanvas](https://kicanvas.org).

Live site: https://andy-and-terry.github.io/webkicad/

## Setup

1. **val.town storage**
   - Create an HTTP val and paste in the contents of [`val.ts`](val.ts).
   - In the val's *Environment variables*, add `KICAD_KEY` with a long random value, for example from `openssl rand -hex 32`.
   - Copy the val's HTTP endpoint URL, e.g. `https://<you>--<valname>.web.val.run`.
2. **GitHub Pages**
   - Go to *Settings → Pages → Source* and choose **GitHub Actions**.
   - On every push to `main`, [`.github/workflows/pages.yml`](.github/workflows/pages.yml) regenerates the libraries, runs all tests and deploys the site.
3. **App config**
   - Repo settings are in `GH` at the top of [`js/app.js`](js/app.js) (`andy-and-terry` / `webkicad` / `main`).
   - Open the site and click **Settings**, then enter the val URL and key.
   - The URL and key are stored in that browser's `localStorage` only. The key is never committed.

## Storage API (`val.ts`)

All requests need `Authorization: Bearer <KICAD_KEY>`. Keys are stored under the `kicad/` prefix in `std/blob`.

| Request | Result |
|---|---|
| `GET /` (optional `?prefix=proj/x/`) | `[{name, size, lastModified}]` |
| `GET /<name>` | file text |
| `PUT /<name>` | store body (max 10 MB) |
| `DELETE /<name>` | delete |

A project is the prefix `proj/<name>/`.

## Schematic editor

To start editing:
- Open a `.kicad_sch` in a project and tap **✎ Edit schematic**, or
- Use **+ Schematic** on a project to create a new one.

Tools (toolbar buttons, or keys in brackets):

| Tool | How to use it |
|---|---|
| Select (Esc) | Tap to select, drag to move. Dragging empty space pans; pinch or the mouse wheel zooms. |
| Wire (W) | Tap points; segments are orthogonal. Double-tap, Enter or **Finish wire** to end. Junctions are added automatically at T-joins. |
| Net label (L) | Tap to place. |
| Global label (G) | Tap to place. |
| Power (P) | Pick GND, +3V3, +5V, +12V, VCC or PWR_FLAG, then tap to place. |
| Junction (J) | Tap to place. |
| No-connect (Q) | Tap to place. |
| + Symbol (A) | Search the whole library, then tap to place. |

Editing commands:
- Rotate (R), mirror (X / Y), delete (Del), undo (Ctrl+Z), redo (Ctrl+Y), save (Ctrl+S).
- The properties panel edits Reference, Value, Footprint, Datasheet, the unit of multi-unit parts, and label text.

Everything snaps to the 1.27 mm grid. New items get random v4 UUIDs, and new schematics follow the KiCad 8 layout (`lib_symbols`, `instances`, `sheet_instances`).

Unedited parts of a file are written back byte for byte. The tests check this on real KiCad files in `tests/fixtures/sch`.

## Libraries

| Folder | What |
|---|---|
| `kicad-symbols/Gen_*.kicad_sym` | generated symbols (KiCad 8 format) |
| `kicad-footprints/Gen_*.pretty/` | generated footprints |
| `vendor/kicad-symbols`, `vendor/kicad-footprints` | subset of the official KiCad libraries (CC-BY-SA 4.0 + design exception, see `LICENSE.md` and `vendor/SOURCE.txt`) |
| `index.json` | search index used by the web app |

To regenerate everything (generate, index and validate; exits 1 on any error):

```bash
pip install pyyaml pytest
```

```bash
python tools/build_all.py
```

```bash
python -m pytest -q
```

```bash
node --test tests/js/sexpr.test.mjs
```

Browser end-to-end test (needs Playwright and Chromium; the optional argument is a local `jszip.min.js` path):

```bash
node tests/js/e2e.mjs
```

Generators:
- `tools/gen_conn.py`: `Conn_01xNN_Pin`, `Conn_01xNN_Socket`, `Conn_02xNN_Odd_Even` (1–40), plus straight 1xN/2xN pin headers and sockets at 2.54/1.27 mm. Pad, drill and body sizes come from the official KiCad footprints, and a test asserts pad-for-pad equality with them.
- `tools/gen_passives.py`: R, C, C_Polarized, L, D, LED (1=K, 2=A), and power symbols. Their default footprints are the vendored official 0603 / SOD-123 / CP_Elec footprints.
- `tools/gen_ic.py` + `packages.yaml`: parametric chip/dual/quad/dip/explicit-pad footprints. Every entry must cite `source` and `density`, otherwise it is rejected. The table is currently empty; see [`TODO.md`](TODO.md).
- `tools/gen_symbol.py`: builds a symbol from a CSV/JSON pin table (`number,name,type,side[,group][,unit][,hidden]`).
- `tools/gen_parts.py`: datasheet-driven parts in `parts/<Name>/part.yaml`.
- `tools/validate.py`: the validation rules, listed below.

Validation rules:
- **Footprints:** pads are unique and contiguous, pad 1 is marked, the courtyard is ≥0.25 mm from pads (0.1 mm only via `CourtyardClearance`), silkscreen does not overlap pads, and units are plausible mm.
- **Symbols:** pin numbers are unique, pins don't overlap, pins are on the 1.27 mm grid, and the `Footprint` field resolves to a real footprint.

## ERC

```bash
python tools/erc.py path/to/file.kicad_sch   # or a directory
```

This runs `tools/ercheck.jar` and prints every error and warning verbatim. It exits 1 if any error remains.

**Known false positive (filtered, still printed as `FILTERED`):** `<REF>: duplicate reference designator (N uses)`. It is filtered only when the N symbols with that reference share one `lib_id` and have N distinct unit numbers, i.e. the units of one multi-unit part, which KiCad requires to share a reference. All 58 such reports in the library preview schematics were checked this way:

<details><summary>58 multi-unit symbols (Device library)</summary>

- `Device:D_Dual_CommonAnode_AKK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_CommonAnode_KAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_CommonAnode_KKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_CommonCathode_AAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_CommonCathode_AKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_CommonCathode_KAA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_Series_ACK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_Series_AKC_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_Series_CAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_Series_CKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_Series_KAC_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Dual_Series_KCA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_CommonAnode_AKK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_CommonAnode_KAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_CommonAnode_KKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_CommonCathode_AAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_CommonCathode_AKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_CommonCathode_KAA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_Series_ACK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_Series_AKC_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_Series_CAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_Series_CKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_Series_KAC_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Schottky_Dual_Series_KCA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Zener_Dual_CommonAnode_AKK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Zener_Dual_CommonAnode_KAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Zener_Dual_CommonAnode_KKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Zener_Dual_CommonCathode_AAK_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Zener_Dual_CommonCathode_AKA_Split: D1: duplicate reference designator (2 uses)`
- `Device:D_Zener_Dual_CommonCathode_KAA_Split: D1: duplicate reference designator (2 uses)`
- `Device:R_Network03_Split: RN1: duplicate reference designator (3 uses)`
- `Device:R_Network04_Split: RN1: duplicate reference designator (4 uses)`
- `Device:R_Network05_Split: RN1: duplicate reference designator (5 uses)`
- `Device:R_Network06_Split: RN1: duplicate reference designator (6 uses)`
- `Device:R_Network07_Split: RN1: duplicate reference designator (7 uses)`
- `Device:R_Network08_Split: RN1: duplicate reference designator (8 uses)`
- `Device:R_Network09_Split: RN1: duplicate reference designator (9 uses)`
- `Device:R_Network10_Split: RN1: duplicate reference designator (10 uses)`
- `Device:R_Network11_Split: RN1: duplicate reference designator (11 uses)`
- `Device:R_Network12_Split: RN1: duplicate reference designator (12 uses)`
- `Device:R_Network13_Split: RN1: duplicate reference designator (13 uses)`
- `Device:R_Pack02_SIP_Split: RN1: duplicate reference designator (2 uses)`
- `Device:R_Pack02_Split: RN1: duplicate reference designator (2 uses)`
- `Device:R_Pack03_SIP_Split: RN1: duplicate reference designator (3 uses)`
- `Device:R_Pack03_Split: RN1: duplicate reference designator (3 uses)`
- `Device:R_Pack04_SIP_Split: RN1: duplicate reference designator (4 uses)`
- `Device:R_Pack04_Split: RN1: duplicate reference designator (4 uses)`
- `Device:R_Pack05_SIP_Split: RN1: duplicate reference designator (5 uses)`
- `Device:R_Pack05_Split: RN1: duplicate reference designator (5 uses)`
- `Device:R_Pack06_SIP_Split: RN1: duplicate reference designator (6 uses)`
- `Device:R_Pack06_Split: RN1: duplicate reference designator (6 uses)`
- `Device:R_Pack07_SIP_Split: RN1: duplicate reference designator (7 uses)`
- `Device:R_Pack07_Split: RN1: duplicate reference designator (7 uses)`
- `Device:R_Pack08_Split: RN1: duplicate reference designator (8 uses)`
- `Device:R_Pack09_Split: RN1: duplicate reference designator (9 uses)`
- `Device:R_Pack10_Split: RN1: duplicate reference designator (10 uses)`
- `Device:R_Pack11_Split: RN1: duplicate reference designator (11 uses)`
- `Device:R_Potentiometer_Dual_Separate: RV1: duplicate reference designator (2 uses)`

</details>

The library previews also give 963 warnings, which are expected and left in the report:
- 902× `no Footprint assigned`: generic official symbols ship with an empty footprint field.
- 59× `input pin not driven` and 2× `power input not driven`: pins that carry a no-connect flag in the preview.

## Adding a part from a datasheet

Rule: pinouts and land patterns come **only** from the datasheet you provide, never from memory.

1. Put the PDF somewhere Claude Code can read it (or paste the tables).
2. Ask Claude Code to make `parts/<Name>/`:
   - `pins.csv`, taken from the datasheet pin table, with the page cited.
   - `part.yaml` containing:
     - `datasheet`: URL
     - `source`: document, revision and pages
     - either `footprint: Lib:Name` (an existing footprint) or a `package:` block with the dimensions from the datasheet's recommended land pattern (`source`, `density: manufacturer-recommended`).
3. Run `python tools/build_all.py`. It must print `build_all: OK`.
4. Cross-check pin 1 location and pad numbering against the datasheet drawing before ordering boards.

## Limitations

- Editing covers schematics only; there is no PCB editing or routing (boards are view-only via KiCanvas). The editor has no buses, hierarchical sheets, bulk annotation or ERC of its own: run `python tools/erc.py` on saved files.
- The editor writes KiCad 8 format (version 20231120) for new schematics. When it edits a newer file (for example KiCad 9), it keeps that file's version header, and the symbols it inserts use KiCad 8 syntax. This is not yet verified in KiCad 9.
- KiCanvas only renders `.kicad_sch` / `.kicad_pcb`, so library previews are wrapped into a temporary schematic or board.
- Vendored official symbols are KiCad 10 format (`.kicad_symdir`). The generated ones are KiCad 8 format. When a vendored symbol is put into a schematic (previews now, the editor later), `js/downconvert.js` converts it to KiCad 8 syntax: `(hide yes)` becomes a bare `hide`, and KiCad 10-only fields (`show_name`, `do_not_autoplace`, `in_pos_files`, `embedded_fonts`, `duplicate_pin_numbers_are_jumpers`) are dropped. Anything else it doesn't recognise is rejected rather than guessed. The 8 `(show_name yes)` fields lose their visible field name.
- Chip land patterns, IC packages, right-angle headers and JST footprints are not generated yet; they are waiting on cited sources (`TODO.md`). Use the vendored official footprints meanwhile.
- val.town blob storage is text-only in this app; binary files in uploaded zips are skipped.
