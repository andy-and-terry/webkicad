#!/usr/bin/env python3
"""Validate generated KiCad libraries.

Footprints: parse; mm sanity; pad numbers unique & contiguous (1..N); pad 1 marked;
courtyard encloses all pads with >= CRT_CLEAR (0.25 mm, or 0.1 mm when the footprint
has property "CourtyardClearance" "0.1"); silkscreen does not overlap any pad.
Symbols: parse; pin numbers unique; no two pins share a connection point within a
unit/style; pins on 1.27 mm grid; Footprint field resolves to an existing footprint.
Vendored libraries are only parse-checked.
"""
import glob
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sexpr import parse, find, findall, SexprError  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRID = 1.27
EPS = 1e-6


def f(x):
    return float(x)


# ---------- geometry ----------
def pad_rect(pad):
    at, size = find(pad, "at"), find(pad, "size")
    x, y = f(at[1]), f(at[2])
    ang = f(at[3]) if len(at) > 3 else 0.0
    w, h = f(size[1]), f(size[2])
    a = ang % 180
    if abs(a) < EPS:
        pass
    elif abs(a - 90) < EPS:
        w, h = h, w
    else:  # arbitrary rotation: conservative circumscribed square
        r = math.hypot(w, h) / 2
        return (x - r, y - r, x + r, y + r)
    return (x - w / 2, y - h / 2, x + w / 2, y + h / 2)


def _pt_rect_dist(px, py, r):
    dx = max(r[0] - px, 0, px - r[2])
    dy = max(r[1] - py, 0, py - r[3])
    return math.hypot(dx, dy)


def _seg_intersects(a, b, c, d):
    def cr(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    d1, d2, d3, d4 = cr(c, d, a), cr(c, d, b), cr(a, b, c), cr(a, b, d)
    return (d1 * d2 < 0) and (d3 * d4 < 0)


def _pt_seg_dist(p, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    L2 = vx * vx + vy * vy
    t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
    return math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy)


def seg_rect_dist(a, b, r):
    if r[0] <= a[0] <= r[2] and r[1] <= a[1] <= r[3]:
        return 0.0
    corners = [(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])]
    for i in range(4):
        if _seg_intersects(a, b, corners[i], corners[(i + 1) % 4]):
            return 0.0
    return min([_pt_rect_dist(*a, r), _pt_rect_dist(*b, r)] + [_pt_seg_dist(c, a, b) for c in corners])


def graphic_segments(fp, layer):
    """Yield (a, b, width) segments for lines/rects/polys on a layer."""
    for kind in ("fp_line", "fp_rect", "fp_poly"):
        for g in findall(fp, kind):
            lay = find(g, "layer")
            if not lay or lay[1] != layer:
                continue
            st = find(g, "stroke")
            w = f(find(st, "width")[1]) if st else f((find(g, "width") or [0, 0])[1])
            if kind == "fp_line":
                s, e = find(g, "start"), find(g, "end")
                yield (f(s[1]), f(s[2])), (f(e[1]), f(e[2])), w
            elif kind == "fp_rect":
                s, e = find(g, "start"), find(g, "end")
                x1, y1, x2, y2 = f(s[1]), f(s[2]), f(e[1]), f(e[2])
                pts = [(x1, y1), (x2, y1), (x2, y2), (x1, y2), (x1, y1)]
                for a, b in zip(pts, pts[1:]):
                    yield a, b, w
            else:
                pts = [(f(p[1]), f(p[2])) for p in findall(find(g, "pts"), "xy")]
                for a, b in zip(pts, pts[1:] + pts[:1]):
                    yield a, b, w
    for g in findall(fp, "fp_circle"):
        lay = find(g, "layer")
        if lay and lay[1] == layer:
            c, e = find(g, "center"), find(g, "end")
            r = math.hypot(f(e[1]) - f(c[1]), f(e[2]) - f(c[2]))
            cx, cy = f(c[1]), f(c[2])
            pts = [(cx + r * math.cos(k * math.pi / 16), cy + r * math.sin(k * math.pi / 16)) for k in range(33)]
            st = find(g, "stroke")
            w = f(find(st, "width")[1]) if st else 0.12
            for a, b in zip(pts, pts[1:]):
                yield a, b, w


