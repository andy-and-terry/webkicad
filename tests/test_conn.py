import glob
import os

import gen_conn
from sexpr import parse, findall, find

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pads(path):
    t = parse(open(path).read())
    return sorted((str(p[1]), str(p[3]), tuple(map(float, find(p, "at")[1:3])),
                   tuple(map(float, find(p, "size")[1:3])), float(find(p, "drill")[1])) for p in findall(t, "pad"))


def test_pads_match_official_kicad_library():
    """Every generated header/socket whose counterpart exists in the vendored official
    library must have identical pad numbers, shapes, positions, sizes and drills."""
    gen_conn.main()
    compared = 0
    for g in glob.glob(os.path.join(ROOT, "kicad-footprints", "Gen_Connector_*.pretty", "*.kicad_mod")):
        lib = os.path.basename(os.path.dirname(g))[len("Gen_"):]
        v = os.path.join(ROOT, "vendor", "kicad-footprints", lib, os.path.basename(g))
        if os.path.exists(v):
            assert pads(g) == pads(v), g
            compared += 1
    assert compared >= 300


def test_deterministic(tmp_path):
    a = gen_conn.main()
    before = {p: open(p).read() for p in a}
    gen_conn.main()
    assert all(open(p).read() == s for p, s in before.items())
