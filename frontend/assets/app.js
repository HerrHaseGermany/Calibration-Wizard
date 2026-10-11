import { renderFilamentPage } from "./wizards/filament/frontend.mjs?v=20261011-1";
import { renderXyzPage } from "./wizards/xyz/frontend.mjs?v=20261011-1";
import { getLanguagePreference, setLocale, t, msg, rich, setText, setTranslatedAttribute, applyTranslations, apiError, loadLocales, LocalizedError } from "./i18n.js?v=20261010-9";
import { adjustment, positionMap } from "./positions.mjs?v=20261010-9";

await loadLocales();

const base = new URL("./api/", window.location.href);
const panel = document.querySelector("#panel");
const notice = document.querySelector("#notice");
const progress = document.querySelector("#progress");
const connection = document.querySelector(".connection");
const rail = document.querySelector("#rail");
const workspace = document.querySelector(".workspace");
const statusStrip = document.querySelector("#status-strip");
const homeButton = document.querySelector("#home-button");
const configurationButton = document.querySelector("#configuration-button");
let navigationLocked = false;
const emergencyButton = document.querySelector("#emergency-button");
let printer = null;
let session = null;
let wizards = [];
let uiStep = 0;
let activeWizard = null;
let isOverview = true;
let isConfigurationOverview = false;
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
  return `${Boolean(value?.connected)}|${value?.state || "unknown"}|${value?.state_message || ""}|${value?.print_state || "standby"}`;
}

function printerReadinessNotice() {
  if (printerIsReady()) return "";
  const state = printer?.connected ? (printer.state || "unknown") : "disconnected";
  const copy = {
    shutdown: msg("ui.klipper_is_in_shutdown_state_check_the_printer_and_the"),
    error: msg("ui.klipper_reports_an_error_check_the_message_in_mainsail_and"),
    startup: msg("ui.klipper_is_starting_calibrations_will_be_enabled_automatically_as_soon"),
    disconnected: msg("ui.klipper_tools_cannot_reach_klipper_right_now_check_the_connection"),
  }[state] || msg("ui.klipper_is_currently_not_ready_state_value_check_the_printer", {value0: state});
  const detail = printer?.state_message ? `<p class="printer-state-message">${esc(printer.state_message)}</p>` : "";
  return `<aside class="printer-readiness" role="alert"><div><strong>${msg("ui.klipper_is_not_ready")}</strong><p>${copy}</p>${detail}</div><a class="button secondary" href="/">${msg("ui.go_to_mainsail")}</a></aside>`;
}

function setOverviewState(current) {
  isConfigurationOverview = false;
  isOverview = current;
  homeButton.disabled = current || navigationLocked;
  if (current) homeButton.setAttribute("aria-current", "page");
  else homeButton.removeAttribute("aria-current");
}

const language = document.querySelector("#language");
language.value = getLanguagePreference();
setLocale(getLanguagePreference());
language.addEventListener("change", () => { setLocale(language.value); applyTranslations(); });
applyTranslations();
window.addEventListener("languagechange", () => {
  if (getLanguagePreference() === "system") { setLocale("system"); applyTranslations(); }
});

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
  setText(document.querySelector("#theme-icon"), () => mode === "system" ? "◐" : mode === "dark" ? "☾" : "☀");
  const title = () => t(`ui.color_scheme_${mode === "system" ? "system" : mode === "light" ? "light" : "dark"}`);
  setTranslatedAttribute(themeButton, "title", title);
  setTranslatedAttribute(themeButton, "aria-label", title);

}
applyThemeMode(themeMode,false);
themeButton.addEventListener("click",()=>{const modes=["system","light","dark"]; applyThemeMode(modes[(modes.indexOf(themeMode)+1)%modes.length]);});
systemTheme.addEventListener("change",()=>{if(themeMode === "system")applyThemeMode("system",false);});

function setSteps(title, labels) {
  document.querySelector("#rail-title").innerHTML = title;
  progress.replaceChildren();
  labels.forEach((label) => {
    const item = document.createElement("li"); item.innerHTML = label; progress.append(item);
  });
}

setSteps(msg("welcomeTitle"), t("steps").map(key => msg(key)));

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
  setText(emergencyButton.querySelector(".header-button-label"), () => t("ui.emergency_stop"));
  activeWizard = null;
  rail.classList.add("hidden");
  workspace.classList.add("menu-mode");
  statusStrip.classList.add("hidden");
  clearError();
  const ready = printerIsReady();
  const printBusy = ["printing", "paused"].includes(printer?.print_state);
  const filamentReady = ready && printer?.print_state !== "printing";
  const card = (wizard) => {
    const usable = wizard.id === "filament" ? filamentReady : !printBusy && (ready || wizard.id === "flow");
    const interaction = wizard.available && usable ? `data-wizard="${wizard.id}" role="button" tabindex="0"` : 'aria-disabled="true"';
    const blocked = !wizard.available ? "unavailable" : usable ? "" : "printer-blocked";
    const configured = wizard.configuration?.point_count ? `<span class="configured">${msg("ui.value_points_detected", {value0: wizard.configuration.point_count})}</span>` : "";
    const unavailable = !wizard.available ? `<span class="unavailable-reason">${wizard.availability_key ? msg(wizard.availability_key, wizard.availability_params) : msg("ui.not_available_on_this_printer")}</span><span class="planned">${msg("ui.not_configured")}</span>` : "";
    return `<div class="calibration-card ${blocked}" ${interaction}>
      <span class="card-icon">${cardIcon(wizard.id)}</span><h3>${msg(wizard.name_key || `wizards.${wizard.id}.name`)}</h3><p>${msg(wizard.description_key || `wizards.${wizard.id}.description`)}</p>
      ${configured}${unavailable}</div>`;
  };
  const phases = [
    {title:msg("overview.phase_temperature"), ids:["pid","extruder"]},
    {title:msg("overview.phase_mechanics"), ids:["bed_screws","screws_tilt","z_tilt","quad_gantry_level","probe_offset","bed_mesh","xyz"]},
    {title:msg("overview.phase_quality"), ids:["flow","input_shaper","pressure_advance"]},
  ];
  const cards = phases.map(phase=>{
    const entries=phase.ids.map(id=>wizards.find(wizard=>wizard.id===id)).filter(wizard=>wizard?.available);
    if(!entries.length)return "";
    return `<section class="calibration-phase"><div class="phase-heading"><h3>${phase.title}</h3></div><div class="calibration-grid">${entries.map(card).join("")}</div></section>`;
  }).join("");
  const unavailable=wizards.filter(wizard=>!wizard.available && wizard.category !== "helper");
  const unavailableCards=unavailable.length ? `<section class="calibration-phase unavailable-phase"><div class="phase-heading"><h3>${msg("ui.unavailable")}</h3></div><div class="calibration-grid">${unavailable.map(card).join("")}</div></section>` : "";
  panel.innerHTML = `<h1>${msg("ui.tools")}</h1>
    ${printerReadinessNotice()}
    <div class="tool-groups">
      <section class="tool-group">
        <div class="calibration-grid">
          ${card(wizards.find(wizard => wizard.id === "filament") || {id:"filament", available:true})}
        </div>
      </section>
      <section class="tool-group" aria-labelledby="calibration-title">
        <h2 id="calibration-title">${msg("tools.calibration")}</h2>
        <div class="calibration-phases">${cards}${unavailableCards}</div>
      </section>
    </div>`;
  const openWizard = (card) => {
    const id = card.dataset.wizard;
    if (id === "filament") filamentPage();
    else if (cleanConfigWizards.has(id) && printer?.save_config_pending) pendingConfigPage(id);
    else if (id === "extruder") welcome(); else openGeneric(id);
  };
  document.querySelectorAll("[data-wizard]").forEach((card) => {
    card.addEventListener("click", () => openWizard(card));
    card.addEventListener("keydown", (event) => { if(event.target===card && (event.key === "Enter" || event.key === " ")){event.preventDefault();openWizard(card);} });
  });
  updateNavigationAvailability();
}

