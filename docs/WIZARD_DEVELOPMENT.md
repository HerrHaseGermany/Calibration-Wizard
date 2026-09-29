# Wizard development

A wizard is an independent domain workflow, not a set of frontend-only pages.

1. Add `wizards/<id>/manifest.json` with stable ID, translated display keys, requirements, defaults, and states.
2. Implement a backend controller with an explicit state enum and a transition allow-list.
3. Put calculations and validation in pure functions. Reject non-finite, out-of-range, and implausible values server-side.
4. Express hardware operations through `PrinterAdapter`; never import a concrete Moonraker client into domain logic.
5. Re-query safety-critical printer state immediately before every heater or motion command.
6. Add API handlers that only translate requests to controller transitions.
7. Add localized UI strings in `frontend/assets/i18n.js` and keep the view non-authoritative.
8. Test every calculation boundary, invalid transition, disconnect, shutdown, and persistence failure.

Permanent changes require a preview, explicit confirmation, an old-value compare-and-swap check, a backup, and atomic output. A new wizard must not use blind string replacement or rely on `SAVE_CONFIG` unless the exact Klipper calibration command is documented to populate the pending save set.

