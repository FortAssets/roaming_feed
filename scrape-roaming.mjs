// ============================================================
// scrape-roaming.mjs — dekkingsgegevens per provider ophalen
//
// Draait in een GitHub Action, niet in Cloudflare. Reden: Odido, Ben en KPN
// weren datacenter-IP's, precies zoals Tradedoubler dat doet bij de
// MediaMarkt-feed. Een GitHub-runner heeft een schoon IP en komt er wel door.
//
// Wat het oplevert: roaming.json, via jsDelivr te lezen door de worker.
//
// ONTWERPKEUZE — lees dit voordat je iets aanpast.
// Volautomatisch afleiden welke bundel welk land dekt is niet betrouwbaar te
// doen met tekstherkenning; providers schrijven dat elk in eigen bewoordingen.
// Daarom doet dit script twee dingen die het WEL betrouwbaar kan:
//   1. landnamen herkennen binnen een venster rond bundelwoorden, met de
//      omliggende zin erbij zodat je kunt controleren wat er stond;
//   2. de inhoud vergelijken met de vorige run en melden DAT er iets is
//      veranderd.
// Punt twee is de echte winst. Je hoeft niet elke week acht sites te lezen;
// je hoort het als er iets beweegt.
//
// Een provider die faalt overschrijft NOOIT de vorige gegevens. Liever oude
// data met een datum erbij dan een lege tabel.
// ============================================================

import { writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const UIT = 'roaming.json'

// Wereldlijst met aliassen. Een bezoeker typt Türkiye, Turkey, USA, de VS of
// Curacao zonder cedille; dat moet allemaal op dezelfde sleutel uitkomen.
// Deze lijst dient twee doelen: landnamen herkennen op providerpagina's, en
// invoer van bezoekers normaliseren.
const LANDEN_ALIAS = {
  'Turkije': ['turkiye', 'türkiye', 'turkey'],
  'Verenigde Staten': ['vs', 'v.s.', 'amerika', 'usa', 'united states', 'verenigde staten van amerika'],
  'Verenigd Koninkrijk': ['vk', 'engeland', 'groot-brittannie', 'groot-brittannië', 'uk', 'united kingdom', 'schotland', 'wales'],
  'Zwitserland': ['switzerland', 'zwitserland'],
  'Curacao': ['curaçao', 'curacao'],
  'Duitsland': ['germany', 'deutschland'], 'Belgie': ['belgië', 'belgium'],
  'Frankrijk': ['france'], 'Spanje': ['spain', 'espana', 'españa'],
  'Italie': ['italië', 'italy'], 'Portugal': [], 'Griekenland': ['greece'],
  'Oostenrijk': ['austria'], 'Polen': ['poland'], 'Tsjechie': ['tsjechië', 'czech'],
  'Kroatie': ['kroatië', 'croatia'], 'Hongarije': ['hungary'], 'Ierland': ['ireland'],
  'Denemarken': ['denmark'], 'Zweden': ['sweden'], 'Finland': [], 'Noorwegen': ['norway'],
  'IJsland': ['ijsland', 'iceland'], 'Liechtenstein': [], 'Luxemburg': ['luxembourg'],
  'Malta': [], 'Cyprus': [], 'Bulgarije': ['bulgaria'], 'Roemenie': ['roemenië', 'romania'],
  'Slovenie': ['slovenië', 'slovenia'], 'Slowakije': ['slovakia'], 'Estland': ['estonia'],
  'Letland': ['latvia'], 'Litouwen': ['lithuania'], 'Andorra': [], 'Monaco': [],
  'San Marino': [], 'Vaticaanstad': ['vaticaan'], 'Oekraine': ['oekraïne', 'ukraine'],
  'Moldavie': ['moldavië', 'moldova'], 'Albanie': ['albanië', 'albania'],
  'Servie': ['servië', 'serbia'], 'Bosnie': ['bosnië', 'bosnie en herzegovina', 'bosnia'],
  'Noord-Macedonie': ['noord-macedonië', 'macedonie', 'macedonië'], 'Montenegro': [],
  'Kosovo': [], 'Rusland': ['russia'], 'Wit-Rusland': ['belarus'],
  'Marokko': ['morocco'], 'Egypte': ['egypt'], 'Tunesie': ['tunesië', 'tunisia'],
  'Algerije': ['algeria'], 'Zuid-Afrika': ['south africa'], 'Kaapverdie': ['kaapverdië', 'cape verde', 'cabo verde'],
  'Gambia': [], 'Senegal': [], 'Ghana': [], 'Nigeria': [], 'Kenia': ['kenya'],
  'Tanzania': ['zanzibar'], 'Ethiopie': ['ethiopië'], 'Suriname': [],
  'Canada': [], 'Mexico': [], 'Brazilie': ['brazilië', 'brazil'], 'Argentinie': ['argentinië'],
  'Colombia': [], 'Peru': [], 'Chili': ['chile'], 'Aruba': [], 'Bonaire': [],
  'Sint Maarten': ['st maarten'], 'Dominicaanse Republiek': ['dominicaanse rep'],
  'Thailand': [], 'Indonesie': ['indonesië', 'indonesia', 'bali'], 'Vietnam': [],
  'Maleisie': ['maleisië', 'malaysia'], 'Singapore': [], 'Filipijnen': ['philippines'],
  'Japan': [], 'Zuid-Korea': ['south korea'], 'China': [], 'Hongkong': ['hong kong'],
  'India': [], 'Sri Lanka': [], 'Nepal': [], 'Pakistan': [],
  'Verenigde Arabische Emiraten': ['vae', 'dubai', 'abu dhabi', 'emiraten'],
  'Israel': ['israël'], 'Jordanie': ['jordanië', 'jordan'], 'Saoedi-Arabie': ['saoedi-arabië'],
  'Qatar': [], 'Oman': [], 'Australie': ['australië', 'australia'], 'Nieuw-Zeeland': ['new zealand']
}
const LANDEN = Object.keys(LANDEN_ALIAS)

// Zoeksleutel: accenten weg, kleine letters. Zo matcht Türkiye op turkije.
function sleutel(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
// Bouw de omgekeerde index: elke schrijfwijze wijst naar de officiele naam.
const ALIAS_INDEX = (() => {
  const m = {}
  for (const land of LANDEN) {
    m[sleutel(land)] = land
    for (const a of LANDEN_ALIAS[land]) m[sleutel(a)] = land
  }
  return m
})()

// Formuleringen die betekenen: dit land valt binnen je bundel.
const IN_BUNDEL = /(in (?:je|uw) bundel|uit (?:je|uw) bundel|zonder (?:extra )?(?:toeslag|kosten|meerkosten)|valt onder|vallen (?:bij [a-z]+ )?ook onder|inbegrepen|zit(?:ten)? in de bundel|geldt ook in|geldig in|roam like home|gebruik je (?:bundel|abonnement)|gebruik je dus ook|per maand in)/i
// En de tegenhanger: dit kost extra.
const BUITEN_BUNDEL = /(buiten (?:je|uw) bundel|extra kosten|hogere tarieven|per MB|bijkopen|los(?:se)? bundel|buitenlandbundel|reispas|op reis-pas|niet inbegrepen)/i
// Ontkenningen. KPN schrijft letterlijk: "Net als Marokko, Suriname en het
// Caribisch deel van het Koninkrijk valt Turkije NIET binnen de EU bij KPN."
// Zonder deze controle las het script dat als drie landen in de bundel —
// exact het omgekeerde van wat er staat.
const NEGATIE = /(niet binnen|valt niet|vallen niet|niet onder|niet in (?:je|uw|de) bundel|geen (?:deel|onderdeel)|uitgezonderd|met uitzondering|behalve)/i
const TIER_RE = /(Unlimited[a-zA-Z0-9+ ]{0,14}|SuperUnlimited\+?|Premium|Snelst|Plus|Basis|Start|Go\b|Red\b)/g

// Per provider meerdere URL's: de eerste die bruikbare tekst oplevert wint.
// Providers verhuizen hun serviceartikelen regelmatig; met één URL sta je
// dan stil tot iemand het merkt.
//
// browser: true betekent verplicht renderen. Zonder vlag proberen we eerst
// een gewone fetch en vallen we bij 403 of 404 automatisch terug op de
// browser — dat verslaat de meeste botcontroles.
const PROVIDERS = [
  // Odido en Ben geven 403 vanaf elke automatische browser: headless-shell,
  // volledige chromium en met stealth-vlag allemaal geprobeerd. Dat is een WAF,
  // geen IP-blokkade, en daar valt redelijkerwijs niet omheen te komen.
  // Voor Odido vallen we terug op de eigen buitenlandpagina; die onderhoud je
  // zelf en bevat dezelfde tier-informatie. Voor Ben is er geen bron.
  { id: 'odido', naam: 'Odido', urls: [
      'https://www.deprijsvergelijker.com/pages/bellen-internet-buitenland' ],
    bronType: 'eigen pagina' },
  { id: 'kpn', naam: 'KPN', urls: [
      'https://www.kpn.com/mobiel-abonnement/bundels/buitenland/binnen-eu',
      'https://www.kpn.com/mobiel-abonnement/bundels/buitenland',
      'https://www.kpn.com/mobiel-abonnement/bundels/buitenland/wereld' ] },
  { id: 'vodafone', naam: 'Vodafone', browser: true, urls: [
      'https://www.vodafone.nl/abonnement/buitenland' ] },
  { id: 'ben', naam: 'Ben', browser: true, handmatig: true, urls: [
      'https://www.ben.nl/klantenservice/bellen-en-internetten-in-het-buitenland' ] },
  { id: 'simyo', naam: 'Simyo', urls: [ 'https://www.simyo.nl/buitenland' ] },
  { id: 'youfone', naam: 'Youfone', urls: [
      'https://www.youfone.nl/buitenland',
      'https://www.youfone.nl/sim-only/buitenland-gebruik' ] },
  { id: 'hollandsnieuwe', naam: 'hollandsnieuwe', urls: [ 'https://www.hollandsnieuwe.nl/buitenland' ] },
  { id: 'lebara', naam: 'Lebara', browser: true, urls: [
      'https://www.lebara.nl/nl/roaming.html',
      'https://www.lebara.nl/nl/help/roaming.html' ] }
]

function totTekst(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&euro;/g, '€')
    .replace(/\s+/g, ' ')
    .trim()
}

async function haalUrl(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'nl-NL,nl;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
      'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'document'
    },
    redirect: 'follow'
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const tekst = totTekst(await r.text())
  if (tekst.length < 800) throw new Error('te weinig tekst (' + tekst.length + ')')
  return { tekst, url }
}