function configurationOverview() {
  setOverviewState(false);
  isConfigurationOverview = true;
  activeWizard = null;
  session = null;
  clearError();
  const ready = printerIsReady() && !["printing", "paused"].includes(printer?.print_state);
  panel.innerHTML = `<h1>${msg("configuration.title")}</h1><p class="lead">${msg("configuration.description")}</p>${printerReadinessNotice()}
    <div class="calibration-grid">${wizards.filter(wizard => wizard.setup_available).map(wizard => `<div class="calibration-card ${ready ? "" : "printer-blocked"}" ${ready ? `data-setup="${wizard.id}" role="button" tabindex="0"` : 'aria-disabled="true"'}>
      <span class="card-icon">${cardIcon(wizard.id)}</span><h3>${msg(wizard.name_key || `wizards.${wizard.id}.name`)}</h3><p>${msg(wizard.description_key || `wizards.${wizard.id}.description`)}</p></div>`).join("")}</div>
    <div class="actions">${button("configuration-back", msg("actions.back"), "secondary")}</div>`;
  bind("configuration-back", dashboard);
  const open = async card => { try { await openSetup(card.dataset.setup); } catch(error) { showError(error); } };
  panel.querySelectorAll("[data-setup]").forEach(card => {
    card.addEventListener("click", () => open(card));
    card.addEventListener("keydown", event => {
      if (event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); open(card);
      }
    });
  });
}

function filamentPage() {
  clearError();
  session = null;
  activeWizard = "filament";
  setOverviewState(false);
  rail.classList.add("hidden");
  emergencyButton.classList.remove("hidden");
  updateCalibrationStatusStrip();
  renderFilamentPage({panel, base, getPrinter: () => printer, setNavigationLocked, onCancel: returnHome, button, showError, t, msg, setText, apiError, LocalizedError});
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

function updateNavigationAvailability() {
  configurationButton.disabled = navigationLocked || !printerIsReady() || ["printing", "paused"].includes(printer?.print_state);
}

function setNavigationLocked(locked) {
  navigationLocked = locked;
  document.querySelector("#cancel").disabled = locked;
  homeButton.disabled = locked || isOverview;
  updateNavigationAvailability();
}

configurationButton.addEventListener("click", async () => {
  if (configurationButton.disabled) return;
  configurationButton.disabled = true;
  try { await returnHome(); configurationOverview(); }
  catch(error) { showError(error); }
  finally { updateNavigationAvailability(); }
});

homeButton.addEventListener("click",async(event)=>{
  event.currentTarget.disabled=true;
  try { await returnHome(); } catch(error) { showError(error); }
  finally { event.currentTarget.disabled=isOverview; }
});

emergencyButton.addEventListener("click", async () => {
  emergencyButton.disabled = true;
  setText(emergencyButton.querySelector(".header-button-label"), () => t("ui.stopping"));
  try {
    const response = await fetch(new URL("emergency-stop", base), {method:"POST"});
    const result = await response.json();
    if (!response.ok) throw apiError(result);
    session = null;
    setText(emergencyButton.querySelector(".header-button-label"), () => t("ui.stopped"));
    window.location.assign(document.querySelector("#mainsail-button").href);
  } catch (error) {
    emergencyButton.disabled = false;
    setText(emergencyButton.querySelector(".header-button-label"), () => t("ui.emergency_stop"));
    showError(error);
  }

});

function cardIcon(id) {
  if (id === "xyz") return "XYZ";
  return ({filament:"↕", extruder:"E", pid:"°", flow:"%", pressure_advance:"PA", probe_offset:"Z", screws_tilt:"↻", bed_screws:"⌁", z_tilt:"Z²", quad_gantry_level:"Q", bed_mesh:"▦", input_shaper:"≈"})[id] || "+";
}

function showError(message) {
  setText(notice, () => message instanceof Error ? message.message : message);
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
  if (!response.ok) throw apiError(data);
  session = data.session || data;
  return data;
}

async function postCommand(path) {
  clearError();
  const response = await fetch(new URL(path, base), {method:"POST"});
  const data = await response.json();
  if (!response.ok) throw apiError(data);
  return data;
}

function pendingItemsMarkup(items) {
  const entries = Object.entries(items || {});
  if (!entries.length) return "";
  return `<div class="pending-values"><strong>${msg("ui.affected_configuration_values")}</strong><pre>${esc(JSON.stringify(items, null, 2))}</pre></div>`;
}

function pendingConfigPage(wizardId) {
  const definition = wizards.find((item) => item.id === wizardId);
  activeWizard = null;
  setOverviewState(false);
  emergencyButton.classList.add("hidden");
  rail.classList.add("hidden");
  workspace.classList.add("menu-mode");
  statusStrip.classList.add("hidden");
  panel.innerHTML = `<span class="kicker">${msg("ui.pending_klipper_values")}</span>
    <h1>${msg("ui.resolve_existing_changes")}</h1>
    <p class="lead">${msg("ui.klipper_already_has_unsaved_values_for")} <code>${msg("ui.save_config")}</code>${msg("ui.first_decide_what_should_happen_to_them_then")} <strong>${msg(definition?.name_key || `wizards.${wizardId}.name`)}</strong> ${msg("ui.will_open_automatically")}</p>
    ${pendingItemsMarkup(printer?.save_config_pending_items)}
    <p class="safety-note">${msg("ui.save_permanently_applies_all_values_listed_above_discard_reloads_the")}</p>
    <div class="actions">${button("save-pending", msg("ui.save_existing_values"))} ${button("discard-pending", msg("ui.discard_and_continue"), "danger ghost")} ${button("pending-back", msg("actions.back"), "secondary")}</div>`;
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
  panel.innerHTML = `<span class="kicker">${msg("ui.klipper_restart")}</span><h1>${action === "save" ? msg("ui.saving_values") : msg("ui.discarding_values")}</h1>
    <p class="lead">${action === "save" ? msg("ui.klipper_is_restarting_as_soon_as_the_firmware_is_ready_2") : `${msg("ui.klipper_is_restarting_as_soon_as_the_firmware_is_ready")} <strong>${msg(definition?.name_key || `wizards.${wizardId}.name`)}</strong>.`}</p>
    <div class="running-state"><span class="spinner"></span><strong>${msg("ui.waiting_for_klipper")}</strong></div>
    <div class="actions">${button("pending-cancel", msg("navigation.overview"), "secondary")}</div>`;
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
    try { await handler(); } catch (error) { showError(error); target.disabled = false; }
  });
}

function welcome() {
  activeWizard = "extruder";
  rememberCalibration("extruder");
  setSteps(msg("welcomeTitle"), t("steps").map(key => msg(key)));
  setProgress(0);
  panel.innerHTML = `
    <span class="kicker">${msg("ui.safe_guided_setup")}</span>
    <h1>${msg("welcomeTitle")}</h1><p class="lead">${msg("welcomeBody")}</p>
    <div class="detail-grid">
      <div class="detail"><span>${msg("ui.current_extruder")}</span><strong>${printer?.extruder || "extruder"}</strong></div>
      <div class="detail"><span>${msg("ui.current_rotation_distance")}</span><strong>${msg("ui.value_mm", {value3: printer?.rotation_distance?.toFixed(5) || "—"})}</strong></div>
    </div>
    <div class="actions">${button("start", msg("ui.start_calibration"))}</div>`;
  bind("start", async () => { await api("wizards/extruder/start", { mark_distance: 120, commanded_extrusion: 100 }); rememberCalibration("extruder", session.id); heat(); });
}

const genericSteps = {
  xyz: ["ui.home_axes", "ui.prepare", "ui.measure_2", "ui.result"],
  pid: ["ui.prepare", "ui.pid_tuning", "ui.review", "actions.save"],
  bed_mesh: ["ui.prepare", "ui.home_axes", "ui.measure", "actions.save"],
  screws_tilt: ["ui.home_axes", "ui.measure_2", "ui.adjust", "ui.repeat"],
  bed_screws: ["ui.home_axes", "ui.paper_test", "ui.adjust_screws"],
  probe_offset: ["ui.home_axes", "ui.start_probe", "ui.paper_test", "actions.save"],
  pressure_advance: ["ui.prepare", "ui.test_tower", "ui.evaluate", "actions.save"],
  flow: ["ui.print_test", "ui.measure_2", "ui.calculate"],
  input_shaper: ["ui.check_sensor", "ui.home_axes", "ui.measure_2", "actions.save"],
  z_tilt: ["ui.prepare", "ui.home_axes", "ui.level"],
  quad_gantry_level: ["ui.prepare", "ui.home_axes", "ui.level"],
};

function genericFrame(id, step) {
  const definition = wizards.find((item) => item.id === id);
  activeWizard = id;
  setSteps(msg(definition?.name_key || `wizards.${id}.name`), (genericSteps[id] || ["ui.start", "ui.result"]).map(key => msg(key)));
  setProgress(step);
  updateCalibrationStatusStrip();
}

