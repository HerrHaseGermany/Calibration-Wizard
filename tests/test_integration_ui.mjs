import test from "node:test";
import assert from "node:assert/strict";
import {mountIntegration} from "../frontend/assets/integration.mjs";

function element() {
  const classes = new Set();
  return {
    children: [], listeners: {}, classList: {
      toggle(name, enabled) {if (enabled) classes.add(name); else classes.delete(name);},
      contains(name) {return classes.has(name);},
    },
    replaceChildren() {this.children = [];},
    append(...children) {this.children.push(...children);},
    addEventListener(name, handler) {this.listeners[name] = handler;},
  };
}

test("repair notice queues a fixed endpoint and displays build status", async () => {
  const saved = Object.fromEntries(["document", "window", "fetch", "setInterval"].map(key => [key, globalThis[key]]));
  let current = {configured: true, healthy: false, supported: true, can_repair: true, busy: false};
  const requests = [];
  const root = element();
  let idle = false;
  try {
    globalThis.document = {createElement: element};
    globalThis.window = {addEventListener() {}};
    globalThis.setInterval = () => 0;
    globalThis.fetch = async (url, options) => {
      requests.push({url: url.toString(), options});
      if (options?.method === "POST") {
        current = {...current, can_repair: false, busy: true};
        return {ok: true, json: async () => ({status: "queued"})};
      }
      return {ok: true, json: async () => current};
    };
    const ui = mountIntegration({base: new URL("http://printer/api/klipper-tools/api/"), root,
      t: key => key, canRepair: () => idle, apiError: value => new Error(value.detail)});
    await ui.refresh();
    assert.equal(root.children[0].textContent, "integration.missing");
    assert.equal(root.children.find(child => child.className === "button secondary").disabled, true);
    idle = true;
    ui.render();
    const repair = root.children.find(child => child.className === "button secondary");
    assert.equal(repair.disabled, false);
    await repair.listeners.click();
    const mutation = requests.find(request => request.options?.method === "POST");
    assert.equal(mutation.url, "http://printer/api/klipper-tools/api/mainsail/repair");
    assert.equal(mutation.options.body, undefined);
    assert.ok(root.children.some(child => child.textContent === "integration.building"));
    assert.equal(root.children[0].textContent, "integration.building_title");
    assert.equal(root.classList.contains("building"), true);
    assert.equal(root.children.some(child => child.textContent === "integration.missing"), false);
    assert.equal(root.children.some(child => child.className === "button secondary"), false);
    current = {...current, busy: false, supported: false};
    await ui.refresh();
    assert.ok(root.children.some(child => child.textContent === "integration.unsupported"));
    assert.equal(root.classList.contains("building"), false);
    current = {...current, healthy: true};
    await ui.refresh();
    assert.equal(root.classList.contains("hidden"), true);
    assert.equal(root.children.length, 0);
  } finally {
    Object.assign(globalThis, saved);
  }
});
