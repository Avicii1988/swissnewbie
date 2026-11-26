#!/usr/bin/env node
/**
 * Build-time generator for the "2026 Switzerland Relocation Checklist" PDFs
 * (EN/DE/FR) in /assets/. Not part of the site runtime: the PDFs are committed
 * as static files and served as-is.
 *
 * Content follows the site's own checklists (first-90-days guides, permits,
 * health insurance and banking guides). Edit the CONTENT object, then run:
 *
 *   node scripts/build-checklist-pdf.js
 *
 * Needs a Playwright + Chromium install on the build machine (only for this
 * script; it is not a site dependency). Uses locally installed fonts only, so it
 * runs offline; the fonts are embedded in the PDFs.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets');
const FILES = { en: 'swissnewbie-checklist-2026.pdf', de: 'swissnewbie-checklist-2026-de.pdf', fr: 'swissnewbie-checklist-2026-fr.pdf' };

const CONTENT = {
  en: {
    title: '2026 Switzerland Relocation Checklist',
    sub: 'Every step from before you arrive to the end of your first 90 days — tick them off as you go.',
    name: 'Name', move: 'Moving date',
    phases: [
      { when: 'Before you arrive', items: [
        ['Residence & work permit', 'EU/EFTA citizens register after arrival. Non-EU citizens usually need a permit arranged by the employer before entering.'],
        ['Signed rental contract', 'Needed for your registration — or a letter from your host confirming your address.'],
        ['Personal liability insurance', 'Almost every landlord asks for proof before you sign the lease.'],
        ['Travel eSIM', 'EU roaming tariffs do not apply in Switzerland — stay connected from the airport.'],
        ['Documents folder', 'Passport or ID, employment contract, passport photos, rental contract.'],
      ] },
      { when: 'Days 1–7', items: [
        ['Swiss phone number', 'Needed for bank two-factor login, TWINT and calls from landlords and employers.'],
        ['Book your Gemeinde appointment', 'Register within 14 days at your municipality — most allow online booking.'],
        ['Registration (Anmeldung)', 'Bring passport/ID, rental contract, employment contract or proof of means, photos.'],
      ] },
      { when: 'Weeks 2–4', items: [
        ['Health insurance (KVG/LaMal)', 'Mandatory within 90 days, backdated to arrival. Compare premiums on priminfo.admin.ch.'],
        ['Swiss bank account', 'Your IBAN is needed for salary, rent and the rental deposit.'],
        ['Driving licence', 'Valid for 12 months — start the exchange early at the Strassenverkehrsamt.'],
      ] },
      { when: 'Weeks 5–12', items: [
        ['E-banking & standing orders', 'Set up standing orders (Dauerauftrag) for rent and utilities.'],
        ['TWINT', 'Switzerland’s mobile payment app — needs a Swiss bank account and phone number.'],
        ['SBB Half-Fare Card', 'Halves the price of train, bus and tram tickets if you travel regularly.'],
        ['Supplementary insurance', 'Optional cover for dental, glasses or hospital room choice — compare first.'],
        ['Pillar 3a', 'Employed? Pay in up to CHF 7,258 (2026) per year and deduct it from taxable income.'],
      ] },
    ],
    deadlinesTitle: 'Key deadlines',
    deadlines: [['14 days', 'Register at your Gemeinde'], ['90 days', 'Choose your health insurance'], ['12 months', 'Exchange your foreign driving licence'], ['3 months before expiry', 'Start a non-EU/EFTA permit renewal']],
    notesTitle: 'Notes',
    footer: 'swissnewbie.ch · General information, not legal advice · Status 2026',
    more: 'More guides, deadlines and checklists: swissnewbie.ch',
  },
  de: {
    title: 'Schweiz-Umzugscheckliste 2026',
    sub: 'Jeder Schritt von vor der Ankunft bis zum Ende deiner ersten 90 Tage — einfach abhaken.',
    name: 'Name', move: 'Umzugsdatum',
    phases: [
      { when: 'Vor der Ankunft', items: [
        ['Aufenthalts- & Arbeitsbewilligung', 'EU/EFTA-Bürger melden sich nach der Ankunft an. Nicht-EU-Bürger brauchen meist eine Bewilligung, die der Arbeitgeber vor der Einreise organisiert.'],
        ['Unterschriebener Mietvertrag', 'Nötig für die Anmeldung — oder eine Bestätigung deines Gastgebers zu deiner Adresse.'],
        ['Privathaftpflichtversicherung', 'Fast jeder Vermieter verlangt den Nachweis vor der Unterschrift.'],
        ['Reise-eSIM', 'EU-Roaming-Tarife gelten in der Schweiz nicht — ab dem Flughafen erreichbar.'],
        ['Dokumentenmappe', 'Pass oder ID, Arbeitsvertrag, Passfotos, Mietvertrag.'],
      ] },
      { when: 'Tag 1–7', items: [
        ['Schweizer Handynummer', 'Nötig für das Bank-Login, TWINT und Anrufe von Vermietern und Arbeitgebern.'],
        ['Termin bei der Gemeinde', 'Anmeldung innert 14 Tagen — die meisten Gemeinden bieten Online-Termine.'],
        ['Anmeldung', 'Mitbringen: Pass/ID, Mietvertrag, Arbeitsvertrag oder Nachweis der Mittel, Fotos.'],
      ] },
      { when: 'Woche 2–4', items: [
        ['Krankenversicherung (KVG)', 'Obligatorisch innert 90 Tagen, rückwirkend ab Ankunft. Prämien auf priminfo.admin.ch vergleichen.'],
        ['Schweizer Bankkonto', 'Deine IBAN brauchst du für Lohn, Miete und Mietkaution.'],
        ['Führerausweis', '12 Monate gültig — den Umtausch beim Strassenverkehrsamt früh starten.'],
      ] },
      { when: 'Woche 5–12', items: [
        ['E-Banking & Daueraufträge', 'Daueraufträge für Miete und Nebenkosten einrichten.'],
        ['TWINT', 'Die Bezahl-App der Schweiz — braucht ein Schweizer Konto und eine Schweizer Nummer.'],
        ['SBB Halbtax', 'Halbiert den Preis für Zug, Bus und Tram, wenn du regelmässig fährst.'],
        ['Zusatzversicherung', 'Optional für Zahnarzt, Brille oder Spitalzimmer — vorher vergleichen.'],
        ['Säule 3a', 'Angestellt? Bis CHF 7’258 (2026) pro Jahr einzahlen und vom Einkommen abziehen.'],
      ] },
    ],
    deadlinesTitle: 'Wichtige Fristen',
    deadlines: [['14 Tage', 'Anmeldung bei der Gemeinde'], ['90 Tage', 'Krankenversicherung wählen'], ['12 Monate', 'Ausländischen Führerausweis umtauschen'], ['3 Monate vor Ablauf', 'Verlängerung der Nicht-EU/EFTA-Bewilligung starten']],
    notesTitle: 'Notizen',
    footer: 'swissnewbie.ch · Allgemeine Informationen, keine Rechtsberatung · Stand 2026',
    more: 'Mehr Ratgeber, Fristen und Checklisten: swissnewbie.ch',
  },
  fr: {
    title: 'Checklist déménagement en Suisse 2026',
    sub: 'Chaque étape, d’avant votre arrivée à la fin de vos 90 premiers jours — à cocher au fur et à mesure.',
    name: 'Nom', move: 'Date du déménagement',
    phases: [
      { when: 'Avant l’arrivée', items: [
        ['Permis de séjour et de travail', 'Les citoyens UE/AELE s’annoncent après l’arrivée. Hors UE, le permis est en général organisé par l’employeur avant l’entrée.'],
        ['Bail signé', 'Nécessaire pour l’annonce — ou une attestation de votre hôte confirmant votre adresse.'],
        ['Assurance responsabilité civile', 'Presque tous les bailleurs demandent une attestation avant la signature du bail.'],
        ['eSIM de voyage', 'Les tarifs d’itinérance UE ne s’appliquent pas en Suisse — joignable dès l’aéroport.'],
        ['Dossier de documents', 'Passeport ou carte d’identité, contrat de travail, photos d’identité, bail.'],
      ] },
      { when: 'Jours 1–7', items: [
        ['Numéro de téléphone suisse', 'Nécessaire pour la connexion bancaire, TWINT et les appels des bailleurs et employeurs.'],
        ['Rendez-vous à la commune', 'Annonce dans les 14 jours — la plupart des communes proposent la réservation en ligne.'],
        ['Annonce d’arrivée', 'À apporter : passeport/ID, bail, contrat de travail ou preuve de moyens, photos.'],
      ] },
      { when: 'Semaines 2–4', items: [
        ['Assurance maladie (LAMal)', 'Obligatoire dans les 90 jours, avec effet rétroactif. Comparez les primes sur priminfo.admin.ch.'],
        ['Compte bancaire suisse', 'Votre IBAN est nécessaire pour le salaire, le loyer et la garantie de loyer.'],
        ['Permis de conduire', 'Valable 12 mois — lancez l’échange tôt auprès du service des automobiles.'],
      ] },
      { when: 'Semaines 5–12', items: [
        ['E-banking et ordres permanents', 'Mettez en place les ordres permanents pour le loyer et les charges.'],
        ['TWINT', 'L’app de paiement suisse — nécessite un compte et un numéro suisses.'],
        ['Abonnement demi-tarif CFF', 'Réduit de moitié le prix des trains, bus et trams si vous voyagez souvent.'],
        ['Assurance complémentaire', 'Optionnelle pour dentiste, lunettes ou chambre d’hôpital — comparez d’abord.'],
        ['Pilier 3a', 'Salarié ? Versez jusqu’à CHF 7’258 (2026) par an et déduisez-les du revenu imposable.'],
      ] },
    ],
    deadlinesTitle: 'Délais importants',
    deadlines: [['14 jours', 'Annonce à la commune'], ['90 jours', 'Choisir l’assurance maladie'], ['12 mois', 'Échanger le permis de conduire étranger'], ['3 mois avant l’échéance', 'Lancer le renouvellement du permis hors UE/AELE']],
    notesTitle: 'Notes',
    footer: 'swissnewbie.ch · Informations générales, pas un conseil juridique · État 2026',
    more: 'Plus de guides, délais et checklists : swissnewbie.ch',
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function phaseHtml(p) {
  return `<section class="phase"><div class="when">${esc(p.when)}</div><ul>${p.items.map(([t, d]) =>
    `<li><span class="box"></span><div><strong>${esc(t)}</strong><span>${esc(d)}</span></div></li>`).join('')}</ul></section>`;
}

function page(c, body, n) {
  return `<div class="page">
  <header><div class="logo">🐄 Swiss<span>Newbie</span></div><div class="pg">${n} / 2</div></header>
  ${body}
  <footer>${esc(c.footer)}</footer>
</div>`;
}

function render(lang) {
  const c = CONTENT[lang];
  const p1 = `<div class="hero"><div class="kicker">2026</div><h1>${esc(c.title)}</h1><p>${esc(c.sub)}</p>
    <div class="fields"><div>${esc(c.name)}<i></i></div><div>${esc(c.move)}<i></i></div></div></div>
    ${phaseHtml(c.phases[0])}${phaseHtml(c.phases[1])}`;
  const p2 = `${phaseHtml(c.phases[2])}${phaseHtml(c.phases[3])}
    <section class="deadlines"><h2>${esc(c.deadlinesTitle)}</h2><div class="dl">${c.deadlines.map(([w, t]) =>
      `<div><b>${esc(w)}</b><span>${esc(t)}</span></div>`).join('')}</div></section>
    <section class="notes"><h2>${esc(c.notesTitle)}</h2><i></i><i></i><i></i></section>
    <div class="more">${esc(c.more)}</div>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Inter,'Liberation Sans',sans-serif;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;height:297mm;padding:0 16mm 14mm;position:relative;page-break-after:always;overflow:hidden}
  .page:last-child{page-break-after:auto}
  header{display:flex;justify-content:space-between;align-items:center;height:20mm;margin:0 -16mm 7mm;padding:0 16mm;background:#1a1a1a}
  .logo{font-family:'Bitstream Charter',Charter,'DejaVu Serif',serif;font-weight:700;font-size:17pt;color:#f7f5f0;letter-spacing:-0.02em}
  .logo span{color:#ff4d5e}
  .pg{color:rgba(247,245,240,.55);font-size:8.5pt;letter-spacing:.08em}
  .hero{margin-bottom:6mm;padding-bottom:5mm;border-bottom:2px solid #D0021B}
  .kicker{display:inline-block;background:#D0021B;color:#fff;font-size:8pt;font-weight:600;letter-spacing:.12em;padding:1.2mm 3mm;border-radius:20px;margin-bottom:3mm}
  h1{font-family:'Bitstream Charter',Charter,'DejaVu Serif',serif;font-size:25pt;line-height:1.1;letter-spacing:-0.02em;margin-bottom:2.5mm}
  .hero p{font-size:10pt;color:#555;line-height:1.5;max-width:150mm}
  .fields{display:flex;gap:8mm;margin-top:4.5mm;font-size:8.5pt;color:#777}
  .fields div{flex:1;display:flex;gap:3mm;align-items:flex-end}.fields i{flex:1;border-bottom:1px solid #bbb;height:5mm}
  .phase{margin-bottom:5mm}
  .when{font-size:8.5pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#D0021B;margin-bottom:2mm;display:flex;align-items:center;gap:3mm}
  .when::after{content:'';flex:1;height:1px;background:#e5e2dc}
  ul{list-style:none}
  li{display:flex;gap:3.5mm;align-items:flex-start;padding:2.2mm 0;border-bottom:1px solid #f0ede8;break-inside:avoid}
  .box{flex:0 0 4.6mm;height:4.6mm;border:1.6px solid #1a1a1a;border-radius:1mm;margin-top:.4mm}
  li strong{display:block;font-size:10pt;font-weight:600;margin-bottom:.6mm}
  li span{font-size:8.8pt;color:#555;line-height:1.45}
  h2{font-family:'Bitstream Charter',Charter,'DejaVu Serif',serif;font-size:13pt;margin-bottom:3mm}
  .deadlines{background:#1a1a1a;color:#f7f5f0;border-radius:3mm;padding:5mm 6mm;margin:2mm 0 5mm}
  .dl{display:grid;grid-template-columns:1fr 1fr;gap:3mm 6mm}
  .dl div{display:flex;flex-direction:column;border-left:2.5px solid #D0021B;padding-left:3mm}
  .dl b{font-size:11pt;color:#ff4d5e}.dl span{font-size:8.8pt;color:rgba(247,245,240,.8)}
  .notes i{display:block;border-bottom:1px solid #ccc;height:8mm}
  .more{margin-top:5mm;font-size:9pt;font-weight:600;color:#D0021B}
  footer{position:absolute;left:16mm;right:16mm;bottom:8mm;border-top:1px solid #e5e2dc;padding-top:2.5mm;font-size:7.5pt;color:#888}
</style></head><body>${page(c, p1, 1)}${page(c, p2, 2)}</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  // offline: block every request (everything is inline, fonts are local)
  await pg.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  for (const lang of Object.keys(FILES)) {
    await pg.setContent(render(lang), { waitUntil: 'load' });
    const out = path.join(OUT_DIR, FILES[lang]);
    await pg.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pages = (fs.readFileSync(out, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pages !== 2) throw new Error(`${FILES[lang]}: expected 2 pages, got ${pages}`);
    console.log(`${FILES[lang]}  ${pages} pages  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