async function haal(p) {
  const fouten = []
  for (const url of p.urls) {
    if (!p.browser) {
      try { return await haalUrl(url) } catch (e) { fouten.push(url.slice(8, 40) + ': ' + e.message) }
    }
    // Verplicht renderen, of tweede poging na een blokkade.
    try { return await haalMetBrowser(url) } catch (e) { fouten.push('browser ' + url.slice(8, 40) + ': ' + e.message) }
  }
  throw new Error(fouten.join(' | ').slice(0, 200))
}

// Renderen met een echte browser. Drie dingen die uit de proef bleken:
// page.content() geeft de HTML voordat de pagina is uitgehydrateerd, een
// cookiemuur blokkeert de inhoud, en sommige blokken laden pas bij scrollen.
// Vandaar wachten, klikken, scrollen en dan innerText lezen.
const CONSENT = [
  '#onetrust-accept-btn-handler', 'button#accept-all', '[data-testid*="accept" i]',
  'button:has-text("Accepteer")', 'button:has-text("Alles accepteren")',
  'button:has-text("Akkoord")', 'button:has-text("Accept all")'
]

async function haalMetBrowser(url) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({
      userAgent: UA, locale: 'nl-NL', viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'nl-NL,nl;q=0.9' }
    })
    const page = await ctx.newPage()
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 })
    if (resp && resp.status() >= 400) throw new Error('HTTP ' + resp.status())
    await page.waitForTimeout(2000)
    for (const sel of CONSENT) {
      try {
        const el = page.locator(sel).first()
        if (await el.count() && await el.isVisible({ timeout: 700 })) { await el.click({ timeout: 2500 }); break }
      } catch {}
    }
    await page.waitForTimeout(1800)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1200)
    const tekst = (await page.evaluate(() => (document.body ? document.body.innerText : ''))).replace(/\s+/g, ' ').trim()
    if (tekst.length < 800) throw new Error('te weinig tekst na render (' + tekst.length + ')')
    return { tekst, url }
  } finally {
    await browser.close()
  }
}

