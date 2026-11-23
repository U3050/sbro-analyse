'use strict';
/* SBro local vault: PBKDF2-SHA256 (310000 iterations), AES-GCM-256; opt-in.
   This protects locally stored data at rest, not code sent to a browser.
   Password and derived key never leave the device. No password recovery. */
(function(){
  const STORE='sbro-secure-vault-v1', LEGACY='sbro-v2', LEGACY_API='sbro-cloud-api-v1';
  const enc=new TextEncoder(),dec=new TextDecoder(), rounds=310000;
  const toB64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const fromB64=text=>Uint8Array.from(atob(text),ch=>ch.charCodeAt(0));
  let key=null,unlocked=false,saving=Promise.resolve(), getPayload=()=>({}),onRestore=()=>{},onLock=()=>{};
  let lastActivity=Date.now(),busy=false,overlay=null,hiddenSince=0;
  const hasVault=()=>!!localStorage.getItem(STORE);
  const enabled=()=>hasVault();
  const isLocked=()=>hasVault()&&!unlocked;
  async function derive(password,salt){
    const raw=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:rounds,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encrypt(payload,k,salt){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,enc.encode(JSON.stringify(payload)));
    return JSON.stringify({v:1,kdf:'PBKDF2-SHA256',iterations:rounds,salt:toB64(salt),iv:toB64(iv),ciphertext:toB64(data)});
  }
  async function unlock(password){
    const stored=JSON.parse(localStorage.getItem(STORE)||'null');
    if(!stored||stored.v!==1||stored.iterations!==rounds)throw Error('Unbekanntes Tresorformat. Bitte keine Daten löschen.');
    const k=await derive(password,fromB64(stored.salt));
    let payload;
    try{payload=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(stored.iv)},k,fromB64(stored.ciphertext))));}
    catch{throw Error('Passwort falsch oder verschlüsselte Daten beschädigt.');}
    if(!payload||!payload.state||!Array.isArray(payload.state.transactions))throw Error('Ungültige Tresordaten. Keine Änderungen vorgenommen.');
    key=k;unlocked=true;lastActivity=Date.now();hideOverlay();onRestore(payload);
  }
  function save(payload){
    if(!hasVault()||!unlocked||!key) return Promise.resolve();
    const snapshot=JSON.parse(JSON.stringify(payload));
    saving=saving.catch(()=>{}).then(async()=>{
      const previous=JSON.parse(localStorage.getItem(STORE));
      const salt=fromB64(previous.salt);
      const packed=await encrypt(snapshot,key,salt);
      localStorage.setItem(STORE,packed);
    }).catch(e=>{alert('Tresor konnte nicht gespeichert werden: '+String(e.message||e));throw e;});
    return saving;
  }
  function styles(){
    if(document.getElementById('sbro-vault-style'))return;
    const style=document.createElement('style');style.id='sbro-vault-style';
    style.textContent='.sbro-vault-cover{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;overflow:auto;background:#f3f0e8;padding:20px;color:#284331;font:16px system-ui,-apple-system,sans-serif}.sbro-vault-card{width:min(440px,100%);padding:28px;background:#fffdfa;border:1px solid #dcded2;border-radius:22px;box-shadow:0 14px 50px #23382d22}.sbro-vault-card h2{margin:0 0 12px;font:600 28px Georgia,serif}.sbro-vault-card p{line-height:1.5}.sbro-vault-card label{display:block;font-weight:600;margin:15px 0 6px}.sbro-vault-card input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #aab7a9;border-radius:10px;font:inherit}.sbro-vault-card button{width:100%;padding:13px;margin-top:18px;color:#fff;background:#3a5f46;border:0;border-radius:10px;font-weight:700;font-size:16px}.sbro-vault-card button:disabled{opacity:.6}.sbro-vault-error{color:#a31e35;font-weight:600;min-height:1.4em}.sbro-vault-note{font-size:13px;color:#626e64}';
    document.head.append(style);
  }
  function hideOverlay(){
    overlay?.remove();overlay=null;
    const shell=document.querySelector('.app-shell');if(shell)shell.inert=false;
  }
  function dialog(mode){
    styles();overlay?.remove();
    const shell=document.querySelector('.app-shell');if(shell)shell.inert=true;
    overlay=document.createElement('div');overlay.className='sbro-vault-cover';
    const setup=mode==='setup';
    overlay.innerHTML='<section class="sbro-vault-card" role="dialog" aria-modal="true" aria-labelledby="sbro-vault-title"><h2 id="sbro-vault-title">'+(setup?'Depot-Tresor aktivieren':'SBro Analyse entsperren')+'</h2><p>'+(setup?'Verschlüssele dein Depot und den Zugangscode lokal auf diesem Gerät.':'Dein Depot ist auf diesem Gerät verschlüsselt.')+'</p><form id="sbro-vault-form"><label for="vault-pass">Passwort</label><input id="vault-pass" name="pass" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" required minlength="'+(setup?'12':'1')+'">'+(setup?'<label for="vault-confirm">Passwort wiederholen</label><input id="vault-confirm" name="confirm" type="password" autocomplete="new-password" required minlength="12">':'')+'<p class="sbro-vault-error" aria-live="assertive"></p><button type="submit">'+(setup?'Verschlüsselung aktivieren':'Entsperren')+'</button></form><p class="sbro-vault-note">Kein Passwort-Reset: Ohne Passwort sind die Daten nicht wiederherstellbar. Backups sicher aufbewahren. Dieser Schutz versteckt nicht den öffentlich ausgelieferten App-Code.</p>'+(setup?'<button type="button" id="vault-cancel" style="background:#e7ebe2;color:#284331">Abbrechen</button>':'')+'</section>';
    document.body.append(overlay);
    overlay.querySelector('#vault-cancel')?.addEventListener('click',hideOverlay);
    overlay.querySelector('form').addEventListener('submit',async ev=>{
      ev.preventDefault();if(busy)return;busy=true;
      const form=ev.currentTarget,btn=form.querySelector('button'),error=form.querySelector('.sbro-vault-error');btn.disabled=true;error.textContent='';
      try{
        const password=form.elements.pass.value;
        if(setup){
          if(password.length<12)throw Error('Bitte mindestens 12 Zeichen verwenden.');
          if(password!==form.elements.confirm.value)throw Error('Passwörter stimmen nicht überein.');
          if(hasVault())throw Error('Tresor existiert bereits.');
          const salt=crypto.getRandomValues(new Uint8Array(16)),k=await derive(password,salt);
          const packed=await encrypt(getPayload(),k,salt);
          localStorage.setItem(STORE,packed); // Only remove unencrypted originals after successful write.
          key=k;unlocked=true;localStorage.removeItem(LEGACY);localStorage.removeItem(LEGACY_API);
          hideOverlay();alert('Depot-Tresor aktiviert. Passwort gut aufbewahren.');lastActivity=Date.now();
        }else await unlock(password);
      }catch(e){error.textContent=String(e.message||'Aktion fehlgeschlagen.');}
      finally{form.elements.pass.value='';if(setup)form.elements.confirm.value='';btn.disabled=false;busy=false;}
    });
    overlay.querySelector('#vault-pass').focus();
  }
  async function lock(){
    if(!hasVault()||!unlocked)return;
    try{await saving;}catch{alert('Speichern fehlgeschlagen. Tresor bleibt geöffnet, bis du es erneut versuchst.');return;}
    unlocked=false;key=null;onLock();dialog('unlock');
  }
  function configure(callbacks){
    getPayload=callbacks.getPayload;onRestore=callbacks.onRestore;onLock=callbacks.onLock;
    if(hasVault()){dialog('unlock');}
    for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,()=>{if(unlocked)lastActivity=Date.now();},{passive:true});
    setInterval(()=>{if(unlocked&&Date.now()-lastActivity>5*60*1000)lock();},30000);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)hiddenSince=Date.now();
      else if(hiddenSince&&unlocked&&Date.now()-hiddenSince>60*1000)lock();
    });
  }
  window.SBroVault={configure,hasVault,enabled,isLocked,save,setup:()=>{if(!hasVault())dialog('setup');},lock};
})();