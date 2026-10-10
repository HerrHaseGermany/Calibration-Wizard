import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadLocales, t, msg, getLocale, getLanguagePreference, resolveLocale, setLocale, setText, applyTranslations, apiError} from "../frontend/assets/i18n.js";

const catalogs = {};
await loadLocales(async url => {
  const language = url.pathname.split("/").pop().split(".")[0];
  catalogs[language] = JSON.parse(await readFile(url, "utf8"));
  return catalogs[language];
});

test("catalogs have identical stable keys and named parameters", () => {
  assert.deepEqual(Object.keys(catalogs.de).sort(), Object.keys(catalogs.en).sort());
  for (const key of Object.keys(catalogs.de)) {
    assert.deepEqual([...String(catalogs.de[key]).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), [...String(catalogs.en[key]).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), key);
  }
});

test("filament labels and dynamic text use explicit keys", () => {
  setLocale("de");
  assert.equal(t("filament.change"), "Filament wechseln");
  assert.equal(t("ui.extrude_value_mm_again", {distance:100}), "Extrudiere 100 mm erneut");
  setLocale("en");
  assert.equal(t("filament.change"), "Change filament");
  assert.equal(t("ui.extrude_value_mm_again", {distance:100}), "Extrude 100 mm again");
  assert.equal(t("missing.key"), "missing.key");
});

test("markup preserves keys and safely stores interpolation parameters", () => {
  const html = msg("ui.extrude_value_mm", {distance:'100" onmouseover="test'});
  assert.match(html, /data-i18n="ui.extrude_value_mm"/);
  assert.match(html, /data-i18n-params="[^\"]*&quot;/);
});

test("structured backend errors translate parameters and follow language changes", () => {
  const error = apiError({message_key:"ui.value_is_not_a_valid_number", message_params:{label:{message_key:"setup.axis",message_params:{label:{message_key:"setup.point",message_params:{index:2}},axis:"X"}}},detail:"Diagnostic"});
  setLocale("en");
  assert.equal(error.message, "Point 2 X is not a valid number");
  setLocale("de");
  assert.equal(error.message, "Punkt 2 X ist keine gültige Zahl");
  assert.equal(apiError({detail:[{type:"validation"}]}).message,"Bitte prüfe die Eingabewerte.");
});

test("keyed slots and text bindings switch in place without modifying inputs", () => {
  const input = {value:"243"};
  const slot = {dataset:{i18n:"filament.load"},parentElement:{closest:()=>null},querySelectorAll:()=>[]};
  const status = {isConnected:true,textContent:""};
  const root = {querySelectorAll:selector=>selector==="[data-i18n]"?[slot]:[],contains:()=>true};
  setLocale("de"); setText(status,()=>t("filament.change")); applyTranslations(root);
  assert.equal(slot.innerHTML,"Filament laden");
  setLocale("en"); applyTranslations(root);
  assert.equal(slot.innerHTML,"Load filament");
  assert.equal(status.textContent,"Change filament");
  assert.equal(input.value,"243");
});

test("frontend no longer uses phrase matching or a translation observer", async () => {
  const runtime = await readFile(new URL("../frontend/assets/i18n.js",import.meta.url),"utf8");
  const app = await readFile(new URL("../frontend/assets/app.js",import.meta.url),"utf8");
  assert.doesNotMatch(runtime,/replacePhrases|const pairs|const templates|export function translate\(/);
  assert.doesNotMatch(app,/MutationObserver|localize\(/);
});

test("frontend key references exist in the catalogs", async () => {
  for (const path of ["../frontend/assets/app.js", "../frontend/assets/positions.mjs", "../wizards/filament/frontend.mjs"]) {
    const source = await readFile(new URL(path,import.meta.url),"utf8");
    const keys = [...source.matchAll(/\b(?:t|msg|LocalizedError)\(["']([^"']+)["']/g)].map(match=>match[1]);
    for (const key of keys) assert.ok(Object.hasOwn(catalogs.de,key), key);
  }
  const html = await readFile(new URL("../frontend/index.html",import.meta.url),"utf8");
  for (const match of html.matchAll(/data-i18n(?:-aria-label|-title|-placeholder)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(catalogs.de,match[1]),match[1]);
  }
});


test("automatic language follows browser preferences while manual choices take priority", () => {
  assert.equal(resolveLocale("system", ["de-DE", "en-US"]), "de");
  assert.equal(resolveLocale("system", ["en-GB", "de-DE"]), "en");
  assert.equal(resolveLocale("system", ["fr-FR", "de-AT"]), "de");
  assert.equal(resolveLocale("system", ["fr-FR", "es-ES"]), "en");
  assert.equal(resolveLocale("system", []), "en");
  assert.equal(resolveLocale("en", ["de-DE"]), "en");
  assert.equal(resolveLocale("de", ["en-US"]), "de");
  setLocale("system");
  assert.equal(getLanguagePreference(), "system");
  assert.equal(getLocale(), resolveLocale("system"));
});

test("browser modules share the same localization module instance", async () => {
  const app = await readFile(new URL("../frontend/assets/app.js",import.meta.url),"utf8");
  const positions = await readFile(new URL("../frontend/assets/positions.mjs",import.meta.url),"utf8");
  assert.equal(app.match(/from "(\.\/i18n\.js[^\"]*)"/)[1], positions.match(/from "(\.\/i18n\.js[^\"]*)"/)[1]);
});
