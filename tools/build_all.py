#!/usr/bin/env python3
"""Regenerate every library, build index.json, then validate. Exit 1 on any error."""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_index, gen_conn, gen_ic, gen_parts, gen_passives, validate  # noqa: E402,E401

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    # clean generated output so removed parts don't linger
    for d in ("kicad-symbols", "kicad-footprints"):
        shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)
    gen_conn.main()
    gen_passives.main()
    gen_ic.main()
    gen_parts.main()
    build_index.main()
    errors = validate.run()
    if errors:
        print(f"FAILED: {errors} validation error(s)")
        return 1
    print("build_all: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
