const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);

// Schematic top view: increasing X goes right, increasing Y goes toward the rear.
export function positionGrid(points) {
  const valid = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  const xs = [...new Set(valid.map(point => point.x))].sort((a, b) => a - b);
  const ys = [...new Set(valid.map(point => point.y))].sort((a, b) => b - a);
  return {columns: xs.length, rows: ys.length, points: valid.map(point => ({
    ...point, column: xs.indexOf(point.x) + 1, row: ys.indexOf(point.y) + 1,
  }))};
}

export function adjustment(item = {}) {
  if (item.is_base) return '<strong>Referenz</strong>';
  const sign = String(item.sign || "").toUpperCase();
  const arrow = sign === "CW" ? "↻" : sign === "CCW" ? "↺" : "";
  const label = sign === "CW" ? "Im Uhrzeigersinn" : "Gegen den Uhrzeigersinn";
  return `<strong class="screw-adjustment">${arrow ? `<span class="turn-arrow" role="img" aria-label="${label}">${arrow}</span>` : ""}${esc(sign)} ${esc(item.adjust || "—")}</strong>`;
}

export function positionMap(points, results = null) {
  const grid = positionGrid(points);
  if (!grid.points.length) return "";
  const cells = new Map();
  for (const point of grid.points) {
    const key = `${point.column}/${point.row}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  const cards = [...cells.values()].map(group => `<div class="position-cell" style="grid-column:${group[0].column};grid-row:${group[0].row}">${group.map(point => `<div class="metric position-card"><span data-no-i18n>${esc(point.name)}</span>${results ? adjustment(results[point.id]) : ""}<small>X ${esc(point.x)} · Y ${esc(point.y)}</small></div>`).join("")}</div>`).join("");
  return `<section class="position-view" aria-label="Positionen – Draufsicht"><div class="position-edge">Hinten · Y+</div><div class="position-scroll"><div class="position-map" style="grid-template-columns:repeat(${grid.columns},minmax(130px,1fr));grid-template-rows:repeat(${grid.rows},auto)">${cards}</div></div><div class="position-edge">Vorne · Y−</div><p class="position-caption">Draufsicht · links X− / rechts X+ · schematisch</p></section>`;
}
