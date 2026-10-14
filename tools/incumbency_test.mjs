/**
 * Validation de l'effet des député.es sortant.es, cibles provinciales exactes :
 * pour chaque transition, delta estimé sur les erreurs CLR locales de l'autre
 * transition seulement, appliqué après le swing par transfert ; RMSE des parts
 * et gagnants corrects, sans et avec l'effet.
 *
 * Run: node tools/incumbency_test.mjs
 */
import { ridings, aggregate, transferSwing, presenceFromResults, score, TRANSITIONS, P } from "../lib/bc.mjs";
import { present, clrOn, perturb } from "../lib/simulate.mjs";
import { incumbencyFeatures, incumbencyShift, estimateDelta } from "../lib/incumbency.mjs";

const H = TRANSITIONS.map((T) => {
  const A = ridings(...T.base), B = ridings(...T.target);
  const list = [...A.values()].filter((x) => B.has(x.code));
  const presence = presenceFromResults(B);
  const pred = transferSwing(list, aggregate([...B.values()]), { present: presence });
  const F = incumbencyFeatures(A, T.base[0], T.target[0]);
  const items = list.map((x, i) => {
    const y = B.get(x.code).shares, idx = present(pred[i]).filter((j) => y[j] > 0);
    const e = P.map(() => 0); const a = clrOn(y, idx), b = clrOn(pred[i], idx); idx.forEach((j, k) => (e[j] = a[k] - b[k]));
    return { e, f: F.get(x.code), idx };
  });
  const counts = { open: 0, rerun: 0, moved: 0 };
  for (const f of F.values()) { if (f.some((v) => v === -1)) counts.open++; if (f.some((v) => v === 1)) counts.moved++; }
  counts.rerun = F.size - counts.open;
  return { T, A, B, list, presence, pred, F, items, counts };
});
for (const h of H) {
  const own = estimateDelta(h.items), other = estimateDelta(H.filter((o) => o !== h).flatMap((o) => o.items));
  const apply = (d) => h.pred.map((s, i) => { const idx = present(s); return perturb(s, idx, idx.map((j) => incumbencyShift(h.F.get(h.list[i].code), idx, d)[j])); });
  const act = (x) => h.B.get(x.code).shares;
  const s0 = score(h.list, h.pred, act), s1 = score(h.list, apply(other), act);
  console.log(`${h.T.id} : sièges libérés ${h.counts.open}, sortant.es sous une autre bannière ou ailleurs ${h.counts.moved} ; delta propre ${own.toFixed(3)}, delta de l'autre transition ${other.toFixed(3)}`);
  console.log(`   sans effet RMSE ${s0.rmse.toFixed(2)} gagnants ${s0.correct}/${s0.n} | avec effet RMSE ${s1.rmse.toFixed(2)} gagnants ${s1.correct}/${s1.n}`);
}
