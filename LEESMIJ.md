# roaming-feed v5

Twee bestanden, twee rollen. Dat onderscheid is de kern.

    zones-handmatig.json   <- BRON VAN WAARHEID voor het landfilter
    roaming.json           <- signaleert DAT er iets veranderd is

## Waarom die splitsing

Ik heb drie keer geprobeerd de zonelijsten automatisch af te leiden uit de
providerpagina's. Het blijft de verkeerde zin oppikken: tarieventabellen en
uitzonderingslijsten lijken te veel op de zonebeschrijving. KPN kreeg zo
"Turkije" in zijn EU-zone terwijl het daar juist buiten valt, en Simyo kreeg
Rusland en Kenia uit een tarieventabel.

Bij dekkingsinformatie is zelfverzekerd fout erger dan niets weten. Daarom
staan de echte lijsten met de hand in `zones-handmatig.json` en zijn de
gescrapete velden in `roaming.json` gelabeld als `zekerheid: laag`.

Dat kost weinig onderhoud: zones veranderen misschien twee keer per jaar, en
de Action vertelt je wanneer.

## De regel die alles dekt

Een bezoeker typt Kaapverdie, Vietnam of Curacao. Je hoeft die landen niet te
kennen:

1. staat het land in `euBasis` of in de `euExtra` van die provider -> in de bundel
2. staat het in een `uitzonderingen`-blok -> in de bundel, maar alleen bij die tiers
3. anders -> NIET gedekt; toon de eSIM en de landengids

Punt drie klopt voor de tweehonderd landen die je niet expliciet kent, en is
commercieel het interessantst: daar stuur je door naar je eSIM-vergelijker.

## Landnamen normaliseren

`roaming.json` bevat een `alias`-tabel met 173 schrijfwijzen. Getest:
Türkiye/turkey -> Turkije, USA/de VS -> Verenigde Staten, bali -> Indonesie,
KAAPVERDIE -> Kaapverdie, Curacao met en zonder cedille. Normaliseer de invoer
van de bezoeker hiermee voordat je opzoekt.

## Wat de Action nog wel doet

Elke nacht de acht pagina's ophalen, de inhoud vergelijken met de vorige run,
en melden welke provider iets veranderd heeft. Dan kijk jij of
`zones-handmatig.json` bijgewerkt moet worden. Dat is de winst: je leest niet
wekelijks acht sites, je hoort het wanneer er iets beweegt.

## Stand van zaken

| Provider | Zonelijst | Buiten de EU in de bundel |
|---|---|---|
| KPN | compleet | geen; Turkije/Marokko/Suriname vallen er expliciet buiten |
| Vodafone | compleet | Turkije, Zwitserland, Albanie in de EU-zone; Unlimited Max ook 25 GB in Canada, Caribisch NL, Marokko, Suriname, VS, Zuid-Afrika |
| Odido | compleet | Turkije, VS, Zwitserland vanaf Unlimited Plus/Snelst/Premium |
| Simyo | compleet | geen |
| hollandsnieuwe | compleet | geen |
| Youfone | te verifieren | geen |
| Lebara | te verifieren | geen |
| Ben | ONBEKEND | 403 op elke automatische browser |

Ben en Youfone zijn de enige gaten. Twee minuten op hun site en je hebt ze.

## Installeren

Repo `roaming_feed` (publiek). De drie JSON/JS-bestanden in de root,
`roaming.yml` onder `.github/workflows/`. Settings -> Actions -> General ->
Workflow permissions op Read and write.
