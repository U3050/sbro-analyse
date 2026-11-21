/* Standalone installation on iPhone and desktop browsers; no push subscription until a server exists. */
(() => {
  let deferredInstall = null;
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const installButton = () => document.getElementById('install-pwa');
  const updateButton = () => { const btn = installButton(); if (btn) btn.hidden = installed(); };
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(error => console.warn('Offline-Modus nicht verfügbar:',error)));
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; updateButton(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; updateButton(); });
  function instructions() {
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const title = apple ? 'Auf dem iPhone installieren' : 'SBro Analyse installieren';
    const steps = apple ? 'Öffne diese HTTPS-Webadresse in Safari, tippe auf „Teilen“ und danach „Zum Home-Bildschirm“. Bestätige mit „Hinzufügen“. In neueren iOS-Versionen kann die Option „Zu Home-Bildschirm“ heißen.' : 'Öffne SBro über eine HTTPS-Adresse in Edge oder Chrome und nutze dort „App installieren“ oder „Zum Startbildschirm hinzufügen“. Die lokal geöffnete HTML-Datei ist nicht installierbar.';
    if (typeof openModal === 'function') {
      openModal(title, '<p class="explainer">'+steps+'</p><p class="explainer"><strong>Wichtig:</strong> Das Installieren schaltet noch keine Live-Kursdaten oder Hintergrund-Pushs frei. Depotdaten werden lokal auf diesem Gerät gespeichert. Sichere dein Depot unter „Daten & Speicherung“ als JSON-Backup.</p><div class="modal-actions"><button class="btn btn-primary" type="button" id="cancel-modal">Verstanden</button></div>');
    } else alert(steps);
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('#install-pwa');
    if (!target) return;
    if (installed()) return;
    if (!deferredInstall) { instructions(); return; }
    const prompt = deferredInstall;
    deferredInstall = null;
    try { await prompt.prompt(); await prompt.userChoice; } catch { instructions(); }
    updateButton();
  });
  window.addEventListener('offline', () => { if (typeof toast === 'function') toast('Offline: Dein gespeichertes Depot bleibt verfügbar; neue Kursdaten können nicht geladen werden.', true); });
  updateButton();
})();