/**
 * Validation de la forme du swing, cibles exactes (« oracle ») : pour chaque
 * transition (2017-2020, carte de 2015 ; 2020-2024, 2020 transposé sur la
 * carte de 2023), swing par transfert vers les parts réelles de l'élection
 * visée, provinciales ou par région (VAN, ISL, RESTE), présence des partis
 * d'après les résultats visés, rétention beta sur une grille (beta = 0 :
 * perte proportionnelle). Erreur : RMSE des parts par circonscription et
 * gagnants corrects.
 *
 * Run: node tools/swing_form.mjs
 */
import { ridings, aggregate, transferSwing, presenceFromResults, score, TRANSITIONS, REGIONS } from "../lib/bc.mjs";

const BETAS = [0, 0.25, 0.5, 0.75, 1];
for (const T of TRANSITIONS) {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const present = presenceFromResults(B);
  const actual = (x) => B.get(x.code).shares;
  console.log(`${T.id} ${T.base[0]} -> ${T.target[0]} (${list.length} circonscriptions)`);
  for (const beta of BETAS) {
    const prov = transferSwing(list, aggregate([...B.values()]), { beta, present });
    const reg = new Array(list.length);
    for (const g of REGIONS) {
      const idx = list.map((x, i) => (x.region === g ? i : -1)).filter((i) => i >= 0);
      const tg = aggregate([...B.values()].filter((y) => y.region === g));
      transferSwing(idx.map((i) => list[i]), tg, { beta, present }).forEach((s, k) => (reg[idx[k]] = s));
    }
    const a = score(list, prov, actual), b = score(list, reg, actual);
    console.log(`  beta ${beta.toFixed(2)} | provincial RMSE ${a.rmse.toFixed(2)} gagnants ${a.correct}/${a.n} | régional RMSE ${b.rmse.toFixed(2)} gagnants ${b.correct}/${b.n}`);
  }
}
