/**
 * Colombie-Britannique : résultats par circonscription, zones et régions,
 * swing par transfert avec présence des partis, mesures d'erreur.
 *
 * Zones (district régional où réside la majorité relative des électeurs de
 * la circonscription) : MV (Metro Vancouver), FV (Fraser Valley), ISL (île
 * de Vancouver), NOR (Nord), INT (Intérieur et côte continentale).
 * Régions du modèle, communes aux ventilations des sondeurs : VAN (MV),
 * ISL, RESTE (FV, INT, NOR).
 */
import { readFileSync } from "node:fs";

export const P = ["NDP", "CON", "GRN", "BCU", "ONEBC", "CENTRE", "AUTRES"];
export const MAIN = ["NDP", "CON", "GRN", "BCU", "ONEBC", "CENTRE"];
export const REGIONS = ["VAN", "ISL", "RESTE"];
const ILE = ["Capital Regional District", "Cowichan Valley Regional District", "Regional District of Nanaimo", "Regional District of Alberni-Clayoquot",
  "Comox Valley Regional District", "Strathcona Regional District", "Regional District of Mount Waddington"];
const NORD = ["Peace River Regional District", "Regional District of Fraser-Fort George", "Regional District of Bulkley-Nechako",
  "Regional District of Kitimat-Stikine", "North Coast Regional District", "Stikine Region (Unincorporated)", "Cariboo Regional District"];
export const zoneOf = (district) => district === "Metro Vancouver Regional District" ? "MV" : district === "Fraser Valley Regional District" ? "FV"
  : ILE.includes(district) ? "ISL" : NORD.includes(district) ? "NOR" : "INT";
export const REGION_OF_ZONE = { MV: "VAN", ISL: "ISL", FV: "RESTE", INT: "RESTE", NOR: "RESTE" };
export const TRANSITIONS = [
  { id: "T1", base: ["2017-05-09", "2015"], target: ["2020-10-24", "2015"] },
  { id: "T2", base: ["2020-10-24", "2023"], target: ["2024-10-19", "2023"] },
];

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf-8"));
const rows = load("bc_riding_results.json");
const districts = load("bc_districts.json");

/** Map code -> { code, name, district, zone, region, votes: [P], total, shares } pour une élection et une carte. */
export function ridings(date, map) {
  const m = new Map();
  for (const r of rows) {
    if (r.election_date !== date || r.boundary_year !== map) continue;
    if (!m.has(r.riding_code)) {
      const district = districts[map][r.riding_code], zone = zoneOf(district);
      m.set(r.riding_code, { code: r.riding_code, name: r.riding_name, district, zone, region: REGION_OF_ZONE[zone], votes: P.map(() => 0), total: 0 });
    }
    const x = m.get(r.riding_code); x.votes[P.indexOf(r.party_code)] += r.votes; x.total += r.votes;
  }
  for (const x of m.values()) x.shares = x.votes.map((v) => v / x.total);
  return m;
}

/** Parts agrégées (pondérées par les votes) d'un ensemble de circonscriptions. */
export function aggregate(list, sharesOf = (x) => x.shares, weightOf = (x) => x.total) {
  const acc = P.map(() => 0); let W = 0;
  for (const x of list) { const w = weightOf(x); sharesOf(x).forEach((s, j) => (acc[j] += w * s)); W += w; }
  return acc.map((v) => v / W);
}

/** Présence des partis à l'élection visée, d'après ses résultats (0 vote : absent) ; */
export const presenceFromResults = (target) => (x) => {
  const y = target.get(x.code);
  return P.map((_, j) => (y ? y.votes[j] > 0 : true));
};

/**
 * Swing par transfert (« Strong Transition Model ») avec présence des
 * partis : un parti en recul conserve, partout où il se présente, la même
 * proportion de ses voix, modulée par la force locale (rétention
 * 1 - (1 - r)(s_i / s̄)^(-beta)) ; un parti qui ne se présente pas perd
 * toutes ses voix ; les voix libérées vont aux partis en progression qui se
 * présentent, au prorata de leur gain dans l'agrégat. Les cibles internes
 * sont ajustées par point fixe pour que l'agrégat reproduise `target`.
 * present(x) : booléens par parti (défaut : tous).
 */
export function transferSwing(list, target, { beta = 0, present = null, iters = 40 } = {}) {
  const pres = list.map((x) => (present ? present(x) : P.map(() => true)));
  const base = aggregate(list);
  let t = [...target], out = null;
  for (let it = 0; it < iters; it++) {
    out = transferOnce(list, pres, base, t, beta);
    const agg = aggregate(list.map((x, i) => ({ ...x, s: out[i] })), (x) => x.s);
    let maxErr = 0;
    t = t.map((v, j) => { maxErr = Math.max(maxErr, Math.abs(agg[j] - target[j])); return agg[j] > 0 && target[j] > 0 ? v * target[j] / agg[j] : v; });
    const T = t.reduce((a, b) => a + b, 0); t = t.map((v) => v / T);
    if (maxErr < 1e-5) break;
  }
  return out;
}

