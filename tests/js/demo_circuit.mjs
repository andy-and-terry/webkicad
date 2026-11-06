// Build a small schematic with the Schematic model (used by tests and ERC runs).
import fs from "node:fs";
import { Schematic } from "../../js/schematic.js";
import { extractSymbol } from "../../js/preview.js";

const lib = (file, name) => extractSymbol(fs.readFileSync(file, "utf8"), name);
export function buildDemo() {
  const s = Schematic.empty("demo");
  const DEV = "kicad-symbols/Gen_Device.kicad_sym", PWR = "kicad-symbols/Gen_power.kicad_sym";
  const v = s.placeSymbol("Gen_power:+3V3", lib(PWR, "+3V3"), 50.8, 40.64);
  s.placeSymbol("Gen_power:PWR_FLAG", lib(PWR, "PWR_FLAG"), 45.72, 40.64);
  const r = s.placeSymbol("Gen_Device:R", lib(DEV, "R"), 50.8, 50.8);
  s.setProperty(r, "Value", "330");
  const d = s.placeSymbol("Gen_Device:LED", lib(DEV, "LED"), 50.8, 63.5);
  s.rotate(d);
  const g = s.placeSymbol("Gen_power:GND", lib(PWR, "GND"), 50.8, 72.39);
  s.placeSymbol("Gen_power:PWR_FLAG", lib(PWR, "PWR_FLAG"), 45.72, 72.39);
  s.addWire(50.8, 40.64, 50.8, 46.99);       // +3V3 -> R pin 1
  s.addWire(45.72, 40.64, 50.8, 40.64);      // PWR_FLAG on +3V3
  s.addWire(50.8, 54.61, 50.8, 59.69);       // R pin 2 -> LED anode
  s.addWire(50.8, 67.31, 50.8, 72.39);       // LED cathode -> GND
  s.addWire(45.72, 72.39, 50.8, 72.39);      // PWR_FLAG on GND
  s.addLabel("LED_A", 50.8, 57.15);
  s.addGlobalLabel("VLED", 50.8, 57.15, 0, "output");
  return { s, r, d, v, g };
}
