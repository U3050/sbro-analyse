/**
 * SBro Analyse – Cloudflare Worker v1.6 (November 2026).
 * Direkt in Cloudflare Workers > Edit code einfuegen. Modulformat; keine npm-Module.
 * Eigene Secrets in Cloudflare > Settings > Variables and Secrets:
 *   ACCESS_TOKEN       (Secret: frei waehlbarer langer Zugangscode)
 *   ALLOWED_ORIGIN     (Text: https://u3050.github.io)
 * Fuer Aktien: TWELVEDATA_API_KEY; fuer Kennzahlen: FMP_API_KEY;
 * fuer interaktive KI: OPENAI_API_KEY (alle als Secrets hinterlegen).
 * Bitcoin, Ethereum und Solana: Kraken Public API, kein Provider-Schluessel.
 * US-Aktien: optionaler Stooq-Tageskurs-Fallback ohne API-Key; nur EOD und ohne Garantien.
 * Fuer belastbare Aktien-Livekurse und Unternehmenskennzahlen weiterhin kostenpflichtige Quellen erforderlich.
 * Die KI rechnet serverseitig; Elliott-Zonen sind Heuristiken, keine Prognosegarantie.
 * Depot-KI: /api/portfolio-interpret (max 6 Symbole, jeweils serverseitiger Kursabruf).
 * Dieser Worker sendet noch keine Push-Nachrichten oder taeglichen Berichte.
 */
