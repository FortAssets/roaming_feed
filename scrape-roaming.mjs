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
const IN_BUNDEL = /(in (?:je|uw) bundel|uit (?:je|uw) bundel|zonder (?:extra )?(?:toeslag|kosten|meerkosten)|valt onder|inbegrepen|zit(?:ten)? in de bundel|geldt ook in|roam like home|gebruik je bundel)/i
// Woorden die aangeven dat het juist NIET in de bundel zit.
const BUITEN_BUNDEL = /(buiten (?:je|uw) bundel|extra kosten|hogere tarieven|per MB|bijkopen|los(?:se)? bundel|buitenlandbundel|reispas|op reis-pas|niet inbegrepen)/i
// Tier-namen zoals providers ze schrijven.
const TIER_RE = /(Unlimited[a-zA-Z0-9+ ]{0,14}|SuperUnlimited\+?|Premium|Snelst|Plus|Basis|Start|Go\b|Red\b)/g

const PROVIDERS = [
  { id: 'odido',          naam: 'Odido',          url: 'https://www.odido.nl/service/bellen-en-internetten-in-het-buitenland' },
  { id: 'kpn',            naam: 'KPN',            url: 'https://www.kpn.com/service/mobiel/bellen-sms-en-en-internetten-in-het-buitenland.htm' },
  { id: 'vodafone',       naam: 'Vodafone',       url: 'https://www.vodafone.nl/service/mobiel/bellen-en-internetten-in-het-buitenland', browser: true },
  { id: 'ben',            naam: 'Ben',            url: 'https://www.ben.nl/klantenservice/bellen-en-internetten-in-het-buitenland' },
  { id: 'simyo',          naam: 'Simyo',          url: 'https://www.simyo.nl/buitenland' },
  { id: 'youfone',        naam: 'Youfone',        url: 'https://www.youfone.nl/buitenland' },
  { id: 'hollandsnieuwe', naam: 'hollandsnieuwe', url: 'https://www.hollandsnieuwe.nl/buitenland' },
  { id: 'lebara',         naam: 'Lebara',         url: 'https://www.lebara.nl/nl/roaming.html' }
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

async function haal(p) {
  if (p.browser) return haalMetBrowser(p)
  const r = await fetch(p.url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'nl-NL,nl;q=0.9', 'Accept': 'text/html' },
    redirect: 'follow'
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const html = await r.text()
  const tekst = totTekst(html)
  if (tekst.length < 800) throw new Error('te weinig tekst (' + tekst.length + ')')
  return tekst
}

// Alleen voor sites die client-side renderen. Playwright staat op de runner.
async function haalMetBrowser(p) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ userAgent: UA, locale: 'nl-NL' })
    await page.goto(p.url, { waitUntil: 'networkidle', timeout: 45000 })
    const html = await page.content()
    const tekst = totTekst(html)
    if (tekst.length < 800) throw new Error('te weinig tekst na render')
    return tekst
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
    const aantal = LANDEN.filter(l => new RegExp('\\b' + l + '\\b', 'i').test(z)).length
    if (aantal >= 3 && z.length > zoneZin.length) zoneZin = z.trim()
  }

  for (const land of LANDEN) {
    const re = new RegExp('\\b' + land.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
    for (const z of zinnen) {
      if (!re.test(z)) continue
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
  const vorig = oud.providers?.[p.id] || null
  try {
    const tekst = await haal(p)
    const ontleed_ = ontleed(tekst)
    const h = hash(tekst)
    const veranderd = vorig && vorig.hash && vorig.hash !== h

    nieuw.providers[p.id] = {
      naam: p.naam,
      url: p.url,
      status: 'ok',
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
      nieuw.providers[p.id] = { naam: p.naam, url: p.url, status: 'onbekend', laatsteFout: String(e.message).slice(0, 120) }
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
