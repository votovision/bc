/**
 * Registered voters per electoral district at the 2024 general election,
 * summed over voting areas (Elections BC, provincial registered voter counts,
 * BC Data Catalogue). Used by the dashboard map to size districts by electors.
 *
 * Run: node tools/make_riding_electors.mjs
 * Writes data/bc_riding_electors.json {district_code: electors}.
 */
import { writeFileSync } from "node:fs";

const URL_COUNTS = "https://catalogue.data.gov.bc.ca/dataset/60bf8c02-1436-49fc-b350-f985618d6881/resource/c332d1dc-67aa-4a6a-883f-18a50751844d/download/provincial_registered_voter_counts.csv";
const EVENT = "2024 General Election";

const res = await fetch(URL_COUNTS, { headers: { "User-Agent": "votovision-data" } });
if (!res.ok) throw new Error(`${URL_COUNTS}: ${res.status}`);
const lines = (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
// Quoted fields may contain commas.
const split = (line) => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]).slice(0, -1);
const head = split(lines[0]);
const [iEvent, iDistrict, iVoters] = ["EVENT_NAME", "ED_ABBREVIATION", "REGISTERED_VOTERS"].map((c) => head.indexOf(c));

const electors = {};
for (const line of lines.slice(1)) {
  const c = split(line);
  if (c[iEvent] !== EVENT) continue;
  electors[c[iDistrict]] = (electors[c[iDistrict]] ?? 0) + (+c[iVoters] || 0);
}
const n = Object.keys(electors).length;
if (n !== 93) throw new Error(`expected 93 districts, got ${n}`);
writeFileSync(new URL("../data/bc_riding_electors.json", import.meta.url), JSON.stringify(electors));
console.log(`${n} districts, ${Object.values(electors).reduce((a, b) => a + b, 0)} registered voters`);
