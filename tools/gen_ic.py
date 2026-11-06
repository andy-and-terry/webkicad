#!/usr/bin/env python3
"""Parametric package footprints from packages.yaml.

Families:
  chip : 2-terminal chip component (R/C/L 0201..1210)
  dual : gull-wing / no-lead dual-row (SOIC, SSOP, TSSOP, MSOP, DFN)
  quad : four-sided (TQFP/LQFP, QFN)
  dip  : through-hole dual in-line
  pads : explicit pad list (SOT-23-3/5/6, SOT-223, anything irregular)

Every entry MUST carry a non-empty `source` naming the JEDEC drawing or vendor
package/land-pattern document the numbers come from, and `density` describing
what kind of land pattern it is (e.g. "manufacturer-recommended"). Entries
without a source are rejected. Values are taken as given; nothing is derived
from assumed IPC equations.

Pad geometry convention: `pad: [along_x, along_y]` for the left-side pads of a
dual/quad (toe-to-heel is along_x); `pad_span` is the centre-to-centre distance
between opposite pad rows (for quad: [x_span, y_span]).
"""
import math
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kicad import Footprint  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPDIR = os.path.join(ROOT, "kicad-footprints")
SILK_W, FAB_W, CRT_W = 0.12, 0.1, 0.05
SILK_PAD_GAP = 0.2  # silk keeps this far from copper (plus half line width)

REQUIRED = {
    "chip": ["pad", "pad_span", "body"],
    "dual": ["pins", "pitch", "pad", "pad_span", "body"],
    "quad": ["pins", "pitch", "pad", "pad_span", "body"],
    "dip": ["pins", "pitch", "row_spacing", "pad_dia", "drill", "body"],
    "pads": ["pad_list", "body"],
}


class PackageError(ValueError):
    pass


def r3(v):
    return round(v + 0.0, 4)


def check_entry(e):
    for k in ("name", "family", "library", "source", "density"):
        if not str(e.get(k, "")).strip():
            raise PackageError(f"{e.get('name', '?')}: missing required field '{k}'")
    fam = e["family"]
    if fam not in REQUIRED:
        raise PackageError(f"{e['name']}: unknown family {fam}")
    for k in REQUIRED[fam]:
        if k not in e:
            raise PackageError(f"{e['name']}: family {fam} requires '{k}'")
    if fam in ("dual", "dip") and e["pins"] % 2:
        raise PackageError(f"{e['name']}: dual/dip pin count must be even")
    if fam == "quad" and e["pins"] % 4:
        raise PackageError(f"{e['name']}: quad pin count must be a multiple of 4")


def pad_list(e):
    """Return [(num, x, y, w, h)] with pin 1 top-left, counter-clockwise."""
    fam = e["family"]
    if fam == "chip":
        w, h = e["pad"]
        s = e["pad_span"] / 2
        return [(1, -s, 0, w, h), (2, s, 0, w, h)]
    if fam in ("dual", "dip"):
        n = e["pins"] // 2
        p = e["pitch"]
        s = (e["pad_span"] if fam == "dual" else e["row_spacing"]) / 2
        w, h = e["pad"] if fam == "dual" else (e["pad_dia"], e["pad_dia"])
        top = (n - 1) * p / 2
        out = [(i + 1, -s, -top + i * p, w, h) for i in range(n)]
        out += [(n + i + 1, s, top - i * p, w, h) for i in range(n)]
        return out
    if fam == "quad":
        n = e["pins"] // 4
        p = e["pitch"]
        sx, sy = e["pad_span"][0] / 2, e["pad_span"][1] / 2
        a, b = e["pad"]  # a = toe-heel length, b = width
        top = (n - 1) * p / 2
        out = []
        for i in range(n):
            out.append((i + 1, -sx, -top + i * p, a, b))            # left, downward
        for i in range(n):
            out.append((n + i + 1, -top + i * p, sy, b, a))         # bottom, rightward
        for i in range(n):
            out.append((2 * n + i + 1, sx, top - i * p, a, b))      # right, upward
        for i in range(n):
            out.append((3 * n + i + 1, top - i * p, -sy, b, a))     # top, leftward
        return out
    return [(int(p["num"]), p["x"], p["y"], p["w"], p["h"]) for p in e["pad_list"]]


