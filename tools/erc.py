#!/usr/bin/env python3
"""Run tools/ercheck.jar on .kicad_sch files and report errors/warnings verbatim.

Known false positive filtered out (and listed separately):
  "<REF>: duplicate reference designator (N uses)" when the N symbols with that
  reference all share one lib_id and have N distinct unit numbers, i.e. the units
  of one multi-unit part. KiCad requires units to share a reference; ercheck.jar
  counts each unit as a separate use.
Exit code 1 if any unfiltered error remains.

Usage: python tools/erc.py file.kicad_sch [...]   (or a directory)
"""
import glob
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sexpr import parse, find, findall  # noqa: E402

JAR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ercheck.jar")
DUP = re.compile(r"^(\S+): duplicate reference designator \((\d+) uses\)$")


def is_multiunit_dup(sch_tree, msg):
    m = DUP.match(msg)
    if not m:
        return False
    ref, n = m[1], int(m[2])
    insts = [s for s in findall(sch_tree, "symbol")
             if any(str(p[1]) == "Reference" and str(p[2]) == ref for p in findall(s, "property"))]
    libs = {str(find(s, "lib_id")[1]) for s in insts}
    units = [str(find(s, "unit")[1]) for s in insts if find(s, "unit")]
    return len(insts) == n and len(libs) == 1 and len(units) == n and len(set(units)) == n


def run(path):
    out = subprocess.run(["java", "-jar", JAR, path], capture_output=True, text=True)
    m = re.search(r"\{\s*\"file\".*\}", out.stdout, re.S)
    if not m:
        raise RuntimeError(f"ercheck.jar gave no JSON for {path}: {out.stdout}{out.stderr}")
    r = json.loads(m.group(0))
    tree = parse(open(path, encoding="utf-8").read())
    fp = [e for e in r["errors"] if is_multiunit_dup(tree, e)]
    r["errors"] = [e for e in r["errors"] if e not in fp]
    r["filtered_false_positives"] = fp
    return r


def main(args):
    files = []
    for a in args:
        files += sorted(glob.glob(os.path.join(a, "*.kicad_sch"))) if os.path.isdir(a) else [a]
    nerr = nwarn = nfp = 0
    for f in files:
        r = run(f)
        nerr += len(r["errors"]); nwarn += len(r["warnings"]); nfp += len(r["filtered_false_positives"])
        for e in r["errors"]:
            print(f"ERROR   {f}: {e}")
        for w in r["warnings"]:
            print(f"WARNING {f}: {w}")
        for e in r["filtered_false_positives"]:
            print(f"FILTERED(known false positive) {f}: {e}")
    print(f"erc: {len(files)} file(s), {nerr} error(s), {nwarn} warning(s), {nfp} known false positive(s) filtered")
    return 1 if nerr else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