function updateCalibrationStatusStrip() {
  if (activeWizard === "pid") {
    statusStrip.classList.remove("hidden");
    setText(document.querySelector("#status-label-1"), () => t("ui.hotend_actual"));
    setText(document.querySelector("#status-label-2"), () => t("ui.bed_actual"));
    setText(document.querySelector("#temperature"), () => t("ui.value_c", {value0: printer?.temperature?.toFixed(1) ?? "—"}));
    setText(document.querySelector("#target"), () => t("ui.value_c", {value0: printer?.bed_temperature?.toFixed(1) ?? "—"}));
  } else if (activeWizard === "extruder" || activeWizard === "filament") {
    statusStrip.classList.remove("hidden");
    setText(document.querySelector("#status-label-1"), () => t("ui.hotend_actual"));
    setText(document.querySelector("#status-label-2"), () => t("ui.hotend_target"));
    setText(document.querySelector("#temperature"), () => t("ui.value_c", {value0: printer?.temperature?.toFixed(1) ?? "—"}));
    setText(document.querySelector("#target"), () => t("ui.value_c", {value0: printer?.target?.toFixed(1) ?? "—"}));
  } else if (activeWizard === "pressure_advance") {
    statusStrip.classList.remove("hidden");
    setText(document.querySelector("#status-label-1"), () => t("ui.print_status"));
    setText(document.querySelector("#status-label-2"), () => t("ui.test_factor"));
    setText(document.querySelector("#temperature"), () => printer?.print_state ? t(`printer.print.${printer.print_state}`) : "—");
    setText(document.querySelector("#target"), () => Number.isFinite(session?.data?.factor) ? session.data.factor.toFixed(3) : "—");
  } else if (activeWizard === "flow") {
    statusStrip.classList.add("hidden");
    return;
  } else if (activeWizard) {
    const definition = wizards.find((item) => item.id === activeWizard);
    statusStrip.classList.remove("hidden");
    setText(document.querySelector("#status-label-1"), () => t("ui.active_workflow"));
    setText(document.querySelector("#status-label-2"), () => t("ui.homed_axes"));
    setText(document.querySelector("#temperature"), () => t(definition?.name_key || `wizards.${activeWizard}.name`));
    setText(document.querySelector("#target"), () => printer?.homed_axes?.toUpperCase() || t("ui.none"));
  } else {
    return;
  }
  setText(document.querySelector("#klipper-state"), () => printer?.state ? t(`printer.state.${printer.state}`) : "—");
}

function openGeneric(id) {
  rememberCalibration(id);
  genericFrame(id, 0);
  if (id === "xyz") { session = null; return xyzPage(); }
  if (id === "pid") return pidSetup();
  if (id === "pressure_advance") return pressureSetup();
  if (id === "flow") return flowSetup();
  if (id === "input_shaper") return shaperSetup();
  const intro = {
    bed_mesh: [msg("ui.bed_mesh"), msg("ui.the_printer_is_homed_first_then_the_bed_is_measured")],
    screws_tilt: [msg("ui.level_bed_screws"), msg("ui.klipper_calculates_direction_and_amount_for_every_screw_you_can")],
    bed_screws: [msg("ui.manual_bed_screws"), msg("ui.klipper_moves_to_each_configured_screw_you_adjust_the_paper")],
    probe_offset: [msg("ui.probe_z_offset"), msg("ui.use_probe_calibrate_and_fine_testz_steps_to_set_the")],
    z_tilt: ["Z-Tilt", msg("ui.klipper_probes_the_configured_points_and_levels_two_or_more")],
    quad_gantry_level: [msg("ui.quad_gantry_level"), msg("ui.klipper_probes_four_points_and_levels_the_gantry_with_four")],
  }[id];
  panel.innerHTML = `<span class="kicker">${msg("ui.guided_workflow")}</span><h1>${intro[0]}</h1><p class="lead">${intro[1]}</p>
    <p class="safety-note">${msg("ui.the_printer_must_not_be_printing_or_paused_motion_starts")}</p>
    <div class="actions">${button("generic-start", msg("ui.start_calibration"))}</div>`;
  bind("generic-start", async () => { await startCalibration(id); homingPage(id); });
}

function xyzPage() {
  renderXyzPage({panel, session, msg, button, bind, frame: step => genericFrame("xyz", step),
    start: () => startCalibration("xyz"), action: calibrationAction, home: returnHome,
    render: xyzPage, setNavigationLocked, LocalizedError});
}

function homingPage(id) {
  genericFrame(id, 1);
  panel.innerHTML = `<span class="kicker">${msg("ui.motion")}</span><h2>${msg("ui.home_all_axes")}</h2><p>${msg("ui.make_sure_the_build_volume_is_clear_the_printer_will_2")} <code>${msg("ui.g28")}</code> ${msg("ui.label")}</p>
    <div class="actions">${button("home", msg("ui.home_now"))}</div>`;
  bind("home", async () => { await calibrationAction("home"); if (id === "bed_mesh") bedMeshRun(); else if (id === "screws_tilt") screwsRun(); else if (id === "bed_screws") bedScrewsRun(); else if (id === "z_tilt" || id === "quad_gantry_level") gantryRun(id); else probeRun(); });
}

function bedScrewsRun() {
  genericFrame("bed_screws",1); panel.innerHTML=`<span class="kicker">${msg("ui.manual_paper_test")}</span><h2>${msg("ui.move_to_the_first_screw")}</h2><p>${msg("ui.klipper_moves_to_the_screws_in_sequence_set_the_same")}</p><div class="actions">${button("run",msg("actions.start_bed_screws"))}</div>`;
  bind("run",async()=>{await calibrationAction("run"); bedScrewsAdjust();});
}

function bedScrewsAdjust() {
  genericFrame("bed_screws",2); panel.innerHTML=`<span class="kicker">${msg("ui.adjust_screw")}</span><h2>${msg("ui.match_paper_resistance")}</h2><p>${msg("ui.turn_only_the_screw_at_the_current_position_then_click")}</p><div class="actions">${button("next",msg("ui.next_screw"))} ${button("accept",msg("ui.accept_leveling"),"secondary")} ${button("abort",msg("actions.cancel"),"danger ghost")}</div>`;
  panel.querySelector(".actions").insertAdjacentHTML("beforebegin",positionMap(session.data.positions || []));
  bind("next",async()=>{await calibrationAction("next"); document.querySelector("#next").disabled=false;}); bind("accept",async()=>{await calibrationAction("accept");completePage(msg("ui.manual_bed_screws"));}); bind("abort",async()=>{await calibrationAction("abort");dashboard();});
}

function gantryRun(id) {
  genericFrame(id,2); const command=id === "z_tilt" ? "Z_TILT_ADJUST" : "QUAD_GANTRY_LEVEL";
  panel.innerHTML=`<span class="kicker">${msg("ui.automatic_leveling")}</span><h2>${command}</h2><p>${msg("ui.klipper_probes_all_configured_points_and_iteratively_corrects_the_independent")}</p><div class="actions">${button("run",msg("ui.value_start", {value0: command}))}</div>`;
  panel.querySelector(".actions").insertAdjacentHTML("beforebegin",positionMap(session.data.positions || []));
  bind("run",async()=>{document.querySelector("#run").innerHTML=`<span class="spinner"></span>${msg("ui.leveling_running")}`; await calibrationAction("run"); completePage(id === "z_tilt" ? "Z-Tilt" : msg("ui.quad_gantry_level"));});
}

async function openSetup(id) {
  setOverviewState(false);
  emergencyButton.classList.add("hidden");
  activeWizard = null; rail.classList.add("hidden"); workspace.classList.add("menu-mode"); statusStrip.classList.add("hidden"); clearError();
  const response = await fetch(new URL(`setup/${id}`,base)); const setup = await response.json();
  if(!response.ok) throw apiError(setup);
  renderSetup(id,setup);
}

function pair(value, fallback=["",""]) {
  if (Array.isArray(value)) return [value[0] ?? "", value[1] ?? ""];
  if (typeof value === "string") return value.split(",").map(item=>item.trim());
  return fallback;
}

function pointRows(points, named=false) {
  return points.map((point,index)=>`<div class="point-row">
    ${named ? `<input class="point-name" value="${esc(point.name || t("ui.screw_value", {value0: index+1}))}" aria-label="${t("ui.name")}" data-i18n-aria-label="ui.name">` : `<span class="point-number">${index+1}</span>`}
    <input class="point-x" type="number" step="0.1" value="${esc(point.x)}" placeholder="${t("ui.x")}" data-i18n-placeholder="ui.x">
    <input class="point-y" type="number" step="0.1" value="${esc(point.y)}" placeholder="${t("ui.y")}" data-i18n-placeholder="ui.y">
    <button class="remove-point" type="button" aria-label="${t("ui.remove_point")}" data-i18n-aria-label="ui.remove_point">×</button></div>`).join("");
}

