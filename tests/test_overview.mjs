import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../frontend/assets/app.js", import.meta.url), "utf8");
const dashboardSource = source.slice(source.indexOf("function dashboard()"), source.indexOf("function configurationOverview()"));
const configurationSource = source.slice(source.indexOf("function configurationOverview()"), source.indexOf("function filamentPage()"));

function harness(printState = "standby") {
  const noop = () => {};
  const calls = [];
  let cards = [];
  const panel = {
    set innerHTML(value) {
      this.markup = value;
      cards = [...value.matchAll(/data-(wizard|setup)="([^"]+)"/g)].map(match => ({
        dataset: {[match[1]]:match[2]}, handlers:{}, addEventListener(name, handler) {this.handlers[name]=handler;},
      }));
    },
    querySelectorAll(selector) {return cards.filter(card => selector.includes(card.dataset.wizard ? "wizard" : "setup"));},
  };
  const element = {classList:{add:noop},querySelector:()=>({})};
  const context = vm.createContext({
    panel, printer:{connected:true,state:"ready",print_state:printState}, session:null, activeWizard:null,
    wizards:[{id:"filament",category:"helper",available:true},{id:"pid",available:true},{id:"bed_mesh",available:false,setup_available:true}],
    forgetCalibration:noop,setOverviewState:noop,emergencyButton:element,rail:element,workspace:element,statusStrip:element,
    clearError:noop,printerIsReady:()=>true,printerReadinessNotice:()=>"",setText:noop,
    msg:key=>key,t:key=>key,cardIcon:()=>"",updateNavigationAvailability:noop,
    button:(id,label)=>`<button id="${id}">${label}</button>`,bind:noop,
    document:{querySelectorAll:selector=>panel.querySelectorAll(selector)},cleanConfigWizards:new Set(),
    filamentPage:()=>calls.push("filament"),welcome:()=>calls.push("extruder"),openGeneric:id=>calls.push(id),
    pendingConfigPage:id=>calls.push(id),openSetup:async id=>calls.push(`setup:${id}`),showError:error=>{throw error;},
  });
  vm.runInContext(dashboardSource + configurationSource,context);
  context.dashboard();
  return {context,panel,calls,cards:()=>cards};
}

test("overview cards have no nested buttons and filament opens by click or keyboard", () => {
  const {context,panel,calls,cards} = harness();
  assert.doesNotMatch(panel.markup,/<button/);
  let filament = cards().find(card=>card.dataset.wizard==="filament");
  filament.handlers.click();
  assert.deepEqual(calls,["filament"]);
  context.dashboard();
  filament = cards().find(card=>card.dataset.wizard==="filament");
  let prevented = false;
  filament.handlers.keydown({target:filament,key:" ",preventDefault:()=>{prevented=true;}});
  assert.ok(prevented);
  assert.deepEqual(calls,["filament","filament"]);
});

test("printing blocks cards while a paused print still permits filament", () => {
  assert.equal(harness("printing").cards().filter(card=>card.dataset.wizard).length,0);
  const paused = harness("paused").cards().filter(card=>card.dataset.wizard);
  assert.deepEqual(paused.map(card=>card.dataset.wizard),["filament"]);
});

test("configuration includes unconfigured tools and supports keyboard activation", async () => {
  const {context,cards,calls} = harness();
  context.configurationOverview();
  const setup = cards().find(card=>card.dataset.setup==="bed_mesh");
  assert.ok(setup);
  setup.handlers.keydown({target:setup,key:"Enter",preventDefault(){}});
  await Promise.resolve();
  assert.deepEqual(calls,["setup:bed_mesh"]);
  context.printer.print_state="printing";
  context.configurationOverview();
  assert.equal(cards().length,0);
});
