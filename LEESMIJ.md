# roaming-feed

Haalt dagelijks de buitenlandpagina's van de providers op en publiceert
`roaming.json` voor de worker.

## Installeren

1. Publieke repo `roaming_feed` onder FortAssets.
2. `scrape-roaming.mjs`, `roaming.json` en dit bestand in de root;
   `roaming.yml` onder `.github/workflows/`.
3. Settings → Actions → General → Workflow permissions op **Read and write**.
4. Actions → roaming-feed → Run workflow.

De worker leest daarna:

    https://cdn.jsdelivr.net/gh/FortAssets/roaming_feed@main/roaming.json

## Wat er in v2 is veranderd

**Juiste URL's.** KPN en Vodafone waren verhuisd. Elke provider heeft nu een
lijstje URL's; de eerste die bruikbare tekst geeft wint.

**Automatische browser-terugval.** Zonder `browser: true` proberen we eerst een
gewone fetch en vallen we bij 403 of 404 terug op Playwright. Odido, Ben,
Lebara en Vodafone staan op verplicht renderen.

**Ontkenningen worden herkend.** Dit was de belangrijkste fout. KPN schrijft:

> "Net als Marokko, Suriname en het Caribisch deel van het Koninkrijk valt
> Turkije **niet** binnen de EU bij KPN."

De eerste versie las dat als drie landen die in de bundel zitten — exact het
omgekeerde. Er is nu een negatiecontrole; zinnen met "niet binnen", "valt niet",
"uitgezonderd" en dergelijke tellen niet mee.

**Geen valse eerdere gegevens meer.** Een provider die nooit gelukt is meldt
niet langer "vorige gegevens behouden van undefined".

## Wat het bewust NIET doet

Volautomatisch afleiden welke bundel welk land dekt is niet betrouwbaar.
Zinnen langer dan 400 tekens zijn tabellen en worden overgeslagen, het land moet
binnen 120 tekens van de bundeluitspraak staan, en alles krijgt de bronzin mee
zodat je het kunt nalezen. Twijfelgevallen komen er niet in.

Liever een gat dan een verkeerd antwoord over dekking.

## Handmatig geverifieerd, nog niet automatisch

Deze feiten komen van de providers zelf maar staan op pagina's die het script
nog niet binnenkrijgt. Zet ze desnoods met de hand in de worker:

- **Vodafone**: EU-zone omvat ook **Turkije, Zwitserland en Albanië** — voor
  alle abonnementen. Databundel in de EU: Unlimited Start 50 GB, Plus 75 GB,
  Max 100 GB. **Unlimited Max** geeft daarnaast 25 GB per maand in Canada,
  Caribisch Nederland, Marokko, Suriname, de VS en Zuid-Afrika.
  Bron: vodafone.nl/abonnement/buitenland
- **KPN**: EU-zone omvat ook IJsland, Noorwegen, Noordzee (Tampnet), Moldavië,
  Oekraïne, het VK, Zwitserland en de Canarische Eilanden. Turkije, Marokko en
  Suriname vallen er **niet** onder; daar is een buitenlandbundel voor nodig.
  Zonder bundel €2,50 per MB.
  Bron: kpn.com/mobiel-abonnement/bundels/buitenland/binnen-eu
- **Odido**: Turkije, de VS en Zwitserland zitten in de bundel vanaf
  **Unlimited Plus, Snelst en Premium**, niet bij Start of Basis.
  Bron: jouw eigen buitenlandpagina.