function existingPoints(current, kind) {
  if (kind === "named_points") return Object.keys(current).filter(key=>/^screw\d+$/.test(key)).sort((a,b)=>Number(a.slice(5))-Number(b.slice(5))).map(key=>{const xy=pair(current[key]); return {x:xy[0],y:xy[1],name:current[`${key}_name`] || key};});
  const raw=current.points || []; const values=Array.isArray(raw?.[0]) ? raw : (typeof raw === "string" ? raw.split("\n").map(pair) : []); return values.map(item=>({x:item[0],y:item[1]}));
}

function renderSetup(id, setup) {
  const {schema,current,printer_bounds:bounds}=setup; const boundsText=msg("ui.x_value_value_y_value_value_mm", {value0: bounds.x.min ?? "?", value1: bounds.x.max ?? "?", value2: bounds.y.min ?? "?", value3: bounds.y.max ?? "?"});
  let fields="";
  if(schema.kind === "mesh") { const min=pair(current.mesh_min); const max=pair(current.mesh_max); const count=pair(current.probe_count,[5,5]); fields=`<div class="setup-grid"><label>${msg("ui.mesh_minimum_x")}<input id="min-x" type="number" step="0.1" value="${esc(min[0])}"></label><label>${msg("ui.mesh_minimum_y")}<input id="min-y" type="number" step="0.1" value="${esc(min[1])}"></label><label>${msg("ui.mesh_maximum_x")}<input id="max-x" type="number" step="0.1" value="${esc(max[0])}"></label><label>${msg("ui.mesh_maximum_y")}<input id="max-y" type="number" step="0.1" value="${esc(max[1])}"></label><label>${msg("ui.probe_points_x")}<input id="count-x" type="number" min="2" max="50" value="${esc(count[0])}"></label><label>${msg("ui.probe_points_y")}<input id="count-y" type="number" min="2" max="50" value="${esc(count[1])}"></label></div>`; }
  else { let groups=[]; if(schema.kind === "dual_points") groups=[{key:"z_positions",title:msg("ui.z_actuator_positions"),points:(Array.isArray(current.z_positions)?current.z_positions:[]).map(item=>({x:item[0],y:item[1]}))},{key:"points",title:msg("ui.probe_points_2"),points:existingPoints(current,schema.kind)}]; else if(schema.kind === "quad_gantry") groups=[{key:"gantry_corners",title:msg("setup.gantry_corners"),points:(Array.isArray(current.gantry_corners)?current.gantry_corners:[]).map(item=>({x:item[0],y:item[1]}))},{key:"points",title:msg("setup.probe_points_four"),points:existingPoints(current,schema.kind)}]; else groups=[{key:"points",title:msg("ui.screw_positions"),points:existingPoints(current,schema.kind),named:true}]; fields=groups.map(group=>`<section class="point-group" data-key="${group.key}" data-named="${group.named ? "true":"false"}"><div class="group-heading"><h3>${group.title}</h3><button class="add-point button secondary" type="button">${msg("ui.add_point")}</button></div><div class="point-list">${pointRows(group.points.length?group.points:[{},{},{},{}],group.named)}</div></section>`).join(""); }
  const thread=schema.fields.includes("screw_thread") ? `<label>${msg("ui.screw_thread")}<select id="screw-thread">${["CW-M3","CW-M4","CW-M5","CCW-M3","CCW-M4","CCW-M5"].map(value=>`<option ${current.screw_thread===value?"selected":""}>${value}</option>`).join("")}</select></label>`:"";
  const setupLabels = {speed:msg("ui.travel_speed"), horizontal_move_z:msg("ui.travel_z_height"), probe_height:msg("ui.paper_test_height"), retries:msg("ui.retries"), retry_tolerance:msg("ui.retry_tolerance"), max_adjust:msg("ui.maximum_adjustment")};
  const advanced=["speed","horizontal_move_z","probe_height","retries","retry_tolerance","max_adjust"].filter(key=>schema.fields.includes(key)).map(key=>`<label>${setupLabels[key]}<input id="setup-${key}" type="number" step="0.01" value="${esc(current[key])}"></label>`).join("");
  panel.innerHTML=`<span class="kicker">${msg("ui.configure_calibration")}</span><h1>${msg(`wizards.${id}.name`)}</h1><p class="lead">${msg("ui.define_the_geometry_for_this_printer_travel_range_reported_by")} <strong>${boundsText}</strong>.</p><p class="safety-note">${msg("ui.coordinates_must_match_the_mechanics_probe_offset_and_a_clear")}</p>${fields}<div class="setup-grid advanced-fields">${thread}${advanced}</div><div class="actions">${button("preview-setup",msg("ui.review_changes"))} ${button("back",msg("actions.back"),"secondary")}</div>`;
  document.querySelectorAll(".add-point").forEach(control=>control.addEventListener("click",()=>{const group=control.closest(".point-group"); group.querySelector(".point-list").insertAdjacentHTML("beforeend",pointRows([{}],group.dataset.named==="true")); bindPointRemovers();})); bindPointRemovers(); bind("back",dashboard); bind("preview-setup",async()=>{const values=collectSetup(schema); const response=await api(`setup/${id}/preview`,{values}); renderSetupPreview(id,values,response);});
}

function bindPointRemovers(){document.querySelectorAll(".remove-point").forEach(control=>control.onclick=()=>control.closest(".point-row").remove());}

function collectSetup(schema){const value=id=>document.querySelector(`#${id}`)?.value; const values={}; if(schema.kind==="mesh"){values.mesh_min=[value("min-x"),value("min-y")]; values.mesh_max=[value("max-x"),value("max-y")]; values.probe_count=[value("count-x"),value("count-y")];} document.querySelectorAll(".point-group").forEach(group=>{values[group.dataset.key]=[...group.querySelectorAll(".point-row")].map(row=>({x:row.querySelector(".point-x").value,y:row.querySelector(".point-y").value,name:row.querySelector(".point-name")?.value}));}); if(schema.fields.includes("screw_thread"))values.screw_thread=value("screw-thread"); ["speed","horizontal_move_z","probe_height","retries","retry_tolerance","max_adjust"].forEach(key=>{const entry=value(`setup-${key}`);if(entry!==undefined&&entry!=="")values[key]=entry;}); return values;}

function renderSetupPreview(id,values,preview){panel.innerHTML=`<span class="kicker">${msg("ui.preview_value", {value0: esc(preview.digest)})}</span><h2>${msg("ui.value_review", {value1: esc(preview.section)})}</h2><p>${msg("ui.these_normalized_values_will_be_written_to_the_existing_section")}</p><pre class="config-preview">${esc(Object.entries(preview.settings).map(([key,value])=>`${key}: ${String(value).replaceAll("\n","\n  ")}`).join("\n"))}</pre><label><input id="setup-confirm" type="checkbox" style="width:auto"> ${msg("ui.create_a_backup_write_the_configuration_and_restart_klipper")}</label><div class="actions">${button("save-setup",msg("ui.save_setup"))} ${button("back",msg("actions.cancel"),"secondary")}</div>`; bind("back",dashboard); bind("save-setup",async()=>{if(!document.querySelector("#setup-confirm").checked)throw new LocalizedError("ui.confirm_the_change_and_the_klipper_restart"); const result=await api(`setup/${id}/save`,{values,confirmation_token:preview.confirmation_token,restart:true}); panel.innerHTML=`<span class="kicker">${msg("ui.saved")}</span><h2>${msg("ui.setup_applied")}</h2><p>${msg("ui.source_2")} <code>${esc(result.source)}</code><br>${msg("ui.backup_2")} <code>${esc(result.backup)}</code></p><p>${msg("ui.klipper_is_restarting_after_reconnecting_calibration_availability_is_evaluated_automatically")}</p><div class="actions">${button("dashboard",msg("navigation.overview"))}</div>`; bind("dashboard",async()=>{wizards=await fetch(new URL("wizards",base)).then(r=>r.json());dashboard();});});}

function bedMeshRun() {
  genericFrame("bed_mesh", 2);
  panel.innerHTML = `<span class="kicker">${msg("ui.measurement_motion")}</span><h2>${msg("ui.measure_the_print_bed")}</h2><p>${msg("ui.klipper_probes_every_point_defined_in")} <code>${msg("ui.bed_mesh_2")}</code> ${msg("ui.this_may_take_several_minutes")}</p>
    <div class="actions">${button("run", msg("ui.start_bed_mesh"))}</div>`;
  bind("run", async () => { document.querySelector("#run").innerHTML=`<span class="spinner"></span>${msg("ui.measurement_running")}`; await calibrationAction("run"); saveKlipperPage(msg("ui.bed_mesh"), msg("ui.the_new_mesh_is_calculated_save_config_saves_it_permanently"), bedMeshSummary() + pendingCalibrationValues()); });
}

