// Kategorier for statistikk og sortering. Foreslås automatisk ut fra varenavnet,
// men kan endres per vare.

export const CATEGORIES = ['Tørkepapir og toalett', 'Hygiene', 'Renhold', 'Kontor', 'Kjøkken', 'Forming og aktivitet', 'Annet'];

const RULES = [
  ['Tørkepapir og toalett', /håndtørk|tørkepapir|\btoa\b|toalettpapir|ansiktsserviett|legebenkpapir|tørkerull|papirhåndkle/i],
  ['Hygiene', /våtserviett|hanske|såpe|bleie|vaskeklut|plaster|desinfeksjon|hånddesinf|tannbørst|solkrem|stellunderlag/i],
  ['Renhold', /rengjøring|mopp|skaft|sanifix|kôkfix|kökfix|avfallspose|søppel|pedalbøtte|vaskemiddel|oppvask|klut|skurekrem|bøtte|kost\b|feiebrett/i],
  ['Kjøkken', /kaffe|filter|engangs|tallerken|beger|bestikk|folie|matpapir|plastfolie|fryse|servietter?\b/i],
  ['Forming og aktivitet', /forming|tegne|fargeblyant|tusj|maling|pensel|lim\b|limstift|papp|kartong(?!g)|perler|leire|glitter|kritt/i],
  ['Kontor', /kopipapir|notatblokk|penn|blyant|kinabok|mappe|etikett|heftestift|stiftemaskin|saks|ordrebrett|klikkramme|skriveunderlag|musematte|håndleddstøtte|batteri|halssnor|tape|konvolutt|perm|post-it|markeringspenn/i],
];

export function guessCategory(name = '') {
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return 'Annet';
}
