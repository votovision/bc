/**
 * Tendance provinciale à la veille de chaque scrutin (2020, 2024) : GP en ILR
 * (src/gpTrend.js, calendrier bc_calendar.json) ajusté sur les sondages
 * provinciaux du cycle (après l'élection précédente, avant le scrutin),
 * dernier sondage de chaque firme par semaine. Écrit la moyenne et 400
 * tirages de la composition provinciale à la date du scrutin dans
 * data/bc_eve_national.json et compare au résultat.
 *
 * Run: node tools/eve_national.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fitTrend, predictTrend, sampleTrendDraws } from "../src/gpTrend.js";
import { pivotPolls } from "../src/compositional.js";
import { ridings, aggregate, TRANSITIONS, P, MAIN } from "../lib/bc.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const calendar = load("bc_calendar.json");
const rows = load("bc_polls.json").filter((r) => r.region_code === "National");
const week = (d) => Math.floor(Date.parse(d) / 864e5 / 7);

/**
 * Sondages provinciaux d'un cycle, dernier de chaque firme par semaine ; codes
 * de partis du cycle. Un parti qu'aucun sondage ne mesure dans les 30 jours
 * précédant `to` (retrait, BC United en 2024) est mesuré à zéro après sa
 * dernière mesure, et sa part est retirée de la composition prédite
 * (`withdrawn`), les autres parts renormalisées.
 */
export function cyclePolls(from, to) {
  const { polls, partyCodes } = pivotPolls(rows.filter((r) => r.poll_date > from && r.poll_date < to));
  const limite = new Date(Date.parse(to) - 30 * 864e5).toISOString().slice(0, 10);
  const withdrawn = [], lastMeasured = {};
  for (const p of partyCodes) {
    const derniere = polls.filter((q) => q.shares[p] !== null).map((q) => q.pollDate).sort().at(-1);
    if (!derniere || derniere >= limite) continue;
    withdrawn.push(p); lastMeasured[p] = derniere;
    for (const q of polls) if (q.pollDate > derniere) { q.shares[p] = 0; q.reported.add(p); }
  }
  const m = new Map();
  for (const p of polls) {
    const k = `${p.firm}|${week(p.pollDate)}`;
    if (!m.has(k) || p.pollDate > m.get(k).pollDate) m.set(k, p);
  }
  return { polls: [...m.values()].sort((a, b) => a.pollDate.localeCompare(b.pollDate)), partyCodes, withdrawn, lastMeasured };
}

/** Composition P sans les partis retirés, renormalisée. */
export const withoutWithdrawn = (v, withdrawn) => {
  const w = v.map((x, j) => (withdrawn.includes(P[j]) ? 0 : x)); const t = w.reduce((a, b) => a + b, 0); return w.map((x) => x / t);
};

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("eve_national.mjs")) {
  const out = {};
  for (const T of TRANSITIONS) {
    const E = T.target[0];
    const { polls, partyCodes, withdrawn } = cyclePolls(T.base[0], E);
    const t0 = Date.now();
    const model = fitTrend(polls, partyCodes, { calendar });
    const pred = predictTrend(model, E, { nSamples: 400, seed: 9 });
    const draws = sampleTrendDraws(model, E, 400, 9);
    const point = withoutWithdrawn(P.map((p) => pred[p]?.mean ?? 0), withdrawn);
    const actual = aggregate([...ridings(...T.target).values()]);
    out[T.id] = { date: E, nPolls: polls.length, point, draws: draws.map((d) => withoutWithdrawn(P.map((p) => d[p] ?? 0), withdrawn)) };
    const present = MAIN.filter((p) => actual[P.indexOf(p)] > 0.005);
    console.log(`${T.id} ${E} (${polls.length} sondages, ${partyCodes.join(" ")}, ${((Date.now() - t0) / 1000).toFixed(0)} s) : ` +
      P.map((p, j) => `${p} ${(100 * point[j]).toFixed(1)}/${(100 * actual[j]).toFixed(1)}`).join(" ") +
      ` ; EAM ${(present.reduce((s, p) => s + Math.abs(point[P.indexOf(p)] - actual[P.indexOf(p)]), 0) / present.length * 100).toFixed(2)}`);
  }
  writeFileSync(new URL("../data/bc_eve_national.json", import.meta.url), JSON.stringify(out));
}
