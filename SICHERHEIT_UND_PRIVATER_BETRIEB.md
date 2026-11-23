# SBro Analyse – Sicherer Bereitstellungsweg (Version 1.7)

## Aktueller Sicherheitsstand
- Repository U3050/sbro-analyse: **öffentlich**, GitHub Pages: **öffentlich**. Jeder kann HTML, CSS und JavaScript herunterladen. Ein clientseitiger Login kann das NICHT verhindern.
- Neues optionales Modul `vault.js`: lokale AES-GCM-256 Verschlüsselung mit PBKDF2-SHA256 (310.000 Iterationen, 16-Byte Salt), Passwort mindestens 12 Zeichen. Depotzustand und Cloudflare ACCESS_TOKEN werden auf dem jeweiligen Gerät verschlüsselt gespeichert. Automatische Sperre nach Inaktivität. Noch nicht vollständig auf iOS getestet; vor Aktivierung ein JSON-Backup sicher aufbewahren.
- `ACCESS_TOKEN` im Cloudflare Worker schützt API-Endpunkte, ersetzt aber keine individuellen Nutzerkonten. Wenn mehrere Nutzer denselben Code haben, sind Nutzung und Kosten nicht pro Nutzer begrenzt.
- PIN/Passwort im Browser schützt Daten **auf dem Gerät**, nicht den öffentlich bereitgestellten Javascript-Quellcode. Optionales Face ID via WebAuthn ist nicht umgesetzt.
- Keine geheimen API-Keys im GitHub-Repository oder Browser-Code hinterlegen!

## Für privaten Quellcode und eine für Fremde unzugängliche App
1. Neue **private** GitHub-Repositorykopie oder geschützte Quelle erstellen. Vorher Backups bestehender Quellcode- und Depotsicherungen erstellen. **Die Historie eines bereits öffentlich gewesenen Repositories ist potenziell weiterhin kopiert oder archiviert**.
2. Die App von GitHub Pages zu einer **Cloudflare-gehosteten, über Cloudflare Access geschützten** App oder zu einer anderen Hostingplattform mit serverseitiger Authentifizierung migrieren. Die gesamte Produktionsseite einschließlich JS, CSS, Manifest, Service Worker und API-Routen muss VOR der Auslieferung Authentifizierung prüfen. Die bisherige GitHub-Pages-Adresse bleibt bis zum Abschalten öffentlich!
3. Cloudflare Zero Trust / Access: **Self-hosted Anwendung** mit Allow-Liste deiner E-Mail-Adressen, MFA bzw. Einmalcode oder Identity Provider und eindeutiger Session-Dauer konfigurieren. Prüfen, dass auch direkte Asset-URLs und die alternative pages.dev-Domain geschützt sind.
4. Danach GitHub Pages als öffentliche Quelle abschalten (GitHub Repository → Settings → Pages). Repository privat schalten, sobald eine alternative Deployment-Quelle läuft; sonst kann die bestehende App ausfallen.
5. Für weitere Nutzer: pro Nutzer eigener Identitätsnachweis, backendseitig überprüfte Berechtigungen und Rate-Limits, getrennte Kostenkonten oder pro-Nutzer-Quoten. Keinen gemeinsam genutzten ACCESS_TOKEN an andere weitergeben.
6. Browser-Code bleibt **auch nach Login für jeden autorisierten Nutzer sichtbar**. Geschäftslogik, die tatsächlich geheim bleiben muss, ausschließlich auf dem Server ausführen. Clientseitige Verschleierung bietet keine verlässliche Sicherheit.
7. Vor produktiver Nutzung: Sicherheitsprüfung auf XSS, CSP, Storage-Migration, Verschlüsselung, Backup-Wiederherstellung, PWA Offline-Verhalten, Mehrgeräte- und iOS-Safari-Szenarien sowie Cloudflare-Zugriffsregeln durchführen.

## Bestehende Depotdaten schützen
- Vor Aktivierung des Tresors: bisheriges JSON-Backup über Datenquellen exportieren und sicher verwahren; die alte Sicherung ist unverschlüsselt.
- Dann Datenquellen → `Tresor aktivieren` → starkes, einzigartiges Passwort mit mindestens 12 Zeichen wählen.
- Die Verschlüsselung erfolgt lokal, die Schlüsselableitung aus dem Passwort direkt im Browser. Es existiert kein Passwort-Reset. Ohne Passwort kein Zugriff auf die Daten.
- Unter Datenquellen → `Verschlüsseltes Backup` exportieren. Das verschlüsselte Backup kann auf einem anderen Gerät mit dem ursprünglichen Passwort importiert werden.
- Bei Gerätverlust können ungesicherte Änderungen verloren sein. Browserdaten sind kein Ersatz für Backups.

## Vertraulichkeit des Quellcodes
Solange `https://u3050.github.io/sbro-analyse/` aktiv ist, kann der ausgelieferte Code heruntergeladen werden. Die hier umgesetzte Verschlüsselung mindert das Risiko bei lokal gespeicherten privaten Depotdaten, verhindert aber kein Kopieren der App.
