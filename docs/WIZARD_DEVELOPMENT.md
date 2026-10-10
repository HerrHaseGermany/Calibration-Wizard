# Wizard development

A wizard is an independent domain workflow, not a set of frontend-only pages.

1. Add `wizards/<id>/manifest.json` with stable ID, translated display keys, requirements, defaults, and states.
2. Implement a backend controller with an explicit state enum and a transition allow-list.
3. Put calculations and validation in pure functions. Reject non-finite, out-of-range, and implausible values server-side.
4. Express hardware operations through `PrinterAdapter`; never import a concrete Moonraker client into domain logic.
5. Re-query safety-critical printer state immediately before every heater or motion command.
6. Add API handlers that only translate requests to controller transitions.
7. Add matching stable keys and named placeholders to `frontend/assets/locales/de.json` and `en.json`; keep the view non-authoritative.
8. Test every calculation boundary, invalid transition, disconnect, shutdown, and persistence failure.

Permanent changes require a preview, explicit confirmation, an old-value compare-and-swap check, a backup, and atomic output. A new wizard must not use blind string replacement or rely on `SAVE_CONFIG` unless the exact Klipper calibration command is documented to populate the pending save set.


## Localization

Use `t("filament.change")` for plain text and `msg("filament.change")` inside HTML templates. `msg` creates an explicit keyed slot; language changes update these slots without rebuilding forms or dialogs. Its parameters are escaped automatically. Use `rich()` only for trusted application markup, such as another keyed label.

For dynamic text, use named parameters: `t("ui.extrude_value_mm", {distance: 100})`. For text assigned to an existing element, use `setText(element, () => t(key, params))`; the callback is evaluated again on language changes. Use `setTranslatedAttribute` for dynamic accessibility labels and tooltips, or `data-i18n-title`, `data-i18n-aria-label`, and `data-i18n-placeholder` for static attributes. Store keys rather than rendered translations in long-lived arrays or objects.

Backend errors retain diagnostic text and additionally provide `message_key` and `message_params`. Pass these explicitly when raising `WizardError`, `ConfigError`, or `PrinterError`. Labels inside error parameters can use `Message` to carry their own key and parameters. Wizard descriptions use `wizards.<id>.name` and `wizards.<id>.description`. User-defined names and raw Klipper diagnostics remain user data.

Run `node --test tests/*.mjs` to check catalog parity, placeholders, localization behavior, and position maps.
