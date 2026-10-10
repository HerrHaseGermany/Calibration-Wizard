import { getLocale, localize, setLocale, t } from "./i18n.js?v=20261010-6";
import { adjustment, positionMap } from "./positions.mjs?v=20261006-2";

const base = new URL("./api/", window.location.href);
const panel = document.querySelector("#panel");
const notice = document.querySelector("#notice");
const progress = document.querySelector("#progress");
const connection = document.querySelector(".connection");
const rail = document.querySelector("#rail");
const workspace = document.querySelector(".workspace");
const statusStrip = document.querySelector("#status-strip");
const homeButton = document.querySelector("#home-button");
const emergencyButton = document.querySelector("#emergency-button");
let printer = null;
let session = null;
let wizards = [];
let uiStep = 0;
let activeWizard = null;
let isOverview = true;
let resumeMode = false;
let bootstrapping = true;
const resumeStorageKey = "kcw-active-calibration";
const pendingResolutionStorageKey = "kcw-pending-config-resolution";
const cleanConfigWizards = new Set(["pid", "bed_mesh", "probe_offset", "input_shaper"]);
let resolvingPendingConfig = false;

function rememberCalibration(wizard, id = null) {
  sessionStorage.setItem(resumeStorageKey, JSON.stringify({wizard, id}));
}

function forgetCalibration() {
  sessionStorage.removeItem(resumeStorageKey);
  resumeMode = false;
}

function pendingResolution() {
  try { return JSON.parse(sessionStorage.getItem(pendingResolutionStorageKey)); }
  catch { sessionStorage.removeItem(pendingResolutionStorageKey); return null; }
}

function printerIsReady() {
  return Boolean(printer?.connected && printer.state === "ready");
}

function printerReadinessKey(value = printer) {
  return `${Boolean(value?.connected)}|${value?.state || "unknown"}|${value?.state_message || ""}`;
}

function printerReadinessNotice() {
  if (printerIsReady()) return "";
  const state = printer?.connected ? (printer.state || "unknown") : "disconnected";
  const copy = {
    shutdown: "Klipper befindet sich im Shutdown-Zustand. Prüfe den Drucker und die Fehlermeldung in Mainsail. Führe einen Firmware-Neustart erst aus, wenn die Ursache behoben ist.",
    error: "Klipper meldet einen Fehler. Prüfe die Fehlermeldung in Mainsail und behebe die Ursache, bevor du fortfährst.",
    startup: "Klipper startet gerade. Die Kalibrierungen werden automatisch freigegeben, sobald die Firmware bereit ist.",
    disconnected: "Klipper Tools kann Klipper derzeit nicht erreichen. Prüfe die Verbindung und den Zustand in Mainsail.",
  }[state] || `Klipper ist momentan nicht bereit (Zustand: ${esc(state)}). Prüfe den Drucker in Mainsail.`;
  const detail = printer?.state_message ? `<p class="printer-state-message" data-no-i18n>${esc(printer.state_message)}</p>` : "";
  return `<aside class="printer-readiness" role="alert"><div><strong>Klipper ist nicht bereit</strong><p>${copy}</p>${detail}</div><a class="button secondary" href="/">Zu Mainsail</a></aside>`;
}

function setOverviewState(current) {
  isOverview = current;
  homeButton.disabled = current;
  if (current) homeButton.setAttribute("aria-current", "page");
  else homeButton.removeAttribute("aria-current");
}

const language = document.querySelector("#language");
language.value = getLocale();
setLocale(getLocale());
const localizationObserver = new MutationObserver(records => {
  const roots = new Set();
  for (const record of records) {
    if (record.type === "childList") record.addedNodes.forEach(node => roots.add(node));
    else roots.add(record.target);
  }
  roots.forEach(root => localize(root));
});
localizationObserver.observe(document.body, {
  childList: true, subtree: true, characterData: true,
  attributes: true, attributeFilter: ["placeholder", "aria-label", "title"],
});
language.addEventListener("change",()=>{setLocale(language.value); localize(document.body);});
localize(document.body);

const themeButton = document.querySelector("#theme-button");
const systemTheme = matchMedia("(prefers-color-scheme: light)");
let themeMode = localStorage.getItem("kcw-theme-mode") || "system";
if (!["system","light","dark"].includes(themeMode)) themeMode = "system";
function applyThemeMode(mode, persist=true) {
  themeMode = mode;
  const theme = mode === "system" ? (systemTheme.matches ? "light" : "dark") : mode;
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem("kcw-theme-mode",mode);
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0b1017" : "#f3f6f9";
  document.querySelector("#theme-icon").textContent = mode === "system" ? "◐" : mode === "dark" ? "☾" : "☀";
  themeButton.title = mode === "system" ? "Farbschema: System" : mode === "light" ? "Farbschema: Hell" : "Farbschema: Dunkel";
  themeButton.setAttribute("aria-label",themeButton.title);
  localize(themeButton);
}
applyThemeMode(themeMode,false);
themeButton.addEventListener("click",()=>{const modes=["system","light","dark"]; applyThemeMode(modes[(modes.indexOf(themeMode)+1)%modes.length]);});
systemTheme.addEventListener("change",()=>{if(themeMode === "system")applyThemeMode("system",false);});

function setSteps(title, labels) {
  document.querySelector("#rail-title").textContent = title;
  progress.replaceChildren();
  labels.forEach((label) => {
    const item = document.createElement("li"); item.textContent = label; progress.append(item);
  });
}

setSteps("Extruder calibration", t("steps"));

function setProgress(step) {
  setOverviewState(false);
  emergencyButton.classList.remove("hidden");
  rail.classList.remove("hidden");
  workspace.classList.remove("menu-mode");
  statusStrip.classList.remove("hidden");
  uiStep = step;
  [...progress.children].forEach((item, index) => {
    item.className = index < step ? "done" : index === step ? "active" : "";
  });
}

function dashboard() {
  forgetCalibration();
  session = null;
  setOverviewState(true);
  emergencyButton.classList.add("hidden");
  emergencyButton.disabled = false;
  emergencyButton.querySelector(".header-button-label").textContent = "NOT-AUS";
  activeWizard = null;
  rail.classList.add("hidden");
  workspace.classList.add("menu-mode");
  statusStrip.classList.add("hidden");
  clearError();
  const ready = printerIsReady();
  const card = (wizard) => {
    const usable = ready || wizard.id === "flow";
    const configured = wizard.configuration?.point_count ? `<span class="configured">${wizard.configuration.point_count} Punkte erkannt</span>` : "";
    const setup = wizard.setup_available ? `<button class="card-setup" type="button" data-setup="${wizard.id}" ${ready ? "" : "disabled"}>Einrichten</button>` : "";
    if (wizard.available) {
      const interaction = usable ? `data-wizard="${wizard.id}" role="button" tabindex="0"` : "";
      return `<div class="calibration-card ${usable ? "" : "printer-blocked"}" ${interaction}>
        <span class="card-icon">${cardIcon(wizard.id)}</span><h3>${wizard.name}</h3><p>${wizard.description}</p>
        ${configured}<div class="card-buttons"><button class="card-start" type="button" ${usable ? "" : "disabled"}>Jetzt starten →</button>${setup}</div></div>`;
    }
    return `<div class="calibration-card unavailable">
      <span class="card-icon">${cardIcon(wizard.id)}</span><h3>${wizard.name}</h3><p>${wizard.description}</p>
      <span class="unavailable-reason">${wizard.availability_reason || "Auf diesem Drucker nicht verfügbar"}</span>
      <div class="card-buttons">${setup}<span class="planned">Nicht konfiguriert</span></div></div>`;
  };
  const phases = [
    {title:"1 · Temperatur & Extrusion", ids:["pid","extruder"]},
    {title:"2 · Mechanik, Gantry & Z", ids:["bed_screws","screws_tilt","z_tilt","quad_gantry_level","probe_offset","bed_mesh"]},
    {title:"3 · Druckqualität", ids:["flow","input_shaper","pressure_advance"]},
  ];
  const cards = phases.map(phase=>{
    const entries=phase.ids.map(id=>wizards.find(wizard=>wizard.id===id)).filter(wizard=>wizard?.available);
    if(!entries.length)return "";
    return `<section class="calibration-phase"><div class="phase-heading"><h3>${phase.title}</h3></div><div class="calibration-grid">${entries.map(card).join("")}</div></section>`;
  }).join("");
  const unavailable=wizards.filter(wizard=>!wizard.available);
  const unavailableCards=unavailable.length ? `<section class="calibration-phase unavailable-phase"><div class="phase-heading"><h3>Nicht verfügbar</h3></div><div class="calibration-grid">${unavailable.map(card).join("")}</div></section>` : "";
  panel.innerHTML = `<h1>Tools</h1>
    ${printerReadinessNotice()}
    <div class="tool-groups">
      <section class="tool-group" aria-labelledby="helper-title">
        <h2 id="helper-title">Helfer</h2>
        <div class="calibration-grid">
          <div class="calibration-card">
            <span class="card-icon">↕</span><h3>Filament laden / entladen</h3>
            <p>Hotend aufheizen und Filament kontrolliert laden oder entladen.</p>
            <div class="card-buttons"><button id="open-filament" class="card-start" type="button" ${ready ? "" : "disabled"}>Öffnen →</button></div>
          </div>
        </div>
      </section>
      <section class="tool-group" aria-labelledby="calibration-title">
        <h2 id="calibration-title">Kalibrierung</h2>
        <div class="calibration-phases">${cards}${unavailableCards}</div>
      </section>
    </div>`;
  const openWizard = (card) => {
    const id = card.dataset.wizard;
    if (cleanConfigWizards.has(id) && printer?.save_config_pending) pendingConfigPage(id);
    else if (id === "extruder") welcome(); else openGeneric(id);
  };
  document.querySelectorAll("[data-wizard]").forEach((card) => {
    card.addEventListener("click", () => openWizard(card));
    card.addEventListener("keydown", (event) => { if(event.target===card && (event.key === "Enter" || event.key === " ")){event.preventDefault();openWizard(card);} });
  });
  document.querySelectorAll("[data-setup]").forEach((control) => control.addEventListener("click", async (event) => { event.stopPropagation(); try { await openSetup(control.dataset.setup); } catch(error) { showError(error.message); } }));
  bind("open-filament", filamentPage);
}

