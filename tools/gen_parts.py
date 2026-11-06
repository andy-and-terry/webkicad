#!/usr/bin/env python3
"""Datasheet-driven parts: parts/<Name>/part.yaml -> symbol (+ optional footprint).

part.yaml:
  name: PART_NAME            # symbol name
  lib: Gen_Parts             # symbol library (kicad-symbols/<lib>.kicad_sym)
  ref: U
  datasheet: https://...     # URL of the datasheet the data came from
  source: "Doc title, rev, page/table for pinout; page/figure for land pattern"
  description: ...
  keywords: ...
  pins: pins.csv             # pin table (see tools/gen_symbol.py)
  footprint: Lib:Name        # existing footprint, OR:
  package: {...}             # a tools/gen_ic.py entry (family, dims, source, density)
Every part needs `datasheet` and `source`; a part without them is rejected.
"""
import glob
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_ic  # noqa: E402
import gen_symbol  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_part(path):
    d = yaml.safe_load(open(path))
    base = os.path.dirname(path)
    for k in ("name", "pins", "datasheet", "source"):
        if not str(d.get(k, "")).strip():
            raise ValueError(f"{path}: missing '{k}' (every part must cite its datasheet)")
    out = []
    if "package" in d:
        pkg = dict(d["package"])
        pkg.setdefault("library", "Gen_Parts")
        out.append(gen_ic.build(pkg))
        fp = f"{pkg['library']}:{pkg['name']}"
    else:
        fp = d["footprint"]
    sym = gen_symbol.make_symbol(d["name"], gen_symbol.load_pins(os.path.join(base, d["pins"])), fp,
                                 d.get("ref", "U"), d["datasheet"], d.get("description", ""),
                                 d.get("keywords", ""), d["source"])
    out.append(gen_symbol.add_to_library(os.path.join(ROOT, "kicad-symbols", d.get("lib", "Gen_Parts") + ".kicad_sym"), sym))
    return out


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "parts", "*", "part.yaml")))
    lib = os.path.join(ROOT, "kicad-symbols", "Gen_Parts.kicad_sym")
    if os.path.exists(lib):
        os.remove(lib)  # rebuilt from parts/ every time
    out = []
    for f in files:
        out += build_part(f)
    print(f"gen_parts: {len(files)} parts")
    return out


if __name__ == "__main__":
    main()
