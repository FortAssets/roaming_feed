# roaming-feed

Haalt dagelijks de buitenlandpagina's van de providers op en publiceert
`roaming.json`, zodat de worker weet welke landen in welke bundel zitten.

## Waarom een GitHub Action en niet Cloudflare

Odido, Ben en KPN weren datacenter-IP's. Precies hetzelfde probleem als bij
de MediaMarkt-feed, en dezelfde oplossing: een runner met een schoon IP.

## Installeren

1. Nieuwe repo onder FortAssets, bijvoorbeeld `roaming_feed`. Publiek, anders
   werkt jsDelivr niet.
2. Zet `scrape-roaming.mjs` in de root en `.github/workflows/roaming.yml` op
   zijn plek.
3. Settings → Actions → General → Workflow permissions op
   **Read and write**. Zonder dat kan de bot niet committen.
4. Actions-tabblad → roaming-feed → Run workflow, om hem meteen te testen.

De worker leest daarna:

    https://cdn.jsdelivr.net/gh/FortAssets/roaming_feed@main/roaming.json

Let op: jsDelivr cachet tot 12 uur. Voor een verse versie kan
`@main` vervangen worden door een commit-hash, maar dagelijks is ruim genoeg.

## Wat er in roaming.json staat

Per provider:

- `status` — `ok`, `verouderd` (ophalen mislukt, vorige gegevens behouden) of
  `onbekend` (nooit gelukt)
- `zoneZin` — de zin waarin de provider zijn EU-zone definieert
- `inbundel` / `buitenbundel` — landen waarvan met redelijke zekerheid vaststaat
  wat er geldt
- `landen` — per land het oordeel, de gevonden tier-namen, een zekerheid en de
  bronzin, zodat je het kunt nalezen
- `hash` — om te zien of de pagina veranderd is

## Wat het bewust NIET doet

Volautomatisch afleiden welke bundel welk land dekt is niet betrouwbaar.
De eerste versie deed dat wel en ging meteen mis op Simyo: hun tarieventabel
zet honderd landen in één blok tekst met "per MB" erin, waarna Zwitserland en
het Verenigd Koninkrijk als "buiten de bundel" werden gemarkeerd terwijl ze
juist in zone 1 zitten.

Nu geldt: zinnen langer dan 400 tekens zijn tabellen en worden overgeslagen,
het land moet binnen 120 tekens van de bundeluitspraak staan, en wat overblijft
krijgt een zekerheid plus de bronzin mee.

Twijfelgevallen komen er dus niet in. Liever een gat dan een verkeerd antwoord
over dekking.

## Wat je zelf moet doen

Vier providers blokkeren of zijn verhuisd. Controleer de URL's in
`PROVIDERS` als een provider structureel `onbekend` blijft:

- **Odido** en **Ben** gaven 403 vanaf een datacenter-IP. Op een GitHub-runner
  komen ze er waarschijnlijk wel door; blijft het 403, dan is de pagina zelf
  afgeschermd en moet `browser: true` erbij.
- **KPN** gaf 404: hun serviceartikelen zijn verhuisd. Zoek de juiste URL op
  en pas hem aan.
- **Lebara** leverde te weinig tekst — die rendert client-side, dus
  `browser: true`.

Verandert er iets bij een provider, dan zet de Action een waarschuwing in de
run en in de samenvatting. Dat is de belangrijkste functie: je hoeft niet
wekelijks acht sites te lezen, je hoort het als er iets beweegt.
