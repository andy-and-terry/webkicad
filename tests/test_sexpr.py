import glob
import os
import random

import pytest
from sexpr import parse, dumps, same, Sym, QStr, SexprError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_basic_types():
    t = parse('(a "b c" 1.5 (d "e\\"f\\\\g\\nh"))')
    assert t == ["a", "b c", "1.5", ["d", 'e"f\\g\nh']]
    assert type(t[0]) is Sym and type(t[1]) is QStr and type(t[2]) is Sym


@pytest.mark.parametrize("bad", ["(a", "a)", "(a))", "(a \"b)", "", "(a) (b)", "x"])
def test_rejects_malformed(bad):
    with pytest.raises(SexprError):
        parse(bad)


def test_roundtrip_quoting_preserved():
    t = parse('(x "1" 1 "" "a b")')
    assert same(parse(dumps(t)), t)


def test_roundtrip_real_kicad_files():
    files = [f for f in glob.glob(os.path.join(ROOT, "vendor", "**", "*.kicad_*"), recursive=True) if os.path.isfile(f)]
    assert len(files) > 1000
    random.Random(0).shuffle(files)
    for f in files[:400]:
        t = parse(open(f, encoding="utf-8").read())
        assert same(parse(dumps(t)), t), f