function bedMeshSummary() {
  const result = session?.data?.result || {};
  const matrix = Array.isArray(result.probed_matrix) ? result.probed_matrix : [];
  const values = matrix.flat().map(Number).filter(Number.isFinite);
  const rows = matrix.length;
  const columns = Math.max(0, ...matrix.map(row => Array.isArray(row) ? row.length : 0));
  const range = values.length ? Math.max(...values) - Math.min(...values) : null;
  return `<div class="result-grid"><div class="metric"><span>${msg("ui.mesh_profile")}</span><strong>${esc(result.profile_name || "default")}</strong></div><div class="metric"><span>${msg("ui.measurement_grid")}</span><strong>${rows && columns ? `${columns} × ${rows}` : "—"}</strong></div><div class="metric"><span>${msg("ui.height_range")}</span><strong>${Number.isFinite(range) ? msg("ui.value_mm_2", {value0: range.toFixed(3)}) : "—"}</strong></div></div>`;
}

function pendingCalibrationValues() {
  return pendingItemsMarkup(session?.data?.pending_items);
}

function screwsRun() {
  genericFrame("screws_tilt", 1);
  panel.innerHTML = `<span class="kicker">${msg("ui.measurement")}</span><h2>${msg("ui.measure_screw_positions")}</h2><p>${msg("ui.klipper_probes_the_configured_screw_positions_and_calculates_the_adjustments")}</p><div class="actions">${button("run", msg("actions.start_screws_tilt"))}</div>`;
  bind("run", async () => { await calibrationAction("calculate"); screwsResult(); });
}

function screwsResult() {
  genericFrame("screws_tilt", 2);
  const result = session.data.result || {}; const entries = Object.entries(result.results || {});
  const positions = session.data.positions || [];
  const positioned = positions.filter(point => Object.hasOwn(result.results || {}, point.id));
  const unmatched = entries.filter(([id]) => !positioned.some(point => point.id === id));
  const rows = unmatched.map(([name, item]) => `<div class="metric"><span>${esc(name)}</span>${adjustment(item)}</div>`).join("");
  const layout = positionMap(positioned, result.results) + (rows ? `<div class="result-grid">${rows}</div>` : "");
  panel.innerHTML = `<span class="kicker">${msg("ui.result")}</span><h2>${msg("ui.adjust_screws")}</h2>${layout || `<p>${msg("ui.klipper_reports_no_screw_results")}</p>`}<p>${msg("ui.adjust_the_screws_while_the_printer_is_stationary_then_repeat")}</p><div class="actions">${button("again", msg("ui.measure_again"))} ${button("done", msg("actions.done"), "secondary")}</div>`;
  bind("again", screwsRun); bind("done", dashboard);
}

function probeRun() {
  genericFrame("probe_offset", 1);
  panel.innerHTML = `<span class="kicker">${msg("ui.probe")}</span><h2>${msg("ui.start_manual_z_calibration")}</h2><p>${msg("ui.klipper_positions_the_nozzle_and_starts")} <code>${msg("ui.probe_calibrate")}</code>${msg("ui.then_place_a_normal_sheet_of_paper_under_the_clean")}</p><div class="actions">${button("begin", msg("actions.start_probe"))}</div>`;
  bind("begin", async () => { await calibrationAction("begin"); probeAdjust(); });
}

function probeAdjust() {
  genericFrame("probe_offset", 2);
  const controls = [-1,-.5,-.1,-.05,-.01,.01,.05,.1,.5,1].map((value) => `<button class="button secondary testz" data-z="${value}">${msg("ui.valuevalue_mm", {value1: value > 0 ? "+" : "", value2: value})}</button>`).join("");
  panel.innerHTML = `<span class="kicker">${msg("ui.paper_test")}</span><h2>${msg("ui.lower_nozzle_step_by_step")}</h2><p>${msg("ui.move_z_until_the_paper_slides_with_light_resistance_negative")}</p><div class="jog-grid">${controls}</div><div class="actions">${button("accept", msg("ui.accept_position"))} ${button("abort", msg("actions.cancel"), "danger ghost")}</div>`;
  document.querySelectorAll(".testz").forEach((control) => control.addEventListener("click", async () => { control.disabled=true; try { await calibrationAction("testz", {amount:Number(control.dataset.z)}); } catch(error) { showError(error); } finally { control.disabled=false; } }));
  bind("accept", async () => { await calibrationAction("accept"); saveKlipperPage(msg("ui.probe_z_offset"), msg("ui.the_offset_is_applied_but_has_not_been_saved_permanently"), pendingCalibrationValues()); });
  bind("abort", async () => { await calibrationAction("abort"); dashboard(); });
}

function pidSetup() {
  genericFrame("pid", 0);
  const heaters = wizards.find(item=>item.id==="pid")?.configuration?.heaters || ["extruder"];
  const heaterName = value => value === "heater_bed" ? t("ui.heated_bed") : value === "extruder" ? "Hotend" : value.startsWith("extruder") ? t("ui.hotend_value", {value0: value}) : value.replace("heater_generic ", "");
  panel.innerHTML = `<span class="kicker">${msg("ui.choose_heater")}</span><h1>${msg("ui.calibrate_pid")}</h1><p class="lead">${msg("ui.choose_the_heater_and_a_typical_printing_temperature_after_the")}</p>
    <label for="heater">${msg("ui.heater")}</label><select id="heater">${heaters.map(value=>`<option value="${esc(value)}" ${value === "heater_bed" ? 'data-i18n="ui.heated_bed"' : ""}>${esc(heaterName(value))}</option>`).join("")}</select>
    <label for="pid-target">${msg("ui.target_temperature_5_c_increments")}</label><div class="input-row"><input id="pid-target" type="number" value="220" min="150" max="300" step="5"><span class="unit">${msg("ui.c")}</span></div><div class="actions">${button("pid-start", msg("ui.start_pid_tuning"))}</div>`;
  const updatePidRange = (value) => { const hotend=value.startsWith("extruder"); const input=document.querySelector("#pid-target"); input.value=hotend?220:60; input.min=hotend?150:30; input.max=hotend?300:130; };
  document.querySelector("#heater").addEventListener("change", (event) => updatePidRange(event.target.value));
  updatePidRange(document.querySelector("#heater").value);
  bind("pid-start", async () => { const heater=document.querySelector("#heater").value; const target=Number(document.querySelector("#pid-target").value); await startCalibration("pid", {heater,target}); pidReadyPage(); });
}

function pidReadyPage() {
  genericFrame("pid",1);
  panel.innerHTML=`<span class="kicker">${msg("ui.heating_cycles")}</span><h2>${msg("ui.pid_tuning_ready")}</h2>${pidSelectionSummary()}<p>${msg("ui.high_temperatures_are_reached_during_measurement_after_the_initial_heat")}</p><div class="actions">${button("run",msg("ui.run_measurement"))}</div>`;
  bind("run",async()=>{document.querySelector("#run").innerHTML=`<span class="spinner"></span>${msg("ui.pid_tuning_running")}`; await calibrationAction("run"); saveKlipperPage(msg("ui.pid_values"), msg("ui.klipper_has_calculated_new_pid_values_review_the_result_then"), pidSelectionSummary() + pendingCalibrationValues());});
}

function pidSelectionSummary() {
  const selected = session?.data?.heater || "extruder";
  const heater = selected === "heater_bed" ? msg("ui.heated_bed") : selected === "extruder" ? "Hotend" : selected;
  const target = Number(session?.data?.target);
  return `<div class="result-grid"><div class="metric"><span>${msg("ui.selected_heater")}</span><strong>${heater}</strong></div><div class="metric"><span>${msg("ui.selected_target_temperature")}</span><strong>${msg("ui.value_c_2", {value1: Number.isFinite(target) ? target.toFixed(0) : "—"})}</strong></div></div>`;
}

function pressureSetup() {
  genericFrame("pressure_advance",0);
  panel.innerHTML=`<span class="kicker">${msg("ui.test_tower")}</span><h1>${msg("ui.pressure_advance")}</h1><p class="lead">${msg("ui.the_klipper_test_tower_changes_pressure_advance_with_height_select")}</p><label for="drive">${msg("ui.extruder_type")}</label><select id="drive"><option value="direct">${msg("ui.direct_drive_factor_0_005")}</option><option value="bowden">${msg("ui.bowden_factor_0_020")}</option></select><div class="actions">${button("pa-start",msg("ui.prepare"))}</div>`;
  bind("pa-start",async()=>{await startCalibration("pressure_advance",{drive:document.querySelector("#drive").value}); pressurePrint();});
}

