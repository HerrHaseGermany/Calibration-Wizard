// The application references stable keys; all copy lives in locales/*.json.
const catalogs = {};
const storage = globalThis.localStorage;
let locale = storage?.getItem("kcw-language") || (globalThis.navigator?.language?.toLowerCase().startsWith("de") ? "de" : "en");
if (!["de", "en"].includes(locale)) locale = "en";
const bindings = new Map();
const escapeAttribute = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[char]);

export async function loadLocales(loader = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load locale: ${response.status}`);
  return response.json();
}) {
  const entries = await Promise.all(["de", "en"].map(async language => [language, await loader(new URL(`./locales/${language}.json?v=20261010-8`, import.meta.url))]));
  Object.assign(catalogs, Object.fromEntries(entries));
}

export const getLocale = () => locale;
export function setLocale(value) {
  locale = ["de", "en"].includes(value) ? value : "en";
  storage?.setItem("kcw-language", locale);
  if (globalThis.document) document.documentElement.lang = locale;
}

export function t(key, params = {}) {
  const value = catalogs[locale]?.[key] ?? catalogs.en?.[key] ?? key;
  if (Array.isArray(value)) return value;
  return String(value).replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    const parameter = params[name];
    return parameter?.message_key ? t(parameter.message_key, parameter.message_params) : String(parameter);
  });
}

// Explicitly keyed HTML slots can change language without rebuilding forms or dialogs.
// Dynamic values are escaped; rich() marks trusted, internally generated markup.
export function msg(key, params = {}) {
  return `<span data-i18n="${escapeAttribute(key)}" data-i18n-params="${escapeAttribute(JSON.stringify(params))}">${htmlMessage(key, params)}</span>`;
}

export const rich = markup => ({html: markup});

function htmlMessage(key, params) {
  const safe = Object.fromEntries(Object.entries(params).map(([name, value]) => [name,
    value?.html !== undefined ? value.html : escapeAttribute(value?.message_key ? t(value.message_key, value.message_params) : value),
  ]));
  return t(key, safe);
}

export function setText(element, render) {
  if (!element) return;
  bindValue(element, "textContent", render);
}

export function setTranslatedAttribute(element, attribute, render) {
  if (!element) return;
  bindValue(element, attribute, render);
}

function bindValue(element, attribute, render) {
  let values = bindings.get(element);
  if (!values) { values = new Map(); bindings.set(element, values); }
  values.set(attribute, render);
  if (attribute === "textContent") element.textContent = render();
  else element.setAttribute(attribute, render());
}

export function applyTranslations(root = document) {
  renderSlots(root);
  for (const attribute of ["aria-label", "title", "placeholder"]) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
  for (const [element, values] of bindings) {
    if (!element.isConnected) { bindings.delete(element); continue; }
    for (const [attribute, render] of values) {
      if (attribute === "textContent") element.textContent = render();
      else element.setAttribute(attribute, render());
    }
  }
}

function renderSlots(root) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    if (!root.contains(element) || !element.parentElement) continue;
    const owner = element.parentElement.closest("[data-i18n]");
    if (owner && owner !== root && root.contains(owner)) continue;
    element.innerHTML = htmlMessage(element.dataset.i18n, JSON.parse(element.dataset.i18nParams || "{}"));
    renderSlots(element);
  }
}

export class LocalizedError extends Error {
  constructor(key, params = {}, detail = "") {
    super();
    this.key = key;
    this.params = params;
    this.detail = detail;
  }
  get message() { return this.key ? t(this.key, this.params) : this.detail; }
}

export function apiError(payload) {
  return new LocalizedError(payload.message_key || (typeof payload.detail === "string" ? "" : "errors.invalid_input"), payload.message_params || {}, payload.detail || t("errors.request_failed"));
}
