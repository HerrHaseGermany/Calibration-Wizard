export function renderFilamentPage({panel, base, getPrinter, setNavigationLocked, button, showError, t, msg, setText, apiError, LocalizedError}) {
  const presets = [["PLA", 210], ["PETG", 240], ["ABS", 255], ["ASA", 260], ["TPU", 220]];
  const presetButtons = () => `<div class="filament-presets">${presets.map(([material, temperature]) => `<button class="button secondary" type="button" data-filament-preset="${temperature}" aria-pressed="${temperature === 210}">${msg("ui.value_value_c", {value2: material, value3: temperature})}</button>`).join("")}</div>`;
  const temperatureInput = (id) => `<label>${msg("ui.target_temperature_c")}<input id="${id}" type="number" min="${Math.max(150, getPrinter()?.min_extrude_temp || 170)}" max="300" step="5" value="210"></label>`;
  const bindPresets = (root, input) => {
    const update = () => root.querySelectorAll("[data-filament-preset]").forEach(control => control.setAttribute("aria-pressed", Number(control.dataset.filamentPreset) === Number(input.value)));
    root.querySelectorAll("[data-filament-preset]").forEach(control => control.addEventListener("click", () => { input.value = control.dataset.filamentPreset; update(); }));
    input.addEventListener("input", update);
  };
  panel.innerHTML = `<span class="kicker">${msg("tools.helpers")}</span>
    <h1>${msg("filament.title")}</h1>
    <div class="actions">${button("filament-load", msg("filament.load"))} ${button("filament-unload", msg("filament.unload"))} ${button("filament-change", msg("filament.change"))}</div>`;
  const request = async (action, payload) => {
    const response = await fetch(new URL(`tools/filament/${action}`, base), {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw apiError(data);
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
    dialog.innerHTML = `<h2 id="filament-dialog-title">${mode === "change" ? msg("filament.change") : mode === "load" ? msg("filament.load") : msg("filament.unload")}</h2>
      <p id="filament-process" role="status"></p>
      <div id="filament-selection">
        <div id="filament-current-material"><h3>${mode === "change" ? msg("ui.from") : mode === "load" ? msg("ui.filament_to_load") : msg("ui.filament_to_unload")}</h3>${presetButtons()}${temperatureInput("filament-current-temperature")}</div>
        <div id="filament-new-material" class="${mode === "change" ? "" : "hidden"}"><h3>${msg("ui.to")}</h3>${presetButtons()}${temperatureInput("filament-new-temperature")}</div>
      </div>
      <div id="filament-heating" class="hidden"><strong id="filament-live-temperature"></strong><progress id="filament-heat-progress" max="100" value="0"></progress></div>
      <div id="filament-moving" class="hidden"><strong id="filament-move-label"></strong><progress id="filament-move-progress" max="100" value="0" aria-labelledby="filament-move-label"></progress></div>
      <p id="filament-dialog-error" class="notice hidden" role="alert"></p>
      <p id="filament-hot-note" class="hidden">${msg("ui.done_switches_the_hotend_off")}</p>
      <div class="actions">${button("filament-confirm", msg("ui.heat_up"))} ${button("filament-keep-hot", msg("ui.finish_and_keep_hotend_on"), "secondary")} ${button("filament-close", msg("actions.cancel"), "secondary")}</div>`;
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
    setNavigationLocked(true);
    const showFailure = (error) => {
      stage = "error";
      confirm.disabled = true;
      close.disabled = false;
      keepHot.classList.add("hidden");
      setText(errorBox, () => error.message);
      errorBox.classList.remove("hidden");

    };
    const poll = async () => {
      if (disposed || !["heating", "ready"].includes(stage)) return;
      try {
        const response = await fetch(new URL("printer", base));
        if (!response.ok) throw new LocalizedError("ui.could_not_load_printer_status");
        const current = await response.json();
        if (disposed || !["heating", "ready"].includes(stage)) return;
        const usable = current.connected && current.state === "ready" && current.print_state !== "printing";
        const reached = usable && current.can_extrude && current.temperature >= current.min_extrude_temp && current.temperature >= temperature - 2 && Math.abs(current.target - temperature) < 0.1;
        stage = reached ? "ready" : "heating";
        confirm.disabled = !reached;
        setText(process, () => reached ? (direction === "load" ? t("ui.temperature_reached_insert_filament_and_confirm_loading") : t("ui.temperature_reached_confirm_unloading")) : t("ui.heating_hotend"));
        setText(dialog.querySelector("#filament-live-temperature"), () => t("ui.value_value_c_2", {value0: current.temperature.toFixed(1), value1: temperature}));
        dialog.querySelector("#filament-heat-progress").value = Math.min(100, Math.max(0, current.temperature / temperature * 100));
        if (!usable) throw new LocalizedError("ui.klipper_must_be_ready_for_a_filament_change");

        timer = setTimeout(poll, 1000);
      } catch (error) { if (!disposed) showFailure(error); }
    };
    const pollMovement = async () => {
      if (disposed || stage !== "running") return;
      try {
        const response = await fetch(new URL("tools/filament/progress", base));
        if (!response.ok) throw new LocalizedError("errors.progress_load");
        const current = await response.json();
        if (disposed || stage !== "running") return;
        if (current.operation_id === token) {
          moveProgress.value = current.percent;
          setText(moveLabel, () => `${current.percent} %`);
        }
      } catch {
        // Losing progress updates must not unlock controls while the printer is moving.
        setText(moveLabel, () => t("ui.waiting_for_movement_progress"));

      }
      if (!disposed && stage === "running") timer = setTimeout(pollMovement, 500);
    };
    const startHeating = async () => {
      stage = "heating";
      confirm.disabled = true;
      close.disabled = true;
      setText(confirm, () => t("ui.confirm_and_start"));
      setText(process, () => t("ui.heating_hotend"));
      heating.classList.remove("hidden");
      moving.classList.add("hidden");
      selection.classList.add("hidden");

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
      setNavigationLocked(false);
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
      setText(process, () => t("ui.moving_filament"));
      heating.classList.add("hidden");
      moving.classList.remove("hidden");
      moveProgress.value = 0;
      setText(moveLabel, () => "0 %");

      try {
        const movement = request(direction, {speed, confirmation_token: token});
        pollMovement();
        await movement;
        clearTimeout(timer);
        moveProgress.value = 100;
        setText(moveLabel, () => "100 %");
        heating.classList.add("hidden");
        if (mode === "change" && direction === "unload") {
          stage = "swap";
          setText(process, () => t("ui.insert_the_new_filament_and_confirm_the_new_temperature"));
          selection.classList.remove("hidden");
          currentMaterial.classList.add("hidden");
          setText(confirm, () => t("ui.heat_for_new_material"));
          confirm.disabled = false;
        } else {
          stage = "complete";
          setText(process, () => direction === "load" ? t("ui.filament_loaded") : t("ui.filament_unloaded"));
          confirm.classList.add("hidden");
          setText(close, () => t("actions.done"));
          close.classList.remove("secondary");
          keepHot.classList.remove("hidden");
          dialog.querySelector("#filament-hot-note").classList.remove("hidden");
        }
        close.disabled = false;

      } catch (error) { showFailure(error); }
    });

    dialog.showModal();
  };
  const bindTool = (id, handler) => document.querySelector(`#${id}`).addEventListener("click", async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try { await handler(); }
    catch (error) { showError(error); }
    finally { control.disabled = false; }
  });
  bindTool("filament-load", () => openFlow("load"));
  bindTool("filament-unload", () => openFlow("unload"));
  bindTool("filament-change", () => openFlow("change"));
}
