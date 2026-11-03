"""Builders for KiCad 8 footprint (.kicad_mod) and symbol (.kicad_sym) files.

All geometry in mm. UUIDs are deterministic (uuid5) so regenerating is stable.
"""
import os
import uuid as _uuid
from sexpr import L, Q, dumps, fmt

GENERATOR = "webkicad_gen"
GEN_VERSION = "1.0"
FP_VERSION = 20240108   # KiCad 8 footprint format
SYM_VERSION = 20231120  # KiCad 8 symbol format
NS = _uuid.UUID("6f1b0b7e-3c1a-4f3e-9d4e-1a2b3c4d5e6f")


def uid(*parts):
    return Q(str(_uuid.uuid5(NS, "/".join(str(p) for p in parts))))


def font(size=1.0, thickness=None):
    f = L("font", L("size", size, size))
    if thickness:
        f.append(L("thickness", thickness))
    return f


# ---------------- footprints ----------------
class Footprint:
    def __init__(self, name, descr, tags, source, attr="smd"):
        self.name, self.descr, self.tags, self.source, self.attr = name, descr, tags, source, attr
        self.items = []
        self._n = 0

    def _u(self):
        self._n += 1
        return uid(self.name, self._n)

    def line(self, x1, y1, x2, y2, layer, width):
        self.items.append(L("fp_line", L("start", x1, y1), L("end", x2, y2),
                            L("stroke", L("width", width), L("type", "solid")), L("layer", Q(layer)), L("uuid", self._u())))

    def rect(self, x1, y1, x2, y2, layer, width):
        for a in ((x1, y1, x2, y1), (x2, y1, x2, y2), (x2, y2, x1, y2), (x1, y2, x1, y1)):
            self.line(*a, layer, width)

    def text(self, kind, value, x, y, layer, size=1.0, thick=0.15):
        self.items.append(L("fp_text", kind, Q(value), L("at", x, y), L("layer", Q(layer)), L("uuid", self._u()),
                            L("effects", font(size, thick))))

    def pad_tht(self, num, x, y, shape, size, drill):
        self.items.append(L("pad", Q(str(num)), "thru_hole", shape, L("at", x, y), L("size", size, size),
                            L("drill", drill), L("layers", Q("*.Cu"), Q("*.Mask")), L("uuid", self._u())))

    def pad_smd(self, num, x, y, w, h, shape="roundrect", rratio=0.25, layers=("F.Cu", "F.Paste", "F.Mask")):
        p = L("pad", Q(str(num)), "smd", shape, L("at", x, y), L("size", w, h), L("layers", *[Q(l) for l in layers]))
        if shape == "roundrect":
            p.append(L("roundrect_rratio", rratio))
        p.append(L("uuid", self._u()))
        self.items.append(p)

    def tree(self, ref_y=-2.0, val_y=2.0):
        t = L("footprint", Q(self.name), L("version", FP_VERSION), L("generator", Q(GENERATOR)),
              L("generator_version", Q(GEN_VERSION)), L("layer", Q("F.Cu")),
              L("descr", Q(self.descr)), L("tags", Q(self.tags)))
        def prop(k, v, y, layer, hide=False):
            p = L("property", Q(k), Q(v), L("at", 0, y, 0), L("layer", Q(layer)))
            if hide:
                p.append(L("hide", "yes"))
            p += [L("uuid", uid(self.name, "prop", k)), L("effects", font(1, 0.15))]
            return p
        t.append(prop("Reference", "REF**", ref_y, "F.SilkS"))
        t.append(prop("Value", self.name, val_y, "F.Fab"))
        t.append(prop("Footprint", "", 0, "F.Fab", True))
        t.append(prop("Datasheet", "", 0, "F.Fab", True))
        t.append(prop("Description", self.descr, 0, "F.Fab", True))
        t.append(prop("Source", self.source, 0, "F.Fab", True))
        t.append(L("attr", self.attr))
        t += self.items
        return t

    def write(self, libdir, **kw):
        os.makedirs(libdir, exist_ok=True)
        path = os.path.join(libdir, self.name + ".kicad_mod")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(dumps(self.tree(**kw)) + "\n")
        return path


# ---------------- symbols ----------------
PIN_TYPES = {"input", "output", "bidirectional", "tri_state", "passive", "free", "unspecified",
             "power_in", "power_out", "open_collector", "open_emitter", "no_connect"}


def sym_property(key, value, x, y, angle=0, hide=False, justify=None):
    eff = L("effects", font(1.27))
    if justify:
        eff.append(L("justify", justify))
    if hide:
        eff.append("hide")
    return L("property", Q(key), Q(value), L("at", x, y, angle), eff)


def sym_pin(ptype, x, y, angle, length, name, number, hidden=False, shape="line"):
    assert ptype in PIN_TYPES, ptype
    p = L("pin", ptype, shape, L("at", x, y, angle), L("length", length))
    if hidden:
        p.append("hide")
    p.append(L("name", Q(name), L("effects", font(1.27))))
    p.append(L("number", Q(str(number)), L("effects", font(1.27))))
    return p


def sym_rect(x1, y1, x2, y2, fill="background", width=0.254):
    return L("rectangle", L("start", x1, y1), L("end", x2, y2),
             L("stroke", L("width", width), L("type", "default")), L("fill", L("type", fill)))


def sym_poly(pts, fill="none", width=0.254):
    return L("polyline", L("pts", *[L("xy", x, y) for x, y in pts]),
             L("stroke", L("width", width), L("type", "default")), L("fill", L("type", fill)))


def symbol(name, props, units, extends=None, pin_names_hide=False, pin_numbers_hide=False,
           pin_name_offset=0.508, power=False):
    """props: list of (key, value, x, y, angle, hide, justify).
    units: dict {(unit, style): [graphics/pins]}; unit 0 = common to all units."""
    s = L("symbol", Q(name))
    if power:
        s.append(L("power"))
    if pin_numbers_hide:
        s.append(L("pin_numbers", "hide"))
    pn = L("pin_names", L("offset", pin_name_offset))
    if pin_names_hide:
        pn.append("hide")
    s.append(pn)
    s += [L("exclude_from_sim", "no"), L("in_bom", "no" if power else "yes"), L("on_board", "no" if power else "yes")]
    for p in props:
        s.append(sym_property(*p))
    for (u, st), body in sorted(units.items()):
        s.append(L("symbol", Q(f"{name}_{u}_{st}"), *body))
    return s


def write_symlib(path, symbols):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    t = L("kicad_symbol_lib", L("version", SYM_VERSION), L("generator", Q(GENERATOR)),
          L("generator_version", Q(GEN_VERSION)), *symbols)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(dumps(t) + "\n")
    return path


def std_props(ref, value, footprint, datasheet, descr, keywords, ref_xy, val_xy, fp_filters=None, source=None):
    p = [("Reference", ref, *ref_xy, 0, False, None),
         ("Value", value, *val_xy, 0, False, None),
         ("Footprint", footprint, 0, 0, 0, True, None),
         ("Datasheet", datasheet or "~", 0, 0, 0, True, None),
         ("Description", descr, 0, 0, 0, True, None),
         ("ki_keywords", keywords, 0, 0, 0, True, None)]
    if fp_filters:
        p.append(("ki_fp_filters", fp_filters, 0, 0, 0, True, None))
    if source:
        p.append(("Source", source, 0, 0, 0, True, None))
    return p


__all__ = ["Footprint", "symbol", "sym_pin", "sym_rect", "sym_poly", "write_symlib", "std_props", "uid", "fmt", "PIN_TYPES"]
