/**
 * Prévision de l'élection générale du 24 octobre 2026 : départ résultats de
 * 2024 (carte de 2023) ; composition provinciale = tendance GP des sondages
 * provinciaux du cycle, prédite à la date du scrutin (moyenne et tirages),
 * ramenée à la couverture des partis (part des votes de départ des
 * circonscriptions où ils présentent une candidature) ; choc systémique CLR
 * de variance tau² / s (tau estimé sur les veilles de 2020 et de 2024) ;
 * déplacement régional kappa (0 : non retenu en validation) ; swing avec
 * présence des partis d'après les candidatures de 2026, par transfert dans
 * la moitié des tirages et additif dans l'autre ; écart local tiré parmi les
 * erreurs des deux transitions (2017-2020, 2020-2024) sous la même forme. Écrit data/bc_dashboard.json au schéma du tableau de bord.
 *
 * Run: node tools/project_now.mjs [AAAA-MM-JJ]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ridings, aggregate, presenceFromResults, coverageTarget, transferSwing, TRANSITIONS, P, MAIN, REGIONS, winnerOf } from "../lib/bc.mjs";
import { simulate, localResiduals, systemicTau, interval } from "../lib/simulate.mjs";
import { loadBreakdowns, pooled, regionalShift } from "../lib/regional.mjs";
import { cyclePolls, withoutWithdrawn } from "./eve_national.mjs";
import { seatDistributions, governmentScenarios } from "../src/simulate.js";
import { fitTrend, predictTrend, sampleTrendDraws, predictTrendSeries } from "../src/gpTrend.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const calendar = load("bc_calendar.json");
const eve = load("bc_eve_national.json");
const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const ELECTION = "2026-10-24", LAST = ["2024-10-19", "2023"];
const KAPPA = 0, N = 2000;
const SPEC = { tau: 120, D: 16, campaigns: calendar.campaigns };

// Historique : choc systémique et bassin d'erreurs locales.
const hist = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const real = Object.fromEntries(REGIONS.map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  return { T, B, list, real, presence: presenceFromResults(B), actual: aggregate([...B.values()]) };
});
const tau = systemicTau(hist.map((h) => ({ actual: h.actual, eve: eve[h.T.id].point })));
const FORMS = ["transfert", "additif"];
const pool = Object.fromEntries(FORMS.map((f) => [f, hist.flatMap((h) => localResiduals(h.list, (x) => h.B.get(x.code).shares, h.real, h.presence, f))]));

// Départ et candidatures de 2026.
const list = [...ridings(...LAST).values()];
const candidates = load("bc_candidates.json").filter((c) => c.election_date === ELECTION);
const running = new Map();
for (const c of candidates) (running.get(c.riding_code) ?? running.set(c.riding_code, new Set()).get(c.riding_code)).add(c.party_code);
const presence = (x) => P.map((p) => running.get(x.code)?.has(p) ?? false);

// Tendance provinciale du cycle, prédite à la date du scrutin.
const { polls, partyCodes, withdrawn } = cyclePolls(LAST[0], asOf <= ELECTION ? new Date(Date.parse(asOf) + 864e5).toISOString().slice(0, 10) : ELECTION);
const model = fitTrend(polls, partyCodes, { calendar });
const target = asOf < ELECTION ? ELECTION : asOf;
const pred = predictTrend(model, target, { nSamples: 400, seed: 9 });
const trendPoint = withoutWithdrawn(P.map((p) => pred[p]?.mean ?? 0), withdrawn);
const draws = sampleTrendDraws(model, target, 400, 9).map((d) => withoutWithdrawn(P.map((p) => d[p] ?? 0), withdrawn));
const province = coverageTarget(list, trendPoint, presence);

const zoneVotes = {}; for (const x of list) zoneVotes[x.zone] = (zoneVotes[x.zone] ?? 0) + x.total;
const regPolls = loadBreakdowns(zoneVotes);
const regPool = pooled(regPolls, asOf, LAST[0], SPEC);
const shift = regionalShift(regPool, list, transferSwing(list, province, { present: presence }), KAPPA);
const sim = simulate(list, province, draws.map((d) => coverageTarget(list, d, presence)), { tau, shift, pool, presence, form: "mixte", N });

const fmt = (v) => P.map((p, j) => `${p} ${(100 * v[j]).toFixed(1)}`).join(" ");
console.log(`Prévision au ${asOf} pour le ${ELECTION} : ${polls.length} sondages provinciaux, ${regPolls.filter((q) => q.date > LAST[0]).length} ventilations régionales`);
console.log(`  tendance       ${fmt(trendPoint)}`);
console.log(`  couverture     ${fmt(province)}`);
console.log(`  tau ${tau.toFixed(3)} ; bassin ${pool.transfert.length} erreurs locales par forme ; kappa ${KAPPA}`);
console.log(`  sièges : ponctuel ${JSON.stringify(sim.pointSeats)} ; médoïde ${JSON.stringify(sim.medoid)}`);
console.log(`  intervalles à 90 % : ${MAIN.map((p) => { const iv = interval(sim.seats, p); return `${p} ${iv.med} [${iv.lo}-${iv.hi}]`; }).join(" | ")}`);
for (const g of REGIONS) if (regPool[g]) console.log(`  sondages ${g.padEnd(5)} ${fmt(regPool[g])}`);

// --- Export au schéma du tableau de bord ----------------------------------------
const seatDraws = sim.seats.map((d) => ({ ...d, AUTRES: 0 }));
// Partis affichés : ceux qui présentent au moins une candidature en 2026.
const shown = P.filter((p) => candidates.some((c) => c.party_code === p));
const dates = [];
for (let d = new Date(polls[0].pollDate); d <= new Date(asOf); d.setDate(d.getDate() + 7)) dates.push(d.toISOString().slice(0, 10));
if (dates[dates.length - 1] !== asOf) dates.push(asOf);
const trendSeries = predictTrendSeries(model, dates, { nSamples: 300, seed: 1 });
const winnerSeats = (shares) => { const s = Object.fromEntries(P.map((p) => [p, 0])); for (const v of shares) s[winnerOf(v)]++; return s; };
const gallagher = (v, seats, n) => Math.sqrt(P.reduce((t, p, j) => t + (100 * v[j] - (100 * seats[p]) / n) ** 2, 0) / 2);
const gallagherPrevious = gallagher(aggregate(list), winnerSeats(list.map((x) => x.shares)), list.length);
const q = (arr, pc) => { const s2 = [...arr].sort((a, b) => a - b); return s2[Math.floor((pc / 100) * (s2.length - 1))]; };
const gal = [], gaps = Object.fromEntries(P.map((p) => [p, []])), vMean = Object.fromEntries(P.map((p) => [p, 0])), sMean = Object.fromEntries(P.map((p) => [p, 0]));
for (let i = 0; i < seatDraws.length; i++) {
  let sq = 0;
  for (const p of P) { const v = sim.votes[i][p] * 100, s2 = (seatDraws[i][p] / list.length) * 100; sq += (v - s2) ** 2; gaps[p].push(s2 - v); vMean[p] += v / N; sMean[p] += s2 / N; }
  gal.push(Math.sqrt(sq / 2));
}
const ZONE_NAMES = { MV: "Metro Vancouver", FV: "Fraser Valley", ISL: "Vancouver Island", INT: "Interior", NOR: "North" };
const national = aggregate(list.map((x, i) => ({ ...x, s: sim.point[i] })), (x) => x.s);
const dash = {
  meta: { generatedAt: new Date().toISOString(), asOf, electionDate: ELECTION, nDraws: N, gallagherPrevious, projectedVote: Object.fromEntries(P.map((p, j) => [p, national[j]])),
    nPolls: polls.length, nRegionalPolls: regPolls.filter((q2) => q2.date > LAST[0] && q2.date <= asOf).length, nRidings: list.length, baseElection: LAST[0], tau, kappa: KAPPA },
  partyCodes: shown, totalSeats: list.length, trendSeries,
  ridingForecast: Object.fromEntries(list.map((x, i) => [x.code, { shares: Object.fromEntries(P.map((p, j) => [p, sim.point[i][j]])), winner: winnerOf(sim.point[i]) }])),
  ridingWinProbs: Object.fromEntries(list.map((x, i) => [x.code, { ...sim.winProb[i], AUTRES: 0 }])),
  ridingBaseline: Object.fromEntries(list.map((x) => [x.code, Object.fromEntries(P.map((p, j) => [p, x.shares[j]]))])),
  ridingNames: Object.fromEntries(list.map((x) => [x.code, x.name])),
  ridingRegions: Object.fromEntries(list.map((x) => [x.code, ZONE_NAMES[x.zone]])),
  ridingCandidates: Object.fromEntries(list.map((x) => [x.code, [...(running.get(x.code) ?? [])]])),
  seatDistributions: seatDistributions(seatDraws, shown),
  pointCounts: { ...sim.pointSeats, AUTRES: 0 }, medoidCounts: { ...sim.medoid, AUTRES: 0 },
  scenarios: governmentScenarios(seatDraws, list.length, shown),
  disproportion: { voteShare: vMean, seatShare: sMean, gaps: Object.fromEntries(P.map((p) => [p, { p05: q(gaps[p], 5), p50: q(gaps[p], 50), p95: q(gaps[p], 95) }])), gallagher: { p05: q(gal, 5), p50: q(gal, 50), p95: q(gal, 95) } },
};
writeFileSync(new URL("../data/bc_dashboard.json", import.meta.url), JSON.stringify(dash));
console.log(`bc_dashboard.json : ${trendSeries.length} points de tendance, ${dash.scenarios.length} scénarios`);
