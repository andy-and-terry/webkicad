"""Minimal, strict s-expression parser/serializer for KiCad files.

Data model:
  list   -> Python list
  Sym    -> bare token (keywords and numbers, kept as original text)
  QStr   -> quoted string (unescaped value)
parse(dumps(parse(x))) == parse(x) for every valid KiCad file.
"""
import re

__all__ = ["Sym", "QStr", "parse", "dumps", "SexprError", "num", "Q", "L", "find", "findall", "fmt"]


class SexprError(ValueError):
    pass


class Sym(str):
    __slots__ = ()
    def __repr__(self):
        return f"Sym({str.__repr__(self)})"


class QStr(str):
    __slots__ = ()
    def __repr__(self):
        return f"QStr({str.__repr__(self)})"


_ESC = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"'}


def parse(text):
    """Parse exactly one top-level expression (trailing whitespace allowed)."""
    i, n = 0, len(text)
    stack, root = [], None
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
        elif c == "(":
            if root is not None and not stack:
                raise SexprError(f"data after top-level expression at {i}")
            new = []
            if stack:
                stack[-1].append(new)
            stack.append(new)
            i += 1
        elif c == ")":
            if not stack:
                raise SexprError(f"unbalanced ')' at offset {i}")
            done = stack.pop()
            if not stack:
                root = done
            i += 1
        elif c == '"':
            if not stack:
                raise SexprError(f"string outside list at {i}")
            i += 1
            buf = []
            while True:
                if i >= n:
                    raise SexprError("unterminated string")
                c = text[i]
                if c == "\\":
                    if i + 1 >= n:
                        raise SexprError("unterminated escape")
                    buf.append(_ESC.get(text[i + 1], text[i + 1]))
                    i += 2
                elif c == '"':
                    i += 1
                    break
                else:
                    buf.append(c)
                    i += 1
            stack[-1].append(QStr("".join(buf)))
        else:
            if not stack:
                raise SexprError(f"atom outside list at {i}")
            j = i
            while j < n and text[j] not in ' \t\r\n()"':
                j += 1
            stack[-1].append(Sym(text[i:j]))
            i = j
    if stack:
        raise SexprError(f"{len(stack)} unclosed '('")
    if root is None:
        raise SexprError("empty input")
    return root


def _quote(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def fmt(v):
    """Format a number the way KiCad does (no trailing zeros, no -0)."""
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, int):
        return str(v)
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _atom(a):
    if isinstance(a, QStr):
        return _quote(a)
    if isinstance(a, (int, float)):
        return fmt(a)
    return str(a)


def dumps(node, indent=0):
    """Serialize in KiCad-like layout: lists of only atoms on one line."""
    if not isinstance(node, list):
        return _atom(node)
    if all(not isinstance(c, list) for c in node):
        return "(" + " ".join(_atom(c) for c in node) + ")"
    pad = "\t" * (indent + 1)
    head, parts = [], []
    k = 0
    while k < len(node) and not isinstance(node[k], list):
        head.append(_atom(node[k]))
        k += 1
    out = "(" + " ".join(head)
    for c in node[k:]:
        parts.append("\n" + pad + dumps(c, indent + 1))
    return out + "".join(parts) + "\n" + "\t" * indent + ")"


# ---------- builder helpers ----------
def Q(s):
    return QStr(s)


def L(*items):
    """Build a list; Python str -> bare Sym, QStr stays quoted, numbers formatted."""
    out = []
    for it in items:
        if it is None:
            continue
        if isinstance(it, (list, QStr, Sym)):
            out.append(it)
        elif isinstance(it, str):
            out.append(Sym(it))
        elif isinstance(it, (int, float)):
            out.append(Sym(fmt(it)))
        else:
            raise TypeError(type(it))
    return out


def num(a):
    return float(a)


def find(node, key):
    for c in node:
        if isinstance(c, list) and c and c[0] == key:
            return c
    return None


def findall(node, key):
    return [c for c in node if isinstance(c, list) and c and c[0] == key]


def same(a, b):
    """Structural equality that also distinguishes quoted vs bare atoms."""
    if isinstance(a, list) or isinstance(b, list):
        return isinstance(a, list) and isinstance(b, list) and len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def walk(node):
    yield node
    for c in node:
        if isinstance(c, list):
            yield from walk(c)


if __name__ == "__main__":
    import sys
    bad = 0
    for p in sys.argv[1:]:
        try:
            parse(open(p, encoding="utf-8").read())
        except SexprError as e:
            bad += 1
            print(f"{p}: {e}")
    print(f"{len(sys.argv) - 1 - bad} ok, {bad} failed")
    sys.exit(1 if bad else 0)
