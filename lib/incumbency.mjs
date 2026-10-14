/**
 * Député.es sortant.es. Sortant : élu.e à l'élection de départ (toute
 * circonscription), reconnu parmi les candidatures de l'élection visée par
 * le nom (nom de famille et initiale du prénom, sans accents). Indicateur
 * par circonscription visée et par parti :
 *   f_p = [un.e sortant.e se présente ici pour p] - [p a gagné ici au départ]
 * (sortant.e qui se représente pour le parti qui détenait le siège : 0 ;
 * siège libéré : -1 pour ce parti ; sortant.e sous une autre bannière ou
 * venu.e d'une autre circonscription : +1 pour son parti). Effet en CLR :
 * delta · f_p, centré sur les partis présents.
 */
import { readFileSync } from "node:fs";
import { P, winnerOf } from "./bc.mjs";

const candidates = JSON.parse(readFileSync(new URL("../data/bc_candidates.json", import.meta.url), "utf-8"));

const cle = (nom) => {
  const t = nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)|["'.]/g, " ").split(/[\s-]+/).filter(Boolean);
  return t.length ? `${t.at(-1)}|${t[0][0]}` : "";
};

/**
 * Indicateurs par circonscription visée : Map code -> f (indices P).
 * base : circonscriptions de départ sur la carte visée (parts de départ, pour
 * le parti gagnant) ; baseElection : date de l'élection de départ ;
 * targetElection : date de l'élection visée.
 */
export function incumbencyFeatures(base, baseElection, targetElection) {
  const sortants = new Set(candidates.filter((c) => c.election_date === baseElection && c.elected).map((c) => cle(c.name)));
  const out = new Map();
  for (const x of base.values()) {
    const f = P.map(() => 0);
    for (const c of candidates) {
      if (c.election_date !== targetElection || c.riding_code !== x.code) continue;
      if (sortants.has(cle(c.name))) f[P.indexOf(c.party_code)] = 1;
    }
    f[P.indexOf(winnerOf(x.shares))] -= 1;
    out.set(x.code, f);
  }
  return out;
}

/** Vecteur CLR (indices P) : delta · f centré sur les partis présents (idx). */
export function incumbencyShift(f, idx, delta) {
  const m = idx.reduce((a, j) => a + f[j], 0) / idx.length;
  const v = P.map(() => 0);
  for (const j of idx) v[j] = delta * (f[j] - m);
  return v;
}

/**
 * delta par moindres carrés : erreurs CLR locales e (résultat - prédiction,
 * partis présents des deux côtés) contre l'indicateur centré.
 */
export function estimateDelta(items) {
  let num = 0, den = 0;
  for (const { e, f, idx } of items) {
    const m = idx.reduce((a, j) => a + f[j], 0) / idx.length;
    for (const j of idx) { const fc = f[j] - m; num += e[j] * fc; den += fc * fc; }
  }
  return den ? num / den : 0;
}
