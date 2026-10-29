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

## Slik regnes forslaget ut

- **Forbruk** mellom to tellinger = forrige telling + det som ble levert − ny telling.
  Har dere ikke talt ennå, anslås forbruket fra bestillingene (merket «grovt anslag»).
- **Anbefalt antall** = forbruk × (leveringstid + periode + buffer) − lager nå − det som er på vei.
- **Varer som har gått tomme** får et påslag (standard 25 %). Når lageret er tomt, vet vi ikke hvor mye
  som egentlig ville blitt brukt, så historikken viser for lavt forbruk.
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
  js/app.js      visningene
```

- Kjør lokalt: `npm start` og åpne http://localhost:8080
- Tester: `npm test`
- Publisering: GitHub Actions publiserer til GitHub Pages ved push til `main` eller standardgrenen
  (krever at *Settings → Pages → Source* er satt til **GitHub Actions**). Kjører også fra standardgrenen så lenge `main` ikke finnes.