// Waarom dit anders werkt dan de eerste opzet.
//
// Eerst zocht ik per land een uitspraak. Dat schaalt niet: een bezoeker typt
// Kaapverdie of Vietnam, en dan zeg je "geen gegevens" terwijl het antwoord
// wel bekend is. De werkelijkheid is namelijk zone-gebaseerd: EU in de
// bundel, daarbuiten niet, met een handvol uitzonderingen.
//
// Dus oogsten we drie dingen per provider:
//   1. de EU-zonelijst, uit de opsomming op de pagina;
//   2. de uitzonderingen buiten de EU, met de tier waar ze bij horen;
//   3. de bronzin, zodat een mens het kan nalezen.
//
// Staat een land in geen van beide, dan is het antwoord "niet gedekt" — en
// dat klopt voor de tweehonderd landen die we niet expliciet kennen.
//
// De tabelregel uit de vorige versie geldt nog steeds BUITEN de zone-context.
// Daar ontstonden de fouten: Simyo's tarieventabel met honderd landen en
// "per MB" erin maakte van Zwitserland ten onrechte een niet-gedekt land.
const MAX_ZIN = 400
const MAX_AFSTAND = 120
const ZONE_KOP = /(zone 1|EU-?zone|EU-landen|binnen de EU|vallen (?:bij [a-z]+ )?onder de EU|Roam Like Home|gereguleerde roaming)/i

function dichtbij(zin, land, patroon) {
  const li = sleutel(zin).indexOf(sleutel(land))
  if (li < 0) return false
  const m = patroon.exec(zin)
  patroon.lastIndex = 0
  if (!m) return false
  return Math.abs(m.index - li) <= MAX_AFSTAND
}

function landenIn(tekst) {
  const k = ' ' + sleutel(tekst) + ' '
  const uit = []
  for (const land of LANDEN) {
    if (k.indexOf(' ' + sleutel(land) + ' ') > -1) { uit.push(land); continue }
    for (const a of LANDEN_ALIAS[land]) {
      if (a && k.indexOf(' ' + sleutel(a) + ' ') > -1) { uit.push(land); break }
    }
  }
  return uit
}

function ontleed(tekst) {
  const alle = tekst.split(/(?<=[.!?:])\s+/)

  // 1. Zonelijst. Dit MAG een lange opsomming zijn — juist daar staat hij.
  //    Voorwaarde: de zin moet onder een zone-kop vallen en geen ontkenning
  //    bevatten, anders vist hij de tarieventabel op.
  let zoneZin = '', euZone = []
  for (const z of alle) {
    if (!ZONE_KOP.test(z) || NEGATIE.test(z)) continue
    if (BUITEN_BUNDEL.test(z)) continue
    const gevonden = landenIn(z)
    if (gevonden.length > euZone.length) { euZone = gevonden; zoneZin = z.slice(0, 500).trim() }
  }

  // 2. Uitzonderingen buiten de EU: korte zinnen die een land aan de bundel
  //    koppelen. Hier geldt de tabelregel wel.
  const kort = alle.filter(z => z.length <= MAX_ZIN)
  const uitzonderingen = []
  for (const z of kort) {
    if (NEGATIE.test(z) || !IN_BUNDEL.test(z)) continue
    for (const land of landenIn(z)) {
      if (euZone.indexOf(land) > -1) continue
      if (uitzonderingen.some(u => u.land === land)) continue
      if (!dichtbij(z, land, new RegExp(IN_BUNDEL.source, 'gi'))) continue
      const tiers = [...new Set((z.match(TIER_RE) || []).map(t => t.trim()))].slice(0, 5)
      uitzonderingen.push({ land, tiers, zin: z.slice(0, 240).trim() })
    }
  }

  return { zoneZin, euZone, uitzonderingen }
}