function transferOnce(list, pres, base, target, beta) {
  const ratio = P.map((_, j) => (base[j] > 0 ? Math.min(target[j] / base[j], 1) : 1));
  const retain = P.map((_, j) => {
    if (ratio[j] >= 1 || !beta) return null;
    const raw = list.map((x) => (x.shares[j] > 0 ? Math.max(0, 1 - (1 - ratio[j]) * Math.pow(x.shares[j] / base[j], -beta)) : 0));
    let lo = 0, hi = 50;
    for (let it = 0; it < 60; it++) {
      const c = (lo + hi) / 2;
      const agg = aggregate(list.map((x, i) => ({ ...x, s: [x.shares[j] * Math.min(1, 1 - (1 - raw[i]) * c)] })), (x) => x.s)[0];
      if (agg > target[j]) lo = c; else hi = c;
    }
    const c = (lo + hi) / 2;
    return raw.map((r) => Math.max(0, Math.min(1, 1 - (1 - r) * c)));
  });
  const gain = P.map((_, j) => Math.max(target[j] - base[j], 0));
  return list.map((x, i) => {
    const s = x.shares, ok = pres[i];
    const r = P.map((_, j) => (!ok[j] ? 0 : retain[j] ? retain[j][i] : ratio[j]));
    const Gi = gain.reduce((a, g, j) => a + (ok[j] ? g : 0), 0);
    const lost = s.reduce((a, v, j) => a + v * (1 - r[j]), 0);
    // Aucun parti en progression ne se présente : les voix libérées restent aux partis présents, au prorata.
    const keep = s.map((v, j) => v * r[j]);
    const K = keep.reduce((a, b) => a + b, 0);
    const o = keep.map((v, j) => v + (Gi > 0 ? (ok[j] ? lost * gain[j] / Gi : 0) : (K > 0 ? lost * v / K : 0)));
    const T = o.reduce((a, b) => a + b, 0); return o.map((v) => v / T);
  });
}

export const winnerOf = (s) => MAIN.reduce((b, p) => (s[P.indexOf(p)] > s[P.indexOf(b)] ? p : b), MAIN[0]);

/** Erreurs : RMSE des parts (points, partis principaux présents), gagnants, sièges. */
export function score(list, pred, actualOf) {
  let se = 0, n = 0, ok = 0;
  const seats = Object.fromEntries(MAIN.map((p) => [p, 0])), real = Object.fromEntries(MAIN.map((p) => [p, 0]));
  list.forEach((x, i) => {
    const y = actualOf(x); if (!y) return;
    for (const p of MAIN) { const j = P.indexOf(p); if (y[j] > 0 || pred[i][j] > 0) { se += ((pred[i][j] - y[j]) * 100) ** 2; n++; } }
    const w = winnerOf(pred[i]), t = winnerOf(y); seats[w]++; real[t]++; if (w === t) ok++;
  });
  return { rmse: Math.sqrt(se / n), correct: ok, n: list.length, seatErr: MAIN.reduce((s, p) => s + Math.abs(seats[p] - real[p]), 0), seats, real };
}

/**
 * Couverture : part p d'un parti mesurée sur toute la province mais
 * présent dans une partie des circonscriptions ; part ramenée à
 * p · c, c étant la part des votes de départ des circonscriptions où il se
 * présente, les autres partis renormalisés.
 */
export function coverageTarget(list, target, present) {
  const W = list.reduce((a, x) => a + x.total, 0);
  const c = P.map((_, j) => list.reduce((a, x) => a + (present(x)[j] ? x.total : 0), 0) / W);
  const t = target.map((v, j) => v * c[j]);
  const T = t.reduce((a, b) => a + b, 0); return t.map((v) => v / T);
}

/**
 * Swing additif avec présence : parts_i,p = max(s_i,p + d_p, 0,2 %) là où le
 * parti se présente, 0 ailleurs, renormalisées ; d ajusté itérativement pour
 * que l'agrégat reproduise `target`.
 */
export function additiveSwing(list, target, { present = null, iters = 200 } = {}) {
  const pres = list.map((x) => (present ? present(x) : P.map(() => true)));
  const d = P.map(() => 0);
  let out = null;
  for (let it = 0; it < iters; it++) {
    out = list.map((x, i) => { const u = x.shares.map((v, j) => (pres[i][j] ? Math.max(v + d[j], 0.002) : 0)); const t = u.reduce((a, b) => a + b, 0); return u.map((v) => v / t); });
    const agg = aggregate(list.map((x, i) => ({ ...x, s: out[i] })), (x) => x.s);
    let maxErr = 0;
    for (let j = 0; j < P.length; j++) { d[j] += target[j] - agg[j]; maxErr = Math.max(maxErr, Math.abs(target[j] - agg[j])); }
    if (maxErr < 1e-5) break;
  }
  return out;
}
