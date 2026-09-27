# Signly

Hackathon-Prototyp für **13 isolierte ASL-Gebärden**. Kamera, Hand- und Oberkörperpunkte sowie das Wortmodell laufen lokal im Browser. Es gibt keinen Upload der Kamerabilder und keine Cloud-Inferenz. Das ist keine kontinuierliche Gebärdensprachübersetzung.

Unterstützt: **drink, help, yes, no, thank you, sad, cold, take, give, change, work, day, white**.

## Starten unter Windows

Voraussetzung: **Node.js 24** und npm. Im geklonten Projekt:

```powershell
cd app
npm.cmd ci
npm.cmd run assets
npm.cmd run dev
```

Die von Vite angezeigte `localhost`-Adresse öffnen und die Kamera freigeben. `assets` kopiert die installierten WASM-Dateien lokal; dieser Schritt ist nach einer frischen Installation nötig. Die Hand-, Pose- und Wortmodelle liegen bereits im Repository. Python und Trainingsvideos werden zum Starten der App nicht benötigt.

Hände und Oberkörper sichtbar halten, eine Gebärde vollständig ausführen, dann beide Hände kurz aus dem Bild nehmen und auf „Bereit“ warten. Die Wortliste wird beim Start der Erkennung geladen. Die Live-Grenze beträgt 85 % Modellkonfidenz; eine Aufnahme muss mindestens 0,6 Sekunden lang sein. Ablehnungsgründe erscheinen im Ergebnisfeld. Eine Prozentanzeige ist keine gemessene Erkennungsgenauigkeit.

## Prüfen und Demo vorbereiten

Aus `app`:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Nach Installation und Asset-Kopie braucht die Erkennung keine externen Modelle oder Dienste. Den Build über den lokalen Server öffnen, nicht direkt als HTML-Datei. Außerhalb von localhost benötigt der Kamerazugriff HTTPS. Vor der Demo auf dem tatsächlichen Rechner Beleuchtung, Kamerafreigabe, einige Wörter, Pause/Fortsetzen und Stoppen prüfen. Die Webcam-Genauigkeit ist noch nicht systematisch gemessen.

## Entwicklungsstand

- Die 13-Wörter-Version bleibt aktiv. Größere Versuche bis 27 Wörter und eine kleine Erweiterung per Transfer-Lernen haben die Qualitätsprüfung nicht bestanden.
- Kein automatischer Wechsel zu Mock-Daten oder Buchstaben. `?mock=1` ist eine gekennzeichnete UI-Demo; `?mode=legacy` und `/collector.html` sind optionale alte Diagnosewerkzeuge.
- Rohvideos, Landmark-Caches, Python-Umgebung und experimentelle Checkpoints sind bewusst nicht in Git. Die App benötigt diese Dateien nicht.
- Forschungsprüfungen benötigen Python 3.12, die [gesperrten Abhängigkeiten](research/word-signs/requirements-lock.txt) und die wiederhergestellten Forschungsdaten/Artefakte. Sie gehören nicht zum normalen App-Start. Die historischen Berichte beschreiben den jeweiligen Stand vor dem abschließenden Commit.

Details: [RecognitionResult-Vertrag](docs/RECOGNITION_CONTRACT.md), [13-Wörter-Modell und Reproduktion](docs/WORD_EXPANSION_REPORT.md), [Live-Anpassung](docs/WEBCAM_TUNING.md), [Erweiterungsversuche](docs/WORD_EXPANSION_V3_REPORT.md), [kleiner Transfer-Versuch](docs/TRANSFER_V4_REPORT.md).

Die ursprünglichen Laptop-A/B-Prompts und die alte Aufbauanleitung in `docs` sind historische Planungsunterlagen. Für den aktuellen Start gilt diese README. Daten- und Modellquellen sowie Lizenzhinweise stehen in den Berichten und unter [lokale Modelle](app/public/models/README.md).
