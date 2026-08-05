# roaming-feed v4

    https://cdn.jsdelivr.net/gh/FortAssets/roaming_feed@main/roaming.json

## Belangrijk bij het installeren

De repo moet deze vier dingen bevatten:

    scrape-roaming.mjs                 <- in de ROOT
    roaming.json                       <- in de ROOT
    LEESMIJ.md                         <- in de ROOT
    .github/workflows/roaming.yml

Ontbreekt `scrape-roaming.mjs`, dan stopt de workflow nu meteen met een
duidelijke fout. In v1 gaf hij een groen vinkje met een lege samenvatting,
omdat `node ... | tee` alleen de exitcode van tee gebruikt. Dat is opgelost
met `set -o pipefail` plus een controle vooraf.

## Volgorde

1. Publieke repo `roaming_feed` onder FortAssets.
2. De drie losse bestanden uploaden via Add file -> Upload files.
3. De workflow apart aanmaken via Add file -> Create new file met als naam
   precies `.github/workflows/roaming.yml`. Mappen die met een punt beginnen
   worden door Windows en macOS verborgen en gaan bij slepen vaak niet mee.
4. Settings -> Actions -> General -> Workflow permissions op Read and write.
5. Actions -> roaming-feed -> Run workflow.

## Stand van zaken (lokaal getest)

| Provider | Bron | Buiten de EU in de bundel |
|---|---|---|
| Odido | eigen pagina | Turkije, VS, Zwitserland — vanaf Unlimited Plus, Snelst, Premium |
| KPN | provider | geen; EU-zone omvat wel Zwitserland, VK, Noorwegen, IJsland, Oekraine |
| Vodafone | provider | pagina komt binnen, formulering nog niet herkend |
| Simyo | provider | geen; zone 1 = EU plus negen landen |
| Youfone | provider | geen |
| hollandsnieuwe | provider | geen |
| Lebara | provider | geen |
| Ben | — | onbekend, WAF blokkeert elke automatische browser |

## Handmatig geverifieerd, nog niet automatisch herkend

- **Vodafone**: EU-zone omvat ook Turkije, Zwitserland en Albanie, voor alle
  abonnementen. In de EU: Unlimited Start 50 GB, Plus 75 GB, Max 100 GB.
  Unlimited Max geeft daarnaast 25 GB per maand in Canada, Caribisch Nederland,
  Marokko, Suriname, de VS en Zuid-Afrika.
- **KPN**: Turkije, Marokko en Suriname vallen er expliciet NIET onder; daar is
  een buitenlandbundel voor nodig, anders 2,50 euro per MB.

## Wat het bewust niet doet

Zinnen langer dan 400 tekens zijn tabellen en gaan eruit, het land moet binnen
120 tekens van de bundeluitspraak staan, ontkenningen als "valt niet binnen de
EU" worden herkend, en elke uitspraak krijgt de bronzin mee. Liever een gat dan
een verkeerd antwoord over dekking.