def check_footprint(path):
    errs = []
    try:
        fp = parse(open(path, encoding="utf-8").read())
    except SexprError as e:
        return [f"parse error: {e}"]
    if fp[0] != "footprint":
        return ["not a footprint"]
    ver = find(fp, "version")
    if not ver or int(ver[1]) < 20240108:
        errs.append("version missing or older than KiCad 8 (20240108)")
    name = os.path.splitext(os.path.basename(path))[0]
    if str(fp[1]) != name:
        errs.append(f"footprint name {fp[1]!r} != filename {name!r}")
    pads = findall(fp, "pad")
    nums = [str(p[1]) for p in pads if str(p[1]) != ""]
    if len(set(nums)) != len(nums):
        dup = sorted({n for n in nums if nums.count(n) > 1})
        errs.append(f"duplicate pad numbers {dup}")
    try:
        ints = sorted(int(n) for n in set(nums))
        if ints != list(range(1, len(ints) + 1)):
            errs.append(f"pad numbers not contiguous 1..N: {ints}")
    except ValueError:
        errs.append(f"non-numeric pad numbers {sorted(set(nums))}")
    for p in pads:
        r = pad_rect(p)
        if max(abs(v) for v in r) > 200 or (r[2] - r[0]) > 50:
            errs.append(f"pad {p[1]} geometry implausible for mm units {r}")
    # pad 1 marking: distinct shape from others, or silkscreen mark closer to pad 1 than to any other pad
    p1 = [p for p in pads if str(p[1]) == "1"]
    if not p1:
        errs.append("no pad 1")
    else:
        # distinct = pad 1 shape differs from every other pad of the same size
        sz = lambda p: tuple(find(p, "size")[1:3])  # noqa: E731
        same_size = [p for p in pads if str(p[1]) != "1" and sz(p) == sz(p1[0])]
        distinct = all(str(p[3]) != str(p1[0][3]) for p in same_size)
        silk = list(graphic_segments(fp, "F.SilkS"))
        r1 = pad_rect(p1[0])
        marked = distinct
        if not marked and silk and len(pads) > 1:
            rs = [pad_rect(p) for p in pads if str(p[1]) != "1"]
            d1 = min(min(_pt_rect_dist(*a, r1), _pt_rect_dist(*b, r1)) for a, b, _ in silk)
            marked = all(d1 < min(min(_pt_rect_dist(*a, r), _pt_rect_dist(*b, r)) for a, b, _ in silk) for r in rs)
        if not marked and len(pads) > 1:
            errs.append("pad 1 not marked (same shape as others, no nearby silk mark)")
    # courtyard
    clear = 0.25
    for pr in findall(fp, "property"):
        if str(pr[1]) == "CourtyardClearance":
            clear = float(pr[2])
    crt = list(graphic_segments(fp, "F.CrtYd"))
    if not crt:
        errs.append("no courtyard on F.CrtYd")
    else:
        xs = [c for a, b, _ in crt for c in (a[0], b[0])]
        ys = [c for a, b, _ in crt for c in (a[1], b[1])]
        box = (min(xs), min(ys), max(xs), max(ys))
        for p in pads:
            r = pad_rect(p)
            m = min(r[0] - box[0], r[1] - box[1], box[2] - r[2], box[3] - r[3])
            if m < clear - EPS:
                errs.append(f"courtyard clearance {m:.3f} mm < {clear} mm at pad {p[1]}")
    # silkscreen vs pads
    for a, b, w in graphic_segments(fp, "F.SilkS"):
        for p in pads:
            d = seg_rect_dist(a, b, pad_rect(p)) - w / 2
            if d < 0.0 - EPS:
                errs.append(f"silkscreen {a}->{b} overlaps pad {p[1]} by {-d:.3f} mm")
    return errs


def pin_info(pin):
    at = find(pin, "at")
    return (str(find(pin, "number")[1]), f(at[1]), f(at[2]))


def on_grid(v):
    q = v / GRID
    return abs(q - round(q)) < 1e-4


