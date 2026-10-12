# Mainsail Tools integration

The implementation adds a native **Tools** route and navigation entry to Mainsail 2.19.0.
The route embeds our application at `/tools/app/` while keeping the real sidebar and topbar.
`/api/klipper-tools/` stays reachable for integrity checks and repair. No webcam entry is used.

The checked upstream commit is `5fb9e77fb9f4e60cf0725d9dc7f57cf7b84bbd70`. The worker
clones that release and refuses a changed tag or an unknown version. The patch adds a page
component, navigation/locale entries, and the service-worker navigation exclusion for
`/tools/`. The independent recovery address uses the original worker's existing `/api/`
exclusion, so it remains reachable after an upstream update. The iframe reports navigation lock state using same-origin `postMessage`;
the page rejects messages from other windows or origins and blocks route changes during
active Tools steps. The browser's unload guard covers reloads and external navigation.

The backend checks the version and SHA-256 hashes of deployed files. Missing, overwritten,
or changed files show the Repair notice on the standalone page. For supported versions,
the button queues a fixed request file; a systemd path starts the unprivileged worker.
No browser-supplied command, path, version, or service name reaches the worker.

Repairs check printer readiness, print state, calibration sessions and filament movement.
The worker repeats the checks after building. Files are backed up and copied with atomic
file replacement; assets precede entry files. A failed deployment restores the backup.
Repeated repairs retain the first original backup for that release. Uninstall restores it
only when the deployed integration is still intact, so an upstream update is not rolled back.
Printer-specific config.json is preserved.

Mainsail upgrades can overwrite the extension. New versions need a reviewed patch before
Repair is enabled for them. The implementation does not claim compatibility with arbitrary
releases. Detection is automatic; deployment remains an explicit Repair action.

## Verification

- Patched upstream v2.19.0 built successfully using its lockfile and npm build command.
- Backend tests cover overwrites, missing assets, unknown versions, retained printer config,
  backup restoration, changed versions during a build, symlink escape, same-origin checks,
  idle guards and duplicate repair requests.
- The systemd/nginx installation has not been exercised on a real printer in this workspace.

## Upstream references

- [Mainsail layout](https://github.com/mainsail-crew/mainsail/blob/v2.19.0/src/App.vue)
- [Mainsail routes](https://github.com/mainsail-crew/mainsail/blob/v2.19.0/src/routes/index.ts)
- [Mainsail navigation](https://github.com/mainsail-crew/mainsail/blob/v2.19.0/src/components/mixins/navigation.ts)
- [Service worker configuration](https://github.com/mainsail-crew/mainsail/blob/v2.19.0/vite.config.ts)

See [installation](INSTALLATION.md) for paths, prerequisites and recovery.
