#!/usr/bin/env python3
"""Symbol generator from a pin table (CSV or JSON).

Columns: number, name, type, side [, group] [, unit] [, hidden]
  type   : KiCad electrical type (input, output, bidirectional, tri_state, passive,
           free, unspecified, power_in, power_out, open_collector, open_emitter,
           no_connect)
  side   : left | right | top | bottom
  group  : pins with the same group stay together; groups are separated by a gap
  unit   : 1..N for multi-unit parts (default 1)
  hidden : yes/1/true to hide (only allowed for power_in)

JSON form: {"pins": [ {...}, ... ]} or a bare list.

CLI:
  python tools/gen_symbol.py pins.csv --name ATmega328P-AU --footprint Lib:FP \
      --lib Gen_Parts --datasheet URL --description "..." --keywords "..." --ref U
"""
import argparse
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kicad import symbol, sym_pin, sym_rect, write_symlib, std_props, PIN_TYPES  # noqa: E402
from sexpr import parse, findall  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = 2.54          # pin pitch
PIN_LEN = 2.54
CHAR_W = 0.85     # approx text width per char at 1.27 mm font
SIDES = ("left", "right", "top", "bottom")


class PinTableError(ValueError):
    pass


def _truthy(v):
    return str(v).strip().lower() in ("1", "yes", "true", "y", "x")


def load_pins(path):
    if path.lower().endswith(".json"):
        data = json.load(open(path, encoding="utf-8"))
        rows = data["pins"] if isinstance(data, dict) else data
    else:
        rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    return normalize(rows)


def normalize(rows):
    pins, seen = [], set()
    for i, r in enumerate(rows):
        r = {str(k).strip().lower(): (str(v).strip() if v is not None else "") for k, v in r.items()}
        num, name, typ, side = r.get("number", ""), r.get("name", ""), r.get("type", "").lower(), r.get("side", "").lower()
        where = f"row {i + 1} (pin {num or '?'})"
        if not num:
            raise PinTableError(f"{where}: missing number")
        if num in seen:
            raise PinTableError(f"{where}: duplicate pin number {num}")
        seen.add(num)
        if not name:
            raise PinTableError(f"{where}: missing name")
        if typ not in PIN_TYPES:
            raise PinTableError(f"{where}: invalid type {typ!r}")
        if side not in SIDES:
            raise PinTableError(f"{where}: invalid side {side!r}")
        hidden = _truthy(r.get("hidden", ""))
        if hidden and typ != "power_in":
            raise PinTableError(f"{where}: only power_in pins may be hidden")
        unit = int(r.get("unit") or 1)
        if unit < 1:
            raise PinTableError(f"{where}: unit must be >= 1")
        pins.append(dict(number=num, name=name, type=typ, side=side, group=r.get("group", ""), unit=unit, hidden=hidden))
    if not pins:
        raise PinTableError("empty pin table")
    return pins


def _slots(pins):
    """Order pins into slots, inserting one empty slot between groups."""
    out, last = [], None
    for p in pins:
        if out and p["group"] != last:
            out.append(None)
        out.append(p)
        last = p["group"]
    return out


def _grid_up(v, step=2 * P):
    return math.ceil(v / step - 1e-9) * step


def layout_unit(pins):
    by = {s: _slots([p for p in pins if p["side"] == s]) for s in SIDES}
    nl, nr, nt, nb = (len(by[s]) for s in SIDES)
    def mlen(side):
        return max([len(p["name"]) for p in by[side] if p] or [0])
    # body width: room for left+right names, or for top/bottom pin count
    w = max(_grid_up(max(nt, nb) * P + P), _grid_up((mlen("left") + mlen("right")) * CHAR_W + 2 * P), 2 * 2 * P)
    h = max(_grid_up(max(nl, nr) * P + P), _grid_up((mlen("top") + mlen("bottom")) * CHAR_W + 2 * P), 2 * 2 * P)
    hw, hh = w / 2, h / 2
    items = [sym_rect(-hw, hh, hw, -hh, "background")]
    def place(side):
        sl = by[side]
        n = len(sl)
        for i, p in enumerate(sl):
            if p is None:
                continue
            off = round(((n - 1) / 2 - i) * P, 4)
            if side == "left":
                x, y, a = -(hw + PIN_LEN), off, 0
            elif side == "right":
                x, y, a = hw + PIN_LEN, off, 180
            elif side == "top":
                x, y, a = -off, hh + PIN_LEN, 270
            else:
                x, y, a = -off, -(hh + PIN_LEN), 90
            items.append(sym_pin(p["type"], round(x, 4), round(y, 4), a, PIN_LEN, p["name"], p["number"], hidden=p["hidden"]))
    for s in SIDES:
        place(s)
    return items, hw, hh


def make_symbol(name, pins, footprint, ref="U", datasheet="~", description="", keywords="", source=""):
    units = sorted({p["unit"] for p in pins})
    bodies, maxhw, maxhh = {}, 0, 0
    for u in units:
        items, hw, hh = layout_unit([p for p in pins if p["unit"] == u])
        bodies[(u, 1)] = items
        maxhw, maxhh = max(maxhw, hw), max(maxhh, hh)
    props = std_props(ref, name, footprint, datasheet, description, keywords,
                      (-maxhw, maxhh + 1.27), (-maxhw, -maxhh - 1.27), source=source or None)
    props[0] = ("Reference", ref, -maxhw, maxhh + 1.27, 0, False, "left")
    props[1] = ("Value", name, -maxhw, -maxhh - 1.27, 0, False, "left")
    return symbol(name, props, bodies)


def add_to_library(lib_path, sym):
    """Insert or replace a symbol in a .kicad_sym file."""
    existing = []
    if os.path.exists(lib_path):
        existing = [s for s in findall(parse(open(lib_path).read()), "symbol") if str(s[1]) != str(sym[1])]
    syms = sorted(existing + [sym], key=lambda s: str(s[1]))
    return write_symlib(lib_path, syms)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("table")
    ap.add_argument("--name", required=True)
    ap.add_argument("--footprint", required=True, help="Library:Footprint (must exist)")
    ap.add_argument("--lib", default="Gen_Parts")
    ap.add_argument("--ref", default="U")
    ap.add_argument("--datasheet", default="~")
    ap.add_argument("--description", default="")
    ap.add_argument("--keywords", default="")
    ap.add_argument("--source", default="", help="datasheet document + pages the pinout came from")
    a = ap.parse_args(argv)
    sym = make_symbol(a.name, load_pins(a.table), a.footprint, a.ref, a.datasheet, a.description, a.keywords, a.source)
    path = add_to_library(os.path.join(ROOT, "kicad-symbols", a.lib + ".kicad_sym"), sym)
    print(f"wrote {a.name} to {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
