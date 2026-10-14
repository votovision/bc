/**
 * Carte en tuiles des 93 circonscriptions de la Colombie-Britannique (carte
 * de 2023).
 *
 * Une tuile de même taille par circonscription. Chaque zone (île de
 * Vancouver, Metro Vancouver, Fraser Valley, Intérieur, Nord) forme un bloc
 * disposé par la méthode des cartes québécoise et fédérale : cible
 * x' = a·géographie + (1 − a)·rang sur chaque axe (transformation monotone),
 * affectation d'une cellule par circonscription sur une grille en briques
 * (glouton du plus contraint au moins contraint, puis échanges et
 * déplacements tant que la somme des distances diminue). Les blocs sont
 * alignés d'ouest en est sur leur bord sud ; le Nord surmonte l'Intérieur.
 *
 * Écrit data/bc_tile_layout.json {tiles: {code: {x, y, name, abbr}},
 * regions: [{label, x, y}]}, centres en côtés de tuile. À relancer après un
 * redécoupage :
 *   node tools/make_tiles.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { zoneOf } from "../lib/bc.mjs";

const dataDir = new URL("../data/", import.meta.url);
const geo = JSON.parse(readFileSync(new URL("bc_ridings_2023.geojson", dataDir), "utf-8"));

const PITCH = 1.1; // distance entre centres, en côtés de tuile
const GAP = 1.6; // espace entre blocs
const DENSITY = 1.35; // cellules par tuile dans un bloc : les vides dessinent la forme

// [étiquette, zone, poids de la géographie]
const GROUPS = [
  ["Île", "ISL", 0.6],
  ["Metro Vancouver", "MV", 0.45],
  ["Vallée du Fraser", "FV", 0.6],
  ["Intérieur", "INT", 0.6],
];
const NORD = ["Nord", "NOR", 0.6];

/** Centroïde du plus grand anneau extérieur (les îles ne déplacent pas le centre). */
function centroid(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const ring = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const f = x1 * y2 - x2 * y1;
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}

const all = geo.features.map((f) => {
  const [lon, lat] = centroid(f.geometry);
  return { code: String(f.properties.riding_code), name: f.properties.riding_name, zone: zoneOf(f.properties.district_regional), lon, lat };
});

/** Disposition d'un bloc : coordonnées de cellule relatives (col, row ≥ 0). */
function layoutBlock(tiles, alpha) {
  const n = tiles.length;
  if (n === 1) { tiles[0].col = 0; tiles[0].row = 0; return; }
  const minLon = Math.min(...tiles.map((t) => t.lon)), maxLon = Math.max(...tiles.map((t) => t.lon));
  const minLat = Math.min(...tiles.map((t) => t.lat)), maxLat = Math.max(...tiles.map((t) => t.lat));
  const meanLat = tiles.reduce((s, t) => s + t.lat, 0) / n;
  const aspect = Math.max(0.5, Math.min(2.5, ((maxLon - minLon) * Math.cos((meanLat * Math.PI) / 180)) / Math.max(maxLat - minLat, 1e-6)));
  const cols = Math.max(2, Math.round(Math.sqrt(n * DENSITY * aspect)));
  const rows = Math.max(1, Math.ceil((n * DENSITY) / cols));
  [...tiles].sort((a, b) => a.lon - b.lon).forEach((t, i) => { t.rankX = i / (n - 1); });
  [...tiles].sort((a, b) => b.lat - a.lat).forEach((t, i) => { t.rankY = i / (n - 1); });
  for (const t of tiles) {
    const gx = (t.lon - minLon) / Math.max(maxLon - minLon, 1e-6);
    const gy = (maxLat - t.lat) / Math.max(maxLat - minLat, 1e-6);
    t.tx = (alpha * gx + (1 - alpha) * t.rankX) * (cols - 1);
    t.ty = (alpha * gy + (1 - alpha) * t.rankY) * (rows - 1);
  }
  const cells = [];
  for (let r = 0; r < rows + 1; r++) for (let c = 0; c < cols; c++) cells.push({ col: c + (r % 2) * 0.5, row: r });
  const d2 = (t, cell) => (t.tx - cell.col) ** 2 + (t.ty - cell.row) ** 2;
  const free = new Set(cells), todo = new Set(tiles);
  while (todo.size) {
    let pick = null, pickCell = null, pickBest = -1;
    for (const t of todo) {
      let best = null, bestD = Infinity;
      for (const cell of free) { const d = d2(t, cell); if (d < bestD) { bestD = d; best = cell; } }
      if (bestD > pickBest) { pickBest = bestD; pick = t; pickCell = best; }
    }
    pick.cell = pickCell; free.delete(pickCell); todo.delete(pick);
  }
  for (let improved = true; improved;) {
    improved = false;
    for (const a of tiles) {
      for (const cell of free) {
        if (d2(a, cell) < d2(a, a.cell) - 1e-9) { free.add(a.cell); free.delete(cell); a.cell = cell; improved = true; }
      }
      for (const b of tiles) {
        if (a !== b && d2(a, b.cell) + d2(b, a.cell) < d2(a, a.cell) + d2(b, b.cell) - 1e-9) {
          const t = a.cell; a.cell = b.cell; b.cell = t; improved = true;
        }
      }
    }
  }
  for (const t of tiles) { t.col = t.cell.col; t.row = t.cell.row; }
  // Vides resserrés : un écart de rangées ou de colonnes entièrement vides
  // est ramené à au plus une rangée vide (à au plus une colonne et demie),
  // par décalage entier qui conserve l'alternance des briques. Des
  // demi-plans entiers se déplacent ensemble : ordre et absence de
  // chevauchement sont préservés.
  for (const [axe, maxGap] of [["row", 2], ["col", 2]]) {
    const vals = [...new Set(tiles.map((t) => t[axe]))].sort((a, b) => a - b);
    let shift = 0;
    const shiftAt = new Map([[vals[0], 0]]);
    for (let i = 1; i < vals.length; i++) {
      const gap = vals[i] - vals[i - 1];
      if (gap > maxGap) shift += Math.floor(gap - maxGap + 1e-9) + (axe === "row" ? Math.floor(gap - maxGap) % 2 : 0);
      shiftAt.set(vals[i], shift);
    }
    for (const t of tiles) t[axe] -= shiftAt.get(t[axe]);
  }
  const minCol = Math.min(...tiles.map((t) => t.col)), minRow = Math.min(...tiles.map((t) => t.row));
  for (const t of tiles) { t.col -= minCol; t.row -= minRow; }
}

