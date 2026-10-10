export const messages = {
  de: {
    steps: ["Vorbereiten", "Heizen", "Markieren", "Extrudieren", "Messen", "Berechnen", "Prüfen", "Speichern"],
    welcomeTitle: "Extruder kalibrieren",
    welcomeBody: "Kalibriere, wie viel Filament eine volle Extruderumdrehung fördert. Der Assistent liest die aktuelle Rotationsdistanz aus Klipper und speichert nie ohne deine Bestätigung.",
  },
  en: {
    steps: ["Prepare", "Heat", "Mark", "Extrude", "Measure", "Calculate", "Verify", "Save"],
    welcomeTitle: "Extruder calibration",
    welcomeBody: "Calibrate how much filament one full extruder rotation moves. The wizard reads the current rotation distance from Klipper and never saves a change without your confirmation.",
  },
};

const pairs = [
  ["Helfer", "Helper"],
  ["Filament wechseln", "Change filament"],
  ["Wähle das aktuell eingesetzte Material. Der Assistent heizt auf und wartet vor jeder Bewegung auf deine Bestätigung.", "Choose the currently loaded material. The assistant heats the hotend and waits for your confirmation before each movement."],
  ["Pro Vorgang werden 100 mm Filament bewegt. Beim Laden folgen 2 mm Retract; vor dem Entladen werden 5 mm extrudiert.", "Each action moves 100 mm of filament. Loading ends with a 2 mm retraction; unloading starts with 5 mm of extrusion."],
  ["Das Hotend bleibt anschließend heiß, bis du die Heizung ausschaltest.", "The hotend stays hot afterwards until you switch the heater off."],
  ["Setze das neue Filament ein und wähle dessen Material.", "Insert the new filament and choose its material."],
  ["Bestätigen und starten", "Confirm and start"],
  ["Druckerstatus konnte nicht geladen werden.", "Could not load printer status."],
  ["Temperatur erreicht. Setze das Filament ein und bestätige das Laden.", "Temperature reached. Insert filament and confirm loading."],
  ["Temperatur erreicht. Bestätige das Entladen.", "Temperature reached. Confirm unloading."],
  ["Hotend wird aufgeheizt…", "Heating hotend…"],
  ["Neues Material aufheizen", "Heat for new material"],
  ["Starte den Filamentvorgang erneut.", "Start the filament process again."],
  ["Die gewählte Zieltemperatur ist noch nicht erreicht.", "The selected target temperature has not been reached yet."],
  ["Filament laden / entladen", "Load / unload filament"],
  ["Hotend aufheizen und Filament kontrolliert laden oder entladen.", "Heat the hotend and load or unload filament at a controlled speed."],
  ["Öffnen →", "Open →"],
  ["Führe das Filament zum Laden in den Extruder ein. Wähle eine Temperatur passend zum Material und warte, bis das Hotend heiß ist.", "Insert filament into the extruder to load it. Choose a temperature suitable for the material and wait until the hotend is hot."],
  ["Die Länge hängt vom Filamentweg ab. Bei Bedarf kannst du den Vorgang wiederholen. Das Hotend bleibt anschließend heiß, bis du die Heizung ausschaltest.", "The length depends on the filament path. Repeat the action if needed. The hotend stays hot afterwards until you switch the heater off."],
  ["Filamentlänge (mm)", "Filament length (mm)"],
  ["Geschwindigkeit (mm/s)", "Speed (mm/s)"],
  ["Aufheizen", "Heat up"], ["Heizung ausschalten", "Switch heater off"],
  ["Filament laden", "Load filament"], ["Filament entladen", "Unload filament"],
  ["Temperatur wird gesetzt…", "Setting temperature…"],
  ["Filamentbewegung läuft…", "Moving filament…"],
  ["Bitte prüfe die Eingabewerte.", "Please check the input values."],
  ["Heizung ausgeschaltet.", "Heater switched off."],
  ["Warte, bis die Zieltemperatur erreicht ist. Starte dann Laden oder Entladen.", "Wait until the target temperature is reached, then start loading or unloading."],
  ["Filament geladen.", "Filament loaded."], ["Filament entladen.", "Filament unloaded."],
  ["Klipper muss für den Filamentwechsel bereit sein.", "Klipper must be ready for a filament change."],
  ["Filamentwechsel ist während eines Drucks oder einer Pause gesperrt.", "Filament changes are blocked while printing or paused."],
  ["Beende zuerst die laufende Kalibrierung.", "Finish the active calibration first."],
  ["Filamentbewegung läuft bereits.", "A filament move is already running."],
  ["Zieltemperatur liegt unter der Mindest-Extrusionstemperatur.", "Target temperature is below the minimum extrusion temperature."],
  ["Zieltemperatur muss unter Klippers max_temp liegen.", "Target temperature must be below Klipper's max_temp."],
  ["Das Hotend hat die Mindest-Extrusionstemperatur nicht erreicht.", "The hotend has not reached the minimum extrusion temperature."],
  ["Startseite von Klipper Tools", "Klipper Tools home"],
  ["Zur Werkzeugübersicht", "Back to tools overview"],
  ["Klipper Tools kann Klipper derzeit nicht erreichen. Prüfe die Verbindung und den Zustand in Mainsail.", "Klipper Tools cannot reach Klipper right now. Check the connection and status in Mainsail."],
  ["Hinten · Y+", "Rear · Y+"], ["Vorne · Y−", "Front · Y−"],
  ["Positionen – Draufsicht", "Positions – top view"],
  ["Draufsicht · links X− / rechts X+ · schematisch", "Top view · left X− / right X+ · schematic"],
  ["Im Uhrzeigersinn", "Clockwise"], ["Gegen den Uhrzeigersinn", "Counterclockwise"],
  ["Klipper meldet keine Schraubenergebnisse.", "Klipper reports no screw results."],
  ["Aktiven Extruder vermessen und seine Rotationsdistanz kalibrieren.", "Measure the active extruder and calibrate its rotation distance."],
  ["Hotend oder Heizbett auf eine stabile Zieltemperatur abstimmen.", "Tune the hotend or heated bed for a stable target temperature."],
  ["Wandstärken messen und den Extrusionsfaktor für den Slicer berechnen.", "Measure wall thickness and calculate the slicer extrusion multiplier."],
  ["Testturm vorbereiten, optimale Höhe auswerten und Wert sichern.", "Prepare a test tower, evaluate the best height, and save the value."],
  ["Z-Abstand mit Klippers Papiermethode sicher kalibrieren.", "Safely calibrate Z offset with Klipper's paper method."],
  ["Drehrichtung und Korrektur jeder Bettschraube automatisch ermitteln.", "Automatically determine direction and adjustment for every bed screw."],
  ["Gantry mit zwei oder mehr unabhängig angetriebenen Z-Motoren ausrichten.", "Level a gantry with two or more independently driven Z motors."],
  ["Gantry eines CoreXY-Druckers über vier unabhängige Z-Antriebe ausrichten.", "Level a CoreXY gantry using four independent Z drives."],
  ["Druckbett referenzieren, vollständig vermessen und das Mesh prüfen.", "Home the printer, measure the full bed, and review the mesh."],
  ["Resonanzen mit einem Beschleunigungssensor messen und Shaper bestimmen.", "Measure resonances with an accelerometer and determine input shapers."],
  ["Kein Resonanzsensor konfiguriert. Schließe einen Beschleunigungssensor an und konfiguriere [resonance_tester]; danach wird dieser Ablauf automatisch aktiviert.", "No resonance sensor is configured. Connect an accelerometer and configure [resonance_tester]; this workflow will then activate automatically."],
  ["Auf diesem Drucker nicht verfügbar", "Not available on this printer"],
  ["Der Drucker darf nicht drucken oder pausiert sein. Bewegungen starten erst nach deinem Klick.", "The printer must not be printing or paused. Motion starts only after your click."],
  ["Das Bett wird zuerst referenziert und danach mit deiner bestehenden Klipper-Konfiguration vermessen.", "The printer is homed first, then the bed is measured using your existing Klipper configuration."],
  ["Klipper ermittelt für jede Schraube Drehrichtung und Betrag. Nach jeder Korrektur kannst du erneut messen.", "Klipper calculates direction and amount for every screw. You can measure again after each adjustment."],
  ["Mit PROBE_CALIBRATE und feinen TESTZ-Schritten stellst du den Papierabstand ein.", "Use PROBE_CALIBRATE and fine TESTZ steps to set the paper gap."],
  ["Klipper vermisst die konfigurierten Punkte und richtet zwei oder mehr unabhängige Z-Antriebe aus.", "Klipper probes the configured points and levels two or more independent Z drives."],
  ["Klipper vermisst vier Punkte und richtet die Gantry über vier unabhängige Z-Antriebe aus.", "Klipper probes four points and levels the gantry with four independent Z drives."],
  ["Prüfe, dass der Bauraum frei ist. Der Drucker führt anschließend G28 aus.", "Make sure the build volume is clear. The printer will then run G28."],
  ["Klipper fährt alle konfigurierten Messpunkte ab und korrigiert die unabhängigen Z-Antriebe iterativ.", "Klipper probes all configured points and iteratively corrects the independent Z drives."],
  ["Klipper fährt alle in [bed_mesh] definierten Punkte ab. Dieser Vorgang kann mehrere Minuten dauern.", "Klipper probes every point defined in [bed_mesh]. This may take several minutes."],
  ["Klipper fährt die konfigurierten Schraubenpositionen an und berechnet die Korrekturen.", "Klipper probes the configured screw positions and calculates the adjustments."],
  ["Stelle die Schrauben bei stillstehendem Drucker ein und wiederhole danach die Messung. Eine mechanische Änderung kann eine erneute Z‑Offset-Kalibrierung erfordern.", "Adjust the screws while the printer is stationary, then repeat the measurement. A mechanical change may require Z-offset recalibration."],
  ["Klipper positioniert die Düse und startet PROBE_CALIBRATE. Lege danach ein normales Blatt Papier unter die saubere Düse.", "Klipper positions the nozzle and starts PROBE_CALIBRATE. Then place a normal sheet of paper under the clean nozzle."],
  ["Bewege Z, bis sich das Papier mit leichtem Widerstand bewegen lässt. Negative Werte senken die Düse. Beginne grob und werde dann feiner.", "Move Z until the paper slides with light resistance. Negative values lower the nozzle. Start coarse, then use finer steps."],
  ["Wähle den Heizer und eine typische Drucktemperatur. Nach dem ersten Aufheizen schaltet Klipper den Heizer mehrfach knapp ober- und unterhalb der Zieltemperatur um.", "Choose the heater and a typical printing temperature. After the initial heat-up, Klipper switches the heater several times just above and below the target temperature."],
  ["Während der Messung werden hohe Temperaturen erreicht. Nach dem ersten Aufheizen folgen mehrere kurze Heiz- und Abkühlphasen um die Zieltemperatur. Lasse den Drucker nicht unbeaufsichtigt.", "High temperatures are reached during measurement. After the initial heat-up, several short heating and cooling phases follow around the target temperature. Do not leave the printer unattended."],
  ["Während der Messung werden hohe Temperaturen erreicht. Lasse den Drucker nicht unbeaufsichtigt.", "High temperatures are reached during measurement. Do not leave the printer unattended."],
  ["Der Klipper-Testturm verändert Pressure Advance über die Höhe. Wähle deinen Extruder-Typ.", "The Klipper test tower changes Pressure Advance with height. Select your extruder type."],
  ["Miss vom Boden bis zu der Höhe, an der die Ecken am gleichmäßigsten sind.", "Measure from the base to the height where the corners look most consistent."],
  ["Drucke den bereitgestellten Testkörper mit einer Wand und ohne Deckschichten. Trage danach Sollstärke und vier Messungen ein.", "Print the provided test model with one wall and no top layers. Then enter the target thickness and four measurements."],
  ["Der Sensor wird zuerst abgefragt. Danach erzeugt Klipper starke, schnelle Schwingungen und bestimmt passende Shaper für X und Y.", "The sensor is queried first. Klipper then creates strong, rapid vibrations and determines suitable shapers for X and Y."],
  ["Prüfe Sensorbefestigung, Kabelweg und freien Bauraum. Bleibe während der Messung am Drucker.", "Check sensor mounting, cable routing, and a clear build volume. Stay with the printer during measurement."],
  ["Der Drucker bewegt sich schnell und laut. Stoppe ihn sofort bei lockeren Teilen, Zug am Sensorkabel oder ungewöhnlichen Geräuschen.", "The printer moves quickly and loudly. Stop it immediately if parts are loose, the sensor cable is strained, or noises are unusual."],
  ["Lege die Geometrie für diesen Drucker fest.", "Define the geometry for this printer."],
  ["Koordinaten müssen zur Mechanik, zum Probe-Offset und zu einem freien Verfahrweg passen. Falsche Werte können eine Kollision verursachen.", "Coordinates must match the mechanics, probe offset, and a clear travel path. Incorrect values can cause a collision."],
  ["Diese normalisierten Werte werden in den vorhandenen Abschnitt geschrieben; andere Schlüssel bleiben erhalten.", "These normalized values will be written to the existing section; other keys are preserved."],
  ["Klipper wird neu gestartet. Nach dem erneuten Verbinden wird die Kalibrierung automatisch neu bewertet.", "Klipper is restarting. After reconnecting, calibration availability is evaluated automatically."],
  ["Kalibrierzentrale", "Calibration center"],
  ["Sprache", "Language"], ["In Klipper fehlt:", "Missing in Klipper:"],
  ["Quad Gantry Level", "Quad Gantry Level"],
  ["Übersicht", "Overview"], ["Zur Kalibrierübersicht", "Back to calibration overview"],
  ["Zum Mainsail-Dashboard", "Go to Mainsail dashboard"],
  ["Drucker sofort anhalten", "Stop printer immediately"], ["NOT-AUS", "EMERGENCY STOP"],
  ["GESTOPPT", "STOPPED"], ["STOPP…", "STOPPING…"],
  ["NOT-AUS ausgelöst. Klipper befindet sich im Shutdown-Zustand. Prüfe den Drucker und führe erst danach einen Firmware-Neustart aus.", "EMERGENCY STOP triggered. Klipper is in shutdown state. Check the printer before performing a firmware restart."],
  ["Klipper ist nicht bereit", "Klipper is not ready"],
  ["Klipper befindet sich im Shutdown-Zustand. Prüfe den Drucker und die Fehlermeldung in Mainsail. Führe einen Firmware-Neustart erst aus, wenn die Ursache behoben ist.", "Klipper is in shutdown state. Check the printer and the error message in Mainsail. Only restart the firmware after resolving the cause."],
  ["Klipper meldet einen Fehler. Prüfe die Fehlermeldung in Mainsail und behebe die Ursache, bevor du fortfährst.", "Klipper reports an error. Check the message in Mainsail and resolve the cause before continuing."],
  ["Klipper startet gerade. Die Kalibrierungen werden automatisch freigegeben, sobald die Firmware bereit ist.", "Klipper is starting. Calibrations will be enabled automatically as soon as the firmware is ready."],
  ["Der Calibration Wizard kann Klipper derzeit nicht erreichen. Prüfe die Verbindung und den Zustand in Mainsail.", "The Calibration Wizard cannot reach Klipper right now. Check the connection and status in Mainsail."],
  ["Klipper ist momentan nicht bereit", "Klipper is currently not ready"], ["Zustand", "State"], ["Zu Mainsail", "Go to Mainsail"],
  ["Laufende Kalibrierung", "Calibration in progress"], ["Kalibrierung läuft", "Calibration running"],
  ["Der Drucker führt den laufenden Schritt weiter aus. Diese Ansicht wechselt automatisch zum nächsten Schritt, sobald Klipper fertig ist.", "The printer continues the active step. This view will advance automatically as soon as Klipper finishes."],
  ["Bitte warten…", "Please wait…"], ["Extrusion läuft", "Extrusion running"], ["Prüfextrusion läuft", "Verification extrusion running"],
  ["Beschleunigungssensor wird geprüft", "Checking accelerometer"], ["Kalibrierung unterbrochen", "Calibration interrupted"],
  ["Der Ablauf kann nicht fortgesetzt werden", "The workflow cannot continue"], ["Klipper hat während der Kalibrierung einen Fehler gemeldet.", "Klipper reported an error during calibration."],
  ["Temperatur & Extrusion", "Temperature & extrusion"], ["Mechanik, Gantry & Z", "Mechanics, gantry & Z"],
  ["Druckqualität", "Print quality"], ["Nicht verfügbar", "Unavailable"],
  ["Farbschema wechseln", "Change color scheme"], ["Helles Farbschema", "Light color scheme"], ["Dunkles Farbschema", "Dark color scheme"],
  ["Farbschema: System", "Color scheme: System"], ["Farbschema: Hell", "Color scheme: Light"], ["Farbschema: Dunkel", "Color scheme: Dark"],
  ["Jetzt starten", "Start now"], ["Einrichten", "Configure"], ["Nicht konfiguriert", "Not configured"],
  ["Offene Klipper-Werte", "Pending Klipper values"], ["Vorhandene Änderungen auflösen", "Resolve existing changes"],
  ["Klipper hat bereits ungespeicherte Werte für", "Klipper already has unsaved values for"],
  [". Entscheide zuerst, was mit ihnen passieren soll. Danach wird", ". First decide what should happen to them. Then"],
  ["automatisch geöffnet.", "will open automatically."], ["Betroffene Konfigurationswerte", "Affected configuration values"],
  ["„Speichern“ übernimmt alle oben aufgeführten Werte dauerhaft. „Verwerfen“ lädt die zuletzt gespeicherte Konfiguration neu. Beide Aktionen starten Klipper neu.", "“Save” permanently applies all values listed above. “Discard” reloads the last saved configuration. Both actions restart Klipper."],
  ["Vorhandene Werte speichern", "Save existing values"], ["Verwerfen und fortfahren", "Discard and continue"],
  ["Klipper-Neustart", "Klipper restart"], ["Werte werden gespeichert", "Saving values"],
  ["Werte werden verworfen", "Discarding values"], ["Klipper startet neu. Sobald die Firmware wieder bereit ist, öffnet der Wizard automatisch", "Klipper is restarting. As soon as the firmware is ready again, the wizard will automatically open"],
  ["Klipper startet neu. Sobald die Firmware wieder bereit ist, kehrt der Wizard automatisch zur Übersicht zurück.", "Klipper is restarting. As soon as the firmware is ready again, the wizard will automatically return to the overview."],
  ["Warte auf Klipper…", "Waiting for Klipper…"],
  ["Zur Übersicht", "Back to overview"], ["Zurück", "Back"], ["Abbrechen", "Cancel"], ["Fertig", "Done"],
  ["Kalibrierung einrichten", "Configure calibration"], ["Änderungen prüfen", "Review changes"],
  ["Einrichtung speichern", "Save setup"], ["Einrichtung übernommen", "Setup applied"],
  ["Dauerhafte Änderung", "Permanent change"], ["Gespeichert", "Saved"], ["Abgeschlossen", "Complete"],
  ["Ergebnis", "Result"], ["Vorbereiten", "Prepare"], ["Referenzieren", "Home axes"],
  ["Vermessen", "Measure"], ["Speichern", "Save"], ["Messen", "Measure"], ["Berechnen", "Calculate"],
  ["Ausrichten", "Level"], ["Sensor prüfen", "Check sensor"], ["Prüfen", "Review"],
  ["Druckstatus", "Print status"], ["Achsen", "Axes"], ["nicht referenziert", "not homed"],
  ["Hotend Ist", "Hotend actual"], ["Heizbett Ist", "Bed actual"], ["Hotend Ziel", "Hotend target"],
  ["Testfaktor", "Test factor"], ["Referenzierte Achsen", "Homed axes"], ["keine", "none"],
  ["Aktiver Ablauf", "Active workflow"], ["Mesh-Profil", "Mesh profile"], ["Messraster", "Measurement grid"],
  ["Höhenspanne", "Height range"], ["abgeschlossen", "complete"],
  ["Referenzierung läuft", "Homing in progress"],
  ["Die Kalibrierungswerte wurden dauerhaft übernommen.", "The calibration values were saved permanently."],
  ["Die Kalibrierung ist abgeschlossen; es war keine Konfigurationsänderung erforderlich.", "Calibration is complete; no configuration change was required."],
  ["Drucker verbunden", "Printer connected"], ["Drucker offline", "Printer offline"],
  ["Verbindung wird hergestellt", "Connecting"], ["Verbindung wird wiederhergestellt", "Reconnecting"],
  ["Extruder kalibrieren", "Extruder calibration"], ["PID-Kalibrierung", "PID calibration"],
  ["Flow / Extrusionsfaktor", "Flow / extrusion multiplier"], ["Bettschrauben", "Bed screws"],
  ["Manuelle Bettschrauben", "Manual bed screws"], ["Beliebig viele Bettschrauben mit Klippers manueller Papiermethode einstellen.", "Adjust any number of bed screws with Klipper's manual paper method."],
  ["Probe Z-Offset", "Probe Z offset"], ["Bed Mesh", "Bed mesh"], ["Kalibrierung starten", "Start calibration"],
  ["Ziel", "Target"], ["Klipper-Zustand", "Klipper state"],
  ["Jetzt referenzieren", "Home now"], ["Alle Achsen referenzieren", "Home all axes"],
  ["Bewegung", "Motion"], ["Messbewegung", "Measurement motion"], ["Druckbett vermessen", "Measure the print bed"],
  ["Bed Mesh starten", "Start bed mesh"], ["Vermessung läuft", "Measurement running"],
  ["Schraubenpositionen messen", "Measure screw positions"], ["Schrauben einstellen", "Adjust screws"],
  ["Erneut messen", "Measure again"], ["Manuelle Z-Kalibrierung starten", "Start manual Z calibration"],
  ["Papier-Test", "Paper test"], ["Düse schrittweise absenken", "Lower nozzle step by step"],
  ["Position übernehmen", "Accept position"], ["Heizer wählen", "Choose heater"], ["PID kalibrieren", "Calibrate PID"],
  ["Heizer", "Heater"], ["Heizbett", "Heated bed"], ["Zieltemperatur", "Target temperature"],
  ["Ausgewählter Heizer", "Selected heater"], ["Gewählte Zieltemperatur", "Selected target temperature"],
  ["PID-Tuning starten", "Start PID tuning"], ["Messung ausführen", "Run measurement"],
  ["Heizzyklen", "Heating cycles"], ["PID-Tuning bereit", "PID tuning ready"],
  ["Testturm", "Test tower"], ["Extruder-Typ", "Extruder type"], ["Slicer & Druck", "Slicer & print"],
  ["Testturm drucken", "Print test tower"], ["Tuning Tower aktivieren", "Enable tuning tower"],
  ["Auswertung", "Evaluation"], ["Beste Höhe messen", "Measure best height"], ["Höhe", "Height"],
  ["Temporär anwenden", "Apply temporarily"], ["Slicer-Kalibrierung", "Slicer calibration"],
  ["Sollstärke", "Target thickness"], ["Aktueller Flow", "Current flow"],
  ["Flow-Testkörper", "Flow test model"], ["Für jeden Slicer geeignet. Das Modell wird erst durch die folgenden Slicer-Einstellungen zum einwandigen Messkörper.", "Suitable for any slicer. The following slicer settings turn the model into a single-wall test object."],
  ["STL herunterladen", "Download STL"], ["Slicer-Einstellungen", "Slicer settings"],
  ["Wände / Perimeter", "Walls / perimeters"], ["Deckschichten", "Top layers"], ["Bodenschichten", "Bottom layers"], ["Linienbreite", "Line width"],
  ["bei 0,4-mm-Düse", "with a 0.4 mm nozzle"], ["Spiral-/Vasenmodus", "Spiral/vase mode"], ["deaktiviert", "disabled"],
  ["Miss jede Seitenwand mittig, deutlich entfernt von Ecken und untersten Schichten. Verwende bei einer anderen Linienbreite diesen Wert als Sollstärke.", "Measure each side wall in the center, well away from corners and the bottom layers. If you use a different line width, enter that value as the target thickness."],
  ["Extrusionsfaktor berechnen", "Calculate extrusion multiplier"], ["Mittlere gemessene Wandstärke", "Average measured wall thickness"],
  ["Beschleunigungssensor", "Accelerometer"], ["X und Y", "X and Y"], ["Nur X", "X only"], ["Nur Y", "Y only"],
  ["Starke Schwingungen", "Strong vibrations"], ["Resonanzmessung starten", "Start resonance measurement"],
  ["Ausrichtung läuft", "Leveling running"], ["Automatische Ausrichtung", "Automatic leveling"],
  ["Punkte erkannt", "points detected"], ["Zulässiger Verfahrbereich laut Klipper", "Travel range reported by Klipper"],
  ["Mesh-Minimum", "Mesh minimum"], ["Mesh-Maximum", "Mesh maximum"], ["Messpunkte", "Probe points"],
  ["Positionen der Z-Antriebe", "Z actuator positions"], ["Probe-Messpunkte", "Probe points"],
  ["Gantry-Ecken", "Gantry corners"], ["Schraubenpositionen", "Screw positions"],
  ["Punkt hinzufügen", "Add point"], ["Punkt entfernen", "Remove point"], ["Schraubengewinde", "Screw thread"],
  ["Vorschau", "Preview"], ["Quelle", "Source"], ["Backup", "Backup"], ["Schraube", "Screw"],
  ["Aktueller Extruder", "Current extruder"], ["Aktuelle Rotationsdistanz", "Current rotation distance"],
  ["Kalibrierung starten", "Start calibration"], ["Extruder aufheizen", "Heat the extruder"],
  ["Zieltemperatur", "Target temperature"], ["Extruder heizen", "Heat extruder"], ["Weiter", "Continue"],
  ["Filament markieren", "Mark the filament"], ["Markierungsabstand", "Mark distance"],
  ["Nächste Extrusion", "Next extrusion"], ["Markierung ist gesetzt", "Mark is ready"],
  ["Reststrecke messen", "Measure the remainder"], ["Reststrecke", "Remaining distance"],
  ["Ergebnis prüfen", "Check result"], ["Berechnetes Ergebnis", "Calculated result"],
  ["Messung ist plausibel", "Measurement looks plausible"], ["Bitte Messung prüfen", "Please check the measurement"],
  ["Angefordert", "Requested"], ["Tatsächlich", "Actual"], ["Abweichung", "Deviation"],
  ["Temporär anwenden", "Apply temporarily"], ["Erneut messen", "Measure again"],
  ["Neuen Wert prüfen", "Verify the new value"], ["Prüfung überspringen", "Skip verification"],
  ["Konfiguration speichern", "Save configuration"], ["Alter Wert", "Old value"], ["Neuer Wert", "New value"],
  ["Kalibrierung gespeichert", "Calibration saved"], ["Kalibrierung abbrechen", "Cancel calibration"],
  ["Sichere, geführte Einrichtung", "Safe, guided setup"],
  ["Kalibrierung", "Calibration"],
  ["Kalibrierungsfortschritt", "Calibration progress"],
  ["Startseite des Calibration Wizard", "Calibration Wizard home"],
  ["Unbekannt", "Unknown"],
  ["Schritt", "Step"],
  ["Heizen", "Heat"],
  ["Markieren", "Mark"],
  ["Extrudieren", "Extrude"],
  ["Prüfung", "Verification"],
  ["Prüfergebnis", "Verification result"],
  ["Optional", "Optional"],
  ["Neue Rotationsdistanz", "New rotation distance"],
  ["Geprüfte Rotationsdistanz", "Tested rotation distance"],
  ["Weiter zum Speichern", "Continue to save"],
  ["Wähle eine für das eingelegte Filament geeignete Temperatur. Fahre erst fort, wenn Klipper die Extrusion als sicher meldet.", "Choose a temperature suitable for the loaded filament. Continue only when Klipper reports that extrusion is safe."],
  ["Zieltemperatur · Schritte von 5 °C", "Target temperature · 5 °C increments"],
  ["Wähle eine Temperatur in Schritten von 5 °C.", "Choose a temperature in 5 °C increments."],
  ["Heizt…", "Heating…"],
  ["Lade Filament, wähle einen eindeutigen festen Bezugspunkt am Extrudereingang und markiere genau", "Load filament, choose an unambiguous fixed reference point at the extruder entrance, then measure and mark exactly"],
  ["oberhalb davon.", "above it."],
  ["Der Extruder bewegt sich langsam mit 1 mm/s. Klippers Schutz vor kalter Extrusion und der Druckerzustand werden unmittelbar vor der Bewegung erneut geprüft.", "The extruder will move slowly at 1 mm/s. Klipper's cold-extrusion protection and printer state are checked again immediately before motion."],
  ["Extrusion läuft…", "Extruding…"],
  ["Miss vom selben festen Bezugspunkt bis zur Filamentmarkierung. Gib die Reststrecke möglichst genau ein.", "Measure from the same fixed reference point to the filament mark. Enter the remaining distance as precisely as possible."],
  ["Gib eine gültige Reststrecke ein.", "Enter a valid remaining distance."],
  ["Die neue Rotationsdistanz bleibt bis zum Klipper-Neustart aktiv. Du kannst die Messung vor dem Speichern wiederholen oder direkt zur ausdrücklichen Speicherbestätigung gehen.", "The new rotation distance is active until Klipper restarts. You can repeat the measurement before saving, or proceed directly to the explicit save confirmation."],
  ["Zuerst wird ein Backup mit Zeitstempel erstellt. Nur die Einstellung", "A timestamped backup is created first. Only the exact"],
  ["in ihrer ursprünglichen Include-Datei wird geändert.", "setting in its source include file is changed."],
  ["Dauerhaftes Speichern ist nicht verfügbar, weil die Quelldatei der Einstellung nicht ermittelt werden konnte. Der temporäre Wert bleibt bis zum Neustart aktiv.", "Permanent writes are unavailable because the source setting could not be resolved. The temporary value remains active until restart."],
  ["Ich bestätige diese alten und neuen Werte und möchte die Klipper-Konfiguration ändern.", "I confirm these old and new values and want to change the Klipper configuration."],
  ["Bestätige zuerst die dauerhafte Konfigurationsänderung.", "Confirm the permanent configuration change first."],
  ["Der Wert ist bereits zur Laufzeit aktiv. Das Backup kann wie in der Installationsanleitung beschrieben wiederhergestellt werden.", "The runtime value is already active. The backup can be restored as described in the installation guide."],
  ["Geführter Ablauf", "Guided workflow"],
  ["Bettschrauben ausrichten", "Level bed screws"],
  ["Klipper fährt jede konfigurierte Schraube an. Du stellst den Papierwiderstand nacheinander von Hand ein.", "Klipper moves to each configured screw. You adjust the paper resistance manually at each position."],
  ["Manueller Papier-Test", "Manual paper test"],
  ["Erste Schraube anfahren", "Move to the first screw"],
  ["Klipper fährt die Schrauben der Reihe nach an. Stelle an jeder Position denselben leichten Papierwiderstand ein und gehe dann zur nächsten Schraube.", "Klipper moves to the screws in sequence. Set the same light paper resistance at each position, then move to the next screw."],
  ["Schraube einstellen", "Adjust screw"],
  ["Papierwiderstand angleichen", "Match paper resistance"],
  ["Drehe nur die aktuell angefahrene Schraube. Klicke danach auf „Nächste Schraube“. Klipper wiederholt den Rundgang, bis du das Ergebnis akzeptierst.", "Turn only the screw at the current position. Then click “Next screw”. Klipper repeats the sequence until you accept the result."],
  ["Nächste Schraube", "Next screw"],
  ["Ausrichtung akzeptieren", "Accept leveling"],
  ["Einstellen", "Adjust"],
  ["Wiederholen", "Repeat"],
  ["Probe starten", "Start probe"],
  ["Auswerten", "Evaluate"],
  ["Test drucken", "Print test"],
  ["starten", "start"],
  ["speichern", "save"],
  ["gespeichert", "saved"],
  ["prüfen", "review"],
  ["Referenz", "Reference"],
  ["Punkte", "points"],
  ["Messung", "Measurement"],
  ["Name", "Name"],
  ["Prüfe, dass der Bauraum frei ist. Der Drucker führt anschließend", "Make sure the build volume is clear. The printer will then run"],
  ["aus.", "."],
  ["Klipper fährt alle in", "Klipper probes every point defined in"],
  ["definierten Punkte ab. Dieser Vorgang kann mehrere Minuten dauern.", ". This may take several minutes."],
  ["Klipper positioniert die Düse und startet", "Klipper positions the nozzle and starts"],
  [". Lege danach ein normales Blatt Papier unter die saubere Düse.", ". Then place a normal sheet of paper under the clean nozzle."],
  ["Das neue Mesh ist berechnet. Mit SAVE_CONFIG wird es dauerhaft in Klipper gespeichert.", "The new mesh is calculated. SAVE_CONFIG saves it permanently in Klipper."],
  ["Der Offset ist übernommen, aber noch nicht dauerhaft gespeichert.", "The offset is applied but has not been saved permanently yet."],
  ["Zieltemperatur · Schritte von 5 °C", "Target temperature · 5 °C steps"],
  ["PID-Tuning läuft…", "PID tuning running…"],
  ["PID-Werte", "PID values"],
  ["Klipper hat neue PID-Werte ermittelt. Prüfe das Ergebnis und speichere es anschließend explizit.", "Klipper has calculated new PID values. Review the result, then explicitly save it."],
  ["Direct Drive · Faktor 0,005", "Direct Drive · factor 0.005"],
  ["Bowden · Faktor 0,020", "Bowden · factor 0.020"],
  ["Lade das", "Download the"],
  ["offizielle Klipper-Testmodell", "official Klipper test model"],
  [", slice es mit 0,4-mm Düse, 0,2-mm Schichthöhe, 100 mm/s und deaktivierter dynamischer Beschleunigungssteuerung. Starte danach hier den Tuning-Tower-Befehl und anschließend den Druck in Mainsail.", ", slice it with a 0.4 mm nozzle, 0.2 mm layer height, 100 mm/s, and dynamic acceleration control disabled. Then enable the tuning tower here and start the print in Mainsail."],
  ["Der Wert wird zuerst nur zur Laufzeit gesetzt. Erst deine nächste Bestätigung schreibt ihn in die Extruder-Konfiguration.", "The value is initially applied only at runtime. Your next confirmation writes it to the extruder configuration."],
  [". Übernimm den neuen Wert in dein Filamentprofil im Slicer und drucke zur Kontrolle erneut.", ". Apply the new value to your filament profile in the slicer and print again to verify it."],
  ["Achsen referenzieren", "Home axes"],
  ["Räume den Bauraum frei. Anschließend wird G28 ausgeführt.", "Clear the build volume. G28 will then run."],
  ["Sensor und Kabel sind sicher befestigt, der Bauraum ist frei.", "The sensor and cable are securely attached and the build volume is clear."],
  ["Bestätige zuerst die sichere Vorbereitung.", "Confirm the safe preparation first."],
  ["Messung läuft…", "Measurement running…"],
  ["Klipper hat passende Shaper berechnet. Mit SAVE_CONFIG werden sie dauerhaft übernommen.", "Klipper has calculated suitable shapers. SAVE_CONFIG saves them permanently."],
  ["Ich möchte genau die Ergebnisse dieser Kalibrierung mit SAVE_CONFIG speichern und Klipper neu starten.", "I want to save the results of this calibration with SAVE_CONFIG and restart Klipper."],
  ["SAVE_CONFIG ausführen", "Run SAVE_CONFIG"],
  ["Bestätige die dauerhafte Änderung zuerst.", "Confirm the permanent change first."],
  ["Konfigurationsdatei mit Backup ändern.", "Change the configuration file with a backup."],
  ["In Konfiguration speichern", "Save to configuration"],
  ["Bestätige die Änderung zuerst.", "Confirm the change first."],
  ["Backup erstellen, Konfiguration schreiben und Klipper neu starten.", "Create a backup, write the configuration, and restart Klipper."],
  ["Bestätige die Änderung und den Klipper-Neustart.", "Confirm the change and the Klipper restart."],
  ["Not-Aus konnte nicht ausgelöst werden", "Emergency stop could not be triggered"],
  ["Einrichtung konnte nicht geladen werden", "Could not load setup"],
  ["Anfrage fehlgeschlagen", "Request failed"],
  ["Prüfe den Drucker in Mainsail.", "Check the printer in Mainsail."],
  ["Klipper muss für die Einrichtung bereit sein", "Klipper must be ready for setup"],
  ["Die Konfiguration kann während eines Drucks nicht geändert werden", "The configuration cannot be changed during a print"],
  ["Dauerhafte Konfigurationsänderungen sind deaktiviert", "Permanent configuration writes are disabled"],
  ["Die Einrichtungs-Vorschau ist ungültig oder wurde verändert", "The setup preview is invalid or has been changed"],
  ["Für diese Kalibrierung gibt es keinen Einrichtungsassistenten", "No setup wizard is available for this calibration"],
  ["Mesh-Maximum muss rechts oberhalb des Minimums liegen", "The mesh maximum must be above and to the right of the minimum"],
  ["Ungültiges Schraubengewinde", "Invalid screw thread"],
  ["Klipper muss bereit sein, um offene Konfigurationswerte aufzulösen.", "Klipper must be ready to resolve pending configuration values."],
  ["Offene Konfigurationswerte können nicht während eines Drucks aufgelöst werden.", "Pending configuration values cannot be resolved during a print."],
  ["Klipper hat keine ungespeicherten SAVE_CONFIG-Werte.", "Klipper has no unsaved SAVE_CONFIG values."],
  ["Keine Kalibrierungssitzung ist aktiv", "No calibration session is active"],
  ["Druckerverbindung verloren", "Printer connection lost"],
  ["Die Extruder-Kalibrierung ist während eines Drucks oder einer Pause gesperrt", "Extruder calibration is blocked while a print is active or paused"],
  ["Abstände müssen positiv sein", "Distances must be positive"],
  ["Der Markierungsabstand muss größer als die Extrusionsstrecke sein", "Mark distance must be greater than extrusion distance"],
  ["Die angeforderten Abstände überschreiten die Sicherheitsgrenzen", "Requested distances exceed safety limits"],
  ["Klipper hat keine gültige rotation_distance gemeldet", "Klipper did not report a valid rotation_distance"],
  ["Die Temperatur muss in Schritten von 5 °C gewählt werden", "Temperature must be selected in 5 °C increments"],
  ["Das Hotend hat noch keine sichere Extrusionstemperatur erreicht", "The hotend has not reached a safe extrusion temperature"],
  ["Der Schutz vor kalter Extrusion ist aktiv", "Cold extrusion protection is active"],
  ["Plausibilitätswarnungen müssen durch erneutes Messen behoben werden", "Plausibility warnings must be resolved by measuring again"],
  ["Kein sicheres Ergebnis verfügbar", "No safe result is available"],
  ["Die Speicherbestätigung ist ungültig oder abgelaufen", "Save confirmation token is invalid or expired"],
  ["Die Bestätigung des alten Werts passt nicht zu dieser Sitzung", "Old value confirmation does not match this session"],
  ["Die Bestätigung des neuen Werts passt nicht zu dieser Sitzung", "New value confirmation does not match this session"],
  ["Während des laufenden Extrusionsbefehls kann nicht abgebrochen werden", "Cannot cancel while the synchronous extrusion command is running"],
  ["Alle Werte müssen endliche Zahlen sein", "All values must be finite numbers"],
  ["Die aktuelle rotation_distance liegt außerhalb des unterstützten Bereichs", "The current rotation_distance is outside the supported range"],
  ["Markierungsabstand und Extrusionsstrecke müssen positiv sein", "Mark and extrusion distances must be positive"],
  ["Die Reststrecke darf nicht negativ sein", "Remaining distance cannot be negative"],
  ["Die Reststrecke muss kleiner als der Markierungsabstand sein", "Remaining distance must be smaller than the mark distance"],
  ["Die berechnete rotation_distance ist unrealistisch.", "The calculated rotation_distance is not realistic."],
  ["Die gemessene Extrusion weicht um mehr als 20 % vom angeforderten Wert ab.", "The measured extrusion differs by more than 20% from the request."],
  ["Die gemessene Extrusion weicht um mehr als 10 % ab; miss sorgfältig nach.", "The measured extrusion differs by more than 10%; remeasure carefully."],
  ["Die neue rotation_distance verändert den aktuellen Wert um mehr als 20 %.", "The new rotation_distance changes the current value by more than 20%."],
  ["Klipper muss verbunden und bereit sein", "Klipper must be connected and ready"],
  ["Während eines Drucks oder einer Pause ist die Aktion gesperrt", "The action is blocked during a print or pause"],
  ["Kalibrierung ist nicht verfügbar", "Calibration is unavailable"],
  ["Klipper hat bereits ungespeicherte SAVE_CONFIG-Werte. Speichere oder verwerfe diese zuerst, damit die Kalibrierung keine fremden Änderungen übernimmt.", "Klipper already has unsaved SAVE_CONFIG values. Save or discard them first so this calibration does not include unrelated changes."],
  ["Für diese Kalibrierung ist keine Sitzung aktiv", "No session is active for this calibration"],
  ["Unbekannte Kalibrierung", "Unknown calibration"],
  ["Der gewählte Heizer ist nicht konfiguriert", "The selected heater is not configured"],
  ["Extruder-Typ muss Direct Drive oder Bowden sein", "The extruder type must be Direct Drive or Bowden"],
  ["Achse muss X, Y oder beide sein", "The axis must be X, Y, or both"],
  ["Unbekannte Kalibrierung oder Aktion", "Unknown calibration or action"],
  ["Diese Kalibrierung ist bereits beendet", "This calibration has already ended"],
  ["Beende oder brich den Testdruck in Mainsail ab, bevor du die Pressure-Advance-Kalibrierung verlässt.", "Finish or cancel the test print in Mainsail before leaving Pressure Advance calibration."],
  ["Diese PID-Aktion ist nicht erlaubt", "This PID action is not allowed"],
  ["Vor dem Bed Mesh müssen alle Achsen referenziert werden", "All axes must be homed before bed mesh calibration"],
  ["Diese Bed-Mesh-Aktion ist nicht erlaubt", "This bed mesh action is not allowed"],
  ["Diese Schrauben-Aktion ist nicht erlaubt", "This screw action is not allowed"],
  ["Vor SCREWS_TILT_CALCULATE müssen alle Achsen referenziert werden", "All axes must be homed before SCREWS_TILT_CALCULATE"],
  ["Diese Gantry-Aktion ist nicht erlaubt", "This gantry action is not allowed"],
  ["Vor der Gantry-Kalibrierung müssen alle Achsen referenziert werden", "All axes must be homed before gantry calibration"],
  ["Diese Bed-Screws-Aktion ist nicht erlaubt", "This bed screws action is not allowed"],
  ["Vor PROBE_CALIBRATE müssen alle Achsen referenziert werden", "All axes must be homed before PROBE_CALIBRATE"],
  ["Nicht erlaubte TESTZ-Schrittweite", "Invalid TESTZ step size"],
  ["Diese Probe-Aktion ist nicht erlaubt", "This probe action is not allowed"],
  ["Messhöhe muss zwischen 0 und 100 mm liegen", "The measured height must be between 0 and 100 mm"],
  ["Berechneter Pressure-Advance-Wert ist unplausibel", "The calculated Pressure Advance value is implausible"],
  ["Diese Pressure-Advance-Aktion ist nicht erlaubt", "This Pressure Advance action is not allowed"],
  ["Diese Flow-Aktion ist nicht erlaubt", "This flow action is not allowed"],
  ["Für die Flow-Berechnung sind genau vier Messwerte erforderlich", "Exactly four measurements are required to calculate flow"],
  ["Sollmaß und Messwerte müssen größer als null sein", "The target size and measurements must be greater than zero"],
  ["Das Ergebnis liegt außerhalb des sicheren Bereichs 70–130 %", "The result is outside the safe range of 70–130 %"],
  ["Vor der Resonanzmessung müssen X und Y referenziert werden", "X and Y must be homed before resonance measurement"],
  ["Diese Input-Shaper-Aktion ist nicht erlaubt", "This Input Shaper action is not allowed"],
  ["Speicherbestätigung ist ungültig oder abgelaufen", "Save confirmation is invalid or expired"],
  ["Ungültiger Zahlenwert", "Invalid numeric value"],
  ["Zahlenwert muss endlich sein", "The numeric value must be finite"],
  ["Klipper ist für eine sichere Extrusion nicht bereit", "Klipper is not ready for a safe extrusion"],
  ["Klipper meldet eine ungültige max_extrude_only_distance", "Invalid max_extrude_only_distance reported by Klipper"],
  ["Ungültige Rotationsdistanz", "Invalid rotation distance"],
  ["Das simulierte Hotend ist nicht bereit zum Extrudieren", "Mock hotend is not ready to extrude"],
  ["Die vorhandene rotation_distance ist keine einfache Zahl", "Existing rotation_distance is not a plain number"],
  ["Die Konfiguration wurde seit der Kalibrierung geändert; der aktuelle Wert wird nicht überschrieben", "Configuration changed since calibration; refusing to overwrite the current value"],
  ["Die rotation_distance-Zeile konnte nicht sicher geändert werden", "Could not safely rewrite the rotation_distance line"],
  ["Der neue Wert muss endlich sein", "New value must be finite"],
  ["Die Konfiguration wurde seit der Vorschau geändert; neuere Werte werden nicht überschrieben", "Configuration changed since preview; refusing to overwrite newer values"],
  ["Es wurden keine Abschnittseinstellungen angegeben", "No section settings were supplied"],
  ["Zustandsänderungen von einer anderen Herkunft sind nicht erlaubt", "Cross-origin state changes are not allowed"],
  ["Frontend ist nicht installiert", "Frontend is not installed"],
  ["Punkt", "Point"],
  ["Extruder-Kalibrierung", "Extruder calibration"],
  ["0,40 mm", "0.40 mm"],
  ["Bewegungsgeschwindigkeit", "Travel speed"],
  ["Z-Höhe beim Verfahren", "Travel Z height"],
  ["Papier-Test-Höhe", "Paper test height"],
  ["Wiederholungen", "Retries"],
  ["Wiederholungstoleranz", "Retry tolerance"],
  ["Maximale Korrektur", "Maximum adjustment"],
  ["Prüfen", "Verify"],
  ["bereit", "ready"],
  ["nicht verbunden", "disconnected"],
  ["Heruntergefahren", "shutdown"],
  ["Startet", "startup"],
  ["Fehler", "error"],
  ["Druckt", "printing"],
  ["Pausiert", "paused"],
  ["Inaktiv", "standby"],
  ["Abgebrochen", "cancelled"],
  ["Fehlgeschlagen", "failed"],
  ["Düse", "Nozzle"],
];

