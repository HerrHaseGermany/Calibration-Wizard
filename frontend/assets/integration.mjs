export function mountIntegration({base, root, t, canRepair, apiError}) {
  let current = null;
  function render() {
    root.replaceChildren();
    root.classList.toggle("hidden", !current?.configured || current?.healthy);
    if (!current?.configured || current.healthy) return;
    const title = document.createElement("strong");
    const copy = document.createElement("p");
    title.textContent = t("integration.missing");
    const key = current.busy ? "integration.building" : !current.supported ? "integration.unsupported" : !current.can_repair ? "integration.setup" : "integration.description";
    copy.textContent = t(key);
    root.append(title, copy);
    if (current.error && current.job === "failed") {
      const detail = document.createElement("p");
      detail.textContent = current.error;
      root.append(detail);
    }
    if (current.can_repair) {
      const button = document.createElement("button");
      button.className = "button secondary";
      button.textContent = t("integration.repair");
      button.disabled = !canRepair();
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const response = await fetch(new URL("mainsail/repair", base), {method: "POST"});
          const result = await response.json();
          if (!response.ok) throw apiError(result);
          await refresh();
        } catch (error) {
          const detail = document.createElement("p");
          detail.textContent = error.message;
          root.append(detail);
          button.disabled = !canRepair();
        }
      });
      root.append(button);
      if (!canRepair()) {
        const note = document.createElement("p");
        note.textContent = t("integration.errors.busy");
        root.append(note);
      }
    }
  }
  async function refresh() {
    try {
      const response = await fetch(new URL("mainsail/integration", base), {cache: "no-store"});
      if (!response.ok) return;
      current = await response.json();
      render();
    } catch { /* Retry after a service restart. */ }
  }
  refresh();
  const timer = setInterval(refresh, 10000);
  window.addEventListener("pagehide", () => clearInterval(timer), {once: true});
  return {render, refresh};
}
