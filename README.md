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

- The app views and organises files; editing is limited to the schematic editor (v2, in progress). There is no PCB editing or routing.
- KiCanvas only renders `.kicad_sch` / `.kicad_pcb`, so library previews are wrapped into a temporary schematic or board.
- Vendored official symbols are KiCad 10 format (`.kicad_symdir`). The generated ones are KiCad 8 format. When a vendored symbol is put into a schematic (previews now, the editor later), `js/downconvert.js` converts it to KiCad 8 syntax: `(hide yes)` becomes a bare `hide`, and KiCad 10-only fields (`show_name`, `do_not_autoplace`, `in_pos_files`, `embedded_fonts`, `duplicate_pin_numbers_are_jumpers`) are dropped. Anything else it doesn't recognise is rejected rather than guessed. The 8 `(show_name yes)` fields lose their visible field name.
- Chip land patterns, IC packages, right-angle headers and JST footprints are not generated yet; they are waiting on cited sources (`TODO.md`). Use the vendored official footprints meanwhile.
- val.town blob storage is text-only in this app; binary files in uploaded zips are skipped.