const block = ([label, zone, alpha]) => {
  const tiles = all.filter((t) => t.zone === zone);
  layoutBlock(tiles, alpha);
  return { label, tiles, w: Math.max(...tiles.map((t) => t.col)) + 1, h: Math.max(...tiles.map((t) => t.row)) + 1 };
};
const blocks = GROUPS.map(block);

// Blocs alignés sur leur bord sud, d'ouest en est ; le Nord au-dessus de l'Intérieur.
const H = Math.max(...blocks.map((b) => b.h));
let x = 0;
for (const b of blocks) {
  b.x0 = x; b.y0 = H - b.h;
  x += b.w + GAP;
}
const nord = block(NORD), interieur = blocks.at(-1);
nord.x0 = interieur.x0 + Math.max(0, Math.floor((interieur.w - nord.w) / 2)); nord.y0 = interieur.y0 - nord.h - GAP;
for (const b of [...blocks, nord]) for (const t of b.tiles) { t.x = (b.x0 + t.col) * PITCH; t.y = (b.y0 + t.row) * PITCH; }

const tiles = [...blocks, nord].flatMap((b) => b.tiles);
const minX = Math.min(...tiles.map((t) => t.x)), minY = Math.min(...tiles.map((t) => t.y)) - 1.2;
const layout = Object.fromEntries(tiles.map((t) => [t.code, { x: +(t.x - minX).toFixed(2), y: +(t.y - minY).toFixed(2), name: t.name, abbr: "" }]));
const regions = [...blocks, nord].map((b) => ({ label: b.label, x: +(((b.x0 + (b.w - 1) / 2) * PITCH) - minX).toFixed(2), y: +((b.y0 - 0.9) * PITCH - minY).toFixed(2) }));

writeFileSync(new URL("bc_tile_layout.json", dataDir), JSON.stringify({ tiles: layout, regions }, null, 1), "utf-8");
const w = Math.max(...tiles.map((t) => t.x)) - minX, h = Math.max(...tiles.map((t) => t.y)) - minY;
console.log(`bc_tile_layout.json : ${tiles.length} tuiles, emprise ${w.toFixed(1)}x${h.toFixed(1)}`);
for (const b of [...blocks, nord]) console.log(`  ${b.label.padEnd(17)} ${String(b.tiles.length).padStart(3)} tuiles, ${b.w}x${b.h}`);
