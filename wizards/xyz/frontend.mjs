export function renderXyzPage({panel, session, msg, button, bind, frame, start, action, home, render, setNavigationLocked, LocalizedError}) {
  const state = session?.state;
  const data = session?.data || {};
  const download = `<p>${msg("xyz.cube.info")} <a class="button secondary" href="assets/wizards/xyz/xyzCalibration_cube.stl" download>${msg("xyz.cube.download")}</a></p>`;
  const results = () => `<div class="result-grid">${(data.results || []).map(row => `<div class="metric"><span>${msg("xyz.result.axis", {axis: row.axis.toUpperCase(), count: row.count})}</span><p>${msg("xyz.result.series", {distance: row.requested, direction: row.direction === 1 ? "+" : "−"})}</p><strong>${msg("xyz.result.error", {mm: row.average_error.toFixed(3), percent: row.average_percent.toFixed(3)})}</strong><p>${msg("xyz.result.range", {mm: row.error_range.toFixed(3)})}</p></div>`).join("")}</div>`;
  const run = async (operation) => {
    setNavigationLocked(true);
    try { await operation(); render(); }
    finally { setNavigationLocked(false); }
  };
  if (!session) {
    frame(0);
    panel.innerHTML = `<span class="kicker">${msg("ui.guided_workflow")}</span><h1>${msg("wizards.xyz.name")}</h1><p class="lead">${msg("xyz.intro")}</p><p>${msg("xyz.hardware")}</p>${download}<div class="actions">${button("xyz-start", msg("ui.start_calibration"))}</div>`;
    bind("xyz-start", async () => { await start(); render(); });
  } else if (state === "READY") {
    frame(0);
    panel.innerHTML = `<h2>${msg("ui.home_all_axes")}</h2><p class="safety-note">${msg("xyz.home.info")}</p><div class="actions">${button("xyz-home", msg("ui.home_now"))}</div>`;
    bind("xyz-home", () => run(() => action("home")));
  } else if (state === "HOMED" || state === "REVIEW") {
    frame(state === "HOMED" ? 1 : 3);
    const axis = data.axis || "x";
    panel.innerHTML = `${state === "REVIEW" ? results() : ""}<h2>${msg("xyz.prepare.title")}</h2><p>${msg("xyz.prepare.info")}</p><p class="safety-note">${msg("xyz.clearance")}</p>
      <label>${msg("xyz.axis")}<select id="xyz-axis">${["x", "y", "z"].map(value => `<option value="${value}" ${value === axis ? "selected" : ""}>${value.toUpperCase()}</option>`).join("")}</select></label>
      <label>${msg("xyz.direction")}<select id="xyz-direction"><option value="1">+</option><option value="-1" ${data.direction === -1 ? "selected" : ""}>−</option></select></label>
      <label>${msg("xyz.distance")}<input id="xyz-distance" type="number" min="1" max="100" step="0.1" value="${data.distance || 10}"></label>
      <label>${msg("xyz.speed")}<input id="xyz-speed" type="number" min="0.1" max="${axis === "z" ? 2 : 10}" step="0.1" value="${data.speed || 2}"></label>
      <div class="actions">${state === "REVIEW" ? button("xyz-return", msg("xyz.return")) : ""}${button("xyz-prepare", msg("xyz.prepare.action"), state === "REVIEW" ? "secondary" : "")}${state === "REVIEW" ? button("xyz-finish", msg("xyz.finish"), "secondary") : ""}</div>`;
    const field = id => panel.querySelector(`#xyz-${id}`);
    field("axis").addEventListener("change", () => { const max = field("axis").value === "z" ? 2 : 10; field("speed").max = max; field("speed").value = Math.min(Number(field("speed").value), max); });
    bind("xyz-prepare", async () => { await action("prepare", {axis: field("axis").value, direction: Number(field("direction").value), distance: Number(field("distance").value), speed: Number(field("speed").value)}); render(); });
    if (state === "REVIEW") {
      bind("xyz-return", () => run(() => action("return")));
      bind("xyz-finish", async () => { await action("finish"); render(); });
      panel.querySelector("#xyz-finish").disabled = (data.results || []).some(row => row.count < 3);
    }
  } else if (state === "AT_START") {
    frame(2);
    panel.innerHTML = `<h2>${msg("xyz.move.title", {axis: data.axis.toUpperCase()})}</h2><p>${msg("xyz.move.info", {distance: data.distance, direction: data.direction === 1 ? "+" : "−", speed: data.speed})}</p><p>${msg("xyz.zero")}</p><p class="safety-note">${msg("xyz.move.safety")}</p><label><input id="xyz-confirm" type="checkbox" style="width:auto"> ${msg("xyz.confirm")}</label><div class="actions">${button("xyz-move", msg("xyz.move.action"))}</div>`;
    bind("xyz-move", async () => { if (!panel.querySelector("#xyz-confirm").checked) throw new LocalizedError("xyz.confirm"); await run(() => action("move")); });
  } else if (state === "WAITING_MEASUREMENT") {
    frame(2);
    panel.innerHTML = `<h2>${msg("xyz.measure.title", {axis: data.axis.toUpperCase()})}</h2><p>${msg("xyz.measure.info", {distance: data.distance})}</p><label>${msg("xyz.actual")}<input id="xyz-actual" type="number" min="0.001" max="200" step="0.001"></label><div class="actions">${button("xyz-measure", msg("xyz.measure.action"))}</div>`;
    bind("xyz-measure", async () => { const value = panel.querySelector("#xyz-actual").value; if (!value) throw new LocalizedError("xyz.errors.measurement"); await action("measure", {actual: Number(value)}); render(); });
  } else if (state === "COMPLETE") {
    frame(3);
    panel.innerHTML = `<h2>${msg("xyz.result.title")}</h2>${results()}<p>${msg("xyz.result.explanation")}</p><p>${msg("xyz.hardware")}</p>${download}<div class="actions">${button("xyz-done", msg("navigation.overview"))}</div>`;
    bind("xyz-done", home);
  }
}