function pressurePrint() {
  genericFrame("pressure_advance",1);
  panel.innerHTML=`<span class="kicker">${msg("ui.slicer_print")}</span><h2>${msg("ui.print_test_tower")}</h2><p>${msg("ui.download_the")} <a href="${session.data.model_url}" target="_blank" rel="noopener">${msg("ui.official_klipper_test_model")}</a>${msg("ui.slice_it_with_a_0_4_mm_nozzle_0_2")}</p><div class="actions">${button("prepare",msg("ui.enable_tuning_tower"))}</div>`;
  bind("prepare",async()=>{await calibrationAction("prepare"); pressureMeasure();});
}

function pressureMeasure() {
  genericFrame("pressure_advance",2);
  panel.innerHTML=`<span class="kicker">${msg("ui.evaluation")}</span><h2>${msg("ui.measure_best_height")}</h2><p>${msg("ui.measure_from_the_base_to_the_height_where_the_corners")}</p><label for="pa-height">${msg("ui.height")}</label><div class="input-row"><input id="pa-height" type="number" min="0" max="100" step="0.1"><span class="unit">mm</span></div><div class="actions">${button("calculate",msg("ui.calculate"))}</div>`;
  bind("calculate",async()=>{await calibrationAction("calculate",{height:Number(document.querySelector("#pa-height").value)}); pressureResult();});
}

function pressureResult() {
  genericFrame("pressure_advance",2); const value=session.data.value;
  panel.innerHTML=`<span class="kicker">${msg("ui.result")}</span><h2>${msg("ui.pressure_advance_value", {value0: value.toFixed(4)})}</h2><p>${msg("ui.the_value_is_initially_applied_only_at_runtime_your_next")}</p><div class="actions">${button("apply",msg("ui.apply_temporarily"))}</div>`;
  bind("apply",async()=>{await calibrationAction("apply"); saveLocalPage(msg("ui.pressure_advance"),msg("ui.new_value_value", {value0: value.toFixed(6)}));});
}

function flowSetup() {
  genericFrame("flow",0);
  panel.innerHTML=`<span class="kicker">${msg("ui.slicer_calibration")}</span><h1>${msg("ui.flow_extrusion_multiplier")}</h1><p class="lead">${msg("ui.print_the_provided_test_model_with_one_wall_and_no")}</p>
    <section class="model-download" aria-labelledby="flow-model-title">
      <div><span class="model-icon" aria-hidden="true">${msg("ui.stl")}</span></div>
      <div><h3 id="flow-model-title">${msg("ui.flow_test_model_30_30_20_mm")}</h3><p>${msg("ui.suitable_for_any_slicer_the_following_slicer_settings_turn_the")}</p></div>
      <a class="button secondary download-button" href="assets/models/flow-calibration-cube-30x30x20.stl" download="flow-calibration-cube-30x30x20.stl">${msg("ui.download_stl")}</a>
    </section>
    <div class="slicer-settings"><h3>${msg("ui.slicer_settings")}</h3><ul><li>${msg("ui.walls_perimeters_2")} <strong>1</strong></li><li>${msg("ui.top_layers_2")} <strong>0</strong></li><li>${msg("ui.infill")} <strong>0 %</strong></li><li>${msg("ui.bottom_layers_2")} <strong>3</strong></li><li>${msg("ui.line_width_2")} <strong>${msg("ui.0_40_mm")}</strong> ${msg("ui.with_a_0_4_mm_nozzle_2")}</li><li>${msg("ui.spiral_vase_mode_2")} <strong>${msg("ui.disabled")}</strong></li></ul></div>
    <p class="measurement-hint">${msg("ui.measure_each_side_wall_in_the_center_well_away_from")}</p>
    <div class="detail-grid"><div><label>${msg("ui.target_thickness")}</label><input id="flow-expected" type="number" value="0.4" min="0.1" step="0.01"></div><div><label>${msg("ui.current_flow")}</label><input id="flow-current" type="number" value="100" min="70" max="130" step="0.1"></div>${[1,2,3,4].map(n=>`<div><label>${msg("ui.measurement_value", {value0: n})}</label><input class="flow-measure" type="number" min="0.1" step="0.01"></div>`).join("")}</div><div class="actions">${button("flow-calc",msg("ui.calculate_extrusion_multiplier"))}</div>`;
  bind("flow-calc",async()=>{await startCalibration("flow"); await calibrationAction("calculate",{expected:Number(document.querySelector("#flow-expected").value),current:Number(document.querySelector("#flow-current").value),measurements:[...document.querySelectorAll(".flow-measure")].map(i=>Number(i.value))}); flowResultPage();});
}

function flowResultPage() {
  genericFrame("flow",2);
  panel.innerHTML=`<span class="kicker">${msg("ui.result")}</span><h2>${msg("ui.value_flow", {value0: session.data.result.toFixed(1)})}</h2><p>${msg("ui.average_measured_wall_thickness_value_mm_apply_the_new_value", {value1: session.data.average.toFixed(3)})}</p><div class="actions">${button("done",msg("actions.done"))}</div>`;
  bind("done",dashboard);
}

function shaperSetup() {
  genericFrame("input_shaper",0);
  panel.innerHTML=`<span class="kicker">${msg("ui.accelerometer")}</span><h1>${msg("ui.input_shaper")}</h1><p class="lead">${msg("ui.the_sensor_is_queried_first_klipper_then_creates_strong_rapid")}</p><p class="safety-note">${msg("ui.check_sensor_mounting_cable_routing_and_a_clear_build_volume")}</p><label for="shaper-axis">${msg("ui.axes")}</label><select id="shaper-axis"><option value="both">${msg("ui.x_and_y")}</option><option value="x">${msg("ui.x_only")}</option><option value="y">${msg("ui.y_only")}</option></select><div class="actions">${button("sensor-check",msg("ui.check_sensor"))}</div>`;
  bind("sensor-check",async()=>{await startCalibration("input_shaper",{axis:document.querySelector("#shaper-axis").value}); await calibrationAction("check"); shaperHome();});
}

function shaperHome() {
  genericFrame("input_shaper",1); panel.innerHTML=`<span class="kicker">${msg("ui.motion")}</span><h2>${msg("ui.home_axes_2")}</h2><p>${msg("ui.clear_the_build_volume_g28_will_then_run")}</p><div class="actions">${button("home",msg("ui.home_axes"))}</div>`;
  bind("home",async()=>{await calibrationAction("home"); shaperRun();});
}

function shaperRun() {
  genericFrame("input_shaper",2); panel.innerHTML=`<span class="kicker">${msg("ui.strong_vibrations")}</span><h2>${msg("ui.start_resonance_measurement")}</h2><p>${msg("ui.the_printer_moves_quickly_and_loudly_stop_it_immediately_if")}</p><label><input id="vibration-confirm" type="checkbox" style="width:auto"> ${msg("ui.the_sensor_and_cable_are_securely_attached_and_the_build")}</label><div class="actions">${button("run",msg("actions.start_shaper"))}</div>`;
  bind("run",async()=>{if(!document.querySelector("#vibration-confirm").checked)throw new LocalizedError("ui.confirm_the_safe_preparation_first"); document.querySelector("#run").innerHTML=`<span class="spinner"></span>${msg("ui.measurement_running_2")}`; await calibrationAction("run"); saveKlipperPage(msg("ui.input_shaper"), msg("ui.klipper_has_calculated_suitable_shapers_save_config_saves_them_permanently"), pendingCalibrationValues());});
}

function saveKlipperPage(title, copy, selection = "") {
  genericFrame(activeWizard,3); panel.innerHTML=`<span class="kicker">${msg("ui.permanent_change")}</span><h2>${msg("ui.value_save", {value0: rich(title)})}</h2><p>${copy}</p>${selection}<label><input id="confirm-save" type="checkbox" style="width:auto"> ${msg("ui.i_want_to_save_the_results_of_this_calibration_with")}</label><div class="actions">${button("save-config",msg("ui.run_save_config"))}</div>`;
  bind("save-config",async()=>{if(!document.querySelector("#confirm-save").checked)throw new LocalizedError("ui.confirm_the_permanent_change_first"); await calibrationAction("save",{},session.save_token); completePage(title, true);});
}

