# Signly: Start von null auf zwei Windows-Laptops

Laptop A übernimmt Kamera und Erkennung. Laptop B übernimmt Oberfläche und Dokumentation.

## 1. Auf beiden Laptops

Installiert Node.js LTS von https://nodejs.org/en/download und Git for Windows von https://git-scm.com/download/win, falls Git fehlt. Schließt danach alle PowerShell-Fenster und öffnet ein neues. Führt die Befehle einzeln aus:

~~~powershell
node --version
npm.cmd --version
git --version
~~~

Node muss mindestens 20.19 oder 22.12 anzeigen; eine neuere LTS-Version ist in Ordnung. Wenn node nicht gefunden wird, Terminal erneut öffnen. Falls es danach noch fehlt, Node mit aktivierter PATH-Option neu installieren und Windows ab- und wieder anmelden.

## 2. Leeres GitHub-Repository

Eine Person öffnet https://github.com/new, erstellt ein Repository namens signly und aktiviert dabei kein README, keine .gitignore und keine Lizenz. Unter Settings > Collaborators wird die zweite Person eingeladen. Notiert die URL https://github.com/DEIN-NAME/signly.git.

## 3. Laptop A: Repository starten

~~~powershell
Set-Location "$env:USERPROFILE\Desktop\Signly"
git init -b main
git config user.name "DEIN NAME"
git config user.email "DEINE-GITHUB-EMAIL"
git add docs
git commit -m "docs: freeze Signly plan and recognition contract"
git remote add origin https://github.com/DEIN-NAME/signly.git
git push -u origin main
~~~

Prüfen:

~~~powershell
git status
git branch --show-current
~~~

Es muss main erscheinen und GitHub muss die Dateien aus docs zeigen.

## 4. Laptop A: App-Grundgerüst

~~~powershell
Set-Location "$env:USERPROFILE\Desktop\Signly"
npm.cmd create vite@latest app -- --template react-ts
Set-Location app
npm.cmd install
npm.cmd install --save-exact @mediapipe/tasks-vision@0.10.35
npm.cmd install --save-dev --save-exact vitest tsx
npm.cmd run build
Set-Location ..
~~~

PASS: app\\dist existiert und es gibt keinen Build-Fehler. Danach docs/PROMPT_LAPTOP_A.md öffnen und dem Coding-Agenten zuerst nur den Bootstrap-Auftrag geben. Danach:

~~~powershell
git add .
git commit -m "chore: bootstrap app and recognition contract"
git push origin main
git switch -c feature/recognition
git push -u origin feature/recognition
~~~

## 5. Laptop B: klonen

Laptop B erzeugt kein zweites Vite-Projekt:

~~~powershell
Set-Location "$env:USERPROFILE\Desktop"
git clone https://github.com/DEIN-NAME/signly.git
Set-Location signly
git config user.name "DEIN NAME"
git config user.email "DEINE-GITHUB-EMAIL"
git switch -c feature/frontend
git push -u origin feature/frontend
Set-Location app
npm.cmd ci
~~~

Falls A später pusht, vorher im Projektordner git pull --ff-only origin main ausführen. Danach docs/PROMPT_LAPTOP_B.md an den Frontend-Agenten geben:

~~~powershell
npm.cmd run dev -- --host localhost --port 5173 --strictPort
~~~

Browser: http://localhost:5173/?mock=1. Die Seite muss MOCK DATA - UI DEVELOPMENT zeigen. Mock-Daten sind nur für die UI-Arbeit.

## 6. Erster echter Checkpoint

Nach etwa zwei Stunden darf niemand das Vokabular erweitern, bevor Laptop A Folgendes zeigt:

~~~
Start Camera -> Kamerabild -> MediaPipe-Handpunkte -> echtes A/B/C -> stabiler Match -> sichtbarer Text
~~~

Jeder Buchstabe muss 9 von 10 frischen, gehaltenen Versuchen korrekt akzeptieren; leere Kamera darf nichts anhängen; ein gehaltenes Zeichen darf nur einmal erscheinen. Bei FAIL: keine zusätzlichen Buchstaben und keine UI-Extras.

## 7. Gemeinsame Integration

Nur Laptop A integriert in main:

~~~powershell
Set-Location "$env:USERPROFILE\Desktop\Signly"
git switch main
git pull --ff-only origin main
git fetch origin
git merge --no-edit origin/feature/recognition
git merge --no-edit origin/feature/frontend
Set-Location app
npm.cmd test
npm.cmd run build
Set-Location ..
git push origin main
~~~

Laptop B holt Änderungen mit:

~~~powershell
Set-Location "$env:USERPROFILE\Desktop\signly"
git fetch origin
git merge --no-edit origin/main
~~~

Bei Konflikten: git status, Datei mit dem Besitzer gemeinsam lösen, dann git add DATEI und git commit. Niemals reset --hard oder Force-Push verwenden.

## 8. Aufgaben heute

Laptop A baut Erkennung, Collector, Modell, Stabilisierung und Integration. Laptop B baut Mock-Oberfläche, Transcript, Start/Pause/Clear/Backspace/Space, Statusanzeigen, README und Demoablauf. Bis Stunde 13 keine neuen Frameworks oder riskanten Features; die letzten vier Stunden sind für Tests, Offline-Build, Backup-Aufnahme und Probe.