def footprint_index():
    out = set()
    for d in glob.glob(os.path.join(ROOT, "kicad-footprints", "*.pretty")) + \
            glob.glob(os.path.join(ROOT, "vendor", "kicad-footprints", "*.pretty")):
        lib = os.path.basename(d)[:-len(".pretty")]
        for m in glob.glob(os.path.join(d, "*.kicad_mod")):
            out.add(f"{lib}:{os.path.basename(m)[:-len('.kicad_mod')]}")
    return out


def check_symlib(path, fps):
    errs = {}
    try:
        lib = parse(open(path, encoding="utf-8").read())
    except SexprError as e:
        return {"<file>": [f"parse error: {e}"]}
    ver = find(lib, "version")
    if not ver or int(ver[1]) < 20231120:
        errs["<file>"] = ["version missing or older than KiCad 8 (20231120)"]
    names = [str(s[1]) for s in findall(lib, "symbol")]
    if len(set(names)) != len(names):
        errs.setdefault("<file>", []).append("duplicate symbol names")
    for s in findall(lib, "symbol"):
        e = []
        props = {str(p[1]): str(p[2]) for p in findall(s, "property")}
        if find(s, "power") is None:
            fpv = props.get("Footprint", "")
            if not fpv:
                e.append("empty Footprint field")
            elif fpv not in fps:
                e.append(f"Footprint {fpv!r} not found in generated or vendored libraries")
        allpins = []
        by_unit = {}
        for sub in findall(s, "symbol"):
            parts = str(sub[1]).rsplit("_", 2)
            unit, style = int(parts[1]), int(parts[2])
            for pin in findall(sub, "pin"):
                n, x, y = pin_info(pin)
                allpins.append((unit, n))
                if not (on_grid(x) and on_grid(y)):
                    e.append(f"pin {n} at ({x},{y}) off 1.27 mm grid")
                by_unit.setdefault((unit, style), []).append((n, x, y))
        nums = [n for _, n in allpins]
        if len(set(nums)) != len(nums):
            e.append(f"duplicate pin numbers {sorted({n for n in nums if nums.count(n) > 1})}")
        # positions: unit 0 pins are shared by every unit
        common = by_unit.get((0, 1), [])
        keys = [k for k in by_unit if k[0] != 0] or [(0, 1)]
        for k in keys:
            pts = by_unit.get(k, []) + (common if k[0] != 0 else [])
            seen = {}
            for n, x, y in pts:
                key = (round(x, 4), round(y, 4))
                if key in seen:
                    e.append(f"pins {seen[key]} and {n} overlap at {key} (unit {k[0]})")
                seen[key] = n
        if e:
            errs[str(s[1])] = e
    return errs


def run(verbose=True):
    total_err = 0
    fps = footprint_index()
    gen_fp = sorted(glob.glob(os.path.join(ROOT, "kicad-footprints", "*.pretty", "*.kicad_mod")))
    for p in gen_fp:
        e = check_footprint(p)
        if e:
            total_err += len(e)
            for m in e:
                print(f"FP  {os.path.relpath(p, ROOT)}: {m}")
    gen_sym = sorted(glob.glob(os.path.join(ROOT, "kicad-symbols", "*.kicad_sym")))
    nsym = 0
    for p in gen_sym:
        es = check_symlib(p, fps)
        nsym += len(findall(parse(open(p).read()), "symbol"))
        for s, e in es.items():
            total_err += len(e)
            for m in e:
                print(f"SYM {os.path.relpath(p, ROOT)}:{s}: {m}")
    vend = [p for p in glob.glob(os.path.join(ROOT, "vendor", "**", "*.kicad_*"), recursive=True) if os.path.isfile(p)]
    for p in vend:
        try:
            parse(open(p, encoding="utf-8").read())
        except SexprError as ex:
            total_err += 1
            print(f"VENDOR {p}: {ex}")
    if verbose:
        print(f"validate: {len(gen_fp)} generated footprints, {nsym} generated symbols in {len(gen_sym)} libs, "
              f"{len(vend)} vendored files parsed; {total_err} error(s)")
    return total_err


if __name__ == "__main__":
    sys.exit(1 if run() else 0)
