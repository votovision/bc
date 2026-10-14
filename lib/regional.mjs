/**
 * Ventilations régionales des sondages (rapports des maisons de sondage,
 * data/bc_polls.json) ramenées aux régions du modèle (VAN, ISL, RESTE) :
 *  - VAN : Metro Vancouver, ou ses sous-régions combinées selon leurs
 *    effectifs ;
 *  - ISL : île de Vancouver (avec la côte nord chez Angus Reid) ;
 *  - RESTE : « reste de la province », ou Fraser Valley, Intérieur et Nord
 *    combinés selon les votes de l'élection de départ dans ces zones.
 * Les groupes qui chevauchent deux régions du modèle (Lower Mainland avec la
 * Fraser Valley) sont écartés. Parts sans les indécis ; « autres » absent :
 * reste à 100 (minimum 0,5).
 * Agrégation pondérée n · exp(-âge / tau) sur l'horloge dilatée (un jour de
 * campagne compte pour D jours), déplacement régional CLR
 * kappa · [(région - province) des sondages - (région - province) prédit
 * par le swing provincial].
 */
import { readFileSync } from "node:fs";
import { P, REGIONS, aggregate } from "./bc.mjs";

const day = (d) => Date.parse(d) / 864e5;
const ZONE_OF_GROUP = { "FRASER-VALLEY": ["FV"], INTERIOR: ["INT"], NORTH: ["NOR"] };
const VAN_PARTS = [["VANCOUVER-BURNABY", "RICHMOND-SURREY", "MAPLE-RIDGE-LANGLEY-COQUITLAM"], ["VANCOUVER-CITY", "METRO-VANCOUVER-REST"]];

const vec = (parts) => {
  const v = P.map((p) => (p === "AUTRES" ? 0 : parts[p] ?? 0));
  const s = v.reduce((a, b) => a + b, 0);
  v[P.indexOf("AUTRES")] = parts.AUTRES ?? Math.max(100 - s, 0.5);
  const t = v.reduce((a, b) => a + b, 0); return v.map((x) => x / t);
};
const mix = (items) => { const W = items.reduce((a, [, w]) => a + w, 0); return P.map((_, j) => items.reduce((a, [v, w]) => a + v[j] * w, 0) / W); };

/** Sondages ventilés : { firm, date, t, n, reg: { VAN, ISL, RESTE } } ; zoneVotes : votes de départ par zone. */
export function loadBreakdowns(zoneVotes) {
  const rows = JSON.parse(readFileSync(new URL("../data/bc_polls.json", import.meta.url), "utf-8"))
    .filter((r) => r.source.startsWith("rapport:") && r.region_code !== "National");
  const bySource = new Map();
  for (const r of rows) {
    if (!bySource.has(r.source)) bySource.set(r.source, { firm: r.firm, date: r.poll_date, groups: {} });
    const g = (bySource.get(r.source).groups[r.region_code] ??= { n: r.sample_size, parts: {} });
    if (!["UNDECIDED", "NONE"].includes(r.party_code)) g.parts[r.party_code] = r.pct_reported;
  }
  const out = [];
  for (const [source, { firm, date, groups }] of bySource) {
    const G = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { n: g.n, v: vec(g.parts) }]));
    const reg = {};
    if (G["METRO-VANCOUVER"]) reg.VAN = G["METRO-VANCOUVER"].v;
    else for (const parts of VAN_PARTS) if (parts.every((k) => G[k])) reg.VAN = mix(parts.map((k) => [G[k].v, G[k].n ?? 1]));
    const isl = G["VANCOUVER-ISLAND"] ?? G["VANCOUVER-ISLAND-NORTH-COAST"];
    if (isl) reg.ISL = isl.v;
    if (G["INTERIOR-NORTH"]) reg.RESTE = G["INTERIOR-NORTH"].v;
    else if (G["FRASER-VALLEY"] && G.INTERIOR) {
      const zones = { "FRASER-VALLEY": ["FV"], INTERIOR: G.NORTH ? ["INT"] : ["INT", "NOR"], NORTH: ["NOR"] };
      reg.RESTE = mix(Object.keys(ZONE_OF_GROUP).filter((k) => G[k]).map((k) => [G[k].v, zones[k].reduce((a, z) => a + (zoneVotes[z] ?? 0), 0)]));
    }
    const n = Object.values(groups).reduce((a, g) => a + (g.n ?? 0), 0) || 800;
    if (REGIONS.filter((g) => reg[g]).length >= 2) out.push({ source, firm, date, t: day(date), n, reg });
  }
  return out.sort((a, b) => a.t - b.t);
}

export const campaignDays = (t, campaigns) => campaigns.reduce((c, [a, b]) => c + Math.max(0, Math.min(t, day(b)) - day(a)), 0);

/** Parts agrégées par région à la date asOf, sondages postérieurs à `after`. */
export function pooled(polls, asOf, after, { tau, D, campaigns }) {
  const t = day(asOf), c = campaignDays(t, campaigns);
  const acc = {}, W = {};
  for (const q of polls) {
    if (q.date >= asOf || q.date <= after) continue;
    const age = (t - q.t) + (D - 1) * (c - campaignDays(q.t, campaigns));
    const w = q.n * Math.exp(-age / tau);
    for (const [g, s] of Object.entries(q.reg)) { acc[g] ??= P.map(() => 0); s.forEach((v, j) => (acc[g][j] += w * v)); W[g] = (W[g] ?? 0) + w; }
  }
  return Object.fromEntries(Object.entries(acc).map(([g, v]) => [g, v.map((x) => x / W[g])]));
}

const clrOn = (v, idx) => { const l = idx.map((j) => Math.log(Math.max(v[j], 1e-3))); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };

/**
 * Déplacement CLR par région : kappa · [(clr région - clr province) des
 * sondages - (même écart) prédit par le swing provincial], sur les partis
 * présents dans la prédiction de la région (part > 0,5 %) et mesurés. La
 * province des sondages et celle de la prédiction sont les moyennes des
 * régions mesurées, pondérées par les votes de départ. pred : parts
 * prédites par circonscription (même ordre que list).
 */
export function regionalShift(pool, list, pred, kappa) {
  const regs = REGIONS.filter((g) => pool[g]);
  if (regs.length < 2 || !kappa) return null;
  const W = Object.fromEntries(REGIONS.map((g) => [g, list.filter((x) => x.region === g).reduce((a, x) => a + x.total, 0)]));
  const predOf = (g) => aggregate(list.map((x, i) => ({ ...x, s: pred[i] })).filter((x) => x.region === g), (x) => x.s);
  const predReg = Object.fromEntries(regs.map((g) => [g, predOf(g)]));
  const pollProv = mix(regs.map((g) => [pool[g], W[g]])), predProv = mix(regs.map((g) => [predReg[g], W[g]]));
  const out = {};
  for (const g of regs) {
    const idx = P.map((_, j) => j).filter((j) => predReg[g][j] > 0.005 && pool[g][j] > 0.002);
    const dp = clrOn(pool[g], idx).map((v, k) => v - clrOn(pollProv, idx)[k]);
    const de = clrOn(predReg[g], idx).map((v, k) => v - clrOn(predProv, idx)[k]);
    const shift = P.map(() => 0);
    idx.forEach((j, k) => (shift[j] = kappa * (dp[k] - de[k])));
    out[g] = shift;
  }
  return out;
}
