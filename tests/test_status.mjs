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
