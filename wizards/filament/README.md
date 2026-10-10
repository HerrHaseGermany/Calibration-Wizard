# Filament helper

`manifest.json` registers loading, unloading, and changing filament as a helper in the tool catalog. It stays ahead of the calibration tools without a helper heading.

`frontend.mjs` contains the material selection, heating, confirmation, movement progress, and change-filament dialogs. The application serves it at `/assets/wizards/filament/frontend.mjs` and supplies its navigation and localization dependencies.

`backend/src/calibration_wizard/filament.py` contains `FilamentWizard`, which owns temperature checks, confirmation tokens, movement locking, and progress. The existing `/api/tools/filament/*` routes delegate to that controller. Active prints block filament operations; paused prints permit them. Calibration safety rules remain separate.