const CRYPTO={BTCUSD:['XBTUSD','Bitcoin'],ETHUSD:['ETHUSD','Ethereum'],SOLUSD:['SOLUSD','Solana']};
const METAL={XAUUSD:['XAU/USD','Gold'],XAGUSD:['XAG/USD','Silber'],XPTUSD:['XPT/USD','Platin'],XPDUSD:['XPD/USD','Palladium']};
const NAME={BTCUSD:'Bitcoin',ETHUSD:'Ethereum',SOLUSD:'Solana'};
const localCache=new Map();
const validSymbol=s=>/^[A-Z0-9.\-]{1,28}$/.test(s);
const num=v=>{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const isISIN=v=>{v=String(v||'').toUpperCase();if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v))return false;const s=[...v].map(c=>/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c).join('');let sum=0,double=false;for(let i=s.length-1;i>=0;i--){let x=Number(s[i]);if(double){x*=2;if(x>9)x-=9;}sum+=x;double=!double;}return sum%10===0;};
function getOrigin(env){return (env.ALLOWED_ORIGIN||'https://u3050.github.io').replace(/\/$/,'');}
function headers(env,origin){const allowed=getOrigin(env);return {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin',...(origin===allowed?{'access-control-allow-origin':allowed,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, Authorization','access-control-max-age':'300'}:{})};}
const json=(data,status,env,origin)=>new Response(JSON.stringify(data),{status,headers:headers(env,origin)});
function err(message,status=502){const e=new Error(message);e.status=status;return e;}
async function fromProvider(url,options={}){let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(14000),headers:{'Accept':'application/json',...(options.headers||{})}});}catch{throw err('Marktdatenanbieter derzeit nicht erreichbar oder Zeitlimit ueberschritten.',503);}let j;try{j=await r.json();}catch{throw err('Datenanbieter liefert kein lesbares JSON (HTTP '+r.status+').');}if(!r.ok||j?.status==='error'||j?.error?.length||j?.['Error Message']){throw err(String(j?.message||j?.['Error Message']||j?.error||`HTTP ${r.status}`).slice(0,180),502);}return j;}
function onePair(data){if(!data||typeof data!=='object')throw err('Ungültige Kraken-Antwort.');const keys=Object.keys(data).filter(k=>k!=='last');if(keys.length!==1)throw err('Kraken-Handelspaar ist nicht eindeutig.');return data[keys[0]];}
async function kraken(symbol){const [pair,name]=CRYPTO[symbol];const url=(route,extra={})=>'https://api.kraken.com/0/public/'+route+'?'+new URLSearchParams({pair,...extra});const [history,trade]=await Promise.all([fromProvider(url('OHLC',{interval:'1440'})),fromProvider(url('Ticker'))]);const rows=onePair(history.result),tick=onePair(trade.result);if(!Array.isArray(rows)||!Array.isArray(tick?.c))throw err('Kraken: fehlende Preisreihe.');if(!rows.length||Date.now()-Number(rows.at(-1)[0])*1000>72*3600000)throw err('Kraken: Tageskerzen sind veraltet; keine aktuelle Trendanalyse möglich.',503);const price=num(tick.c[0]);if(!(price>0))throw err('Kraken: Kurswert unbrauchbar.');const candles=rows.map(r=>({date:new Date(Number(r[0])*1000).toISOString().slice(0,10),open:num(r[1]),high:num(r[2]),low:num(r[3]),close:num(r[4]),volume:num(r[6])||0})).filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&[c.open,c.high,c.low,c.close].every(x=>x>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)).sort((a,b)=>a.date.localeCompare(b.date));if(candles.length<55||candles.some((c,i)=>i&&c.date<=candles[i-1].date))throw err('Kraken liefert zu wenige oder doppelte Tageskerzen.');const last=candles.at(-1);if(last.date!==new Date().toISOString().slice(0,10))throw err('Kraken: die aktuelle UTC-Tageskerze fehlt – Kurs und Zeitreihe nicht zusammenführen.',503);last.close=price;last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);return {symbol,name,currency:'USD',price,candles,provider:'Kraken',asof:new Date().toISOString(),quoteKind:'Letzter Kraken-Trade · Zeitpunkt des Abrufs',quoteNote:'Letzte Tageskerze noch offen; an letzten Kraken-Trade angepasst. Daten nur vom Kraken-USD-Markt.',provisionalLastCandle:true,market:'Kraken Spot USD',fundamentals:null};}
async function fundamentals(symbol,env){
  if(!env.FMP_API_KEY)throw err('FMP_API_KEY fehlt oder ist leer. Bitte einen gueltigen FMP-Schluessel als Cloudflare-Secret speichern.',424);
  // Try published TTM figures and annual ratios. Provider-plan restrictions must never be hidden.
  const url=route=>'https://financialmodelingprep.com/stable/'+route+'?'+new URLSearchParams({symbol,limit:'1',apikey:env.FMP_API_KEY});
  const routes=['ratios-ttm','ratios','cash-flow-statement','balance-sheet-statement'];
  const responses=await Promise.allSettled(routes.map(route=>fromProvider(url(route))));
  const warnings=[];
  const row=(i)=>{
    const result=responses[i];
    if(result.status!=='fulfilled'){warnings.push(routes[i]+': '+String(result.reason?.message||'Anbieterfehler').slice(0,140));return {};}
    const obj=Array.isArray(result.value)?result.value[0]:result.value;
    if(!obj||typeof obj!=='object'||!Object.keys(obj).length){warnings.push(routes[i]+': keine Daten');return {};}
    if(obj.symbol&&String(obj.symbol).toUpperCase()!==symbol){warnings.push(routes[i]+': Ticker passt nicht');return {};}
    return obj;
  };
  const ttm=row(0),annual=row(1),cash=row(2),balance=row(3);
  const pick=(...items)=>{for(const x of items){const n=num(x);if(n!==null)return n;}return null;};
  const annualIsUsed=Object.keys(ttm).length===0&&Object.keys(annual).length>0;
  const model={
    pe:pick(ttm.priceToEarningsRatioTTM,ttm.peRatioTTM,annual.priceToEarningsRatio,annual.priceEarningsRatio),
    debtEquity:pick(ttm.debtToEquityRatioTTM,annual.debtToEquityRatio),
    currentRatio:pick(ttm.currentRatioTTM,annual.currentRatio),
    profitMargin:pick(ttm.netProfitMarginTTM,annual.netProfitMargin),
    interestCoverage:pick(ttm.interestCoverageRatioTTM,annual.interestCoverageRatio),
    freeCashFlow:pick(cash.freeCashFlow),operatingCashFlow:pick(cash.operatingCashFlow),
    totalDebt:pick(balance.totalDebt),cashAndEquivalents:pick(balance.cashAndCashEquivalents),
    reportedCurrency:cash.reportedCurrency||balance.reportedCurrency||annual.reportedCurrency||null,
    reportDate:cash.date||balance.date||annual.date||null,
    valuationAsOf:new Date().toISOString(),
    source:'Financial Modeling Prep'+(annualIsUsed?' · letzte verfuegbare Jahreskennzahlen':' · TTM/Finanzberichte'),
    warnings,fetchedAt:new Date().toISOString()
  };
  const fields=['pe','debtEquity','currentRatio','profitMargin','interestCoverage','freeCashFlow','operatingCashFlow','totalDebt','cashAndEquivalents'];
  model.coverage=fields.filter(key=>model[key]!==null).length;
  model.partial=warnings.length>0||model.coverage<fields.length;
  if(!model.coverage)throw err('FMP bietet fuer '+symbol+' keine freigegebenen Kennzahlen. '+warnings.join(' | ').slice(0,360),424);
  return model;
}

