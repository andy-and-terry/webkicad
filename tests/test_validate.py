import os

import validate
from kicad import Footprint, symbol, sym_pin, sym_rect, write_symlib, std_props


def fp_file(tmp_path, mutate=None):
    fp = Footprint("T", "t", "t", "test", attr="smd")
    fp.pad_smd(1, -1, 0, 1, 1, shape="rect")
    fp.pad_smd(2, 1, 0, 1, 1)
    fp.rect(-2, -1, 2, 1, "F.CrtYd", 0.05)
    fp.line(-2.2, -0.8, -2.2, 0.8, "F.SilkS", 0.12)
    if mutate:
        mutate(fp)
    return fp.write(str(tmp_path / "L.pretty"))


def test_good_footprint(tmp_path):
    assert validate.check_footprint(fp_file(tmp_path)) == []


def test_duplicate_pad(tmp_path):
    e = validate.check_footprint(fp_file(tmp_path, lambda f: f.pad_smd(2, 0, 0.5, 0.2, 0.2)))
    assert any("duplicate" in m for m in e)


def test_non_contiguous(tmp_path):
    e = validate.check_footprint(fp_file(tmp_path, lambda f: f.pad_smd(5, 0, 0.5, 0.2, 0.2)))
    assert any("contiguous" in m for m in e)


def test_courtyard_too_tight(tmp_path):
    e = validate.check_footprint(fp_file(tmp_path, lambda f: f.pad_smd(3, 0, 0.7, 0.2, 0.2)))
    assert any("courtyard" in m for m in e)


def test_silk_over_pad(tmp_path):
    e = validate.check_footprint(fp_file(tmp_path, lambda f: f.line(-1.5, 0, 1.5, 0, "F.SilkS", 0.12)))
    assert any("silkscreen" in m for m in e)


def test_pad1_unmarked(tmp_path):
    fp = Footprint("U", "u", "u", "test")
    fp.pad_smd(1, -1, 0, 1, 1)
    fp.pad_smd(2, 1, 0, 1, 1)
    fp.rect(-2, -1, 2, 1, "F.CrtYd", 0.05)
    assert any("pad 1" in m for m in validate.check_footprint(fp.write(str(tmp_path / "L.pretty"))))


def _sym(tmp_path, pins, fp="Gen_Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical"):
    s = symbol("S", std_props("U", "S", fp, "~", "", "", (0, 5.08), (0, -5.08)),
               {(0, 1): [sym_rect(-2.54, 2.54, 2.54, -2.54)], (1, 1): pins})
    return write_symlib(str(tmp_path / "s.kicad_sym"), [s])


FPS = {"Gen_Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical"}


def test_symbol_ok(tmp_path):
    p = _sym(tmp_path, [sym_pin("passive", -5.08, 0, 0, 2.54, "A", 1), sym_pin("passive", 5.08, 0, 180, 2.54, "B", 2)])
    assert validate.check_symlib(p, FPS) == {}


def test_symbol_errors(tmp_path):
    p = _sym(tmp_path, [sym_pin("passive", -5.0, 0, 0, 2.54, "A", 1), sym_pin("passive", -5.0, 0, 0, 2.54, "B", 1)],
             fp="Nope:Nope")
    msgs = " ".join(validate.check_symlib(p, FPS)["S"])
    assert "off 1.27 mm grid" in msgs and "duplicate pin" in msgs and "overlap" in msgs and "not found" in msgs


def test_generated_libraries_clean():
    import build_all
    assert build_all.main() == 0
