#!/usr/bin/env python3
"""Generic connectors: symbols + straight THT pin header / socket footprints.

Output:
  kicad-symbols/Gen_Connector_Generic.kicad_sym
  kicad-footprints/Gen_Connector_PinHeader_{2.54,1.27}mm.pretty/
  kicad-footprints/Gen_Connector_PinSocket_{2.54,1.27}mm.pretty/

Dimension source: every number in SERIES below was read from the official KiCad
library footprint named in its 'ref' field (vendored in vendor/kicad-footprints,
kicad-footprints commit a0dcd398e7ea4b00cdeb91efc35f09cceaa9097d). No values are
from memory. Right-angle headers and JST-PH/XH are NOT generated: they need a
manufacturer datasheet (see TODO.md).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kicad import Footprint, symbol, sym_pin, sym_rect, write_symlib, std_props  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYMDIR = os.path.join(ROOT, "kicad-symbols")
FPDIR = os.path.join(ROOT, "kicad-footprints")
KICAD_COMMIT = "a0dcd398e7ea4b00cdeb91efc35f09cceaa9097d"
MAX_PINS = 40

# body_x: fab body extent in x relative to pin column(s): (left_of_min_col, right_of_max_col)
# body_y: fab body extent beyond first/last pin; col2: x offset of the second row
SERIES = {
    "PinHeader_2.54": dict(kind="PinHeader", pitch=2.54, pad=1.7, drill=1.0, body_x=(1.27, 1.27), body_y=1.27, col2=+2.54,
                           ref="Connector_PinHeader_2.54mm/PinHeader_1x03_P2.54mm_Vertical, PinHeader_2x03_P2.54mm_Vertical"),
    "PinHeader_1.27": dict(kind="PinHeader", pitch=1.27, pad=1.0, drill=0.65, body_x=(1.05, 1.05), body_x2=(1.07, 1.07), body_y=0.635, col2=+1.27,
                           ref="Connector_PinHeader_1.27mm/PinHeader_1x03_P1.27mm_Vertical, PinHeader_2x03_P1.27mm_Vertical"),
    "PinSocket_2.54": dict(kind="PinSocket", pitch=2.54, pad=1.7, drill=1.0, body_x=(1.27, 1.27), body_y=1.27, col2=-2.54,
                           ref="Connector_PinSocket_2.54mm/PinSocket_1x03_P2.54mm_Vertical, PinSocket_2x03_P2.54mm_Vertical"),
    "PinSocket_1.27": dict(kind="PinSocket", pitch=1.27, pad=1.0, drill=0.7, body_x=(1.27, 1.27), body_x2=(0.89, 0.89), body_y=0.635, col2=-1.27,
                           ref="Connector_PinSocket_1.27mm/PinSocket_1x03_P1.27mm_Vertical, PinSocket_2x03_P1.27mm_Vertical"),
}
SILK_W, SILK_OFF, FAB_W, CRT_W, CRT_MARGIN = 0.12, 0.11, 0.1, 0.05, 0.5


def r2(v):
    return round(v + 1e-9, 2)


def fp_name(kind, rows, n, pitch):
    return f"{kind}_{rows}x{n:02d}_P{pitch:.2f}mm_Vertical"


def make_fp(key, rows, n):
    s = SERIES[key]
    p, kind = s["pitch"], s["kind"]
    name = fp_name(kind, rows, n, p)
    what = "pin header" if kind == "PinHeader" else "socket strip"
    fp = Footprint(name, f"Through hole straight {what}, {rows}x{n:02d}, {p}mm pitch, "
                         f"{'single' if rows == 1 else 'double'} row",
                   f"Through hole {what} THT {rows}x{n:02d} {p}mm {'single' if rows == 1 else 'double'} row",
                   f"Dimensions from KiCad official library {s['ref']} (kicad-footprints {KICAD_COMMIT[:12]})",
                   attr="through_hole")
    cols = [0.0] if rows == 1 else [0.0, s["col2"]]
    num = 1
    for i in range(n):
        for c in cols:
            fp.pad_tht(num, c, r2(i * p), "rect" if num == 1 else "circle", s["pad"], s["drill"])
            num += 1
    bx = s["body_x"] if rows == 1 else s.get("body_x2", s["body_x"])
    xmin, xmax = min(cols) - bx[0], max(cols) + bx[1]
    ymin, ymax = -s["body_y"], (n - 1) * p + s["body_y"]
    # fab outline with chamfer at pin-1 corner
    ch = min(0.635, (xmax - xmin) / 4)
    left_is_pin1 = kind == "PinHeader"
    if left_is_pin1:
        pts = [(xmin + ch, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax), (xmin, ymin + ch), (xmin + ch, ymin)]
    else:
        pts = [(xmin, ymin), (xmax - ch, ymin), (xmax, ymin + ch), (xmax, ymax), (xmin, ymax), (xmin, ymin)]
    for a, b in zip(pts, pts[1:]):
        fp.line(r2(a[0]), r2(a[1]), r2(b[0]), r2(b[1]), "F.Fab", FAB_W)
    # silkscreen: body outline offset outward + pin-1 corner mark
    sx1, sx2, sy1, sy2 = r2(xmin - SILK_OFF), r2(xmax + SILK_OFF), r2(ymin - SILK_OFF), r2(ymax + SILK_OFF)
    fp.rect(sx1, sy1, sx2, sy2, "F.SilkS", SILK_W)
    m = 0.3
    if left_is_pin1:
        fp.line(r2(sx1 - m), r2(sy1 + 1.0), r2(sx1 - m), r2(sy1 - m), "F.SilkS", SILK_W)
        fp.line(r2(sx1 - m), r2(sy1 - m), r2(sx1 + 1.0), r2(sy1 - m), "F.SilkS", SILK_W)
    else:
        fp.line(r2(sx2 + m), r2(sy1 + 1.0), r2(sx2 + m), r2(sy1 - m), "F.SilkS", SILK_W)
        fp.line(r2(sx2 + m), r2(sy1 - m), r2(sx2 - 1.0), r2(sy1 - m), "F.SilkS", SILK_W)
    # courtyard: max(body, pads, silk mark) + margin, on 0.01 grid
    hp = s["pad"] / 2
    cx1 = min(xmin, min(cols) - hp, sx1 - m) - CRT_MARGIN
    cx2 = max(xmax, max(cols) + hp, sx2 + (0 if left_is_pin1 else m)) + CRT_MARGIN
    cy1 = min(ymin, -hp, sy1 - m) - CRT_MARGIN
    cy2 = max(ymax, (n - 1) * p + hp) + CRT_MARGIN
    import math
    fp.rect(math.floor(cx1 * 100) / 100, math.floor(cy1 * 100) / 100,
            math.ceil(cx2 * 100) / 100, math.ceil(cy2 * 100) / 100, "F.CrtYd", CRT_W)
    fp.text("user", "${REFERENCE}", r2((xmin + xmax) / 2), r2((ymin + ymax) / 2), "F.Fab")
    lib = os.path.join(FPDIR, f"Gen_Connector_{kind}_{p:.2f}mm.pretty")
    return fp.write(lib, ref_y=r2(sy1 - 1.5), val_y=r2(cy2 + 1.0))


# ---------------- symbols ----------------
def _pins_col(n, x, angle, start_num, step, length=3.81):
    top = (n - 1) * 2.54 / 2
    return [sym_pin("passive", x, round(top - i * 2.54, 4), angle, length, f"Pin_{start_num + i * step}",
                    start_num + i * step) for i in range(n)]


def conn_1x(n, style):
    name = f"Conn_01x{n:02d}_{style}"
    top = (n - 1) * 2.54 / 2
    yb = top + 1.27
    body = [sym_rect(-1.27, yb, 1.27, -yb, "background")]
    for i in range(n):
        y = round(top - i * 2.54, 4)
        # pin "stub" graphic inside body: line for pin, small arc-like rect for socket
        body.append(sym_rect(-1.27, y + 0.127, 0.0 if style == "Pin" else -0.254, y - 0.127, "outline", 0.1524))
    fpkind = "PinHeader" if style == "Pin" else "PinSocket"
    fp = f"Gen_Connector_{fpkind}_2.54mm:{fpkind}_1x{n:02d}_P2.54mm_Vertical"
    props = std_props("J", name, fp, "~", f"Generic connector, single row, 01x{n:02d}, {'pin header (male)' if style == 'Pin' else 'socket (female)'}",
                      "connector", (0, round(yb + 1.27, 4)), (0, round(-yb - 1.27, 4)),
                      fp_filters="Connector*:*_1x??_* Gen_Connector*:*_1x??_*")
    units = {(0, 1): body, (1, 1): _pins_col(n, -5.08, 0, 1, 1)}
    return symbol(name, props, units, pin_names_hide=True, pin_numbers_hide=False)


def conn_2x(n):
    name = f"Conn_02x{n:02d}_Odd_Even"
    top = (n - 1) * 2.54 / 2
    yb = top + 1.27
    body = [sym_rect(-1.27, yb, 3.81, -yb, "background")]
    for i in range(n):
        y = round(top - i * 2.54, 4)
        body.append(sym_rect(-1.27, y + 0.127, 0, y - 0.127, "outline", 0.1524))
        body.append(sym_rect(2.54, y + 0.127, 3.81, y - 0.127, "outline", 0.1524))
    fp = f"Gen_Connector_PinHeader_2.54mm:PinHeader_2x{n:02d}_P2.54mm_Vertical"
    props = std_props("J", name, fp, "~", f"Generic connector, double row, 02x{n:02d}, odd/even pin numbering scheme (row 1 odd numbers, row 2 even numbers)",
                      "connector", (1.27, round(yb + 1.27, 4)), (1.27, round(-yb - 1.27, 4)),
                      fp_filters="Connector*:*_2x??_* Gen_Connector*:*_2x??_*")
    pins = _pins_col(n, -5.08, 0, 1, 2) + _pins_col(n, 7.62, 180, 2, 2)
    return symbol(name, props, {(0, 1): body, (1, 1): pins}, pin_names_hide=True)


def main():
    out = []
    for key in SERIES:
        for rows in (1, 2):
            for n in range(1, MAX_PINS + 1):
                out.append(make_fp(key, rows, n))
    syms = [conn_1x(n, "Pin") for n in range(1, MAX_PINS + 1)]
    syms += [conn_1x(n, "Socket") for n in range(1, MAX_PINS + 1)]
    syms += [conn_2x(n) for n in range(1, MAX_PINS + 1)]
    out.append(write_symlib(os.path.join(SYMDIR, "Gen_Connector_Generic.kicad_sym"), syms))
    print(f"gen_conn: {len(out) - 1} footprints, {len(syms)} symbols")
    return out


if __name__ == "__main__":
    main()
