import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Load the browser module without adding a package dependency or changing module types.
globalThis.localStorage = {getItem: () => "de", setItem: () => {}};
globalThis.document = {documentElement: {}};
globalThis.Node = {TEXT_NODE: 3, ELEMENT_NODE: 1};
globalThis.NodeFilter = {SHOW_TEXT: 4};
const source = await readFile(new URL("../frontend/assets/i18n.js", import.meta.url), "utf8");
const {translate, localize, setLocale} = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("extruder instructions, warnings and dynamic errors use German", () => {
  setLocale("de");
  assert.equal(translate("Step 4 · Motion"), "Schritt 4 · Bewegung");
  assert.equal(translate("Heating…"), "Heizt…");
  assert.equal(translate("Extrude 100 mm again"), "Extrudiere 100 mm erneut");
  assert.equal(translate("Temperature must be between 170 and 300 °C"), "Die Temperatur muss zwischen 170 und 300 °C liegen");
  assert.equal(translate("The calculated rotation_distance is not realistic."), "Die berechnete rotation_distance ist unrealistisch.");
  assert.equal(translate("Updated /config/printer.cfg; backup: /backups/printer.cfg"), "Aktualisiert: /config/printer.cfg; Backup: /backups/printer.cfg");
});

test("English covers manual screws, setup, inline fragments and validation", () => {
  setLocale("en");
  assert.equal(translate("Papierwiderstand angleichen"), "Match paper resistance");
  assert.equal(translate("Probe-Messpunkte (4 Punkte)"), "Probe points (4 points)");
  assert.equal(translate("Punkt 2 X ist keine gültige Zahl"), "Point 2 X is not a valid number");
  assert.equal(translate("Zieltemperatur muss in 5-°C-Schritten zwischen 150 und 300 liegen"), "Target temperature must be in 5 °C increments between 150 and 300");
  assert.equal(translate("mm. Übernimm den neuen Wert in dein Filamentprofil im Slicer und drucke zur Kontrolle erneut."), "mm. Apply the new value to your filament profile in the slicer and print again to verify it.");
});

test("translation never changes parts of words or Klipper identifiers", () => {
  setLocale("de");
  assert.equal(translate("Heater Heatmap rotation_distance SAVE_CONFIG"), "Heizer Heatmap rotation_distance SAVE_CONFIG");
  setLocale("en");
  assert.equal(translate("Schraubengewinde Vermessungsdaten"), "Screw thread Vermessungsdaten");
});

test("repeated switching preserves ambiguous originals and detects new text", () => {
  const node = {nodeType: 3, nodeValue: "Vermessen", parentElement: {closest: () => null}};
  setLocale("en"); localize(node);
  assert.equal(node.nodeValue, "Measure");
  for (let count = 0; count < 3; count++) {
    setLocale("de"); localize(node); assert.equal(node.nodeValue, "Vermessen");
    setLocale("en"); localize(node); assert.equal(node.nodeValue, "Measure");
  }
  node.nodeValue = "Schraube einstellen";
  localize(node); assert.equal(node.nodeValue, "Adjust screw");
  setLocale("de"); localize(node); assert.equal(node.nodeValue, "Schraube einstellen");
});

test("root accessibility attributes translate while code and user labels stay intact", () => {
  const attributes = new Map([["title", "Drucker sofort anhalten"], ["aria-label", "NOT-AUS"]]);
  const element = {nodeType: 1, querySelectorAll: () => [], closest: () => null,
    hasAttribute: name => attributes.has(name), getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value)};
  document.createTreeWalker = () => ({nextNode: () => false});
  setLocale("en"); localize(element);
  assert.equal(attributes.get("title"), "Stop printer immediately");
  assert.equal(attributes.get("aria-label"), "EMERGENCY STOP");
  setLocale("de"); localize(element);
  assert.equal(attributes.get("title"), "Drucker sofort anhalten");
  const protectedNode = {nodeType: 3, nodeValue: "Speichern", parentElement: {closest: () => ({})}};
  setLocale("en"); localize(protectedNode);
  assert.equal(protectedNode.nodeValue, "Speichern");
});
