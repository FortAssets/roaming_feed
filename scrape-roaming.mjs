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

// Landen die relevant zijn voor Nederlandse reizigers en die providers
// daadwerkelijk in hun voorwaarden noemen. Volgorde doet er niet toe.
const LANDEN = [
  'Turkije', 'Verenigde Staten', 'VS', 'Amerika', 'Zwitserland', 'Verenigd Koninkrijk',
  'Noorwegen', 'IJsland', 'Liechtenstein', 'Andorra', 'Monaco', 'San Marino',
  'Oekraïne', 'Moldavië', 'Albanië', 'Servië', 'Bosnië', 'Noord-Macedonië',
  'Marokko', 'Egypte', 'Tunesië', 'Thailand', 'Indonesië', 'Suriname',
  'Canada', 'Australië', 'Japan', 'China', 'India', 'Zuid-Afrika',
  'Kaapverdië', 'Gambia', 'Dubai', 'Verenigde Arabische Emiraten', 'Israël', 'Mexico', 'Brazilië'
]

// Woorden die aangeven dat een land IN de bundel zit.
// Formuleringen die betekenen: dit land valt binnen je bundel. Uitgebreid na
// de eerste run, waarin Vodafone's "geldig in alle EU-landen, en zelfs in een
// aantal landen daarbuiten, zoals Turkije" niet werd herkend.
const IN_BUNDEL = /(in (?:je|uw) bundel|uit (?:je|uw) bundel|zonder (?:extra )?(?:toeslag|kosten|meerkosten)|valt onder|vallen (?:bij [a-z]+ )?ook onder|inbegrepen|zit(?:ten)? in de bundel|geldt ook in|geldig in|roam like home|gebruik je (?:bundel|abonnement)|gebruik je dus ook|per maand in)/i
// Woorden die aangeven dat het juist NIET in de bundel zit.
const BUITEN_BUNDEL = /(buiten (?:je|uw) bundel|extra kosten|hogere tarieven|per MB|bijkopen|los(?:se)? bundel|buitenlandbundel|reispas|op reis-pas|niet inbegrepen)/i
// Tier-namen zoals providers ze schrijven.
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

// Waarom dit voorzichtiger is dan het lijkt.
// Eerste opzet classificeerde elk land op de zin waarin het stond. Dat ging
// mis op Simyo: hun tarieventabel zet honderd landen in één blok tekst met
// "per MB" erin, waarna Zwitserland en het VK als "buiten de bundel" werden
// gemarkeerd terwijl ze juist in zone 1 zitten. Zelfverzekerd fout is erger
// dan niets weten.
//
// Daarom nu drie regels:
//   1. zinnen langer dan 400 tekens zijn tabellen, die slaan we over;
//   2. het land moet binnen 120 tekens van de bundeluitspraak staan;
//   3. wat overblijft krijgt een zekerheid mee, en de bronzin gaat altijd
//      mee zodat een mens het kan nalezen.
const MAX_ZIN = 400
const MAX_AFSTAND = 120

function dichtbij(zin, land, patroon) {
  const li = zin.toLowerCase().indexOf(land.toLowerCase())
  if (li < 0) return false
  const m = patroon.exec(zin)
  patroon.lastIndex = 0
  if (!m) return false
  return Math.abs(m.index - li) <= MAX_AFSTAND
}

function ontleed(tekst) {
  const zinnen = tekst.split(/(?<=[.!?])\s+/).filter(z => z.length <= MAX_ZIN)
  const gevonden = {}

  // De zone-definitie is het waardevolste stuk en ook het best herkenbaar:
  // één zin die zowel "zone 1" of "EU" bevat als een opsomming van landen.
  let zoneZin = ''
  for (const z of zinnen) {
    if (!/(zone 1|EU-landen|binnen de EU|Roam Like Home)/i.test(z)) continue
    if (NEGATIE.test(z)) continue
    const aantal = LANDEN.filter(l => new RegExp('\\b' + l + '\\b', 'i').test(z)).length
    if (aantal >= 3 && z.length > zoneZin.length) zoneZin = z.trim()
  }

  for (const land of LANDEN) {
    const re = new RegExp('\\b' + land.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
    for (const z of zinnen) {
      if (!re.test(z)) continue
      if (NEGATIE.test(z)) continue
      const inB = dichtbij(z, land, new RegExp(IN_BUNDEL.source, 'gi'))
      const uitB = dichtbij(z, land, new RegExp(BUITEN_BUNDEL.source, 'gi'))
      if (!inB && !uitB) continue
      let oordeel = 'onbeslist'
      if (inB && !uitB) oordeel = 'inbundel'
      else if (uitB && !inB) oordeel = 'buitenbundel'
      if (oordeel === 'onbeslist') continue
      const tiers = [...new Set((z.match(TIER_RE) || []).map(t => t.trim()))].slice(0, 5)
      // Staat het land in de zone-definitie, dan is dat leidend.
      const inZone = zoneZin && re.test(zoneZin)
      if (inZone && oordeel === 'buitenbundel') continue
      if (!gevonden[land]) gevonden[land] = { oordeel, tiers, zekerheid: tiers.length ? 'hoog' : 'midden', zin: z.slice(0, 240).trim() }
    }
    if (!gevonden[land] && zoneZin && re.test(zoneZin)) {
      gevonden[land] = { oordeel: 'inbundel', tiers: [], zekerheid: 'hoog', zin: zoneZin.slice(0, 240) }
    }
  }

  const inbundel = Object.keys(gevonden).filter(l => gevonden[l].oordeel === 'inbundel')
  const buitenbundel = Object.keys(gevonden).filter(l => gevonden[l].oordeel === 'buitenbundel')
  return { zoneZin: zoneZin.slice(0, 400), landen: gevonden, inbundel, buitenbundel }
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
      inbundel: ontleed_.inbundel,
      buitenbundel: ontleed_.buitenbundel,
      landen: ontleed_.landen
    }
    gelukt++
    if (veranderd) wijzigingen.push(p.naam)
    console.log(`✓ ${p.naam.padEnd(16)} ${ontleed_.inbundel.length} in bundel, ${ontleed_.buitenbundel.length} erbuiten${veranderd ? '  [GEWIJZIGD]' : ''}`)
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
