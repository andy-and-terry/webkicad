"""gen_ic / gen_symbol tests. Package numbers here are SYNTHETIC test fixtures used
only to exercise the code paths; they are not written to any library."""
import pytest

import gen_ic
import gen_symbol
import validate
from sexpr import parse, findall, find

FIX = dict(name="TEST_DUAL8", library="Test", family="dual", source="synthetic test fixture",
           density="test", pins=8, pitch=1.27, pad=[1.5, 0.6], pad_span=5.4, body=[3.9, 4.9])


def _pads(path):
    t = parse(open(path).read())
    return {str(p[1]): tuple(map(float, find(p, "at")[1:3])) for p in findall(t, "pad")}


def test_dual_numbering_and_valid(tmp_path, monkeypatch):
    monkeypatch.setattr(gen_ic, "FPDIR", str(tmp_path))
    path = gen_ic.build(dict(FIX))
    p = _pads(path)
    assert p["1"][0] < 0 and p["1"][1] < p["4"][1]       # pin 1 top-left, down the left side
    assert p["5"][0] > 0 and p["5"][1] > p["8"][1]       # then up the right side
    assert validate.check_footprint(path) == []


def test_quad_with_ep(tmp_path, monkeypatch):
    monkeypatch.setattr(gen_ic, "FPDIR", str(tmp_path))
    e = dict(FIX, name="TEST_QUAD16", family="quad", pins=16, pitch=0.5, pad=[0.8, 0.3], pad_span=[3.8, 3.8],
             body=[3, 3], ep=[1.7, 1.7])
    path = gen_ic.build(e)
    p = _pads(path)
    assert len(p) == 17 and p["17"] == (0, 0)
    assert p["5"][1] > 0 and p["9"][0] > 0 and p["13"][1] < 0   # bottom, right, top
    assert validate.check_footprint(path) == []


def test_dip_and_pads_family(tmp_path, monkeypatch):
    monkeypatch.setattr(gen_ic, "FPDIR", str(tmp_path))
    assert validate.check_footprint(gen_ic.build(dict(FIX, name="TEST_DIP8", family="dip", row_spacing=7.62,
                                                      pad_dia=1.6, drill=0.8, pitch=2.54, body=[6.4, 9.8]))) == []
    pl = [dict(num=1, x=-0.95, y=1.0, w=0.6, h=0.7), dict(num=2, x=0.95, y=1.0, w=0.6, h=0.7),
          dict(num=3, x=0, y=-1.0, w=0.6, h=0.7)]
    assert validate.check_footprint(gen_ic.build(dict(FIX, name="TEST_PADS3", family="pads", pad_list=pl, body=[2.9, 1.3]))) == []


@pytest.mark.parametrize("drop", ["source", "density"])
def test_requires_citation(drop):
    e = dict(FIX)
    del e[drop]
    with pytest.raises(gen_ic.PackageError):
        gen_ic.build(e)


ROWS = [
    dict(number="1", name="VCC", type="power_in", side="top"),
    dict(number="2", name="GND", type="power_in", side="bottom", hidden="yes"),
    dict(number="3", name="PA0", type="bidirectional", side="left", group="A"),
    dict(number="4", name="PA1", type="bidirectional", side="left", group="A"),
    dict(number="5", name="RESET", type="input", side="left", group="ctl"),
    dict(number="6", name="OUT", type="output", side="right"),
    dict(number="7", name="IN2", type="input", side="left", unit="2"),
    dict(number="8", name="OUT2", type="output", side="right", unit="2"),
]
FP = "Gen_Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical"


def test_symbol_from_table(tmp_path):
    s = gen_symbol.make_symbol("TEST", gen_symbol.normalize(ROWS), FP)
    path = gen_symbol.add_to_library(str(tmp_path / "x.kicad_sym"), s)
    assert validate.check_symlib(path, {FP}) == {}
    t = parse(open(path).read())
    subs = {str(x[1]): x for x in findall(findall(t, "symbol")[0], "symbol")}
    assert set(subs) == {"TEST_1_1", "TEST_2_1"}
    pins = {str(find(p, "number")[1]): p for x in subs.values() for p in findall(x, "pin")}
    assert str(pins["2"][1]) == "power_in" and "hide" in [str(a) for a in pins["2"]]
    assert str(pins["5"][1]) == "input"
    # group gap: PA1 -> RESET separated by an empty slot (5.08 mm)
    y = lambda n: float(find(pins[n], "at")[2])  # noqa: E731
    assert abs((y("4") - y("5")) - 5.08) < 1e-6 and abs((y("3") - y("4")) - 2.54) < 1e-6


@pytest.mark.parametrize("bad", [
    [dict(number="1", name="A", type="input", side="left", hidden="yes")],
    [dict(number="1", name="A", type="inputt", side="left")],
    [dict(number="1", name="A", type="input", side="middle")],
    [dict(number="1", name="A", type="input", side="left"), dict(number="1", name="B", type="input", side="left")],
])
def test_bad_tables(bad):
    with pytest.raises(gen_symbol.PinTableError):
        gen_symbol.normalize(bad)
