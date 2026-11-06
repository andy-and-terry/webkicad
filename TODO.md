# Library TODO — waiting on a cited source

Nothing below is generated, because no datasheet / standard could be fetched from
the build environment (yageo.com, vishay.com blocked by its network policy) and
values must never come from memory. Until then, use the vendored official KiCad
footprints in `vendor/kicad-footprints/` (Package_SO, Package_TO_SOT_SMD,
Package_QFP, Package_DFN_QFN, Package_DIP, Resistor_SMD, Capacitor_SMD,
Inductor_SMD, LED_SMD, Diode_SMD, Connector_JST, Connector_PinHeader_*,
Connector_PinSocket_*).

Chip R/C/L/LED footprints: decided to use the vendored official KiCad
Resistor_SMD / Capacitor_SMD / Inductor_SMD / LED_SMD libraries (not generated).

## Need a datasheet (send the PDF or the dimension table)
- Right-angle pin headers and sockets, 2.54 / 1.27 mm (vendor drawing).
- JST-PH (S/B..B-PH-K) and JST-XH (B..B-XH-A) — JST drawings.

## Need a JEDEC drawing or vendor package drawing + land pattern
- SOIC-8/14/16 (JEDEC MS-012), SOIC-16W/20W/24W/28W (MS-013)
- SSOP (MO-150), TSSOP-8..28 (MO-153), MSOP-8/10 (MO-187)
- SOT-23-3 (TO-236), SOT-23-5/6 (MO-178), SOT-223 (TO-261)
- TQFP/LQFP-32/44/48/64/100 (MS-026)
- QFN/DFN with exposed pad (MO-220 / MO-229 — EP size is part-specific)
- DIP-8..40 (MS-001)

When a source arrives: add the entry to `packages.yaml` with `source:` and
`density:`, run `python tools/build_all.py`.