async function twelve(symbol,env){if(!env.TWELVEDATA_API_KEY)throw err('Für Aktien und Edelmetalle fehlt TWELVEDATA_API_KEY.',424);const market=METAL[symbol]?.[0]||symbol;const params=new URLSearchParams({symbol:market,interval:'1day',outputsize:'260',format:'JSON',apikey:env.TWELVEDATA_API_KEY});const data=await fromProvider('https://api.twelvedata.com/time_series?'+params);if(!Array.isArray(data.values))throw err('Twelve Data liefert keine historischen Kurse.');const candles=data.values.map(x=>({date:String(x.datetime||'').slice(0,10),open:num(x.open),high:num(x.high),low:num(x.low),close:num(x.close),volume:num(x.volume)||0})).filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&[c.open,c.high,c.low,c.close].every(n=>n>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)).sort((a,b)=>a.date.localeCompare(b.date));if(candles.length<55||candles.some((c,i)=>i&&c.date<=candles[i-1].date))throw err('Zu wenige oder ungültige Tageskurse für eine EW-Analyse.');let quoteNote='Verwendet wird der letzte bestätigte Tageskerzenkurs (nicht Echtzeit).';let quoteKind='Letzter verfügbarer Tageskurs';let asof=candles.at(-1).date;const price=candles.at(-1).close;try{const q=await fromProvider('https://api.twelvedata.com/quote?'+new URLSearchParams({symbol:market,apikey:env.TWELVEDATA_API_KEY}));const qDate=String(q.datetime||q.timestamp||'').slice(0,10);const qPrice=num(q.close??q.price);if(qPrice>0&&qDate===asof&&Math.abs(qPrice-price)/price<.00001){quoteNote='Tageskurs und Quote stimmen überein.';quoteKind='Bestätigter Tageskurs';}}catch{}return {symbol,name:METAL[symbol]?.[1]||data.meta?.name||symbol,currency:data.meta?.currency||(METAL[symbol]?'USD':''),price,candles,asof,quoteKind,quoteNote,provider:'Twelve Data',fundamentals:METAL[symbol]||!env.FMP_API_KEY?null:await fundamentals(symbol,env).catch(()=>null)};}
/** No-key EOD fallback for US equities. Provider may rate-limit or block: never invent values. */
async function stooqEod(symbol,env){
  if(METAL[symbol]||CRYPTO[symbol]||!(/^[A-Z][A-Z0-9.-]{0,12}$/.test(symbol)))throw err('Für diese Anlageklasse ist kein kostenloser US-Aktien-Tageskurs verfügbar.',424);
  const lookup=symbol.toLowerCase().replace(/\./g,'-')+'.us';
  const end=new Date(),start=new Date(end.getTime()-480*86400000);
  const iso=d=>d.toISOString().slice(0,10).replace(/-/g,'');
  const url='https://stooq.com/q/d/l/?'+new URLSearchParams({s:lookup,i:'d',d1:iso(start),d2:iso(end)});
  let response;
  try{response=await fetch(url,{headers:{Accept:'text/csv'},signal:AbortSignal.timeout(14000)});}catch{throw err('Kostenlose US-Tageskurse sind derzeit nicht erreichbar. Für zuverlässige Daten TWELVEDATA_API_KEY hinterlegen.',503);}
  if(!response.ok)throw err('Kostenlose US-Tageskurse derzeit nicht verfügbar (HTTP '+response.status+').',503);
  const csv=await response.text();
  if(!csv.startsWith('Date,Open,High,Low,Close,Volume')||csv.length>500000)throw err('Stooq hat keine nutzbaren Tageskurse geliefert (ggf. Abruflimit). Bitte später versuchen oder Twelve Data verwenden.',503);
  const candles=csv.trim().split(/\r?\n/).slice(1).map(line=>{
    const p=line.split(',');return {date:p[0],open:num(p[1]),high:num(p[2]),low:num(p[3]),close:num(p[4]),volume:num(p[5])||0};
  }).filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&[c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)).sort((a,b)=>a.date.localeCompare(b.date));
  if(candles.length<55||candles.some((c,i)=>i&&c.date<=candles[i-1].date))throw err('Zu wenige oder ungültige Stooq-Tageskurse für eine seriöse Analyse.',503);
  const latest=candles.at(-1),ageDays=(Date.now()-Date.parse(latest.date+'T23:59:59Z'))/86400000;
  if(ageDays>9)throw err('Kostenlose Aktienkurse sind veraltet (letzter Datenstand '+latest.date+').',503);
  return {symbol,name:symbol,currency:'USD',price:latest.close,candles,asof:latest.date,provider:'Stooq · kostenlose EOD-Daten',quoteKind:'Letzter verfügbarer Tages-Schlusskurs · NICHT Echtzeit',quoteNote:'Kurs kann verzögert sein. Datenanbieter kann abraten, limitieren oder ausfallen; kein verifizierter Intraday-Kurs. Historische Kurse können an Kapitalmaßnahmen angepasst sein.',fundamentals:env.FMP_API_KEY?await fundamentals(symbol,env).catch(()=>null):null};
}
async function market(symbol,env){if(symbol==='BRONZE')throw err('Bronze ist eine Legierung ohne einheitlichen standardisierten Spotkurs.',422);const entry=localCache.get(symbol),ttl=CRYPTO[symbol]?60_000:900_000;if(entry&&Date.now()-entry.t<ttl)return entry.result;const result=CRYPTO[symbol]?await kraken(symbol):(env.TWELVEDATA_API_KEY?await twelve(symbol,env):(METAL[symbol]?await twelve(symbol,env):await stooqEod(symbol,env)));if(localCache.size>80)localCache.clear();localCache.set(symbol,{t:Date.now(),result});return result;}
async function openfigi(q){const type=isISIN(q)?'ID_ISIN':/^[A-Z0-9]{6}$/i.test(q)?'ID_WERTPAPIER':null;if(!type)return [];const j=await fromProvider('https://api.openfigi.com/v3/mapping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{idType:type,idValue:q.toUpperCase()}])});return (j?.[0]?.data||[]).filter(x=>validSymbol(String(x.ticker||'').toUpperCase())).slice(0,15).map(x=>({symbol:String(x.ticker).toUpperCase(),name:String(x.name||x.securityDescription||x.ticker).slice(0,100),isin:type==='ID_ISIN'?q.toUpperCase():'',wkn:type==='ID_WERTPAPIER'?q.toUpperCase():'',exchange:String(x.exchCode||'').slice(0,60),currency:'',source:'OpenFIGI · Handelsplatz prüfen'}));}
async function search(q,env){if(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(q)&&!isISIN(q))throw err('ISIN-Prüfziffer ungültig.',400);const jobs=[];if(env.FMP_API_KEY){const api='https://financialmodelingprep.com/stable/';const items=isISIN(q)?['search-isin?'+new URLSearchParams({isin:q,apikey:env.FMP_API_KEY})]:['search-symbol?'+new URLSearchParams({query:q,apikey:env.FMP_API_KEY,limit:'15'}),'search-name?'+new URLSearchParams({query:q,apikey:env.FMP_API_KEY,limit:'15'})];for(const item of items)jobs.push(fromProvider(api+item).then(arr=>Array.isArray(arr)?arr.map(x=>({symbol:String(x.symbol||'').toUpperCase(),name:String(x.name||x.companyName||x.symbol).slice(0,100),isin:String(x.isin||'').slice(0,12),exchange:String(x.exchangeFullName||x.exchange||'').slice(0,60),currency:String(x.currency||'').slice(0,8),source:'FMP'})):[]));}if(isISIN(q)||/^[A-Z0-9]{6}$/i.test(q))jobs.push(openfigi(q));if(!jobs.length)throw err('Für eine Online-Namenssuche ist ein FMP-Zugang nötig; ISIN/WKN kann OpenFIGI auflösen.',424);const results=await Promise.allSettled(jobs);const merged=[],errors=[];for(const res of results){if(res.status==='fulfilled')merged.push(...res.value);else errors.push(res.reason.message);}if(!merged.length&&errors.length===results.length)throw err(errors.join(' · ').slice(0,150));const unique=new Map();for(const item of merged){if(!validSymbol(item.symbol))continue;const key=item.symbol+'|'+item.exchange;if(!unique.has(key))unique.set(key,item);}return {query:q,results:[...unique.values()].slice(0,20),source:'FMP / OpenFIGI'};}
async function events(symbol,env){if(!env.FMP_API_KEY)throw err('Für Unternehmensevents fehlt FMP_API_KEY.',424);const from=new Date().toISOString().slice(0,10),to=new Date(Date.now()+120*86400000).toISOString().slice(0,10);const j=await fromProvider('https://financialmodelingprep.com/stable/earnings-calendar?'+new URLSearchParams({symbol,from,to,apikey:env.FMP_API_KEY}));if(!Array.isArray(j))throw err('Anbieter lieferte keinen Event-Kalender.');return {symbol,source:'FMP',asof:new Date().toISOString(),note:'Ergebnistermine sind Anbieterangaben; keine verifizierten Hauptversammlungen.',events:j.filter(x=>x.symbol===symbol&&/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'').slice(0,10))).map(x=>({symbol,date:String(x.date).slice(0,10),type:'earnings',label:'Ergebnisveröffentlichung (Anbietertermin)',source:'FMP',verified:false})).slice(0,20)};}
/** Deterministic server-side indicators. No client-provided prices or Elliott points are trusted. */
function signals(record){
  const c=record.candles, prices=c.map(x=>x.close), n=prices.length, last=prices.at(-1);
  if(n<55)throw err('Zu wenige Tageskurse für die Berechnung.',422);
  const sma=d=>prices.slice(-d).reduce((a,b)=>a+b,0)/d;
  const sma20=sma(20),sma50=sma(50),mom20=(last/prices.at(-21)-1)*100;
  const atr=c.slice(-14).reduce((sum,x)=>sum+Math.max(x.high-x.low,Math.abs(x.high-last),Math.abs(x.low-last)),0)/14;
  const left=3,pivots=[];
  for(let i=left;i<c.length-left;i++){
    const slice=c.slice(i-left,i+left+1);
    if(slice.every((x,j)=>j===left||c[i].high>x.high))pivots.push({type:'H',price:c[i].high,date:c[i].date});
    else if(slice.every((x,j)=>j===left||c[i].low<x.low))pivots.push({type:'L',price:c[i].low,date:c[i].date});
  }
  const swingHigh=Math.max(...c.slice(-60).map(x=>x.high)),swingLow=Math.min(...c.slice(-60).map(x=>x.low));
  const span=Math.max(swingHigh-swingLow,last*.001),fibo=.618*span;
  const bullBase=last+fibo,bearBase=Math.max(.01,last-fibo);
  const bullInvalidation=Math.min(last-atr*.6,swingLow),bearInvalidation=Math.max(last+atr*.6,swingHigh);
  const points=[last>sma20?1:-1,last>sma50?1:-1,sma20>sma50?1:-1,mom20>1?1:mom20< -1?-1:0];
  const score=points.reduce((a,b)=>a+b,0),direction=score>=2?'bullish':score<=-2?'bearish':'offen';
  return {indicatorType:'Regelbasierte Trend- und Elliott-Fibonacci-Heuristik; keine statistisch validierte Wahrscheinlichkeit',direction,
    sma20,sma50,momentum20d:mom20,atr14:atr,swingHigh60d:swingHigh,swingLow60d:swingLow,
    bullishTargetZone:[bullBase-atr*.35,bullBase+atr*.35],bearishTargetZone:[Math.max(.01,bearBase-atr*.35),bearBase+atr*.35],
    bullishInvalidation:bullInvalidation,bearishInvalidation:bearInvalidation,latestConfirmedPivots:pivots.slice(-8),
    caveat:'Pivots sind lokale Extrema, keine gesicherte Elliott-Wellenzählung. Zielzonen sind Szenarien.'};
}
function financialStress(f){
  if(!f)return {classification:'Nicht bewertbar',reasons:['Keine aktuellen Bilanzkennzahlen verfügbar'],bankruptcyProbability:null};
  const reasons=[];
  if(f.currentRatio!=null&&f.currentRatio<1)reasons.push('Liquiditätskennzahl unter 1');
  if(f.debtEquity!=null&&f.debtEquity>2)reasons.push('Hohe Verschuldung im Verhältnis zum Eigenkapital');
  if(f.freeCashFlow!=null&&f.freeCashFlow<0)reasons.push('Negativer Free Cashflow');
  if(f.interestCoverage!=null&&f.interestCoverage<1.5)reasons.push('Geringe Zinsdeckung');
  return {classification:reasons.length>=3?'Mehrere erhöhte Stresssignale':reasons.length?'Einzelne Warnsignale':'Keine Auffälligkeit in geprüften Kennzahlen',reasons,bankruptcyProbability:null,source:f.source,reportDate:f.reportDate};
}
const instructions='Du bist eine experimentelle Finanzanalyse-Assistenz für SBro Analyse. Antworte auf Deutsch, konkret und möglichst knapp. Begründe Trend, bullisches und bärisches Elliott-Wave-Szenario mit Invalidierungszonen und Gegenargumenten. Benutze nur verifizierte Marktdaten, Fundamente und als heuristisch gekennzeichnete technische Berechnungen aus den übermittelten JSON-Daten. Verlange bei fehlenden Daten keine Prognose. Keine Kurse, News, Firmenversammlungen, HKCM-Auswertungen oder Prozent-Trefferwahrscheinlichkeiten erfinden. Finanzstress ist keine Insolvenz-Eintrittswahrscheinlichkeit. Die Elliott-Prozentwerte sind Indikatorgewichtungen, keine statistisch validierten Eintrittswahrscheinlichkeiten. Erwähne Datenstand, Quellen und Unsicherheiten. Formuliere keine sicheren oder personalisierten Kauf-/Verkaufsanweisungen.';
async function interpret(payload,env){
  if(!env.OPENAI_API_KEY||!env.ACCESS_TOKEN)throw err('KI nicht konfiguriert. OPENAI_API_KEY und ACCESS_TOKEN als Secrets setzen.',424);
  const symbol=String(payload?.symbol||'').trim().toUpperCase();
  if(!validSymbol(symbol)||symbol==='DEMO'||symbol==='BRONZE')throw err('Für eine KI-Auswertung ist ein echtes Börsensymbol nötig.',400);
  const live=await market(symbol,env);
  const question=String(payload?.question||'').trim().slice(0,380);
  const context={symbol,
    market:{provider:live.provider,asof:live.asof,price:live.price,currency:live.currency,quoteKind:live.quoteKind,
      historyBars:live.candles.length,oldest:live.candles[0].date,latest:live.candles.at(-1).date},
    fundamentals:live.fundamentals||null,
    serverCalculatedTechnical:signals(live),financialStress:financialStress(live.fundamentals),
    question:question||'Erstelle eine aktuelle, sachliche Szenarioanalyse.',
    note:'Alle Kurs- und Indikatorwerte wurden vom Server aus einer frisch abgerufenen oder gemäß Anbieter-TTL gecachten Zeitreihe berechnet. App-Daten nicht als Kursquellen übernommen.'};
  const body={model:env.OPENAI_MODEL||'gpt-4.1-mini',instructions,input:JSON.stringify(context).slice(0,12000),max_output_tokens:750,store:false};
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.OPENAI_API_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw err('KI-Anbieter: '+String(j?.error?.message||`HTTP ${r.status}`).slice(0,130));
  const text=(j.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
  if(!text)throw err('KI-Anbieter lieferte keinen lesbaren Text.');
  return {text,marketAsOf:live.asof,marketProvider:live.provider,technicalSource:'serverseitig',
    disclaimer:'Szenariogewichtung ist keine gemessene Eintrittswahrscheinlichkeit.'};
}
async function portfolioInterpret(payload,env){
  if(!env.OPENAI_API_KEY||!env.ACCESS_TOKEN)throw err('Für die Depot-KI fehlen OPENAI_API_KEY oder ACCESS_TOKEN.',424);
  const items=payload?.positions;
  if(!Array.isArray(items)||items.length===0||items.length>6)throw err('Bitte 1 bis 6 Depotpositionen auswählen.',400);
  const question=String(payload?.question||'').trim().slice(0,380);
  if(!question)throw err('Bitte eine Depotfrage angeben.',400);
  const seen=new Set();
  const positions=[];
  for(const raw of items){
    const symbol=String(raw?.symbol||'').trim().toUpperCase();
    if(!validSymbol(symbol)||symbol==='DEMO'||symbol==='BRONZE'||seen.has(symbol))throw err('Ungültiges oder doppeltes Depot-Symbol.',400);
    seen.add(symbol);
    const position={symbol};
    // These are USER-reported positions, not independently verified by a broker.
    if(raw.quantity!==undefined||raw.cost!==undefined||raw.currency!==undefined){
      const quantity=num(raw.quantity),cost=num(raw.cost),currency=String(raw.currency||'').toUpperCase();
      if(quantity===null||quantity<=0||quantity>1e12||cost===null||cost<0||cost>1e15||!/^[A-Z]{3}$/.test(currency))throw err('Unplausible manuell erfasste Depotwerte.',400);
      position.userProvided={quantity,cost,currency};
    }
    positions.push(position);
  }
  const snapshots=[],missing=[];
  for(const item of positions){
    try{
      const live=await market(item.symbol,env);
      snapshots.push({symbol:item.symbol,position:item.userProvided||null,market:{provider:live.provider,asof:live.asof,price:live.price,currency:live.currency,quoteKind:live.quoteKind},fundamentals:live.fundamentals||null,technical:signals(live),financialStress:financialStress(live.fundamentals)});
    }catch(e){missing.push({symbol:item.symbol,error:String(e.message||'Daten nicht verfügbar').slice(0,180)});}
  }
  if(!snapshots.length)throw err('Keine ausreichend belastbaren Depot-Marktdaten verfügbar. '+missing.map(x=>x.symbol+': '+x.error).join('; ').slice(0,160),424);
  const portfolioInstructions=instructions+' Vergleiche höchstens die tatsächlich gelieferten Depotpositionen. Weise auf ausgelassene Titel hin; leite daraus keine Gesamtrendite ab. Vom Nutzer eingegebene Positionsgrößen und Einstandswerte sind nicht brokerverifiziert. Vergleiche Währungen nicht ohne Wechselkurs. Gib keine definitive Handlungsanweisung.';
  const context={question,positions:snapshots,notAnalysed:missing,notice:'Fakten stammen aus den serverseitigen Kursdatenquellen. Indikatoren und Elliott-Zielzonen sind Heuristiken. Vom Nutzer angegebene Positionsdaten sind nicht unabhängig verifiziert.'};
  const body={model:env.OPENAI_MODEL||'gpt-4.1-mini',instructions:portfolioInstructions,input:JSON.stringify(context).slice(0,24000),max_output_tokens:1000,store:false};
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.OPENAI_API_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw err('KI-Anbieter: '+String(result?.error?.message||'HTTP '+response.status).slice(0,130),502);
  const text=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
  if(!text)throw err('KI-Anbieter lieferte keinen lesbaren Text.',502);
  return {text,sources:snapshots.map(x=>({symbol:x.symbol,provider:x.market.provider,asof:x.market.asof})),missing,notice:'Die Zusammenfassung ist eine experimentelle KI-Interpretation, keine persönliche Anlageempfehlung.'};
}
function authorized(request,env){if(!env.ACCESS_TOKEN)return false;const bearer=request.headers.get('authorization')||'';const expected='Bearer '+env.ACCESS_TOKEN;return bearer===expected;}
export default {async fetch(request,env){const origin=request.headers.get('origin')||'';if(origin&&origin!==getOrigin(env))return json({error:'Nicht erlaubte Web-App-Adresse.'},403,env,origin);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(env,origin)});const u=new URL(request.url),p=u.pathname;try{if(request.method==='GET'&&p==='/api/status'){if(env.ACCESS_TOKEN&&!authorized(request,env))return json({error:'Privater Zugangscode fehlt oder ist falsch.'},401,env,origin);if(!env.ACCESS_TOKEN&&(env.OPENAI_API_KEY||env.FMP_API_KEY||env.TWELVEDATA_API_KEY))return json({error:'Bitte ACCESS_TOKEN als Secret in Cloudflare setzen. Ohne diesen Zugangscode dürfen kostenpflichtige Anbieter-Keys nicht aktiviert werden.'},503,env,origin);return json({connected:true,platform:'Cloudflare Worker',twelve:!!env.TWELVEDATA_API_KEY,crypto:true,stockFallback:'Stooq EOD, kein API-Schlüssel, nur Tageskurse und ggf. Ausfälle',openfigi:true,fmp:!!env.FMP_API_KEY,ai:!!env.OPENAI_API_KEY&&!!env.ACCESS_TOKEN,accessRequired:!!env.ACCESS_TOKEN,sourceVerified:false,note:'Zugang konfiguriert. Für US-Aktien ohne Twelve Data werden kostenlose Stooq-Tageskurse versucht (keine Echtzeitgarantie). Ergebnisse stets anhand von Quelle und Datum prüfen.',version:'1.6'},200,env,origin);}if(!p.startsWith('/api/'))return json({error:'Unbekannte Route.'},404,env,origin);if((!!env.ACCESS_TOKEN&&!authorized(request,env))||(!env.ACCESS_TOKEN&&(!!env.TWELVEDATA_API_KEY||!!env.FMP_API_KEY||!!env.OPENAI_API_KEY)))return json({error:'Zugangscode fehlt oder ist falsch. Bitte in SBro unter Datenquellen einrichten.'},401,env,origin);if(request.method==='GET'&&p==='/api/market'){const symbol=String(u.searchParams.get('symbol')||'').toUpperCase();if(!validSymbol(symbol))throw err('Ungültiger Börsenticker.',400);return json(await market(symbol,env),200,env,origin);}if(request.method==='GET'&&p==='/api/search'){const q=String(u.searchParams.get('q')||'').trim();if(q.length<2||q.length>60)throw err('Suchtext muss 2 bis 60 Zeichen enthalten.',400);return json(await search(q,env),200,env,origin);}if(request.method==='GET'&&p==='/api/fmp-test'){const symbol=String(u.searchParams.get('symbol')||'NVDA').toUpperCase();if(!validSymbol(symbol))throw err('Ungueltiger Ticker',400);if(!env.FMP_API_KEY)return json({configured:false,symbol,problem:'FMP_API_KEY fehlt'},424,env,origin);try{const item=await fundamentals(symbol,env);return json({configured:true,symbol,works:true,provider:item.source,coverage:item.coverage,warnings:item.warnings,reportDate:item.reportDate},200,env,origin);}catch(e){return json({configured:true,symbol,works:false,problem:String(e.message||'FMP-Abruf fehlgeschlagen').slice(0,500)},e.status||502,env,origin);}}if(request.method==='GET'&&p==='/api/fundamentals'){const symbol=String(u.searchParams.get('symbol')||'').toUpperCase();if(!validSymbol(symbol)||CRYPTO[symbol]||METAL[symbol]||symbol==='BRONZE')throw err('Bitte einen gültigen Aktien-Ticker eingeben.',400);if(!env.FMP_API_KEY)throw err('Für Fundamentaldaten fehlt FMP_API_KEY.',424);const data=await fundamentals(symbol,env);if(!data)throw err('Für diesen Titel sind keine ausreichend zuordenbaren Fundamentaldaten verfügbar.',404);return json({symbol,fundamentals:data,provider:'Financial Modeling Prep',asof:new Date().toISOString()},200,env,origin);}if(request.method==='GET'&&p==='/api/events'){const symbol=String(u.searchParams.get('symbol')||'').toUpperCase();if(!validSymbol(symbol)||CRYPTO[symbol]||METAL[symbol])throw err('Einen gültigen Aktien-Ticker eingeben.',400);return json(await events(symbol,env),200,env,origin);}if(request.method==='POST'&&p==='/api/portfolio-interpret'){if(Number(request.headers.get('content-length')||0)>9000)throw err('Anfrage zu groß.',413);const raw=await request.text();if(raw.length>9000)throw err('Anfrage zu groß.',413);let input;try{input=JSON.parse(raw);}catch{throw err('Ungültige JSON-Anfrage.',400);}return json(await portfolioInterpret(input,env),200,env,origin);}if(request.method==='POST'&&p==='/api/interpret'){if(Number(request.headers.get('content-length')||0)>12000)throw err('Anfrage zu groß.',413);const raw=await request.text();if(raw.length>12000)throw err('Anfrage zu groß.',413);let input;try{input=JSON.parse(raw);}catch{throw err('Ungültige JSON-Anfrage.',400);}return json(await interpret(input,env),200,env,origin);}return json({error:'Route nicht gefunden.'},404,env,origin);}catch(e){return json({error:String(e.message||'Unbekannter Fehler').slice(0,240)},e.status||502,env,origin);}}};