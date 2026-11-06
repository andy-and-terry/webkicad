#!/usr/bin/env python3
"""Build index.json (library search index for the web app).

Entry: {t: "sym"|"fp", lib, name, path, src: "gen"|"kicad", d: description,
        k: keywords, ds: datasheet, fp: default footprint (symbols)}
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sexpr import parse, find, findall  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _props(s):
    return {str(p[1]): str(p[2]) for p in findall(s, "property")}


def sym_entries(path, lib, src):
    t = parse(open(path, encoding="utf-8").read())
    out = []
    for s in findall(t, "symbol"):
        pr = _props(s)
        ext = find(s, "extends")
        e = {"t": "sym", "lib": lib, "name": str(s[1]), "path": os.path.relpath(path, ROOT).replace(os.sep, "/"),
             "src": src, "d": pr.get("Description", ""), "k": pr.get("ki_keywords", ""),
             "ds": "" if pr.get("Datasheet", "~") == "~" else pr.get("Datasheet", ""), "fp": pr.get("Footprint", "")}
        if ext:
            e["ext"] = str(ext[1])
        out.append(e)
    return out


def fp_entry(path, lib, src):
    t = parse(open(path, encoding="utf-8").read())
    d, k = find(t, "descr"), find(t, "tags")
    return {"t": "fp", "lib": lib, "name": str(t[1]), "path": os.path.relpath(path, ROOT).replace(os.sep, "/"),
            "src": src, "d": str(d[1]) if d else "", "k": str(k[1]) if k else ""}


def main():
    idx = []
    for p in sorted(glob.glob(os.path.join(ROOT, "kicad-symbols", "*.kicad_sym"))):
        idx += sym_entries(p, os.path.basename(p)[:-len(".kicad_sym")], "gen")
    for d in sorted(glob.glob(os.path.join(ROOT, "vendor", "kicad-symbols", "*.kicad_symdir"))):
        lib = os.path.basename(d)[:-len(".kicad_symdir")]
        for p in sorted(glob.glob(os.path.join(d, "*.kicad_sym"))):
            idx += sym_entries(p, lib, "kicad")
    for base, src in (("kicad-footprints", "gen"), (os.path.join("vendor", "kicad-footprints"), "kicad")):
        for d in sorted(glob.glob(os.path.join(ROOT, base, "*.pretty"))):
            lib = os.path.basename(d)[:-len(".pretty")]
            for p in sorted(glob.glob(os.path.join(d, "*.kicad_mod"))):
                idx.append(fp_entry(p, lib, src))
    with open(os.path.join(ROOT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "items": idx}, f, separators=(",", ":"))
    print(f"build_index: {len(idx)} entries "
          f"({sum(e['t'] == 'sym' for e in idx)} symbols, {sum(e['t'] == 'fp' for e in idx)} footprints)")
    return idx


if __name__ == "__main__":
    main()
