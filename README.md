# Bestillingshjelp for Maske.no

En liten app for mobilen som holder oversikt over bestillinger fra Maske.no til barnehagen:
ordrer, prisutvikling, forbruk, lagertelling og forslag til neste bestilling.

**All data lagres bare på telefonen** (i nettleserens lagring). Ingenting sendes til noen server.
Ta sikkerhetskopi jevnlig fra *Innstillinger*.

## Slik brukes den

1. **Legg inn ordrer:** Åpne ordren på maske.no (Min side → Ordrehistorikk), merk all tekst og kopier.
   Lim inn under *Ordrer → Lim inn ordre*. Appen sjekker at varelinjene summerer til ordretotalen.
2. **Tell lageret** før hver bestilling under *Telling*. Skriv 0 for tomme varer.
3. **Se forslaget** under *Bestill*. Velg hvor lenge bestillingen skal vare, juster med − / +, og kopier listen.
4. **Registrer levering** på ordren («Kom i dag»), så lærer appen den faktiske leveringstiden.
5. **Noe gikk tomt?** Trykk *Noe gikk tomt?* på oversikten (eller på varen). Da vet appen *når* lageret tok slutt.
6. **Stengte perioder, budsjett og prisvarsel** settes under ⚙ *Innstillinger*.

## Statistikk

- Kostnad per måned og per kategori (kategori foreslås ut fra varenavnet og kan endres på varen).
- Prisutvikling per vare, og prisvarsel når en vare er blitt dyrere enn forrige gang (standard 5 %).
- Budsjett: brukt hittil i år, hvor langt ut i året vi er, og forventet årsforbruk med samme tempo.

## Slik regnes forslaget ut

- **Forbruk** mellom to tellinger = forrige telling + det som ble levert − ny telling.
  Har dere ikke talt ennå, anslås forbruket fra bestillingene (merket «grovt anslag»).
- **Anbefalt antall** = forbruk × (leveringstid + periode + buffer) − lager nå − det som er på vei.
- **«Gikk tomt» med dato** regnes som en telling på 0 den dagen. Forbruket måles da over de dagene
  varen faktisk varte, og perioden der lageret stod tomt telles ikke med.
- **Varer som var tomme ved telling, uten at vi vet når**, får et påslag (standard 25 %), fordi
  historikken da viser for lavt forbruk.
- **Stengte perioder** (ferie) teller ikke som forbruksdager, verken i målingen eller i forslaget.
- **Neste bestilling** er datoen da første vare når bufferen.
- **Hvor ofte bør dere bestille:** viser hva en bestilling vil koste ved ulike intervaller.
  Er grensen for fri frakt fylt inn, anbefales den hyppigste rytmen som når grensen.

## Teknisk

Ren HTML/CSS/JavaScript uten byggesteg eller avhengigheter, installerbar som app (PWA) og virker uten nett.

```
index.html, css/, js/
  js/parser.js   leser innlimt tekst fra ordresiden
  js/calc.js     forbruk, lager og forslag
  js/db.js       lagring i IndexedDB, import/eksport
  js/charts.js   enkle SVG-diagrammer
  js/categories.js  kategorier og automatisk forslag
  js/app.js      visningene
```

- Kjør lokalt: `npm start` og åpne http://localhost:8080
- Tester: `npm test`
- Publisering: GitHub Actions publiserer til GitHub Pages ved push til `main` eller standardgrenen
  (krever at *Settings → Pages → Source* er satt til **GitHub Actions**). Kjører også fra standardgrenen så lenge `main` ikke finnes.