function filamentPage() {
  clearError();
  session = null;
  activeWizard = "filament";
  setOverviewState(false);
  rail.classList.add("hidden");
  emergencyButton.classList.remove("hidden");
  updateCalibrationStatusStrip();
  const presets = [["PLA", 210], ["PETG", 240], ["ABS", 255], ["ASA", 260], ["TPU", 220]];
  const presetButtons = () => `<div class="filament-presets">${presets.map(([material, temperature]) => `<button class="button secondary" type="button" data-filament-preset="${temperature}" aria-pressed="${temperature === 210}" data-no-i18n>${material} · ${temperature} °C</button>`).join("")}</div>`;
  const temperatureInput = (id) => `<label>Zieltemperatur (°C)<input id="${id}" type="number" min="${Math.max(150, printer?.min_extrude_temp || 170)}" max="300" step="5" value="210"></label>`;
  const bindPresets = (root, input) => {
    const update = () => root.querySelectorAll("[data-filament-preset]").forEach(control => control.setAttribute("aria-pressed", Number(control.dataset.filamentPreset) === Number(input.value)));
    root.querySelectorAll("[data-filament-preset]").forEach(control => control.addEventListener("click", () => { input.value = control.dataset.filamentPreset; update(); }));
    input.addEventListener("input", update);
  };
  panel.innerHTML = `<span class="kicker">Helfer</span>
    <h1>Filament laden / entladen</h1>
    <div class="actions">${button("filament-load", "Filament laden")} ${button("filament-unload", "Filament entladen")} ${button("filament-change", "Filament wechseln")}</div>`;
  const request = async (action, payload) => {
    const response = await fetch(new URL(`tools/filament/${action}`, base), {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Bitte prüfe die Eingabewerte.");
    return data;
  };
  const openFlow = async (mode) => {
    let temperature = 210;
    const speed = 5;
    let direction = mode === "load" ? "load" : "unload";
    let stage = "selection";
    let startedHeating = false;
    let token = null;
    let disposed = false;
    let timer = null;
    const dialog = document.createElement("dialog");
    dialog.className = "filament-dialog";
    dialog.setAttribute("aria-labelledby", "filament-dialog-title");
    dialog.innerHTML = `<h2 id="filament-dialog-title">${mode === "change" ? "Filament wechseln" : mode === "load" ? "Filament laden" : "Filament entladen"}</h2>
      <p id="filament-process" role="status"></p>
      <div id="filament-selection">
        <div id="filament-current-material"><h3>${mode === "change" ? "Von" : mode === "load" ? "Filament zum Laden" : "Filament zum Entladen"}</h3>${presetButtons()}${temperatureInput("filament-current-temperature")}</div>
        <div id="filament-new-material" class="${mode === "change" ? "" : "hidden"}"><h3>Zu</h3>${presetButtons()}${temperatureInput("filament-new-temperature")}</div>
      </div>
      <div id="filament-heating" class="hidden"><strong id="filament-live-temperature"></strong><progress id="filament-heat-progress" max="100" value="0"></progress></div>
      <div id="filament-moving" class="hidden"><strong id="filament-move-label"></strong><progress id="filament-move-progress" max="100" value="0" aria-labelledby="filament-move-label"></progress></div>
      <p id="filament-dialog-error" class="notice hidden" role="alert"></p>
      <p id="filament-hot-note" class="hidden">Mit „Fertig“ wird das Hotend ausgeschaltet.</p>
      <div class="actions">${button("filament-confirm", "Aufheizen")} ${button("filament-keep-hot", "Beenden und Hotend anlassen", "secondary")} ${button("filament-close", "Abbrechen", "secondary")}</div>`;
    document.body.append(dialog);
    const confirm = dialog.querySelector("#filament-confirm");
    const close = dialog.querySelector("#filament-close");
    const process = dialog.querySelector("#filament-process");
    const errorBox = dialog.querySelector("#filament-dialog-error");
    const heating = dialog.querySelector("#filament-heating");
    const moving = dialog.querySelector("#filament-moving");
    const moveLabel = dialog.querySelector("#filament-move-label");
    const moveProgress = dialog.querySelector("#filament-move-progress");
    const selection = dialog.querySelector("#filament-selection");
    const currentMaterial = dialog.querySelector("#filament-current-material");
    const currentTemperature = dialog.querySelector("#filament-current-temperature");
    const newMaterial = dialog.querySelector("#filament-new-material");
    const newTemperature = dialog.querySelector("#filament-new-temperature");
    const keepHot = dialog.querySelector("#filament-keep-hot");
    keepHot.classList.add("hidden");
    bindPresets(currentMaterial, currentTemperature);
    bindPresets(newMaterial, newTemperature);
    homeButton.disabled = true;
    const showFailure = (error) => {
      stage = "error";
      confirm.disabled = true;
      close.disabled = false;
      keepHot.classList.add("hidden");
      errorBox.textContent = error.message;
      errorBox.classList.remove("hidden");
      localize(dialog);
    };
    const poll = async () => {
      if (disposed || !["heating", "ready"].includes(stage)) return;
      try {
        const response = await fetch(new URL("printer", base));
        if (!response.ok) throw new Error("Druckerstatus konnte nicht geladen werden.");
        const current = await response.json();
        if (disposed || !["heating", "ready"].includes(stage)) return;
        const usable = current.connected && current.state === "ready" && !["printing", "paused"].includes(current.print_state);
        const reached = usable && current.can_extrude && current.temperature >= current.min_extrude_temp && current.temperature >= temperature - 2 && Math.abs(current.target - temperature) < 0.1;
        stage = reached ? "ready" : "heating";
        confirm.disabled = !reached;
        process.textContent = reached ? (direction === "load" ? "Temperatur erreicht. Setze das Filament ein und bestätige das Laden." : "Temperatur erreicht. Bestätige das Entladen.") : "Hotend wird aufgeheizt…";
        dialog.querySelector("#filament-live-temperature").textContent = `${current.temperature.toFixed(1)} / ${temperature} °C`;
        dialog.querySelector("#filament-heat-progress").value = Math.min(100, Math.max(0, current.temperature / temperature * 100));
        if (!usable) throw new Error("Klipper muss für den Filamentwechsel bereit sein.");
        localize(dialog);
        timer = setTimeout(poll, 1000);
      } catch (error) { if (!disposed) showFailure(error); }
    };
    const pollMovement = async () => {
      if (disposed || stage !== "running") return;
      try {
        const response = await fetch(new URL("tools/filament/progress", base));
        if (!response.ok) throw new Error("Fortschritt konnte nicht geladen werden.");
        const current = await response.json();
        if (disposed || stage !== "running") return;
        if (current.operation_id === token) {
          moveProgress.value = current.percent;
          moveLabel.textContent = `${current.percent} %`;
        }
      } catch {
        // Losing progress updates must not unlock controls while the printer is moving.
        moveLabel.textContent = "Warte auf Bewegungsfortschritt…";
        localize(dialog);
      }
      if (!disposed && stage === "running") timer = setTimeout(pollMovement, 500);
    };
    const startHeating = async () => {
      stage = "heating";
      confirm.disabled = true;
      close.disabled = true;
      confirm.textContent = "Bestätigen und starten";
      process.textContent = "Hotend wird aufgeheizt…";
      heating.classList.remove("hidden");
      moving.classList.add("hidden");
      selection.classList.add("hidden");
      localize(dialog);
      try {
        startedHeating = true;
        const data = await request("heat", {temperature, direction});
        token = data.confirmation_token;
        close.disabled = false;
        await poll();
      } catch (error) { showFailure(error); }
    };
    const closeDialog = async (leaveHeaterOn = false) => {
      if (close.disabled) return;
      close.disabled = true;
      clearTimeout(timer);
      if (startedHeating && !leaveHeaterOn) {
        stage = "closing";
        try { await request("heat", {temperature: 0}); }
        catch (error) { showFailure(error); return; }
      }
      disposed = true;
      dialog.close();
      dialog.remove();
      homeButton.disabled = false;
    };
    close.addEventListener("click", () => closeDialog());
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
    keepHot.addEventListener("click", () => {
      if (stage === "complete") closeDialog(true);
    });
    confirm.addEventListener("click", async () => {
      if (confirm.disabled) return;
      if (stage === "selection") {
        if (!currentTemperature.reportValidity() || (mode === "change" && !newTemperature.reportValidity())) return;
        temperature = Number(currentTemperature.value);
        await startHeating();
        return;
      }
      if (stage === "swap") {
        if (!newTemperature.reportValidity()) return;
        temperature = Number(newTemperature.value);
        direction = "load";
        await startHeating();
        return;
      }
      if (stage !== "ready") return;
      stage = "running";
      clearTimeout(timer);
      confirm.disabled = true;
      close.disabled = true;
      process.textContent = "Filamentbewegung läuft…";
      heating.classList.add("hidden");
      moving.classList.remove("hidden");
      moveProgress.value = 0;
      moveLabel.textContent = "0 %";
      localize(dialog);
      try {
        const movement = request(direction, {speed, confirmation_token: token});
        pollMovement();
        await movement;
        clearTimeout(timer);
        moveProgress.value = 100;
        moveLabel.textContent = "100 %";
        heating.classList.add("hidden");
        if (mode === "change" && direction === "unload") {
          stage = "swap";
          process.textContent = "Setze das neue Filament ein und bestätige die neue Temperatur.";
          selection.classList.remove("hidden");
          currentMaterial.classList.add("hidden");
          confirm.textContent = "Neues Material aufheizen";
          confirm.disabled = false;
        } else {
          stage = "complete";
          process.textContent = direction === "load" ? "Filament geladen." : "Filament entladen.";
          confirm.classList.add("hidden");
          close.textContent = "Fertig";
          close.classList.remove("secondary");
          keepHot.classList.remove("hidden");
          dialog.querySelector("#filament-hot-note").classList.remove("hidden");
        }
        close.disabled = false;
        localize(dialog);
      } catch (error) { showFailure(error); }
    });
    localize(dialog);
    dialog.showModal();
  };
  const bindTool = (id, handler) => document.querySelector(`#${id}`).addEventListener("click", async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try { await handler(); }
    catch (error) { showError(error.message); }
    finally { control.disabled = false; }
  });
  bindTool("filament-load", () => openFlow("load"));
  bindTool("filament-unload", () => openFlow("unload"));
  bindTool("filament-change", () => openFlow("change"));
}

async function returnHome() {
  clearError();
  const terminal = ["CANCELLED","ERROR"].includes(session?.state) || (session?.state === "COMPLETE" && !session?.save_token);
  if (activeWizard && session && !terminal) {
    if (activeWizard === "extruder") await api("wizards/extruder/cancel");
    else await calibrationAction("cancel");
  }
  session = null;
  dashboard();
}

homeButton.addEventListener("click",async(event)=>{
  event.currentTarget.disabled=true;
  try { await returnHome(); } catch(error) { showError(error.message); }
  finally { event.currentTarget.disabled=isOverview; }
});

emergencyButton.addEventListener("click", async () => {
  emergencyButton.disabled = true;
  emergencyButton.querySelector(".header-button-label").textContent = "STOPP…";
  try {
    const response = await fetch(new URL("emergency-stop", base), {method:"POST"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Not-Aus konnte nicht ausgelöst werden");
    session = null;
    emergencyButton.querySelector(".header-button-label").textContent = "GESTOPPT";
    window.location.assign(document.querySelector("#mainsail-button").href);
  } catch (error) {
    emergencyButton.disabled = false;
    emergencyButton.querySelector(".header-button-label").textContent = "NOT-AUS";
    showError(error.message);
  }
  localize(emergencyButton);
});

function cardIcon(id) {
  return ({extruder:"E", pid:"°", flow:"%", pressure_advance:"PA", probe_offset:"Z", screws_tilt:"↻", bed_screws:"⌁", z_tilt:"Z²", quad_gantry_level:"Q", bed_mesh:"▦", input_shaper:"≈"})[id] || "+";
}

function showError(message) {
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function clearError() { notice.classList.add("hidden"); }

async function api(path, body) {
  clearError();
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Request failed");
  session = data.session || data;
  return data;
}

async function postCommand(path) {
  clearError();
  const response = await fetch(new URL(path, base), {method:"POST"});
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function pendingItemsMarkup(items) {
  const entries = Object.entries(items || {});
  if (!entries.length) return "";
  return `<div class="pending-values"><strong>Betroffene Konfigurationswerte</strong><pre>${esc(JSON.stringify(items, null, 2))}</pre></div>`;
}

function pendingConfigPage(wizardId) {
  const definition = wizards.find((item) => item.id === wizardId);
  activeWizard = null;
  setOverviewState(false);
  emergencyButton.classList.add("hidden");
  rail.classList.add("hidden");
  workspace.classList.add("menu-mode");
  statusStrip.classList.add("hidden");
  panel.innerHTML = `<span class="kicker">Offene Klipper-Werte</span>
    <h1>Vorhandene Änderungen auflösen</h1>
    <p class="lead">Klipper hat bereits ungespeicherte Werte für <code>SAVE_CONFIG</code>. Entscheide zuerst, was mit ihnen passieren soll. Danach wird <strong>${esc(definition?.name || wizardId)}</strong> automatisch geöffnet.</p>
    ${pendingItemsMarkup(printer?.save_config_pending_items)}
    <p class="safety-note">„Speichern“ übernimmt alle oben aufgeführten Werte dauerhaft. „Verwerfen“ lädt die zuletzt gespeicherte Konfiguration neu. Beide Aktionen starten Klipper neu.</p>
    <div class="actions">${button("save-pending", "Vorhandene Werte speichern")} ${button("discard-pending", "Verwerfen und fortfahren", "danger ghost")} ${button("pending-back", "Zurück", "secondary")}</div>`;
  bind("save-pending", () => resolvePendingConfig(wizardId, "save"));
  bind("discard-pending", () => resolvePendingConfig(wizardId, "discard"));
  bind("pending-back", dashboard);
}

async function resolvePendingConfig(wizardId, action) {
  resolvingPendingConfig = true;
  sessionStorage.setItem(pendingResolutionStorageKey, JSON.stringify({wizard:wizardId, action}));
  try {
    await postCommand(`pending-config/${action}`);
  } catch (error) {
    resolvingPendingConfig = false;
    sessionStorage.removeItem(pendingResolutionStorageKey);
    throw error;
  }
  pendingConfigWaitingPage(wizardId, action);
  resolvingPendingConfig = false;
}

function pendingConfigWaitingPage(wizardId, action) {
  const definition = wizards.find((item) => item.id === wizardId);
  activeWizard = null;
  setOverviewState(false);
  emergencyButton.classList.add("hidden");
  rail.classList.add("hidden");
  workspace.classList.add("menu-mode");
  statusStrip.classList.add("hidden");
  panel.innerHTML = `<span class="kicker">Klipper-Neustart</span><h1>${action === "save" ? "Werte werden gespeichert" : "Werte werden verworfen"}</h1>
    <p class="lead">${action === "save" ? "Klipper startet neu. Sobald die Firmware wieder bereit ist, kehrt der Wizard automatisch zur Übersicht zurück." : `Klipper startet neu. Sobald die Firmware wieder bereit ist, öffnet der Wizard automatisch <strong>${esc(definition?.name || wizardId)}</strong>.`}</p>
    <div class="running-state"><span class="spinner"></span><strong>Warte auf Klipper…</strong></div>
    <div class="actions">${button("pending-cancel", "Zur Übersicht", "secondary")}</div>`;
  bind("pending-cancel", () => { sessionStorage.removeItem(pendingResolutionStorageKey); resolvingPendingConfig=false; dashboard(); });
}

function continueAfterPendingResolution() {
  const pending = pendingResolution();
  if (!pending?.wizard || resolvingPendingConfig || !printerIsReady() || printer?.save_config_pending) return false;
  resolvingPendingConfig = true;
  sessionStorage.removeItem(pendingResolutionStorageKey);
  const wizardId = pending.wizard;
  const action = pending.action;
  queueMicrotask(() => {
    resolvingPendingConfig = false;
    if (action === "save") dashboard();
    else if (wizardId === "extruder") welcome();
    else openGeneric(wizardId);
  });
  return true;
}

async function startCalibration(id, options = {}) {
  activeWizard = id;
  const result = await api(`wizards/${id}/start`, { options });
  rememberCalibration(id, session.id);
  return result;
}

async function calibrationAction(action, values = {}, confirmationToken = null) {
  return api(`wizards/${activeWizard}/action`, { action, values, confirmation_token: confirmationToken });
}

function button(id, label, style = "") {
  return `<button id="${id}" class="button ${style}" type="button">${label}</button>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
}

function bind(id, handler) {
  document.querySelector(`#${id}`)?.addEventListener("click", async (event) => {
    const target = event.currentTarget;
    target.disabled = true;
    try { await handler(); } catch (error) { showError(error.message); target.disabled = false; }
  });
}

function welcome() {
  activeWizard = "extruder";
  rememberCalibration("extruder");
  setSteps("Extruder kalibrieren", t("steps"));
  setProgress(0);
  panel.innerHTML = `
    <span class="kicker">Safe, guided setup</span>
    <h1>${t("welcomeTitle")}</h1><p class="lead">${t("welcomeBody")}</p>
    <div class="detail-grid">
      <div class="detail"><span>Current extruder</span><strong>${printer?.extruder || "extruder"}</strong></div>
      <div class="detail"><span>Current rotation distance</span><strong>${printer?.rotation_distance?.toFixed(5) || "—"} mm</strong></div>
    </div>
    <div class="actions">${button("start", "Start calibration")}</div>`;
  bind("start", async () => { await api("wizards/extruder/start", { mark_distance: 120, commanded_extrusion: 100 }); rememberCalibration("extruder", session.id); heat(); });
}

const genericSteps = {
  pid: ["Vorbereiten", "PID-Tuning", "Prüfen", "Speichern"],
  bed_mesh: ["Vorbereiten", "Referenzieren", "Vermessen", "Speichern"],
  screws_tilt: ["Referenzieren", "Messen", "Einstellen", "Wiederholen"],
  bed_screws: ["Referenzieren", "Papier-Test", "Schrauben einstellen"],
  probe_offset: ["Referenzieren", "Probe starten", "Papier-Test", "Speichern"],
  pressure_advance: ["Vorbereiten", "Testturm", "Auswerten", "Speichern"],
  flow: ["Test drucken", "Messen", "Berechnen"],
  input_shaper: ["Sensor prüfen", "Referenzieren", "Messen", "Speichern"],
  z_tilt: ["Vorbereiten", "Referenzieren", "Ausrichten"],
  quad_gantry_level: ["Vorbereiten", "Referenzieren", "Ausrichten"],
};

function genericFrame(id, step) {
  const definition = wizards.find((item) => item.id === id);
  activeWizard = id;
  setSteps(definition?.name || "Kalibrierung", genericSteps[id] || ["Start", "Ergebnis"]);
  setProgress(step);
  updateCalibrationStatusStrip();
}

function updateCalibrationStatusStrip() {
  if (activeWizard === "pid") {
    statusStrip.classList.remove("hidden");
    document.querySelector("#status-label-1").textContent = "Hotend Ist";
    document.querySelector("#status-label-2").textContent = "Heizbett Ist";
    document.querySelector("#temperature").textContent = `${printer?.temperature?.toFixed(1) ?? "—"} °C`;
    document.querySelector("#target").textContent = `${printer?.bed_temperature?.toFixed(1) ?? "—"} °C`;
  } else if (activeWizard === "extruder" || activeWizard === "filament") {
    statusStrip.classList.remove("hidden");
    document.querySelector("#status-label-1").textContent = "Hotend Ist";
    document.querySelector("#status-label-2").textContent = "Hotend Ziel";
    document.querySelector("#temperature").textContent = `${printer?.temperature?.toFixed(1) ?? "—"} °C`;
    document.querySelector("#target").textContent = `${printer?.target?.toFixed(1) ?? "—"} °C`;
  } else if (activeWizard === "pressure_advance") {
    statusStrip.classList.remove("hidden");
    document.querySelector("#status-label-1").textContent = "Druckstatus";
    document.querySelector("#status-label-2").textContent = "Testfaktor";
    document.querySelector("#temperature").textContent = printer?.print_state || "—";
    document.querySelector("#target").textContent = Number.isFinite(session?.data?.factor) ? session.data.factor.toFixed(3) : "—";
  } else if (activeWizard === "flow") {
    statusStrip.classList.add("hidden");
    return;
  } else if (activeWizard) {
    const definition = wizards.find((item) => item.id === activeWizard);
    statusStrip.classList.remove("hidden");
    document.querySelector("#status-label-1").textContent = "Aktiver Ablauf";
    document.querySelector("#status-label-2").textContent = "Referenzierte Achsen";
    document.querySelector("#temperature").textContent = definition?.name || activeWizard;
    document.querySelector("#target").textContent = printer?.homed_axes?.toUpperCase() || "keine";
  } else {
    return;
  }
  document.querySelector("#klipper-state").textContent = printer?.state || "—";
}

function openGeneric(id) {
  rememberCalibration(id);
  genericFrame(id, 0);
  if (id === "pid") return pidSetup();
  if (id === "pressure_advance") return pressureSetup();
  if (id === "flow") return flowSetup();
  if (id === "input_shaper") return shaperSetup();
  const intro = {
    bed_mesh: ["Bed Mesh", "Das Bett wird zuerst referenziert und danach mit deiner bestehenden Klipper-Konfiguration vermessen."],
    screws_tilt: ["Bettschrauben ausrichten", "Klipper ermittelt für jede Schraube Drehrichtung und Betrag. Nach jeder Korrektur kannst du erneut messen."],
    bed_screws: ["Manuelle Bettschrauben", "Klipper fährt jede konfigurierte Schraube an. Du stellst den Papierwiderstand nacheinander von Hand ein."],
    probe_offset: ["Probe Z-Offset", "Mit PROBE_CALIBRATE und feinen TESTZ-Schritten stellst du den Papierabstand ein."],
    z_tilt: ["Z-Tilt", "Klipper vermisst die konfigurierten Punkte und richtet zwei oder mehr unabhängige Z-Antriebe aus."],
    quad_gantry_level: ["Quad Gantry Level", "Klipper vermisst vier Punkte und richtet die Gantry über vier unabhängige Z-Antriebe aus."],
  }[id];
  panel.innerHTML = `<span class="kicker">Geführter Ablauf</span><h1>${intro[0]}</h1><p class="lead">${intro[1]}</p>
    <p class="safety-note">Der Drucker darf nicht drucken oder pausiert sein. Bewegungen starten erst nach deinem Klick.</p>
    <div class="actions">${button("generic-start", "Kalibrierung starten")}</div>`;
  bind("generic-start", async () => { await startCalibration(id); homingPage(id); });
}

function homingPage(id) {
  genericFrame(id, 1);
  panel.innerHTML = `<span class="kicker">Bewegung</span><h2>Alle Achsen referenzieren</h2><p>Prüfe, dass der Bauraum frei ist. Der Drucker führt anschließend <code>G28</code> aus.</p>
    <div class="actions">${button("home", "Jetzt referenzieren")}</div>`;
  bind("home", async () => { await calibrationAction("home"); if (id === "bed_mesh") bedMeshRun(); else if (id === "screws_tilt") screwsRun(); else if (id === "bed_screws") bedScrewsRun(); else if (id === "z_tilt" || id === "quad_gantry_level") gantryRun(id); else probeRun(); });
}

function bedScrewsRun() {
  genericFrame("bed_screws",1); panel.innerHTML=`<span class="kicker">Manueller Papier-Test</span><h2>Erste Schraube anfahren</h2><p>Klipper fährt die Schrauben der Reihe nach an. Stelle an jeder Position denselben leichten Papierwiderstand ein und gehe dann zur nächsten Schraube.</p><div class="actions">${button("run","BED_SCREWS_ADJUST starten")}</div>`;
  bind("run",async()=>{await calibrationAction("run"); bedScrewsAdjust();});
}

function bedScrewsAdjust() {
  genericFrame("bed_screws",2); panel.innerHTML=`<span class="kicker">Schraube einstellen</span><h2>Papierwiderstand angleichen</h2><p>Drehe nur die aktuell angefahrene Schraube. Klicke danach auf „Nächste Schraube“. Klipper wiederholt den Rundgang, bis du das Ergebnis akzeptierst.</p><div class="actions">${button("next","Nächste Schraube")} ${button("accept","Ausrichtung akzeptieren","secondary")} ${button("abort","Abbrechen","danger ghost")}</div>`;
  panel.querySelector(".actions").insertAdjacentHTML("beforebegin",positionMap(session.data.positions || []));
  bind("next",async()=>{await calibrationAction("next"); document.querySelector("#next").disabled=false;}); bind("accept",async()=>{await calibrationAction("accept");completePage("Manuelle Bettschrauben");}); bind("abort",async()=>{await calibrationAction("abort");dashboard();});
}

function gantryRun(id) {
  genericFrame(id,2); const command=id === "z_tilt" ? "Z_TILT_ADJUST" : "QUAD_GANTRY_LEVEL";
  panel.innerHTML=`<span class="kicker">Automatische Ausrichtung</span><h2>${command}</h2><p>Klipper fährt alle konfigurierten Messpunkte ab und korrigiert die unabhängigen Z-Antriebe iterativ.</p><div class="actions">${button("run",`${command} starten`)}</div>`;
  panel.querySelector(".actions").insertAdjacentHTML("beforebegin",positionMap(session.data.positions || []));
  bind("run",async()=>{document.querySelector("#run").innerHTML='<span class="spinner"></span>Ausrichtung läuft…'; await calibrationAction("run"); completePage(id === "z_tilt" ? "Z-Tilt" : "Quad Gantry Level");});
}

async function openSetup(id) {
  setOverviewState(false);
  emergencyButton.classList.add("hidden");
  activeWizard = null; rail.classList.add("hidden"); workspace.classList.add("menu-mode"); statusStrip.classList.add("hidden"); clearError();
  const response = await fetch(new URL(`setup/${id}`,base)); const setup = await response.json();
  if(!response.ok) throw new Error(setup.detail || "Einrichtung konnte nicht geladen werden");
  renderSetup(id,setup);
}

function pair(value, fallback=["",""]) {
  if (Array.isArray(value)) return [value[0] ?? "", value[1] ?? ""];
  if (typeof value === "string") return value.split(",").map(item=>item.trim());
  return fallback;
}

function pointRows(points, named=false) {
  return points.map((point,index)=>`<div class="point-row">
    ${named ? `<input class="point-name" value="${esc(point.name || `Schraube ${index+1}`)}" aria-label="Name">` : `<span class="point-number">${index+1}</span>`}
    <input class="point-x" type="number" step="0.1" value="${esc(point.x)}" placeholder="X">
    <input class="point-y" type="number" step="0.1" value="${esc(point.y)}" placeholder="Y">
    <button class="remove-point" type="button" aria-label="Punkt entfernen">×</button></div>`).join("");
}

function existingPoints(current, kind) {
  if (kind === "named_points") return Object.keys(current).filter(key=>/^screw\d+$/.test(key)).sort((a,b)=>Number(a.slice(5))-Number(b.slice(5))).map(key=>{const xy=pair(current[key]); return {x:xy[0],y:xy[1],name:current[`${key}_name`] || key};});
  const raw=current.points || []; const values=Array.isArray(raw?.[0]) ? raw : (typeof raw === "string" ? raw.split("\n").map(pair) : []); return values.map(item=>({x:item[0],y:item[1]}));
}

function renderSetup(id, setup) {
  const {schema,current,printer_bounds:bounds}=setup; const boundsText=`X ${bounds.x.min ?? "?"}–${bounds.x.max ?? "?"} · Y ${bounds.y.min ?? "?"}–${bounds.y.max ?? "?"} mm`;
  let fields="";
  if(schema.kind === "mesh") { const min=pair(current.mesh_min); const max=pair(current.mesh_max); const count=pair(current.probe_count,[5,5]); fields=`<div class="setup-grid"><label>Mesh-Minimum X<input id="min-x" type="number" step="0.1" value="${esc(min[0])}"></label><label>Mesh-Minimum Y<input id="min-y" type="number" step="0.1" value="${esc(min[1])}"></label><label>Mesh-Maximum X<input id="max-x" type="number" step="0.1" value="${esc(max[0])}"></label><label>Mesh-Maximum Y<input id="max-y" type="number" step="0.1" value="${esc(max[1])}"></label><label>Messpunkte X<input id="count-x" type="number" min="2" max="50" value="${esc(count[0])}"></label><label>Messpunkte Y<input id="count-y" type="number" min="2" max="50" value="${esc(count[1])}"></label></div>`; }
  else { let groups=[]; if(schema.kind === "dual_points") groups=[{key:"z_positions",title:"Positionen der Z-Antriebe",points:(Array.isArray(current.z_positions)?current.z_positions:[]).map(item=>({x:item[0],y:item[1]}))},{key:"points",title:"Probe-Messpunkte",points:existingPoints(current,schema.kind)}]; else if(schema.kind === "quad_gantry") groups=[{key:"gantry_corners",title:"Gantry-Ecken (2 Punkte)",points:(Array.isArray(current.gantry_corners)?current.gantry_corners:[]).map(item=>({x:item[0],y:item[1]}))},{key:"points",title:"Probe-Messpunkte (4 Punkte)",points:existingPoints(current,schema.kind)}]; else groups=[{key:"points",title:"Schraubenpositionen",points:existingPoints(current,schema.kind),named:true}]; fields=groups.map(group=>`<section class="point-group" data-key="${group.key}" data-named="${group.named ? "true":"false"}"><div class="group-heading"><h3>${group.title}</h3><button class="add-point button secondary" type="button">Punkt hinzufügen</button></div><div class="point-list">${pointRows(group.points.length?group.points:[{},{},{},{}],group.named)}</div></section>`).join(""); }
  const thread=schema.fields.includes("screw_thread") ? `<label>Schraubengewinde<select id="screw-thread">${["CW-M3","CW-M4","CW-M5","CCW-M3","CCW-M4","CCW-M5"].map(value=>`<option ${current.screw_thread===value?"selected":""}>${value}</option>`).join("")}</select></label>`:"";
  const setupLabels = {speed:"Bewegungsgeschwindigkeit", horizontal_move_z:"Z-Höhe beim Verfahren", probe_height:"Papier-Test-Höhe", retries:"Wiederholungen", retry_tolerance:"Wiederholungstoleranz", max_adjust:"Maximale Korrektur"};
  const advanced=["speed","horizontal_move_z","probe_height","retries","retry_tolerance","max_adjust"].filter(key=>schema.fields.includes(key)).map(key=>`<label>${setupLabels[key]}<input id="setup-${key}" type="number" step="0.01" value="${esc(current[key])}"></label>`).join("");
  panel.innerHTML=`<span class="kicker">Kalibrierung einrichten</span><h1>${wizards.find(w=>w.id===id)?.name || id}</h1><p class="lead">Lege die Geometrie für diesen Drucker fest. Zulässiger Verfahrbereich laut Klipper: <strong>${boundsText}</strong>.</p><p class="safety-note">Koordinaten müssen zur Mechanik, zum Probe-Offset und zu einem freien Verfahrweg passen. Falsche Werte können eine Kollision verursachen.</p>${fields}<div class="setup-grid advanced-fields">${thread}${advanced}</div><div class="actions">${button("preview-setup","Änderungen prüfen")} ${button("back","Zurück","secondary")}</div>`;
  document.querySelectorAll(".add-point").forEach(control=>control.addEventListener("click",()=>{const group=control.closest(".point-group"); group.querySelector(".point-list").insertAdjacentHTML("beforeend",pointRows([{}],group.dataset.named==="true")); bindPointRemovers();})); bindPointRemovers(); bind("back",dashboard); bind("preview-setup",async()=>{const values=collectSetup(schema); const response=await api(`setup/${id}/preview`,{values}); renderSetupPreview(id,values,response);});
}

function bindPointRemovers(){document.querySelectorAll(".remove-point").forEach(control=>control.onclick=()=>control.closest(".point-row").remove());}

function collectSetup(schema){const value=id=>document.querySelector(`#${id}`)?.value; const values={}; if(schema.kind==="mesh"){values.mesh_min=[value("min-x"),value("min-y")]; values.mesh_max=[value("max-x"),value("max-y")]; values.probe_count=[value("count-x"),value("count-y")];} document.querySelectorAll(".point-group").forEach(group=>{values[group.dataset.key]=[...group.querySelectorAll(".point-row")].map(row=>({x:row.querySelector(".point-x").value,y:row.querySelector(".point-y").value,name:row.querySelector(".point-name")?.value}));}); if(schema.fields.includes("screw_thread"))values.screw_thread=value("screw-thread"); ["speed","horizontal_move_z","probe_height","retries","retry_tolerance","max_adjust"].forEach(key=>{const entry=value(`setup-${key}`);if(entry!==undefined&&entry!=="")values[key]=entry;}); return values;}

function renderSetupPreview(id,values,preview){panel.innerHTML=`<span class="kicker">Vorschau · ${esc(preview.digest)}</span><h2>[${esc(preview.section)}] prüfen</h2><p>Diese normalisierten Werte werden in den vorhandenen Abschnitt geschrieben; andere Schlüssel bleiben erhalten.</p><pre class="config-preview">${esc(Object.entries(preview.settings).map(([key,value])=>`${key}: ${String(value).replaceAll("\n","\n  ")}`).join("\n"))}</pre><label><input id="setup-confirm" type="checkbox" style="width:auto"> Backup erstellen, Konfiguration schreiben und Klipper neu starten.</label><div class="actions">${button("save-setup","Einrichtung speichern")} ${button("back","Abbrechen","secondary")}</div>`; bind("back",dashboard); bind("save-setup",async()=>{if(!document.querySelector("#setup-confirm").checked)throw new Error("Bestätige die Änderung und den Klipper-Neustart."); const result=await api(`setup/${id}/save`,{values,confirmation_token:preview.confirmation_token,restart:true}); panel.innerHTML=`<span class="kicker">Gespeichert</span><h2>Einrichtung übernommen</h2><p>Quelle: <code>${esc(result.source)}</code><br>Backup: <code>${esc(result.backup)}</code></p><p>Klipper wird neu gestartet. Nach dem erneuten Verbinden wird die Kalibrierung automatisch neu bewertet.</p><div class="actions">${button("dashboard","Zur Übersicht")}</div>`; bind("dashboard",async()=>{wizards=await fetch(new URL("wizards",base)).then(r=>r.json());dashboard();});});}

function bedMeshRun() {
  genericFrame("bed_mesh", 2);
  panel.innerHTML = `<span class="kicker">Messbewegung</span><h2>Druckbett vermessen</h2><p>Klipper fährt alle in <code>[bed_mesh]</code> definierten Punkte ab. Dieser Vorgang kann mehrere Minuten dauern.</p>
    <div class="actions">${button("run", "Bed Mesh starten")}</div>`;
  bind("run", async () => { document.querySelector("#run").innerHTML='<span class="spinner"></span>Vermessung läuft…'; await calibrationAction("run"); saveKlipperPage("Bed Mesh", "Das neue Mesh ist berechnet. Mit SAVE_CONFIG wird es dauerhaft in Klipper gespeichert.", bedMeshSummary() + pendingCalibrationValues()); });
}

function bedMeshSummary() {
  const result = session?.data?.result || {};
  const matrix = Array.isArray(result.probed_matrix) ? result.probed_matrix : [];
  const values = matrix.flat().map(Number).filter(Number.isFinite);
  const rows = matrix.length;
  const columns = Math.max(0, ...matrix.map(row => Array.isArray(row) ? row.length : 0));
  const range = values.length ? Math.max(...values) - Math.min(...values) : null;
  return `<div class="result-grid"><div class="metric"><span>Mesh-Profil</span><strong data-no-i18n>${esc(result.profile_name || "default")}</strong></div><div class="metric"><span>Messraster</span><strong>${rows && columns ? `${columns} × ${rows}` : "—"}</strong></div><div class="metric"><span>Höhenspanne</span><strong>${Number.isFinite(range) ? `${range.toFixed(3)} mm` : "—"}</strong></div></div>`;
}

function pendingCalibrationValues() {
  return pendingItemsMarkup(session?.data?.pending_items);
}

function screwsRun() {
  genericFrame("screws_tilt", 1);
  panel.innerHTML = `<span class="kicker">Messung</span><h2>Schraubenpositionen messen</h2><p>Klipper fährt die konfigurierten Schraubenpositionen an und berechnet die Korrekturen.</p><div class="actions">${button("run", "SCREWS_TILT_CALCULATE starten")}</div>`;
  bind("run", async () => { await calibrationAction("calculate"); screwsResult(); });
}

function screwsResult() {
  genericFrame("screws_tilt", 2);
  const result = session.data.result || {}; const entries = Object.entries(result.results || {});
  const positions = session.data.positions || [];
  const positioned = positions.filter(point => Object.hasOwn(result.results || {}, point.id));
  const unmatched = entries.filter(([id]) => !positioned.some(point => point.id === id));
  const rows = unmatched.map(([name, item]) => `<div class="metric"><span data-no-i18n>${esc(name)}</span>${adjustment(item)}</div>`).join("");
  const layout = positionMap(positioned, result.results) + (rows ? `<div class="result-grid">${rows}</div>` : "");
  panel.innerHTML = `<span class="kicker">Ergebnis</span><h2>Schrauben einstellen</h2>${layout || '<p>Klipper meldet keine Schraubenergebnisse.</p>'}<p>Stelle die Schrauben bei stillstehendem Drucker ein und wiederhole danach die Messung. Eine mechanische Änderung kann eine erneute Z‑Offset-Kalibrierung erfordern.</p><div class="actions">${button("again", "Erneut messen")} ${button("done", "Fertig", "secondary")}</div>`;
  bind("again", screwsRun); bind("done", dashboard);
}

function probeRun() {
  genericFrame("probe_offset", 1);
  panel.innerHTML = `<span class="kicker">Probe</span><h2>Manuelle Z-Kalibrierung starten</h2><p>Klipper positioniert die Düse und startet <code>PROBE_CALIBRATE</code>. Lege danach ein normales Blatt Papier unter die saubere Düse.</p><div class="actions">${button("begin", "PROBE_CALIBRATE starten")}</div>`;
  bind("begin", async () => { await calibrationAction("begin"); probeAdjust(); });
}

function probeAdjust() {
  genericFrame("probe_offset", 2);
  const controls = [-1,-.5,-.1,-.05,-.01,.01,.05,.1,.5,1].map((value) => `<button class="button secondary testz" data-z="${value}">${value > 0 ? "+" : ""}${value} mm</button>`).join("");
  panel.innerHTML = `<span class="kicker">Papier-Test</span><h2>Düse schrittweise absenken</h2><p>Bewege Z, bis sich das Papier mit leichtem Widerstand bewegen lässt. Negative Werte senken die Düse. Beginne grob und werde dann feiner.</p><div class="jog-grid">${controls}</div><div class="actions">${button("accept", "Position übernehmen")} ${button("abort", "Abbrechen", "danger ghost")}</div>`;
  document.querySelectorAll(".testz").forEach((control) => control.addEventListener("click", async () => { control.disabled=true; try { await calibrationAction("testz", {amount:Number(control.dataset.z)}); } catch(error) { showError(error.message); } finally { control.disabled=false; } }));
  bind("accept", async () => { await calibrationAction("accept"); saveKlipperPage("Probe Z-Offset", "Der Offset ist übernommen, aber noch nicht dauerhaft gespeichert.", pendingCalibrationValues()); });
  bind("abort", async () => { await calibrationAction("abort"); dashboard(); });
}

function pidSetup() {
  genericFrame("pid", 0);
  const heaters = wizards.find(item=>item.id==="pid")?.configuration?.heaters || ["extruder"];
  const heaterName = value => value === "heater_bed" ? "Heizbett" : value === "extruder" ? "Hotend" : value.startsWith("extruder") ? `Hotend · ${value}` : value.replace("heater_generic ", "");
  panel.innerHTML = `<span class="kicker">Heizer wählen</span><h1>PID kalibrieren</h1><p class="lead">Wähle den Heizer und eine typische Drucktemperatur. Nach dem ersten Aufheizen schaltet Klipper den Heizer mehrfach knapp ober- und unterhalb der Zieltemperatur um.</p>
    <label for="heater">Heizer</label><select id="heater">${heaters.map(value=>`<option value="${esc(value)}">${esc(heaterName(value))}</option>`).join("")}</select>
    <label for="pid-target">Zieltemperatur · Schritte von 5 °C</label><div class="input-row"><input id="pid-target" type="number" value="220" min="150" max="300" step="5"><span class="unit">°C</span></div><div class="actions">${button("pid-start", "PID-Tuning starten")}</div>`;
  const updatePidRange = (value) => { const hotend=value.startsWith("extruder"); const input=document.querySelector("#pid-target"); input.value=hotend?220:60; input.min=hotend?150:30; input.max=hotend?300:130; };
  document.querySelector("#heater").addEventListener("change", (event) => updatePidRange(event.target.value));
  updatePidRange(document.querySelector("#heater").value);
  bind("pid-start", async () => { const heater=document.querySelector("#heater").value; const target=Number(document.querySelector("#pid-target").value); await startCalibration("pid", {heater,target}); pidReadyPage(); });
}

function pidReadyPage() {
  genericFrame("pid",1);
  panel.innerHTML=`<span class="kicker">Heizzyklen</span><h2>PID-Tuning bereit</h2>${pidSelectionSummary()}<p>Während der Messung werden hohe Temperaturen erreicht. Nach dem ersten Aufheizen folgen mehrere kurze Heiz- und Abkühlphasen um die Zieltemperatur. Lasse den Drucker nicht unbeaufsichtigt.</p><div class="actions">${button("run","Messung ausführen")}</div>`;
  bind("run",async()=>{document.querySelector("#run").innerHTML='<span class="spinner"></span>PID-Tuning läuft…'; await calibrationAction("run"); saveKlipperPage("PID-Werte", "Klipper hat neue PID-Werte ermittelt. Prüfe das Ergebnis und speichere es anschließend explizit.", pidSelectionSummary() + pendingCalibrationValues());});
}

function pidSelectionSummary() {
  const selected = session?.data?.heater || "extruder";
  const heater = selected === "heater_bed" ? "Heizbett" : selected === "extruder" ? "Hotend" : selected;
  const target = Number(session?.data?.target);
  return `<div class="result-grid"><div class="metric"><span>Ausgewählter Heizer</span><strong>${heater}</strong></div><div class="metric"><span>Gewählte Zieltemperatur</span><strong>${Number.isFinite(target) ? target.toFixed(0) : "—"} °C</strong></div></div>`;
}

function pressureSetup() {
  genericFrame("pressure_advance",0);
  panel.innerHTML=`<span class="kicker">Testturm</span><h1>Pressure Advance</h1><p class="lead">Der Klipper-Testturm verändert Pressure Advance über die Höhe. Wähle deinen Extruder-Typ.</p><label for="drive">Extruder-Typ</label><select id="drive"><option value="direct">Direct Drive · Faktor 0,005</option><option value="bowden">Bowden · Faktor 0,020</option></select><div class="actions">${button("pa-start","Vorbereiten")}</div>`;
  bind("pa-start",async()=>{await startCalibration("pressure_advance",{drive:document.querySelector("#drive").value}); pressurePrint();});
}

function pressurePrint() {
  genericFrame("pressure_advance",1);
  panel.innerHTML=`<span class="kicker">Slicer & Druck</span><h2>Testturm drucken</h2><p>Lade das <a href="${session.data.model_url}" target="_blank" rel="noopener">offizielle Klipper-Testmodell</a>, slice es mit 0,4-mm Düse, 0,2-mm Schichthöhe, 100 mm/s und deaktivierter dynamischer Beschleunigungssteuerung. Starte danach hier den Tuning-Tower-Befehl und anschließend den Druck in Mainsail.</p><div class="actions">${button("prepare","Tuning Tower aktivieren")}</div>`;
  bind("prepare",async()=>{await calibrationAction("prepare"); pressureMeasure();});
}

function pressureMeasure() {
  genericFrame("pressure_advance",2);
  panel.innerHTML=`<span class="kicker">Auswertung</span><h2>Beste Höhe messen</h2><p>Miss vom Boden bis zu der Höhe, an der die Ecken am gleichmäßigsten sind.</p><label for="pa-height">Höhe</label><div class="input-row"><input id="pa-height" type="number" min="0" max="100" step="0.1"><span class="unit">mm</span></div><div class="actions">${button("calculate","Berechnen")}</div>`;
  bind("calculate",async()=>{await calibrationAction("calculate",{height:Number(document.querySelector("#pa-height").value)}); pressureResult();});
}

function pressureResult() {
  genericFrame("pressure_advance",2); const value=session.data.value;
  panel.innerHTML=`<span class="kicker">Ergebnis</span><h2>Pressure Advance ${value.toFixed(4)}</h2><p>Der Wert wird zuerst nur zur Laufzeit gesetzt. Erst deine nächste Bestätigung schreibt ihn in die Extruder-Konfiguration.</p><div class="actions">${button("apply","Temporär anwenden")}</div>`;
  bind("apply",async()=>{await calibrationAction("apply"); saveLocalPage("Pressure Advance",`Neuer Wert: ${value.toFixed(6)}`);});
}

function flowSetup() {
  genericFrame("flow",0);
  panel.innerHTML=`<span class="kicker">Slicer-Kalibrierung</span><h1>Flow / Extrusionsfaktor</h1><p class="lead">Drucke den bereitgestellten Testkörper mit einer Wand und ohne Deckschichten. Trage danach Sollstärke und vier Messungen ein.</p>
    <section class="model-download" aria-labelledby="flow-model-title">
      <div><span class="model-icon" aria-hidden="true">STL</span></div>
      <div><h3 id="flow-model-title">Flow-Testkörper · 30 × 30 × 20 mm</h3><p>Für jeden Slicer geeignet. Das Modell wird erst durch die folgenden Slicer-Einstellungen zum einwandigen Messkörper.</p></div>
      <a class="button secondary download-button" href="assets/models/flow-calibration-cube-30x30x20.stl" download="flow-calibration-cube-30x30x20.stl">STL herunterladen</a>
    </section>
    <div class="slicer-settings"><h3>Slicer-Einstellungen</h3><ul><li>Wände / Perimeter: <strong>1</strong></li><li>Deckschichten: <strong>0</strong></li><li>Infill: <strong>0 %</strong></li><li>Bodenschichten: <strong>3</strong></li><li>Linienbreite: <strong>0.40 mm</strong> (bei 0,4-mm-Düse)</li><li>Spiral-/Vasenmodus: <strong>deaktiviert</strong></li></ul></div>
    <p class="measurement-hint">Miss jede Seitenwand mittig, deutlich entfernt von Ecken und untersten Schichten. Verwende bei einer anderen Linienbreite diesen Wert als Sollstärke.</p>
    <div class="detail-grid"><div><label>Sollstärke</label><input id="flow-expected" type="number" value="0.4" min="0.1" step="0.01"></div><div><label>Aktueller Flow</label><input id="flow-current" type="number" value="100" min="70" max="130" step="0.1"></div>${[1,2,3,4].map(n=>`<div><label>Messung ${n}</label><input class="flow-measure" type="number" min="0.1" step="0.01"></div>`).join("")}</div><div class="actions">${button("flow-calc","Extrusionsfaktor berechnen")}</div>`;
  bind("flow-calc",async()=>{await startCalibration("flow"); await calibrationAction("calculate",{expected:Number(document.querySelector("#flow-expected").value),current:Number(document.querySelector("#flow-current").value),measurements:[...document.querySelectorAll(".flow-measure")].map(i=>Number(i.value))}); flowResultPage();});
}

function flowResultPage() {
  genericFrame("flow",2);
  panel.innerHTML=`<span class="kicker">Ergebnis</span><h2>${session.data.result.toFixed(1)} % Flow</h2><p>Mittlere gemessene Wandstärke: ${session.data.average.toFixed(3)} mm. Übernimm den neuen Wert in dein Filamentprofil im Slicer und drucke zur Kontrolle erneut.</p><div class="actions">${button("done","Fertig")}</div>`;
  bind("done",dashboard);
}

function shaperSetup() {
  genericFrame("input_shaper",0);
  panel.innerHTML=`<span class="kicker">Beschleunigungssensor</span><h1>Input Shaper</h1><p class="lead">Der Sensor wird zuerst abgefragt. Danach erzeugt Klipper starke, schnelle Schwingungen und bestimmt passende Shaper für X und Y.</p><p class="safety-note">Prüfe Sensorbefestigung, Kabelweg und freien Bauraum. Bleibe während der Messung am Drucker.</p><label for="shaper-axis">Achsen</label><select id="shaper-axis"><option value="both">X und Y</option><option value="x">Nur X</option><option value="y">Nur Y</option></select><div class="actions">${button("sensor-check","Sensor prüfen")}</div>`;
  bind("sensor-check",async()=>{await startCalibration("input_shaper",{axis:document.querySelector("#shaper-axis").value}); await calibrationAction("check"); shaperHome();});
}

function shaperHome() {
  genericFrame("input_shaper",1); panel.innerHTML=`<span class="kicker">Bewegung</span><h2>Achsen referenzieren</h2><p>Räume den Bauraum frei. Anschließend wird G28 ausgeführt.</p><div class="actions">${button("home","Referenzieren")}</div>`;
  bind("home",async()=>{await calibrationAction("home"); shaperRun();});
}

function shaperRun() {
  genericFrame("input_shaper",2); panel.innerHTML=`<span class="kicker">Starke Schwingungen</span><h2>Resonanzmessung starten</h2><p>Der Drucker bewegt sich schnell und laut. Stoppe ihn sofort bei lockeren Teilen, Zug am Sensorkabel oder ungewöhnlichen Geräuschen.</p><label><input id="vibration-confirm" type="checkbox" style="width:auto"> Sensor und Kabel sind sicher befestigt, der Bauraum ist frei.</label><div class="actions">${button("run","SHAPER_CALIBRATE starten")}</div>`;
  bind("run",async()=>{if(!document.querySelector("#vibration-confirm").checked)throw new Error("Bestätige zuerst die sichere Vorbereitung."); document.querySelector("#run").innerHTML='<span class="spinner"></span>Messung läuft…'; await calibrationAction("run"); saveKlipperPage("Input Shaper", "Klipper hat passende Shaper berechnet. Mit SAVE_CONFIG werden sie dauerhaft übernommen.", pendingCalibrationValues());});
}

function saveKlipperPage(title, copy, selection = "") {
  genericFrame(activeWizard,3); panel.innerHTML=`<span class="kicker">Dauerhafte Änderung</span><h2>${title} speichern</h2><p>${copy}</p>${selection}<label><input id="confirm-save" type="checkbox" style="width:auto"> Ich möchte genau die Ergebnisse dieser Kalibrierung mit SAVE_CONFIG speichern und Klipper neu starten.</label><div class="actions">${button("save-config","SAVE_CONFIG ausführen")}</div>`;
  bind("save-config",async()=>{if(!document.querySelector("#confirm-save").checked)throw new Error("Bestätige die dauerhafte Änderung zuerst."); await calibrationAction("save",{},session.save_token); completePage(title, true);});
}

function saveLocalPage(title, copy) {
  genericFrame(activeWizard,3); panel.innerHTML=`<span class="kicker">Dauerhafte Änderung</span><h2>${title} speichern</h2><p>${copy}</p><label><input id="confirm-save" type="checkbox" style="width:auto"> Konfigurationsdatei mit Backup ändern.</label><div class="actions">${button("save-config","In Konfiguration speichern")}</div>`;
  bind("save-config",async()=>{if(!document.querySelector("#confirm-save").checked)throw new Error("Bestätige die Änderung zuerst."); await calibrationAction("save",{},session.save_token); completePage(title, true);});
}

function completePage(title, saved = false) { panel.innerHTML=`<span class="kicker">Abgeschlossen</span><h2>${title} ${saved ? "gespeichert" : "abgeschlossen"}</h2><p>${saved ? "Die Kalibrierungswerte wurden dauerhaft übernommen." : "Die Kalibrierung ist abgeschlossen; es war keine Konfigurationsänderung erforderlich."}</p><div class="actions">${button("dashboard","Zur Übersicht")}</div>`; bind("dashboard",dashboard); }

function heat() {
  setProgress(1);
  const minimum = Math.ceil(Math.max(printer?.min_extrude_temp || 170, 150) / 5) * 5;
  const suggested = Math.max(200, minimum);
  panel.innerHTML = `<span class="kicker">Step 2</span><h2>Heat the extruder</h2>
    <p>Choose a temperature suitable for the loaded filament. Continue only when Klipper reports that extrusion is safe.</p>
    <label for="heat-input">Target temperature · 5 °C increments</label><div class="input-row"><input id="heat-input" type="number" min="${minimum}" max="300" value="${suggested}" step="5"><span class="unit">°C</span></div>
    <div class="actions">${button("heat", "Heat extruder")} ${button("heat-next", "Continue", "secondary")}</div>`;
  bind("heat", async () => {
    const temperature = Number(document.querySelector("#heat-input").value);
    if (!Number.isFinite(temperature) || temperature % 5 !== 0) throw new Error("Choose a temperature in 5 °C increments.");
    await api("wizards/extruder/heat", { temperature }); document.querySelector("#heat").textContent = "Heating…";
  });
  bind("heat-next", async () => { await api("wizards/extruder/ready"); mark(); });
}

function mark() {
  setProgress(2);
  panel.innerHTML = `<span class="kicker">Step 3</span><h2>Mark the filament</h2>
    <p>Load filament, choose an unambiguous fixed reference point at the extruder entrance, then measure and mark exactly <strong>${session.mark_distance} mm</strong> above it.</p>
    <div class="detail-grid"><div class="detail"><span>Mark distance</span><strong>${session.mark_distance} mm</strong></div><div class="detail"><span>Next extrusion</span><strong>${session.commanded_extrusion} mm</strong></div></div>
    <div class="actions">${button("marked", "Mark is ready")}</div>`;
  bind("marked", extrusion);
}

function extrusion() {
  setProgress(3);
  panel.innerHTML = `<span class="kicker">Step 4 · Motion</span><h2>Extrude ${session.commanded_extrusion} mm</h2>
    <p>The extruder will move slowly at 1 mm/s. Klipper's cold-extrusion protection and printer state are checked again immediately before motion.</p>
    <div class="actions">${button("extrude", `Extrude ${session.commanded_extrusion} mm`)}</div>`;
  bind("extrude", async () => { document.querySelector("#extrude").innerHTML = '<span class="spinner"></span>Extruding…'; await api("wizards/extruder/extrude"); measure(false); });
}

function measure(verification) {
  setProgress(verification ? 6 : 4);
  panel.innerHTML = `<span class="kicker">${verification ? "Verification" : "Step 5"}</span><h2>Measure the remainder</h2>
    <p>Measure from the same fixed reference point to the filament mark. Enter the remaining distance as precisely as possible.</p>
    <label for="remaining">Remaining distance</label><div class="input-row"><input id="remaining" inputmode="decimal" type="number" min="0" max="${session.mark_distance}" step="0.01" placeholder="20.00"><span class="unit">mm</span></div>
    <div class="actions">${button("calculate", verification ? "Check result" : "Calculate")}</div>`;
  bind("calculate", async () => {
    const value = Number(document.querySelector("#remaining").value);
    if (!Number.isFinite(value)) throw new Error("Enter a valid remaining distance.");
    await api(verification ? "wizards/extruder/verify/measurement" : "wizards/extruder/measurement", { remaining_distance: value });
    result(verification);
  });
}

function result(verification = false) {
  setProgress(verification ? 7 : 5);
  const r = verification ? session.verification_result : session.result;
  const warnings = r.warnings.length ? `<ul class="warning-list">${r.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : "";
  panel.innerHTML = `<span class="kicker">${verification ? "Verification result" : "Calculated result"}</span><h2>${r.safe_to_apply ? "Measurement looks plausible" : "Please check the measurement"}</h2>
    <div class="result-grid">
      <div class="metric"><span>Requested</span><strong>${r.requested_extrusion.toFixed(2)} mm</strong></div><div class="metric"><span>Actual</span><strong>${r.actual_extrusion.toFixed(2)} mm</strong></div>
      <div class="metric"><span>Deviation</span><strong>${r.deviation_mm.toFixed(2)} mm · ${r.deviation_percent.toFixed(2)}%</strong></div><div class="metric"><span>${verification ? "Tested rotation distance" : "New rotation distance"}</span><strong>${r.new_rotation_distance.toFixed(5)} mm</strong></div>
    </div>${warnings}
    <div class="actions">${!verification && r.safe_to_apply ? button("apply", "Apply temporarily") : ""} ${!verification ? button("again", "Measure again", "secondary") : button("save-view", "Continue to save", "secondary")}</div>`;
  bind("apply", async () => { await api("wizards/extruder/apply"); verify(); });
  bind("again", async () => { await api("wizards/extruder/measure-again"); mark(); });
  bind("save-view", saveView);
}

function verify() {
  setProgress(6);
  panel.innerHTML = `<span class="kicker">Step 7 · Optional</span><h2>Verify the new value</h2><p>The new rotation distance is active until Klipper restarts. You can repeat the measurement before saving, or proceed directly to the explicit save confirmation.</p>
    <div class="actions">${button("verify", `Extrude ${session.commanded_extrusion} mm again`)} ${button("skip", "Skip verification", "secondary")}</div>`;
  bind("verify", async () => { await api("wizards/extruder/verify/extrude"); measure(true); });
  bind("skip", saveView);
}

function saveView() {
  setProgress(7);
  const canSave = Boolean(session.save_token && session.config_source);
  panel.innerHTML = `<span class="kicker">Step 8 · Permanent change</span><h2>Save configuration</h2>
    <p>A timestamped backup is created first. Only the exact <code>rotation_distance</code> setting in its source include file is changed.</p>
    <div class="result-grid"><div class="metric"><span>Old value</span><strong>${session.old_rotation_distance.toFixed(8)}</strong></div><div class="metric"><span>New value</span><strong>${session.result.new_rotation_distance.toFixed(8)}</strong></div></div>
    <p>${canSave ? `Source: <code>${session.config_source}</code>` : "Permanent writes are unavailable because the source setting could not be resolved. The temporary value remains active until restart."}</p>
    <label><input id="confirm" type="checkbox" style="width:auto"> I confirm these old and new values and want to change the Klipper configuration.</label>
    <div class="actions">${button("save", "Save configuration", canSave ? "" : "secondary")}</div>`;
  document.querySelector("#save").disabled = !canSave;
  bind("save", async () => {
    if (!document.querySelector("#confirm").checked) throw new Error("Confirm the permanent configuration change first.");
    const response = await api("wizards/extruder/save", { confirmation_token: session.save_token, old_rotation_distance: session.old_rotation_distance, new_rotation_distance: session.result.new_rotation_distance });
    panel.innerHTML = `<span class="kicker">Complete</span><h2>Calibration saved</h2><p>${response.message}</p><p>The runtime value is already active. The backup can be restored as described in the installation guide.</p>`;
  });
}

document.querySelector("#cancel").addEventListener("click", async () => {
  try {
    if (session && activeWizard === "extruder") await api("wizards/extruder/cancel");
    else if (session && activeWizard) await calibrationAction("cancel");
    session = null; dashboard();
  } catch (error) { showError(error.message); }
});

function resumedRunningPage(id, title = "Kalibrierung läuft") {
  if (id === "extruder") {
    setSteps("Extruder kalibrieren", t("steps"));
    setProgress(session.state === "VERIFYING" ? 6 : 3);
  } else {
    const steps = {pid:1, bed_mesh:2, screws_tilt:1, z_tilt:2, quad_gantry_level:2, input_shaper:2};
    genericFrame(id, session.state === "HOMING" ? 1 : (steps[id] ?? 1));
  }
  const selection = id === "pid" ? pidSelectionSummary() : "";
  panel.innerHTML=`<span class="kicker">Laufende Kalibrierung</span><h2>${title}</h2>${selection}<p>Der Drucker führt den laufenden Schritt weiter aus. Diese Ansicht wechselt automatisch zum nächsten Schritt, sobald Klipper fertig ist.</p><div class="running-state"><span class="spinner"></span><strong>Bitte warten…</strong></div>`;
}

function resumedErrorPage(id) {
  if (id === "extruder") { setSteps("Extruder kalibrieren", t("steps")); setProgress(0); }
  else genericFrame(id, 0);
  panel.innerHTML=`<span class="kicker">Kalibrierung unterbrochen</span><h2>Der Ablauf kann nicht fortgesetzt werden</h2><p>${esc(session.error || "Klipper hat während der Kalibrierung einen Fehler gemeldet.")}</p><div class="actions">${button("dashboard","Zur Übersicht")}</div>`;
  bind("dashboard",dashboard);
}

function renderResumedExtruder() {
  switch (session.state) {
    case "IDLE": heat(); break;
    case "HEATING": heat(); break;
    case "READY": mark(); break;
    case "RUNNING": resumedRunningPage("extruder", "Extrusion läuft"); break;
    case "WAITING_FOR_MEASUREMENT": measure(false); break;
    case "CALCULATED": result(false); break;
    case "APPLIED": verify(); break;
    case "VERIFYING": resumedRunningPage("extruder", "Prüfextrusion läuft"); break;
    case "COMPLETE":
      if (session.verification_result && session.save_token) result(true);
      else { setSteps("Extruder kalibrieren", t("steps")); setProgress(7); completePage("Extruder-Kalibrierung", true); }
      break;
    case "ERROR": resumedErrorPage("extruder"); break;
    default: dashboard();
  }
}

function renderResumedGeneric(id) {
  const state = session.state;
  if (state === "ERROR") return resumedErrorPage(id);
  if (state === "HOMING") return resumedRunningPage(id, "Referenzierung läuft");
  if (state === "RUNNING") return resumedRunningPage(id);
  if (state === "COMPLETE") {
    if (id === "flow" && Number.isFinite(session.data?.result)) return flowResultPage();
    const saved = new Set(["pid", "bed_mesh", "probe_offset", "input_shaper", "pressure_advance"]).has(id);
    genericFrame(id, (genericSteps[id]?.length || 1) - 1); return completePage(wizards.find(item=>item.id===id)?.name || "Kalibrierung", saved);
  }
  if (id === "pid") {
    if (state === "READY") return pidReadyPage();
    if (state === "REVIEW") return saveKlipperPage("PID-Werte", "Klipper hat neue PID-Werte ermittelt. Prüfe das Ergebnis und speichere es anschließend explizit.", pidSelectionSummary() + pendingCalibrationValues());
  }
  if (id === "bed_mesh") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return bedMeshRun();
    if (state === "REVIEW") return saveKlipperPage("Bed Mesh", "Das neue Mesh ist berechnet. Mit SAVE_CONFIG wird es dauerhaft in Klipper gespeichert.", bedMeshSummary() + pendingCalibrationValues());
  }
  if (id === "screws_tilt") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return screwsRun();
    if (state === "REVIEW") return screwsResult();
  }
  if (id === "bed_screws") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return bedScrewsRun();
    if (state === "ADJUSTING") return bedScrewsAdjust();
  }
  if (id === "probe_offset") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return probeRun();
    if (state === "ADJUSTING") return probeAdjust();
    if (state === "REVIEW") return saveKlipperPage("Probe Z-Offset", "Der Offset ist übernommen, aber noch nicht dauerhaft gespeichert.", pendingCalibrationValues());
  }
  if (id === "z_tilt" || id === "quad_gantry_level") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return gantryRun(id);
  }
  if (id === "pressure_advance") {
    if (state === "READY") return pressurePrint();
    if (state === "PRINT_TOWER") return pressureMeasure();
    if (state === "CALCULATED") return pressureResult();
    if (state === "APPLIED") return saveLocalPage("Pressure Advance",`Neuer Wert: ${session.data.value.toFixed(6)}`);
  }
  if (id === "input_shaper") {
    if (state === "READY") return shaperSetup();
    if (state === "CHECKING") return resumedRunningPage(id, "Beschleunigungssensor wird geprüft");
    if (state === "SENSOR_READY") return shaperHome();
    if (state === "HOMED") return shaperRun();
    if (state === "REVIEW") return saveKlipperPage("Input Shaper", "Klipper hat passende Shaper berechnet. Mit SAVE_CONFIG werden sie dauerhaft übernommen.", pendingCalibrationValues());
  }
  if (id === "flow" && state === "READY") return flowSetup();
  dashboard();
}

async function restoreCalibration() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(resumeStorageKey)); } catch { forgetCalibration(); return false; }
  if (!saved?.wizard || !wizards.some(item=>item.id===saved.wizard)) return false;
  activeWizard = saved.wizard;
  if (!saved.id) {
    if (cleanConfigWizards.has(saved.wizard) && printer?.save_config_pending) pendingConfigPage(saved.wizard);
    else if (saved.wizard === "extruder") welcome(); else openGeneric(saved.wizard);
    return true;
  }
  const url = saved.wizard === "extruder" ? "wizards/extruder" : `wizards/${saved.wizard}/session`;
  const response = await fetch(new URL(url,base));
  if (!response.ok) return false;
  const payload = await response.json();
  const recovered = saved.wizard === "extruder" ? payload.session : payload;
  if (!recovered || recovered.id !== saved.id || recovered.state === "CANCELLED") return false;
  session = recovered;
  resumeMode = true;
  if (saved.wizard === "extruder") renderResumedExtruder(); else renderResumedGeneric(saved.wizard);
  return true;
}

function updateStatus(data) {
  const previousReadiness = printerReadinessKey();
  const previousSessionState = session?.state;
  printer = data.printer;
  if (activeWizard === "extruder" && data.session) session = data.session;
  if (activeWizard && activeWizard !== "extruder" && data.calibrations?.[activeWizard]) session = data.calibrations[activeWizard];
  updateCalibrationStatusStrip();
  connection.className = `connection ${printer.connected ? "online" : "offline"}`;
  document.querySelector("#connection").textContent = printer.connected ? "Printer connected" : "Printer offline";
  if (!bootstrapping && pendingResolution() && continueAfterPendingResolution()) return;
  if (!bootstrapping && isOverview && previousReadiness !== printerReadinessKey()) dashboard();
  if (resumeMode && session?.state !== previousSessionState) {
    if (activeWizard === "extruder") renderResumedExtruder(); else renderResumedGeneric(activeWizard);
  }
}

function connect() {
  const wsUrl = new URL("./api/events", window.location.href);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(wsUrl);
  socket.onmessage = (event) => updateStatus(JSON.parse(event.data));
  socket.onclose = () => {
    connection.className = "connection offline";
    document.querySelector("#connection").textContent = "Reconnecting";
    if (printer) printer = {...printer, connected:false, state:"disconnected", state_message:""};
    if (!bootstrapping && isOverview) dashboard();
    setTimeout(connect, 2000);
  };
}

Promise.all([
  fetch(new URL("status", base)).then((r) => r.json()),
  fetch(new URL("wizards", base)).then((r) => r.json()),
]).then(async ([status, availableWizards]) => {
  wizards = availableWizards;
  updateStatus(status);
  const pending = pendingResolution();
  if (pending?.wizard) {
    bootstrapping = false;
    if (!continueAfterPendingResolution()) pendingConfigWaitingPage(pending.wizard, pending.action);
    return;
  }
  const restored = await restoreCalibration();
  bootstrapping = false;
  if (!restored) dashboard();
}).catch((error) => { bootstrapping=false; dashboard(); showError(error.message); });
connect();