function saveLocalPage(title, copy) {
  genericFrame(activeWizard,3); panel.innerHTML=`<span class="kicker">${msg("ui.permanent_change")}</span><h2>${msg("ui.value_save", {value0: rich(title)})}</h2><p>${copy}</p><label><input id="confirm-save" type="checkbox" style="width:auto"> ${msg("ui.change_the_configuration_file_with_a_backup")}</label><div class="actions">${button("save-config",msg("ui.save_to_configuration"))}</div>`;
  bind("save-config",async()=>{if(!document.querySelector("#confirm-save").checked)throw new LocalizedError("ui.confirm_the_change_first"); await calibrationAction("save",{},session.save_token); completePage(title, true);});
}

function completePage(title, saved = false) { panel.innerHTML=`<span class="kicker">${msg("ui.complete")}</span><h2>${title} ${saved ? msg("ui.saved_lower") : msg("ui.completed_lower")}</h2><p>${saved ? msg("ui.the_calibration_values_were_saved_permanently") : msg("ui.calibration_is_complete_no_configuration_change_was_required")}</p><div class="actions">${button("dashboard",msg("navigation.overview"))}</div>`; bind("dashboard",dashboard); }

function heat() {
  setProgress(1);
  const minimum = Math.ceil(Math.max(printer?.min_extrude_temp || 170, 150) / 5) * 5;
  const suggested = Math.max(200, minimum);
  panel.innerHTML = `<span class="kicker">${msg("ui.step_2")}</span><h2>${msg("ui.heat_the_extruder")}</h2>
    <p>${msg("ui.choose_a_temperature_suitable_for_the_loaded_filament_continue_only")}</p>
    <label for="heat-input">${msg("ui.target_temperature_5_c_increments")}</label><div class="input-row"><input id="heat-input" type="number" min="${minimum}" max="300" value="${suggested}" step="5"><span class="unit">${msg("ui.c")}</span></div>
    <div class="actions">${button("heat", msg("ui.heat_extruder"))} ${button("heat-next", msg("ui.continue"), "secondary")}</div>`;
  bind("heat", async () => {
    const temperature = Number(document.querySelector("#heat-input").value);
    if (!Number.isFinite(temperature) || temperature % 5 !== 0) throw new LocalizedError("ui.choose_a_temperature_in_5_c_increments");
    await api("wizards/extruder/heat", { temperature }); setText(document.querySelector("#heat"), () => t("ui.heating"));
  });
  bind("heat-next", async () => { await api("wizards/extruder/ready"); mark(); });
}

function mark() {
  setProgress(2);
  panel.innerHTML = `<span class="kicker">${msg("ui.step_3")}</span><h2>${msg("ui.mark_the_filament")}</h2>
    <p>${msg("ui.load_filament_choose_an_unambiguous_fixed_reference_point_at_the")} <strong>${msg("ui.value_mm_2", {value0: session.mark_distance})}</strong> ${msg("ui.above_it")}</p>
    <div class="detail-grid"><div class="detail"><span>${msg("ui.mark_distance")}</span><strong>${msg("ui.value_mm_3", {value1: session.mark_distance})}</strong></div><div class="detail"><span>${msg("ui.next_extrusion")}</span><strong>${msg("ui.value_mm_4", {value2: session.commanded_extrusion})}</strong></div></div>
    <div class="actions">${button("marked", msg("ui.mark_is_ready"))}</div>`;
  bind("marked", extrusion);
}

function extrusion() {
  setProgress(3);
  panel.innerHTML = `<span class="kicker">${msg("ui.step_4_motion")}</span><h2>${msg("ui.extrude_value_mm", {distance: session.commanded_extrusion})}</h2>
    <p>${msg("ui.the_extruder_will_move_slowly_at_1_mm_s_klipper")}</p>
    <div class="actions">${button("extrude", msg("ui.extrude_value_mm", {distance: session.commanded_extrusion}))}</div>`;
  bind("extrude", async () => { document.querySelector("#extrude").innerHTML = `<span class="spinner"></span>${msg("ui.extruding")}`; await api("wizards/extruder/extrude"); measure(false); });
}

function measure(verification) {
  setProgress(verification ? 6 : 4);
  panel.innerHTML = `<span class="kicker">${verification ? msg("ui.verification") : msg("ui.step_5")}</span><h2>${msg("ui.measure_the_remainder")}</h2>
    <p>${msg("ui.measure_from_the_same_fixed_reference_point_to_the_filament")}</p>
    <label for="remaining">${msg("ui.remaining_distance")}</label><div class="input-row"><input id="remaining" inputmode="decimal" type="number" min="0" max="${session.mark_distance}" step="0.01" placeholder="20.00"><span class="unit">mm</span></div>
    <div class="actions">${button("calculate", verification ? msg("ui.check_result") : msg("ui.calculate"))}</div>`;
  bind("calculate", async () => {
    const value = Number(document.querySelector("#remaining").value);
    if (!Number.isFinite(value)) throw new LocalizedError("ui.enter_a_valid_remaining_distance");
    await api(verification ? "wizards/extruder/verify/measurement" : "wizards/extruder/measurement", { remaining_distance: value });
    result(verification);
  });
}

function result(verification = false) {
  setProgress(verification ? 7 : 5);
  const r = verification ? session.verification_result : session.result;
  const warnings = r.warnings.length ? `<ul class="warning-list">${r.warnings.map((w, index) => `<li>${r.warning_keys?.[index] ? msg(r.warning_keys[index]) : esc(w)}</li>`).join("")}</ul>` : "";
  panel.innerHTML = `<span class="kicker">${verification ? msg("ui.verification_result") : msg("ui.calculated_result")}</span><h2>${r.safe_to_apply ? msg("ui.measurement_looks_plausible") : msg("ui.please_check_the_measurement")}</h2>
    <div class="result-grid">
      <div class="metric"><span>${msg("ui.requested")}</span><strong>${msg("ui.value_mm_4", {value2: r.requested_extrusion.toFixed(2)})}</strong></div><div class="metric"><span>${msg("ui.actual")}</span><strong>${msg("ui.value_mm", {value3: r.actual_extrusion.toFixed(2)})}</strong></div>
      <div class="metric"><span>${msg("ui.deviation")}</span><strong>${msg("ui.value_mm_value", {value4: r.deviation_mm.toFixed(2), value5: r.deviation_percent.toFixed(2)})}</strong></div><div class="metric"><span>${verification ? msg("ui.tested_rotation_distance") : msg("ui.new_rotation_distance")}</span><strong>${msg("ui.value_mm_5", {value7: r.new_rotation_distance.toFixed(5)})}</strong></div>
    </div>${warnings}
    <div class="actions">${!verification && r.safe_to_apply ? button("apply", msg("ui.apply_temporarily")) : ""} ${!verification ? button("again", msg("ui.measure_again"), "secondary") : button("save-view", msg("ui.continue_to_save"), "secondary")}</div>`;
  bind("apply", async () => { await api("wizards/extruder/apply"); verify(); });
  bind("again", async () => { await api("wizards/extruder/measure-again"); mark(); });
  bind("save-view", saveView);
}

function verify() {
  setProgress(6);
  panel.innerHTML = `<span class="kicker">${msg("ui.step_7_optional")}</span><h2>${msg("ui.verify_the_new_value")}</h2><p>${msg("ui.the_new_rotation_distance_is_active_until_klipper_restarts_you")}</p>
    <div class="actions">${button("verify", msg("ui.extrude_value_mm_again", {distance: session.commanded_extrusion}))} ${button("skip", msg("ui.skip_verification"), "secondary")}</div>`;
  bind("verify", async () => { await api("wizards/extruder/verify/extrude"); measure(true); });
  bind("skip", saveView);
}