const templates = [
  ["Klipper-Zustand: {state}", "Klipper state is {state}"],
  [
    "Extrudiere {distance} mm erneut",
    "Extrude {distance} mm again"
  ],
  [
    "Extrudiere {distance} mm",
    "Extrude {distance} mm"
  ],
  [
    "Name von Schraube {index} enthält ungültige Zeichen",
    "Name of screw {index} contains invalid characters"
  ],
  [
    "Es werden {minimum} bis {maximum} Punkte benötigt",
    "Between {minimum} and {maximum} points are required"
  ],
  [
    "Punkt {index} ist ungültig",
    "Point {index} is invalid"
  ],
  [
    "{label} benötigt X und Y",
    "{label} requires X and Y"
  ],
  [
    "{label} muss ganzzahlig sein",
    "{label} must be an integer"
  ],
  [
    "{label} muss zwischen {minimum} und {maximum} liegen",
    "{label} must be between {minimum} and {maximum}"
  ],
  [
    "{label} ist keine gültige Zahl",
    "{label} is not a valid number"
  ],
  [
    "Aktion ist in Zustand {state} nicht erlaubt; erwartet: {expected}",
    "Action is not allowed in {state}; expected {expected}"
  ],
  [
    "Klipper muss bereit sein (aktueller Zustand: {state})",
    "Klipper must be ready (current state: {state})"
  ],
  [
    "Die Temperatur muss zwischen {minimum} und 300 °C liegen",
    "Temperature must be between {minimum} and 300 °C"
  ],
  [
    "Zieltemperatur muss in 5-°C-Schritten zwischen {minimum} und {maximum} liegen",
    "Target temperature must be in 5 °C increments between {minimum} and {maximum}"
  ],
  [
    "Aktualisiert: {source}; Backup: {backup}",
    "Updated {source}; backup: {backup}"
  ],
  [
    "Die Quelldatei der Einstellung liegt außerhalb des beschreibbaren Konfigurationsverzeichnisses: {path}",
    "Setting source is outside the writable config root: {path}"
  ],
  [
    "Konfigurationsdatei existiert nicht: {path}",
    "Configuration file does not exist: {path}"
  ],
  [
    "Das Include-Muster findet keine Dateien: {pattern}",
    "Include pattern matched no files: {pattern}"
  ],
  [
    "[{section}] {key} wurde im geladenen Konfigurationsbaum nicht gefunden",
    "[{section}] {key} was not found in the loaded config tree"
  ],
  [
    "Die Einstellung ist mehrdeutig; gefunden in {locations}",
    "Setting is ambiguous; found at {locations}"
  ],
  [
    "Abschnitt [{section}] fehlt oder ist mehrdeutig",
    "Section [{section}] is missing or ambiguous"
  ],
  [
    "{key} konnte nicht sicher geändert werden",
    "Could not safely rewrite {key}"
  ],
  [
    "Ungültiger Einstellungsname: {key}",
    "Invalid setting name: {key}"
  ],
  [
    "Unsichere Zeichen in [{section}] {key}",
    "Unsafe characters in [{section}] {key}"
  ],
  [
    "Abschnitt [{section}] ist mehrdeutig; gefunden in {locations}",
    "Section [{section}] is ambiguous; found in {locations}"
  ]
];

