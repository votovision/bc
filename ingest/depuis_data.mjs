/**
 * Entrées du modèle tirées du dépôt de données votovision/data (clone voisin
 * ../data, ou chemin donné en argument) :
 *  - data/bc_polls.json : sondages provinciaux et ventilations régionales
 *    (sondages.csv et parts.csv, juridiction bc-provincial), une ligne par
 *    sondage, groupe et parti ;
 *  - data/bc_national_polls.json : sondages provinciaux seulement, au
 *    format du tableau de bord ;
 *  - data/bc_riding_results.json : résultats officiels d'Elections BC par
 *    circonscription et par parti (2017 et 2020 sur la carte de 2015 ; 2020
 *    transposé et 2024 sur la carte de 2023) ;
 *  - data/bc_results.json : résultats de la dernière élection générale,
 *    après l'élection de référence du modèle (2026, préliminaires puis
 *    définitifs) : sièges, votes et gagnant par circonscription, et leur
 *    provenance ; absent tant qu'aucun résultat n'est publié ;
 *  - data/bc_candidates.json : candidatures (2017, 2020, 2024 avec votes et
 *    élus ; 2026) ;
 *  - data/bc_districts.json : district régional de chaque circonscription,
 *    par carte (2015, 2023) ;
 *  - data/bc_ridings_2023.geojson : limites de la carte de 2023, simplifiées,
 *    avec le district régional de chaque circonscription.
 *
 * Run: node ingest/depuis_data.mjs [chemin du dépôt data]
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = fileURLToPath(new URL(".", import.meta.url));
const DATA = resolve(process.argv[2] ?? join(ICI, "..", "..", "data"));
const OUT = new URL("../data/", import.meta.url);
const JURIDICTION = "bc-provincial";

function lireCsv(chemin) {
  const texte = readFileSync(chemin, "utf-8").replace(/^﻿/, "");
  const lignes = []; let ligne = [], champ = "", q = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (q) { if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') q = false; else champ += c; }
    else if (c === '"') q = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texte[i + 1] === "\n") i++; ligne.push(champ); lignes.push(ligne); ligne = []; champ = ""; }
    else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const [h, ...r] = lignes.filter((l) => l.length > 1);
  return r.map((l) => Object.fromEntries(h.map((k, j) => [k, l[j] ?? ""])));
}
const ecrire = (nom, v) => { writeFileSync(new URL(nom, OUT), JSON.stringify(v)); console.log(`${nom} : ${Array.isArray(v) ? v.length : Object.keys(v).length}`); };

const sondages = lireCsv(join(DATA, "csv", "sondages.csv")).filter((s) => s.juridiction === JURIDICTION);
const parts = new Map();
for (const p of lireCsv(join(DATA, "csv", "parts.csv"))) { if (!parts.has(p.id)) parts.set(p.id, []); parts.get(p.id).push(p); }
ecrire("bc_polls.json", sondages.flatMap((s) => (parts.get(s.id) ?? []).map((p) => ({
  poll_id: s.id, region_code: s.region, firm: s.firme, poll_date: s.date_fin, start_date: s.date_debut || null,
  sample_size: s.n ? Number(s.n) : null, party_code: p.parti, pct_reported: Number(p.pct), source: s.provenance,
}))));

ecrire("bc_national_polls.json", sondages.filter((s) => s.region === "National").flatMap((s) => (parts.get(s.id) ?? []).map((p) => ({
  poll_id: s.id, region_code: "National", firm: s.firme, poll_date: s.date_fin, sample_size: s.n ? Number(s.n) : null,
  party_code: p.parti, pct_reported: Number(p.pct), n_decided: s.n_decides ? Number(s.n_decides) : null,
}))));

ecrire("bc_riding_results.json", lireCsv(join(DATA, "csv", "resultats.csv"))
  .filter((r) => r.juridiction === JURIDICTION)
  .map((r) => ({ election_date: r.election, boundary_year: r.carte, riding_code: r.circonscription, riding_name: r.nom, party_code: r.parti, votes: Number(r.votes) })));

// Résultats de la dernière élection, pour les comparer à la prévision.
const BASE = "2024-10-19";
const recents = lireCsv(join(DATA, "csv", "resultats.csv")).filter((r) => r.juridiction === JURIDICTION && r.election > BASE);
const derniere = recents.map((r) => r.election).sort().at(-1);
if (derniere) {
  const lignes = recents.filter((r) => r.election === derniere);
  const ridings = {}, votes = {}, seats = {};
  for (const r of lignes) {
    const x = (ridings[r.circonscription] ??= { name: r.nom, votes: {} });
    x.votes[r.parti] = Number(r.votes);
    votes[r.parti] = (votes[r.parti] ?? 0) + Number(r.votes);
  }
  for (const x of Object.values(ridings)) {
    x.winner = Object.entries(x.votes).sort((a, b) => b[1] - a[1])[0][0];
    seats[x.winner] = (seats[x.winner] ?? 0) + 1;
  }
  const provenance = lignes[0].provenance;
  ecrire("bc_results.json", { election: derniere, map: lignes[0].carte, preliminary: /préliminaires/.test(provenance), provenance, seats, votes, ridings });
}

ecrire("bc_candidates.json", lireCsv(join(DATA, "csv", "candidats_bc.csv")).map((c) => ({
  election_date: c.election, boundary_year: c.carte, riding_code: c.circonscription, name: c.nom, party_code: c.parti,
  votes: c.votes === "" ? null : Number(c.votes), elected: c.elu === "1",
})));

const districts = {};
for (const d of lireCsv(join(DATA, "csv", "circonscriptions_bc.csv"))) (districts[d.carte] ??= {})[d.circonscription] = d.district_regional;
ecrire("bc_districts.json", districts);

copyFileSync(join(DATA, "geo", "circonscriptions_bc_2023.geojson"), new URL("bc_ridings_2023.geojson", OUT));
console.log("bc_ridings_2023.geojson : copié");
