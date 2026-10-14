/**
 * Simulation : composition provinciale tirée (tirage de la tendance GP à la
 * date du scrutin, puis choc systémique CLR de variance tau² / s_p pour un
 * parti de part s_p), déplacement régional,
 * swing par transfert avec présence des partis, écart local tiré dans un
 * bassin d'erreurs CLR ; sièges par tirage, fréquences de victoire par
 * circonscription, médoïde.
 */
import { transferSwing, additiveSwing, aggregate, P, MAIN, REGIONS, winnerOf } from "./bc.mjs";

export const present = (v) => P.map((_, j) => j).filter((j) => v[j] > 0.005);
export const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-4))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
export const perturb = (v, idx, e) => { const out = P.map(() => 0); const ex = idx.map((j, k) => v[j] * Math.exp(e[k])); const t = ex.reduce((a, b) => a + b, 0); idx.forEach((j, k) => (out[j] = ex[k] / t)); return out; };

/**
 * Erreurs locales CLR : swing par transfert vers les parts réelles de chaque
 * région, écart CLR entre le résultat et la prédiction sur les partis
 * présents des deux côtés, centré par région et par parti.
 */
export function localResiduals(list, actualOf, realByRegion, present, form = "transfert") {
  const out = [];
  for (const g of REGIONS) {
    const sub = list.filter((x) => x.region === g), es = [];
    if (!sub.length) continue;
    (form === "additif" ? additiveSwing : transferSwing)(sub, realByRegion[g], { present }).forEach((s, k) => {
      const y = actualOf(sub[k]), idx = present_(s).filter((j) => y[j] > 0);
      const e = P.map(() => null); const a = clrOn(y, idx), b = clrOn(s, idx); idx.forEach((j, q) => (e[j] = a[q] - b[q]));
      es.push(e);
    });
    const m = P.map((_, j) => { const v = es.map((e) => e[j]).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
    for (const e of es) out.push(e.map((v, j) => (v === null ? 0 : v - m[j])));
  }
  return out;
}
const present_ = present;

/**
 * Swing de la province vers une composition provinciale ; avec un
 * déplacement régional (shift, CLR par région), chaque région est ensuite
 * ramenée à son propre agrégat après le swing provincial, déplacé de
 * shift[g] sur les partis présents.
 */
export function swingProvince(list, province, shift, presence, form = "transfert") {
  const swing = form === "additif" ? additiveSwing : transferSwing;
  const pred = swing(list, province, { present: presence });
  if (!shift) return pred;
  for (const g of REGIONS) {
    if (!shift[g]) continue;
    const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
    const sub = idx.map((i) => list[i]);
    const agg = aggregate(sub.map((x, k) => ({ ...x, s: pred[idx[k]] })), (x) => x.s), ii = present(agg);
    swing(sub, perturb(agg, ii, ii.map((j) => shift[g][j])), { present: presence }).forEach((v, k) => (pred[idx[k]] = v));
  }
  return pred;
}

/**
 * Tirages. provinceDraws : compositions provinciales P (tirages de la
 * tendance) ; tau : échelle du choc systémique CLR ; shift : déplacement
 * régional CLR par région (indices P) ; pool : erreurs locales ; presence(x) :
 * partis présents par circonscription.
 */
export function simulate(list, provincePoint, provinceDraws, { tau, shift, pool, presence, iso = false, form = "transfert", N = 2000, seed = 7 }) {
  let s0 = seed;
  const rng = () => { s0 = (s0 * 1664525 + 1013904223) >>> 0; return s0 / 4294967296; };
  const randn = () => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
  // Mélange : la moitié des tirages par transfert, l'autre moitié par swing additif ;
  // point : moyenne des deux prédictions.
  const forms = form === "mixte" ? ["transfert", "additif"] : [form];
  const points = forms.map((f) => swingProvince(list, provincePoint, shift, presence, f));
  const point = points[0].map((_, i) => P.map((__, j) => points.reduce((a, q) => a + q[i][j], 0) / points.length));
  const poolOf = (f) => (Array.isArray(pool) ? pool : pool[f]);
  const seats = [], votes = [], wins = list.map(() => Object.fromEntries(MAIN.map((p) => [p, 0])));
  for (let n = 0; n < N; n++) {
    const base = provinceDraws[Math.floor(rng() * provinceDraws.length)], idx = present(base);
    const prov = perturb(base, idx, idx.map((j) => (iso ? tau : tau / Math.sqrt(base[j])) * randn()));
    const f = forms[n % forms.length];
    const pred = swingProvince(list, prov, shift, presence, f);
    votes.push(Object.fromEntries(P.map((p, j) => [p, aggregate(list.map((x, i) => ({ ...x, s: pred[i] })), (x) => x.s)[j]])));
    const s = Object.fromEntries(MAIN.map((p) => [p, 0]));
    const pl = poolOf(f);
    pred.forEach((sh, i) => { const e = pl[Math.floor(rng() * pl.length)], ii = present(sh); const w = winnerOf(perturb(sh, ii, ii.map((j) => e[j]))); s[w]++; wins[i][w]++; });
    seats.push(s);
  }
  let medoid = null, best = Infinity;
  for (const a of seats) { let d = 0; for (const b of seats) d += MAIN.reduce((t, p) => t + Math.abs(a[p] - b[p]), 0); if (d < best) { best = d; medoid = a; } }
  const pointSeats = Object.fromEntries(MAIN.map((p) => [p, 0])); point.forEach((s) => pointSeats[winnerOf(s)]++);
  return { point, pointSeats, seats, votes, medoid, winProb: wins.map((w) => Object.fromEntries(MAIN.map((p) => [p, w[p] / N]))) };
}

export function interval(seats, p, lo = 0.05, hi = 0.95) {
  const v = seats.map((s) => s[p]).sort((a, b) => a - b);
  return { lo: v[Math.floor(lo * (v.length - 1))], med: v[Math.floor(0.5 * (v.length - 1))], hi: v[Math.floor(hi * (v.length - 1))] };
}

/**
 * Échelle du choc systémique : tau² = moyenne de s_p · e_p² sur les partis
 * présents et les scrutins, e_p étant l'écart CLR entre le résultat et la
 * tendance de veille.
 */
export function systemicTau(pairs, iso = false) {
  const v = [];
  for (const { actual, eve } of pairs) {
    const idx = present(actual), e = clrOn(actual, idx).map((x, k) => x - clrOn(eve, idx)[k]);
    idx.forEach((j, k) => v.push((iso ? 1 : actual[j]) * e[k] ** 2));
  }
  return Math.sqrt(v.reduce((a, b) => a + b, 0) / v.length);
}