let locale = localStorage.getItem("kcw-language") || (navigator.language?.toLowerCase().startsWith("de") ? "de" : "en");
if (!messages[locale]) locale = "en";

export const getLocale = () => locale;
export const setLocale = (value) => { locale = messages[value] ? value : "en"; localStorage.setItem("kcw-language", locale); document.documentElement.lang = locale; };
export const t = (key) => messages[locale][key] ?? messages.en[key] ?? key;

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const placeholder = /\{(\w+)\}/g;
const translators = Object.fromEntries(["de", "en"].map(language => {
  // Accept both source languages, including text already rendered in the selected language.
  const replacements = new Map();
  for (const [de, en] of pairs) {
    const target = language === "de" ? de : en;
    if (!replacements.has(de)) replacements.set(de, target);
    if (!replacements.has(en)) replacements.set(en, target);
  }
  for (const key of ["welcomeTitle", "welcomeBody"]) {
    for (const source of ["de", "en"]) replacements.set(messages[source][key], messages[language][key]);
  }
  const pattern = [...replacements.keys()].sort((a, b) => b.length - a.length).map(escapePattern).join("|");
  const regex = new RegExp(pattern, "gu");
  const dynamic = templates.flatMap(pair => pair.map(source => {
    const names = [...source.matchAll(placeholder)].map(match => match[1]);
    const expression = source.split(placeholder).map((part, index) => index % 2 ? "(.+?)" : escapePattern(part)).join("");
    return {regex: new RegExp(`^${expression}$`, "u"), names, target: pair[language === "de" ? 0 : 1], specificity: source.replace(placeholder, "").length};
  }));
  dynamic.sort((a, b) => b.specificity - a.specificity);
  return [language, {replacements, regex, dynamic}];
}));

