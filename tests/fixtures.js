// Tekst slik den ser ut når ordresiden på maske.no kopieres (eksempelordre).
const lines = [
  ['3365377', 'Batteri Varta Industrial Pro LR14/C', '132,73', '2', '265,46', '66,36', '331,82'],
  ['3373778', 'Våtserviett Abena u/parf lokk 18x20cm', '179,58', '3', '538,74', '134,70', '673,44'],
  ['3359098', 'Håndtørk H5 Tork PeakServe Universal 1l', '324,11', '4', '1.296,44', '324,12', '1.620,56'],
  ['5761034', 'Toa Tork T8 SmartOne 207m 2l', '194,37', '2', '388,74', '97,18', '485,92'],
  ['3393921', 'Avfallspose 60x90cm 50L 8my Hvit', '261,74', '2', '523,48', '130,88', '654,36'],
  ['3392054', 'Notatblokk Resirkulert 75x75 gul', '43,11', '1', '43,11', '10,78', '53,89'],
  ['3392055', 'Notatblokk Resirkulert 75x75 assortert', '42,15', '1', '42,15', '10,54', '52,69'],
  ['3392057', 'Notatblokk Resirkulert 125x75 assortert', '60,50', '1', '60,50', '15,13', '75,63'],
  ['3359296', 'Halssnor Durable m/jojo og krok', '244,22', '1', '244,22', '61,06', '305,28'],
  ['3359297', 'Halssnor Durable m/karabinkrok', '143,53', '1', '143,53', '35,88', '179,41'],
];

const header = `Søk blant våre 12 000 produkter
Min side / Ordrehistorikk
Ordre: w.853448
Ordrenr\tw.853448
Ordredato\t27.10.2026
Referanse\t55184079
Betalingsmetode\tFaktura
Fraktmetode\tFri frakt
Produkter\t4.433,00
Frakt\t0,00
Totalt\t4.433,00
Herav mva.\t886,63
Leveringsadresse
Eksempel Barnehage
Eksempelveien 1
Leverende Filial: 7902
0000 OSLO
NO
Produktnummer / Produktnavn\tPris\tAntall\tSum\tMva.\tSum inkl. mva.
`;

export const tabText = header + lines.map(([s, n, ...r]) => `${s} ${n}\t${r.join('\t')}`).join('\n') + '\nLegg i handlevogn\nSnarveier';
export const newlineText = header.replace(/\t/g, '\n') + lines.map((l) => l.join('\n')).join('\n') + '\nLegg i handlevogn';
export const expectedLines = lines;
