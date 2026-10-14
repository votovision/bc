/**
 * Validation hors échantillon de la simulation à la veille de chaque scrutin
 * (2020, 2024) : composition provinciale tirée de la tendance de veille
 * (bc_eve_national.json), choc systémique et bassin d'erreurs locales
 * estimés sur l'autre transition seulement, présence des partis d'après les
 * candidatures (résultats visés), cibles régionales selon `--kappa` (0 :
 * cible provinciale partout). Rapporte sièges médians et intervalles à 90 %
 * contre le résultat, gagnants corrects du scénario ponctuel, score de Brier
 * des probabilités de victoire et log-vraisemblance du gagnant réel.
 *
 * Run: node tools/eve_simulation.mjs [--kappa k]
 */
import { readFileSync } from "node:fs";
import { ridings, aggregate, presenceFromResults, coverageTarget, transferSwing, TRANSITIONS, MAIN, winnerOf } from "../lib/bc.mjs";
import { simulate, localResiduals, systemicTau, interval } from "../lib/simulate.mjs";
import { loadBreakdowns, pooled, regionalShift } from "../lib/regional.mjs";

const calendar = JSON.parse(readFileSync(new URL("../data/bc_calendar.json", import.meta.url), "utf-8"));
const SPEC = { tau: 120, D: 16, campaigns: calendar.campaigns };
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const KAPPA = arg("--kappa", 0), SCALE = arg("--echelle", 1), ISO = process.argv.includes("--isotrope"), FORM = process.argv.includes("--additif") ? "additif" : process.argv.includes("--mixte") ? "mixte" : "transfert";

const eve = JSON.parse(readFileSync(new URL("../data/bc_eve_national.json", import.meta.url), "utf-8"));
const H = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const real = Object.fromEntries(["VAN", "ISL", "RESTE"].map((g) => [g, aggregate([...B.values()].filter((y) => y.region === g))]));
  const presence = presenceFromResults(B);
  return { T, A, B, list, real, presence, actualProv: aggregate([...B.values()]) };
});

for (const h of H) {
  const other = H.filter((o) => o !== h);
  const tau = systemicTau(other.map((o) => ({ actual: o.actualProv, eve: eve[o.T.id].point })), ISO);
  const poolFor = (f) => other.flatMap((o) => localResiduals(o.list, (x) => o.B.get(x.code).shares, o.real, o.presence, f)).map((e) => e.map((v) => v * SCALE));
  const pool = FORM === "mixte" ? { transfert: poolFor("transfert"), additif: poolFor("additif") } : poolFor(FORM);
  const cov = (v) => (process.argv.includes("--couverture") ? coverageTarget(h.list, v, h.presence) : v);
  const zoneVotes = {}; for (const x of h.list) zoneVotes[x.zone] = (zoneVotes[x.zone] ?? 0) + x.total;
  const pool0 = pooled(loadBreakdowns(zoneVotes), h.T.target[0], h.T.base[0], SPEC);
  const shift = regionalShift(pool0, h.list, transferSwing(h.list, cov(eve[h.T.id].point), { present: h.presence }), KAPPA);
  if (KAPPA) console.log(`  ventilations : ${Object.keys(pool0).join(", ")} ; déplacement ${shift ? Object.entries(shift).map(([g, v]) => g + " " + v.map((x) => x.toFixed(2)).join("/")).join(" | ") : "aucun"}`);
  const sim = simulate(h.list, cov(eve[h.T.id].point), eve[h.T.id].draws.map(cov), { tau, shift, pool, presence: h.presence, iso: ISO, form: FORM, N: 2000 });
  const real = Object.fromEntries(MAIN.map((p) => [p, 0])); for (const y of h.B.values()) real[winnerOf(y.shares)]++;
  let brier = 0, ll = 0, ok = 0;
  h.list.forEach((x, i) => {
    const w = winnerOf(h.B.get(x.code).shares);
    for (const p of MAIN) brier += (sim.winProb[i][p] - (p === w ? 1 : 0)) ** 2;
    ll += Math.log(Math.max(sim.winProb[i][w], 1 / 2000));
    if (winnerOf(sim.point[i]) === w) ok++;
  });
  const medErr = MAIN.reduce((t, p) => t + Math.abs(sim.medoid[p] - real[p]), 0);
  const inside = MAIN.filter((p) => real[p] || sim.pointSeats[p]).map((p) => { const iv = interval(sim.seats, p); return real[p] >= iv.lo && real[p] <= iv.hi; });
  console.log(`${h.T.id} ${h.T.target[0]} : tau ${tau.toFixed(3)}, bassin ${(pool.length ?? pool.transfert.length)} ; gagnants ${ok}/${h.list.length} ; Brier ${(brier / h.list.length).toFixed(3)} ; ` +
    `log-vrais. ${(ll / h.list.length).toFixed(3)} ; erreur absolue de sièges du médoïde ${medErr} ; intervalles à 90 % contenant le résultat ${inside.filter(Boolean).length}/${inside.length}`);
  for (const p of MAIN.filter((p) => real[p] || sim.pointSeats[p])) {
    const iv = interval(sim.seats, p);
    console.log(`   ${p.padEnd(6)} réel ${String(real[p]).padStart(2)} | médiane ${iv.med} [${iv.lo}-${iv.hi}] ${real[p] >= iv.lo && real[p] <= iv.hi ? "contenu" : "HORS"} | ponctuel ${sim.pointSeats[p]}`);
  }
}
