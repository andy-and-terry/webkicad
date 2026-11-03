#!/usr/bin/env python3
"""Generic passive / discrete symbols and power symbols.

Output: kicad-symbols/Gen_Device.kicad_sym, kicad-symbols/Gen_power.kicad_sym

Pin numbering follows the official KiCad Device library (vendored, kicad-symbols
commit 45efbd93be87): R/C/L pins 1,2 (unpolarised); C_Polarized 1=+, 2=-;
D and LED 1=K (cathode), 2=A (anode).

Default footprints point at the vendored official KiCad footprints (0603 for chips).
Generated chip-component land patterns are NOT included yet: the Yageo/Vishay
datasheets could not be fetched from this environment (see TODO.md).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kicad import symbol, sym_pin, sym_rect, sym_poly, write_symlib, std_props  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYMDIR = os.path.join(ROOT, "kicad-symbols")
SRC = "Pin numbering per KiCad official Device library (kicad-symbols 45efbd93be87)"


def vertical_2pin(name, ref, value_descr, kw, fp, filt, body, pin_types=("passive", "passive"), names=("~", "~")):
    pins = [sym_pin(pin_types[0], 0, 3.81, 270, 1.27, names[0], 1),
            sym_pin(pin_types[1], 0, -3.81, 90, 1.27, names[1], 2)]
    props = std_props(ref, name, fp, "~", value_descr, kw, (2.54, 0), (-2.54, 0), fp_filters=filt, source=SRC)
    props[0] = ("Reference", ref, 2.54, 1.27, 0, False, "left")
    props[1] = ("Value", name, 2.54, -1.27, 0, False, "left")
    return symbol(name, props, {(0, 1): body, (1, 1): pins}, pin_numbers_hide=True, pin_names_hide=True, pin_name_offset=0)


def horizontal_diode(name, ref, descr, kw, fp, filt, led=False):
    # K (pin 1) left, A (pin 2) right; triangle points at the cathode bar
    body = [sym_poly([(1.27, 1.27), (1.27, -1.27), (-1.27, 0), (1.27, 1.27)], "none"),
            sym_poly([(-1.27, 1.27), (-1.27, -1.27)], "none"),
            sym_poly([(1.27, 0), (-1.27, 0)], "none", 0)]
    if led:
        body += [sym_poly([(-0.508, 1.524), (0.508, 2.54)], "none", 0.1524),
                 sym_poly([(0.254, 1.524), (1.27, 2.54)], "none", 0.1524)]
    pins = [sym_pin("passive", -3.81, 0, 0, 2.54, "K", 1), sym_pin("passive", 3.81, 0, 180, 2.54, "A", 2)]
    props = std_props(ref, name, fp, "~", descr, kw, (0, 3.81), (0, -2.54), fp_filters=filt, source=SRC)
    return symbol(name, props, {(0, 1): body, (1, 1): pins}, pin_numbers_hide=True, pin_names_hide=True, pin_name_offset=1.016)


def device_symbols():
    out = []
    out.append(vertical_2pin("R", "R", "Resistor", "R res resistor", "Resistor_SMD:R_0603_1608Metric", "R_*",
                             [sym_rect(-1.016, 2.54, 1.016, -2.54, "none")]))
    cap = [sym_poly([(-2.032, 0.762), (2.032, 0.762)], "none", 0.508),
           sym_poly([(-2.032, -0.762), (2.032, -0.762)], "none", 0.508),
           sym_poly([(0, 2.54), (0, 0.762)], "none", 0), sym_poly([(0, -2.54), (0, -0.762)], "none", 0)]
    out.append(vertical_2pin("C", "C", "Unpolarized capacitor", "cap capacitor", "Capacitor_SMD:C_0603_1608Metric", "C_*", cap))
    cp = [sym_rect(-2.286, 1.016, 2.286, 0.508, "none"), sym_rect(-2.286, -0.508, 2.286, -1.016, "outline"),
          sym_poly([(-1.778, 2.286), (-0.762, 2.286)], "none", 0), sym_poly([(-1.27, 2.794), (-1.27, 1.778)], "none", 0),
          sym_poly([(0, 2.54), (0, 1.016)], "none", 0), sym_poly([(0, -2.54), (0, -1.016)], "none", 0)]
    out.append(vertical_2pin("C_Polarized", "C", "Polarized capacitor (pin 1 = +)", "cap capacitor polarized electrolytic",
                             "Capacitor_SMD:CP_Elec_5x5.4", "CP_*", cp))
    from kicad import L
    ind = []
    for k in range(4):
        y0 = 2.54 - k * 1.27
        ind.append(L("arc", L("start", 0, y0 - 1.27), L("mid", 0.635, y0 - 0.635), L("end", 0, y0),
                     L("stroke", L("width", 0), L("type", "default")), L("fill", L("type", "none"))))
    out.append(vertical_2pin("L", "L", "Inductor", "inductor choke coil", "Inductor_SMD:L_0603_1608Metric", "L_*", ind))
    out.append(horizontal_diode("D", "D", "Diode (pin 1 = K, pin 2 = A)", "diode", "Diode_SMD:D_SOD-123", "D_*"))
    out.append(horizontal_diode("LED", "D", "Light emitting diode (pin 1 = K, pin 2 = A)", "LED diode light",
                                "LED_SMD:LED_0603_1608Metric", "LED_*", led=True))
    return out


def power_symbol(net, ground=False):
    if ground:
        body = [sym_poly([(0, 0), (0, -1.27), (1.27, -1.27), (0, -2.54), (-1.27, -1.27), (0, -1.27)], "none", 0)]
        pin = sym_pin("power_in", 0, 0, 270, 0, "~", 1, hidden=True)
        ref_xy, val_xy = (0, -6.35), (0, -3.81)
    else:
        body = [sym_poly([(-0.762, 1.27), (0, 2.54)], "none", 0), sym_poly([(0, 0), (0, 2.54)], "none", 0),
                sym_poly([(0, 2.54), (0.762, 1.27)], "none", 0)]
        pin = sym_pin("power_in", 0, 0, 90, 0, "~", 1, hidden=True)
        ref_xy, val_xy = (0, -3.81), (0, 3.556)
    props = [("Reference", "#PWR", *ref_xy, 0, True, None), ("Value", net, *val_xy, 0, False, None),
             ("Footprint", "", 0, 0, 0, True, None), ("Datasheet", "", 0, 0, 0, True, None),
             ("Description", f'Power symbol creates a global label with name "{net}"', 0, 0, 0, True, None),
             ("ki_keywords", "global power", 0, 0, 0, True, None)]
    return symbol(net, props, {(0, 1): body, (1, 1): [pin]}, power=True, pin_numbers_hide=True, pin_name_offset=0, pin_names_hide=True)


def main():
    a = write_symlib(os.path.join(SYMDIR, "Gen_Device.kicad_sym"), device_symbols())
    pw = [power_symbol("GND", True)] + [power_symbol(n) for n in ("VCC", "+3V3", "+5V", "+12V")]
    b = write_symlib(os.path.join(SYMDIR, "Gen_power.kicad_sym"), pw)
    print("gen_passives: 6 device symbols, 5 power symbols")
    return [a, b]


if __name__ == "__main__":
    main()