function saveView() {
  setProgress(7);
  const canSave = Boolean(session.save_token && session.config_source);
  panel.innerHTML = `<span class="kicker">${msg("ui.step_8_permanent_change")}</span><h2>${msg("ui.save_configuration")}</h2>
    <p>${msg("ui.a_timestamped_backup_is_created_first_only_the_exact")} <code>rotation_distance</code> ${msg("ui.setting_in_its_source_include_file_is_changed")}</p>
    <div class="result-grid"><div class="metric"><span>${msg("ui.old_value")}</span><strong>${session.old_rotation_distance.toFixed(8)}</strong></div><div class="metric"><span>${msg("ui.new_value")}</span><strong>${session.result.new_rotation_distance.toFixed(8)}</strong></div></div>
    <p>${canSave ? `${msg("ui.source_2")} <code>${session.config_source}</code>` : msg("ui.permanent_writes_are_unavailable_because_the_source_setting_could_not")}</p>
    <label><input id="confirm" type="checkbox" style="width:auto"> ${msg("ui.i_confirm_these_old_and_new_values_and_want_to")}</label>
    <div class="actions">${button("save", msg("ui.save_configuration"), canSave ? "" : "secondary")}</div>`;
  document.querySelector("#save").disabled = !canSave;
  bind("save", async () => {
    if (!document.querySelector("#confirm").checked) throw new LocalizedError("ui.confirm_the_permanent_configuration_change_first");
    const response = await api("wizards/extruder/save", { confirmation_token: session.save_token, old_rotation_distance: session.old_rotation_distance, new_rotation_distance: session.result.new_rotation_distance });
    panel.innerHTML = `<span class="kicker">${msg("ui.complete")}</span><h2>${msg("ui.calibration_saved")}</h2><p>${response.message_key ? msg(response.message_key, response.message_params) : esc(response.message)}</p><p>${msg("ui.the_runtime_value_is_already_active_the_backup_can_be")}</p>`;
  });
}

document.querySelector("#cancel").addEventListener("click", async () => {
  try {
    if (session && activeWizard === "extruder") await api("wizards/extruder/cancel");
    else if (session && activeWizard) await calibrationAction("cancel");
    session = null; dashboard();
  } catch (error) { showError(error); }
});

function resumedRunningPage(id, title = msg("ui.calibration_running")) {
  if (id === "extruder") {
    setSteps(msg("welcomeTitle"), t("steps").map(key => msg(key)));
    setProgress(session.state === "VERIFYING" ? 6 : 3);
  } else {
    const steps = {pid:1, bed_mesh:2, screws_tilt:1, z_tilt:2, quad_gantry_level:2, input_shaper:2};
    genericFrame(id, session.state === "HOMING" ? 1 : (steps[id] ?? 1));
  }
  const selection = id === "pid" ? pidSelectionSummary() : "";
  panel.innerHTML=`<span class="kicker">${msg("ui.calibration_in_progress")}</span><h2>${title}</h2>${selection}<p>${msg("ui.the_printer_continues_the_active_step_this_view_will_advance")}</p><div class="running-state"><span class="spinner"></span><strong>${msg("ui.please_wait")}</strong></div>`;
}

function resumedErrorPage(id) {
  if (id === "extruder") { setSteps(msg("welcomeTitle"), t("steps").map(key => msg(key))); setProgress(0); }
  else genericFrame(id, 0);
  panel.innerHTML=`<span class="kicker">${msg("ui.calibration_interrupted")}</span><h2>${msg("ui.the_workflow_cannot_continue")}</h2><p>${session.error_key ? msg(session.error_key, session.error_params) : session.error ? esc(session.error) : msg("ui.klipper_reported_an_error_during_calibration")}</p><div class="actions">${button("dashboard",msg("navigation.overview"))}</div>`;
  bind("dashboard",dashboard);
}

function renderResumedExtruder() {
  switch (session.state) {
    case "IDLE": heat(); break;
    case "HEATING": heat(); break;
    case "READY": mark(); break;
    case "RUNNING": resumedRunningPage("extruder", msg("ui.extrusion_running")); break;
    case "WAITING_FOR_MEASUREMENT": measure(false); break;
    case "CALCULATED": result(false); break;
    case "APPLIED": verify(); break;
    case "VERIFYING": resumedRunningPage("extruder", msg("ui.verification_extrusion_running")); break;
    case "COMPLETE":
      if (session.verification_result && session.save_token) result(true);
      else { setSteps(msg("welcomeTitle"), t("steps").map(key => msg(key))); setProgress(7); completePage(msg("ui.extruder_calibration_2"), true); }
      break;
    case "ERROR": resumedErrorPage("extruder"); break;
    default: dashboard();
  }
}

function renderResumedGeneric(id) {
  const state = session.state;
  if (state === "ERROR") return resumedErrorPage(id);
  if (state === "HOMING") return resumedRunningPage(id, msg("ui.homing_in_progress"));
  if (state === "RUNNING") return resumedRunningPage(id);
  if (id === "xyz") return xyzPage();
  if (state === "COMPLETE") {
    if (id === "flow" && Number.isFinite(session.data?.result)) return flowResultPage();
    const saved = new Set(["pid", "bed_mesh", "probe_offset", "input_shaper", "pressure_advance"]).has(id);
    genericFrame(id, (genericSteps[id]?.length || 1) - 1); return completePage(msg(`wizards.${id}.name`), saved);
  }
  if (id === "pid") {
    if (state === "READY") return pidReadyPage();
    if (state === "REVIEW") return saveKlipperPage(msg("ui.pid_values"), msg("ui.klipper_has_calculated_new_pid_values_review_the_result_then"), pidSelectionSummary() + pendingCalibrationValues());
  }
  if (id === "bed_mesh") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return bedMeshRun();
    if (state === "REVIEW") return saveKlipperPage(msg("ui.bed_mesh"), msg("ui.the_new_mesh_is_calculated_save_config_saves_it_permanently"), bedMeshSummary() + pendingCalibrationValues());
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
    if (state === "REVIEW") return saveKlipperPage(msg("ui.probe_z_offset"), msg("ui.the_offset_is_applied_but_has_not_been_saved_permanently"), pendingCalibrationValues());
  }
  if (id === "z_tilt" || id === "quad_gantry_level") {
    if (state === "READY") return homingPage(id);
    if (state === "HOMED") return gantryRun(id);
  }
  if (id === "pressure_advance") {
    if (state === "READY") return pressurePrint();
    if (state === "PRINT_TOWER") return pressureMeasure();
    if (state === "CALCULATED") return pressureResult();
    if (state === "APPLIED") return saveLocalPage(msg("ui.pressure_advance"),msg("ui.new_value_value", {value0: session.data.value.toFixed(6)}));
  }
  if (id === "input_shaper") {
    if (state === "READY") return shaperSetup();
    if (state === "CHECKING") return resumedRunningPage(id, msg("ui.checking_accelerometer"));
    if (state === "SENSOR_READY") return shaperHome();
    if (state === "HOMED") return shaperRun();
    if (state === "REVIEW") return saveKlipperPage(msg("ui.input_shaper"), msg("ui.klipper_has_calculated_suitable_shapers_save_config_saves_them_permanently"), pendingCalibrationValues());
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

function updateConnectionStatus() {
  let tone = "offline";
  let key = "ui.printer_offline";
  if (printer?.connected) {
    if (printer.state === "ready") {
      if (printer.print_state === "printing") {
        tone = "busy";
        key = "printer.status.printing";
      } else if (printer.print_state === "paused") {
        tone = "busy";
        key = "printer.print.paused";
      } else {
        tone = "online";
        key = "printer.state.ready";
      }
    } else {
      tone = printer.state === "startup" ? "busy" : "offline";
      key = ["startup", "shutdown", "error"].includes(printer.state) ? `printer.state.${printer.state}` : "printer.state.unknown";
    }
  }
  connection.className = `connection ${tone}`;
  setText(document.querySelector("#connection"), () => t(key));
}

function updateStatus(data) {
  const previousReadiness = printerReadinessKey();
  const previousSessionState = session?.state;
  printer = data.printer;
  updateNavigationAvailability();
  if (activeWizard === "extruder" && data.session) session = data.session;
  if (activeWizard && activeWizard !== "extruder" && data.calibrations?.[activeWizard]) session = data.calibrations[activeWizard];
  updateCalibrationStatusStrip();
  updateConnectionStatus();
  if (!bootstrapping && pendingResolution() && continueAfterPendingResolution()) return;
  if (!bootstrapping && previousReadiness !== printerReadinessKey()) {
    if (isOverview) dashboard();
    else if (isConfigurationOverview) configurationOverview();
  }
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
    setText(document.querySelector("#connection"), () => t("ui.reconnecting"));
    if (printer) printer = {...printer, connected:false, state:"disconnected", state_message:""};
    updateNavigationAvailability();
    if (!bootstrapping && isOverview) dashboard();
    else if (!bootstrapping && isConfigurationOverview) configurationOverview();
    setTimeout(connect, 2000);
  };
}

Promise.all([
  fetch(new URL("status", base)).then((r) => r.json()),
  fetch(new URL("wizards", base)).then((r) => r.json()),
]).then(async ([status, availableWizards]) => {
  const versionLabel = document.querySelector("#app-version");
  if (status.version) {
    versionLabel.textContent = `v${status.version}`;
    versionLabel.hidden = false;
  }
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
}).catch((error) => { bootstrapping=false; dashboard(); showError(error); });
connect();