const wordCharacter = /[\p{L}\p{N}_]/u;
function replacePhrases(text, replacements, regex) {
  return text.replace(regex, (match, offset) => {
    // Punctuation fragments may follow inline values; words must remain whole.
    if (wordCharacter.test(match[0]) && wordCharacter.test(text[offset - 1] || "")) return match;
    if (wordCharacter.test(match.at(-1)) && wordCharacter.test(text[offset + match.length] || "")) return match;
    return replacements.get(match);
  });
}

export function translate(value) {
  const {replacements, regex, dynamic} = translators[locale];
  const text = String(value);
  const trimmed = text.trim();
  for (const entry of dynamic) {
    const match = trimmed.match(entry.regex);
    if (!match) continue;
    const values = Object.fromEntries(entry.names.map((name, index) => [name, name === "label" ? replacePhrases(match[index + 1], replacements, regex) : match[index + 1]]));
    const translated = entry.target.replace(placeholder, (_, name) => values[name]);
    return text.slice(0, text.indexOf(trimmed)) + translated + text.slice(text.indexOf(trimmed) + trimmed.length);
  }
  return replacePhrases(text, replacements, regex);
}

// Keep the original text so repeated language changes do not reverse ambiguous translations.
const originals = new WeakMap();
function localizedValue(owner, key, value) {
  let entries = originals.get(owner);
  if (!entries) { entries = new Map(); originals.set(owner, entries); }
  const previous = entries.get(key);
  const source = previous?.rendered === value ? previous.source : value;
  const rendered = translate(source);
  entries.set(key, {source, rendered});
  return rendered;
}

export function localize(root = document.body) {
  if (!root) return;
  document.documentElement.lang = locale;
  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    if (node.parentElement?.closest("code, pre, script, style, [data-no-i18n]")) continue;
    const changed = localizedValue(node, "text", node.nodeValue);
    if (changed !== node.nodeValue) node.nodeValue = changed;
  }
  const elements = [...(root.querySelectorAll?.("[placeholder],[aria-label],[title]") || [])];
  if (root.nodeType === Node.ELEMENT_NODE) elements.unshift(root);
  for (const element of elements) {
    if (element.closest("code, pre, script, style, [data-no-i18n]")) continue;
    for (const attribute of ["placeholder", "aria-label", "title"]) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      const changed = localizedValue(element, attribute, value);
      if (changed !== value) element.setAttribute(attribute, changed);
    }
  }
}
