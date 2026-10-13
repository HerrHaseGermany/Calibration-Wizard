import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../frontend/assets/app.js", import.meta.url), "utf8");
const statusSource = source.slice(source.indexOf("function updateConnectionStatus()"), source.indexOf("function updateStatus(data)"));

test("header status distinguishes printing, paused, readiness and connection failures", () => {
  const label = {};
  const context = vm.createContext({
    connection: {}, document: {querySelector: () => label},
    t: key => key, setText: (element, text) => { element.text = text(); },
  });
  vm.runInContext(statusSource, context);
  for (const [connected, state, printState, tone, key] of [
    [true, "ready", "printing", "busy", "printer.status.printing"],
    [true, "ready", "paused", "busy", "printer.print.paused"],
    [true, "ready", "standby", "online", "printer.state.ready"],
    [true, "ready", "complete", "online", "printer.state.ready"],
    [true, "startup", "printing", "busy", "printer.state.startup"],
    [true, "shutdown", "printing", "offline", "printer.state.shutdown"],
    [true, "error", "standby", "offline", "printer.state.error"],
    [false, "ready", "printing", "offline", "ui.printer_offline"],
    [true, "unexpected", "standby", "offline", "printer.state.unknown"],
  ]) {
    context.printer = {connected, state, print_state: printState};
    context.updateConnectionStatus();
    assert.equal(context.connection.className, `connection ${tone}`);
    assert.equal(label.text, key);
  }
});

const lockSource = source.slice(source.indexOf("function wizardBlockedByPrint()"), source.indexOf('document.querySelector("#print-block-cancel").addEventListener'));

test("remote printing locks the open wizard and preserves its controls until the print ends", () => {
  const banner = {classList: {toggle: (name, hidden) => { banner.hidden = hidden; }}};
  const cancel = {};
  const panel = {controls: [{disabled: true}, {disabled: false}]};
  const context = vm.createContext({
    activeWizard: "extruder", printer: {print_state: "standby"}, navigationLocked: false,
    panel, document: {querySelector: selector => selector === "#print-block" ? banner : cancel},
  });
  vm.runInContext(lockSource, context);
  for (const printState of ["printing", "paused"]) {
    context.printer.print_state = printState;
    context.updateWizardPrintLock();
    assert.equal(panel.inert, true);
    assert.equal(banner.hidden, false);
    assert.equal(cancel.disabled, false);
  }
  context.printer.print_state = "complete";
  context.updateWizardPrintLock();
  assert.equal(panel.inert, false);
  assert.equal(banner.hidden, true);
  assert.deepEqual(panel.controls, [{disabled: true}, {disabled: false}]);
  context.printer.print_state = "printing";
  context.activeWizard = null;
  context.updateWizardPrintLock();
  assert.equal(panel.inert, false);
});

test("paused prints permit filament changes but lock calibration steps", () => {
  const context = vm.createContext({activeWizard: "filament", printer: {print_state: "paused"}});
  vm.runInContext(lockSource, context);
  assert.equal(context.wizardBlockedByPrint(), false);
  context.printer.print_state = "printing";
  assert.equal(context.wizardBlockedByPrint(), true);
});

test("stale wizard requests cannot submit actions while printing, but cancellation can", async () => {
  let requests = 0;
  const context = vm.createContext({
    activeWizard: "extruder", printer: {print_state: "printing"},
    LocalizedError: Error, clearError() {}, URL, base: "http://localhost/api/",
    fetch: async () => { requests++; return {ok: true, json: async () => ({state: "CANCELLED"})}; },
  });
  vm.runInContext(lockSource + source.slice(source.indexOf("async function api("), source.indexOf("async function postCommand(")), context);
  await assert.rejects(context.api("wizards/extruder/heat", {temperature: 200}));
  assert.equal(requests, 0);
  await context.api("wizards/extruder/cancel");
  await context.api("wizards/bed_mesh/action", {action: "cancel"});
  assert.equal(requests, 2);
});

const filamentSource = await readFile(new URL("../wizards/filament/frontend.mjs", import.meta.url), "utf8");

test("remote printing also locks an open filament dialog", () => {
  const currentPrinter = {print_state: "standby"};
  const confirm = {disabled: false};
  const keepHot = {disabled: false};
  const selection = {};
  const context = vm.createContext({
    getPrinter: () => currentPrinter, disposed: false, stage: "selection",
    confirm, keepHot, selection, errorBox: {classList: {add() {}, remove() {}}},
    setText() {}, t: key => key,
  });
  vm.runInContext(filamentSource.slice(filamentSource.indexOf("    let printLocked = false;"), filamentSource.indexOf('    window.addEventListener("printerstatuschange"')) + '\nglobalThis.updatePrintLock = updatePrintLock;', context);
  currentPrinter.print_state = "printing";
  context.updatePrintLock();
  assert.equal(selection.inert, true);
  assert.equal(confirm.disabled, true);
  assert.equal(keepHot.disabled, true);
  currentPrinter.print_state = "paused";
  context.updatePrintLock();
  assert.equal(selection.inert, false);
  assert.equal(confirm.disabled, false);
});

test("cancelling a filament dialog during a print leaves the heater untouched", async () => {
  let heatRequests = 0;
  let closed = false;
  const context = vm.createContext({
    getPrinter: () => ({print_state: "printing"}), close: {disabled: false},
    startedHeating: true, disposed: false, timer: null, clearTimeout() {},
    request: async () => { heatRequests++; },
    window: {removeEventListener() {}}, updatePrintLock() {},
    dialog: {close: () => { closed = true; }, remove() {}}, setNavigationLocked() {},
  });
  vm.runInContext(filamentSource.slice(filamentSource.indexOf("    const closeDialog = async"), filamentSource.indexOf('    close.addEventListener("click"')) + '\nglobalThis.closeDialog = closeDialog;', context);
  await context.closeDialog();
  assert.equal(closed, true);
  assert.equal(heatRequests, 0);
});
