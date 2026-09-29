# Security and safety model

The service controls a heater and motor. Treat it like the printer UI itself.

- It binds to `127.0.0.1` and is exposed only through the existing nginx server.
- Browser mutations and WebSockets enforce same-origin access.
- Moonraker credentials may be supplied in the root-readable service environment and are never returned or logged.
- Server-side state and temperature checks guard every extrusion.
- Print-state and homing checks guard calibration motion; PID, mesh, probe, and shaper refuse to
  start while unrelated `SAVE_CONFIG` values are pending.
- Resonance calibration is unavailable unless Klipper exposes both the configured sensor command
  and `[resonance_tester]`.
- The UI cannot submit raw G-code.
- Inputs must be finite, bounded, and plausible; large changes cannot be applied.
- A random, single-use confirmation token protects permanent saving.
- The configuration writer stays inside the resolved Klipper config root, rejects ambiguous definitions, backs up first, and atomically replaces the file.
- Geometry setup validates finite coordinate bounds and point counts, shows the exact normalized
  section diff, and rejects saving if any included config file changed after that preview.
- Systemd hardening denies new privileges and makes the system read-only except for the Klipper configuration and backup directories.

Do not expose port 7130 directly to an untrusted network. The initial release relies on the same network trust boundary as a typical local Mainsail installation; it does not yet implement an independent user database. Deployments exposed through the internet must put authenticated TLS access in front of both Mainsail and this application.

If a run behaves unexpectedly, use Klipper's emergency stop in the primary printer UI. The Wizard intentionally does not disguise a failed or timed-out command as a successful cancellation.

Report vulnerabilities privately to the repository owner before public disclosure.
