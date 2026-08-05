# roaming-feed v6

Twee bestanden, twee rollen:

    zones-handmatig.json   <- BRON VAN WAARHEID voor het landfilter
    roaming.json           <- signaleert DAT er iets veranderd is

## Wat er in v6 is opgelost: de run duurde bijna acht minuten

Vier oorzaken, alle vier weg:

**`waitUntil: 'networkidle'` bereikt nooit zijn eindpunt** op sites met
tracking of live-chat: die vuren om de paar seconden een verzoek af, dus de
pagina is nooit stil. Playwright wachtte dan tot zijn eigen timeout van 40
seconden. Nu `domcontentloaded`, dat komt altijd.

**Timeouts van 40 naar 15 seconden.** Een pagina die na vijftien seconden
niets heeft, gaat het niet meer worden.

**Ben wordt overgeslagen.** Die geeft 403 op elke automatische browser, lokaal
en op de runner. Acht pogingen van veertig seconden leverden niets op behalve
tijdverlies. Status blijft `onbekend` — eerlijker dan een gok.

**De browser wordt gecachet** en `--with-deps` is weg. Die twee samen kostten
per run ruim anderhalve minuut; ubuntu-latest heeft die bibliotheken al.

Lokaal gemeten na de aanpassing: **42 seconden** voor zeven providers, tegen
bijna acht minuten daarvoor.

## De regel die elk land dekt

1. staat het land in `euBasis` of in de `euExtra` van die provider -> in de bundel
2. staat het in een `uitzonderingen`-blok -> in de bundel, maar alleen bij die tiers
3. anders -> NIET gedekt; toon de eSIM en de landengids

Punt drie klopt voor de tweehonderd landen die je niet expliciet kent, en is
commercieel het interessantst.

## Waarom de zonelijsten met de hand gaan

Drie pogingen om ze automatisch af te leiden gaven steeds de verkeerde zin:
tarieventabellen en uitzonderingslijsten lijken te veel op de zonebeschrijving.
KPN kreeg zo Turkije in zijn EU-zone terwijl het daar juist buiten valt. De
gescrapete velden heten daarom `euZoneKandidaat` en dragen
`zekerheid: laag`. Gebruik ze om te ZIEN dat er iets veranderd is, niet om de
vergelijker mee te vullen.

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
| Ben | ONBEKEND | blokkeert automatische toegang |

Ben en Youfone zijn de enige gaten. Twee minuten op hun site en je hebt ze.

## Installeren

Repo `roaming_feed` (publiek). De drie bestanden in de root, `roaming.yml`
onder `.github/workflows/`. Settings -> Actions -> General -> Workflow
permissions op Read and write.