def build(e):
    check_entry(e)
    fam = e["family"]
    descr = f"{e.get('descr', e['name'])}. Land pattern: {e['density']}. Source: {e['source']}"
    fp = Footprint(e["name"], descr, e.get("tags", e["family"]), e["source"],
                   attr="through_hole" if fam == "dip" else "smd")
    pads = pad_list(e)
    for num, x, y, w, h in pads:
        if fam == "dip":
            fp.pad_tht(num, r3(x), r3(y), "rect" if num == 1 else "circle", w, e["drill"])
        else:
            # pad 1 gets a distinct (sharp-cornered) shape on multi-pin parts
            fp.pad_smd(num, r3(x), r3(y), w, h, shape="rect" if num == 1 and fam != "chip" else "roundrect")
    ep = e.get("ep")
    if ep:
        fp.pad_smd(len(pads) + 1, 0, 0, ep[0], ep[1], shape="rect")
        pads = pads + [(len(pads) + 1, 0, 0, ep[0], ep[1])]
    bx, by = e["body"][0] / 2, e["body"][1] / 2
    # fab body with pin-1 chamfer
    ch = min(1.0, bx / 2, by / 2)
    pts = [(-bx + ch, -by), (bx, -by), (bx, by), (-bx, by), (-bx, -by + ch), (-bx + ch, -by)]
    for a, b in zip(pts, pts[1:]):
        fp.line(r3(a[0]), r3(a[1]), r3(b[0]), r3(b[1]), "F.Fab", FAB_W)
    # silkscreen: body outline segments clipped away from pads, plus pin-1 dot-line
    keep = SILK_PAD_GAP + SILK_W / 2
    rects = [(x - w / 2 - keep, y - h / 2 - keep, x + w / 2 + keep, y + h / 2 + keep) for _, x, y, w, h in pads]
    so = SILK_W / 2 + 0.05
    outline = [((-bx - so, -by - so), (bx + so, -by - so)), ((bx + so, -by - so), (bx + so, by + so)),
               ((bx + so, by + so), (-bx - so, by + so)), ((-bx - so, by + so), (-bx - so, -by - so))]
    for a, b in outline:
        for s0, s1 in _clip_segment(a, b, rects):
            if math.dist(s0, s1) > 0.2:
                fp.line(r3(s0[0]), r3(s0[1]), r3(s1[0]), r3(s1[1]), "F.SilkS", SILK_W)
    # pin-1 marker: short line outside pad 1 on the left, pointing at it
    _, x1, y1, w1, h1 = pads[0]
    mx = x1 - w1 / 2 - keep - 0.1
    if fam != "chip":
        fp.line(r3(mx), r3(y1 - h1 / 2), r3(mx), r3(y1 + h1 / 2), "F.SilkS", SILK_W)
    # courtyard
    clear = float(e.get("courtyard_clearance", 0.25))
    xs = [x - w / 2 for _, x, y, w, h in pads] + [x + w / 2 for _, x, y, w, h in pads] + [-bx, bx, mx - SILK_W]
    ys = [y - h / 2 for _, x, y, w, h in pads] + [y + h / 2 for _, x, y, w, h in pads] + [-by, by]
    c = [math.floor((min(xs) - clear) * 100) / 100, math.floor((min(ys) - clear) * 100) / 100,
         math.ceil((max(xs) + clear) * 100) / 100, math.ceil((max(ys) + clear) * 100) / 100]
    fp.rect(*c, "F.CrtYd", CRT_W)
    fp.text("user", "${REFERENCE}", 0, 0, "F.Fab", size=min(1.0, by), thick=0.15 * min(1.0, by))
    lib = os.path.join(FPDIR, e["library"] + ".pretty")
    path = fp.write(lib, ref_y=r3(c[1] - 1.0), val_y=r3(c[3] + 1.0))
    if clear < 0.25:
        _add_prop(path, "CourtyardClearance", str(clear))
    return path


def _add_prop(path, k, v):
    from sexpr import parse, dumps, L, Q
    t = parse(open(path).read())
    idx = max(i for i, c in enumerate(t) if isinstance(c, list) and c[0] == "property") + 1
    t.insert(idx, L("property", Q(k), Q(v), L("at", 0, 0, 0), L("layer", Q("F.Fab")), L("hide", "yes"),
                    L("effects", L("font", L("size", 1, 1)))))
    open(path, "w").write(dumps(t) + "\n")


def _clip_segment(a, b, rects):
    """Split segment a-b removing parts inside any axis-aligned rect."""
    segs = [(0.0, 1.0)]
    for r in rects:
        t0, t1 = _seg_rect_param(a, b, r)
        if t0 is None:
            continue
        new = []
        for s, e in segs:
            if t1 <= s or t0 >= e:
                new.append((s, e))
            else:
                if t0 > s:
                    new.append((s, t0))
                if t1 < e:
                    new.append((t1, e))
        segs = new
    lerp = lambda t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)  # noqa: E731
    return [(lerp(s), lerp(e)) for s, e in segs]


def _seg_rect_param(a, b, r):
    """Liang-Barsky: parameter interval of a-b inside rect r, or (None, None)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, a[0] - r[0]), (dx, r[2] - a[0]), (-dy, a[1] - r[1]), (dy, r[3] - a[1])):
        if p == 0:
            if q < 0:
                return None, None
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
    return (t0, t1) if t0 < t1 else (None, None)


def load(path):
    if not os.path.exists(path):
        return []
    data = yaml.safe_load(open(path)) or {}
    return data.get("packages") or []


def main(path=os.path.join(ROOT, "packages.yaml")):
    entries = load(path)
    out = [build(e) for e in entries]
    print(f"gen_ic: {len(out)} footprints from {os.path.relpath(path, ROOT)}")
    return out


if __name__ == "__main__":
    main(*sys.argv[1:])