function hash(s) { return createHash('sha256').update(s).digest('hex').slice(0, 16) }

async function vorige() {
  try { return JSON.parse(await readFile(UIT, 'utf8')) } catch { return { providers: {} } }
}

const oud = await vorige()
const nieuw = { bijgewerkt: new Date().toISOString(), bron: 'scrape-roaming.mjs', providers: {} }
const wijzigingen = []
let gelukt = 0, mislukt = 0

for (const p of PROVIDERS) {
  const v0 = oud.providers?.[p.id] || null
  // Een eerdere run zonder gegevens is geen eerdere gegevens; anders meldt hij
  // "vorige gegevens behouden van undefined".
  const vorig = (v0 && v0.status === 'ok' && v0.opgehaald) ? v0 : null
  try {
    const { tekst, url } = await haal(p)
    const ontleed_ = ontleed(tekst)
    const h = hash(tekst)
    const veranderd = vorig && vorig.hash && vorig.hash !== h

    nieuw.providers[p.id] = {
      naam: p.naam,
      url: url,
      status: 'ok',
      bronType: p.bronType || 'provider',
      opgehaald: new Date().toISOString().slice(0, 10),
      hash: h,
      zoneZin: ontleed_.zoneZin,
      // BELANGRIJK: dit zijn KANDIDATEN, geen waarheid. Automatisch afleiden
      // welke zin de EU-zone beschrijft blijkt onbetrouwbaar: tarieventabellen
      // en uitzonderingslijsten lijken er te veel op. KPN kreeg zo Turkije in
      // de EU-zone terwijl het er juist buiten valt. Gebruik deze velden om te
      // ZIEN dat er iets veranderd is, niet om de vergelijker mee te vullen.
      // De echte zonelijsten staan in zones-handmatig.json.
      zekerheid: 'laag — handmatig controleren',
      euZoneKandidaat: ontleed_.euZone,
      uitzonderingKandidaat: ontleed_.uitzonderingen
    }
    gelukt++
    if (veranderd) wijzigingen.push(p.naam)
    console.log(`✓ ${p.naam.padEnd(16)} ${ontleed_.euZone.length} kandidaat-landen, ${ontleed_.uitzonderingen.length} uitzondering(en)${veranderd ? '  [GEWIJZIGD]' : ''}`)
  } catch (e) {
    mislukt++
    if (vorig) {
      // Nooit goede gegevens overschrijven met een mislukking.
      nieuw.providers[p.id] = { ...vorig, status: 'verouderd', laatsteFout: String(e.message).slice(0, 120) }
      console.log(`! ${p.naam.padEnd(16)} mislukt (${e.message}) — vorige gegevens behouden van ${vorig.opgehaald}`)
    } else {
      nieuw.providers[p.id] = { naam: p.naam, url: p.urls[0], status: 'onbekend', laatsteFout: String(e.message).slice(0, 120) }
      console.log(`✗ ${p.naam.padEnd(16)} mislukt (${e.message}) — geen eerdere gegevens`)
    }
  }
}

nieuw.alias = ALIAS_INDEX      // schrijfwijze -> officiele landnaam
nieuw.samenvatting = { gelukt, mislukt, gewijzigd: wijzigingen }
await writeFile(UIT, JSON.stringify(nieuw, null, 2) + '\n', 'utf8')

console.log('')
console.log(`${gelukt} gelukt, ${mislukt} mislukt`)
if (wijzigingen.length) console.log('Gewijzigd sinds vorige run: ' + wijzigingen.join(', '))

// Laat de Action falen als ALLES mislukt: dan is er iets structureels stuk
// en wil je een melding, geen stille lege run.
if (gelukt === 0) {
  console.error('Geen enkele provider gelukt — waarschijnlijk een netwerkprobleem of IP-blokkade.')
  process.exit(1)
}
