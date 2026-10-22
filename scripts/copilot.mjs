import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// Prototype of the live radio copilot (no voice, no AI yet):
//   node scripts/copilot.mjs histoire
// 1. query all stations IN PARALLEL (one request each)
// 2. score each programme of the next hours against the user's wish
// 3. suggest the best one, with its live stream link
const STATIONS = ["FRANCECULTURE", "FRANCEINTER", "FRANCEINFO", "MOUV", "FIP"];
const HOURS_AHEAD = 3;

const wish = process.argv.slice(2).join(" ");
if (!wish) {
  console.log('Usage : node scripts/copilot.mjs "ton envie"');
  process.exit(1);
}

// Lowercase and remove accents, so "Géopolitique" matches "geopolitique"
function simplify(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Words of 3+ letters only, to skip "de", "la", "un"...
const keywords = simplify(wish)
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 3);

const DIFFUSION_FIELDS = `
  diffusion {
    title
    standFirst
    show { title }
    taxonomiesConnection { edges { node { title } } }
    personalitiesConnection { edges { relation node { name } } }
  }
`;

const query = `
  query ($station: StationsEnum!, $start: Int!, $end: Int!) {
    brand(id: $station) { title liveStream }
    grid(start: $start, end: $end, station: $station) {
      start
      end
      ... on DiffusionStep { ${DIFFUSION_FIELDS} }
    }
  }
`;

async function fetchStation(station, now) {
  const response = await fetch("https://openapi.radiofrance.fr/v1/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-token": apiKey,
    },
    body: JSON.stringify({
      query,
      variables: { station, start: now, end: now + HOURS_AHEAD * 3600 },
    }),
    signal: AbortSignal.timeout(10000), // a voice assistant can't wait longer
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const { data } = await response.json();
  return { brand: data?.brand, grid: data?.grid ?? [] };
}

// Score = how many keywords appear, themes counting double.
// Also returns which fields matched, to explain the suggestion.
function score(diffusion) {
  const themes = (diffusion.taxonomiesConnection?.edges ?? [])
    .map((e) => e?.node?.title)
    .filter(Boolean);
  const people = (diffusion.personalitiesConnection?.edges ?? [])
    .filter((e) => e?.relation === "tag" && e.node?.name)
    .map((e) => e.node.name);

  const fields = [
    { label: "thème", values: themes, weight: 2 },
    { label: "titre", values: [diffusion.title, diffusion.show?.title], weight: 1 },
    { label: "résumé", values: [diffusion.standFirst], weight: 1 },
    { label: "sujet", values: people, weight: 1 },
  ];

  let total = 0;
  const reasons = [];
  for (const field of fields) {
    for (const value of field.values) {
      const text = simplify(value);
      if (keywords.some((k) => text.includes(k))) {
        total += field.weight;
        reasons.push(`${field.label} « ${value.trim()} »`);
      }
    }
  }
  return { total, reasons: [...new Set(reasons)] };
}

function time(ts) {
  return new Date(ts * 1000).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function when(start, now) {
  if (start <= now) return "en ce moment";
  const minutes = Math.round((start - now) / 60);
  return minutes < 60 ? `dans ${minutes} min` : `à ${time(start)}`;
}

// --- main ---

const now = Math.floor(Date.now() / 1000);
const t0 = performance.now();

// Promise.allSettled runs all requests at the same time and waits for all,
// without failing everything if one station times out.
const results = await Promise.allSettled(
  STATIONS.map((station) => fetchStation(station, now))
);

const latency = Math.round(performance.now() - t0);

const candidates = [];
const failed = [];

results.forEach((result, i) => {
  if (result.status === "rejected") {
    failed.push(STATIONS[i]);
    return;
  }
  const { brand, grid } = result.value;
  for (const slot of grid) {
    if (!slot?.diffusion || slot.end <= now) continue;
    const { total, reasons } = score(slot.diffusion);
    if (total > 0) {
      candidates.push({ station: brand, slot, total, reasons });
    }
  }
});

// Best match first; if tied, the one starting soonest
candidates.sort((a, b) => b.total - a.total || a.slot.start - b.slot.start);

console.log(`\nEnvie : « ${wish} »  (mots-clés : ${keywords.join(", ")})`);
console.log(`Réponse en ${latency} ms${failed.length ? ` — stations sans réponse : ${failed.join(", ")}` : ""}\n`);

if (candidates.length === 0) {
  console.log(`Rien sur « ${wish} » dans les ${HOURS_AHEAD} prochaines heures.`);
  process.exit(0);
}

const [best, ...others] = candidates;
const d = best.slot.diffusion;

console.log(`👉 ${best.station.title}, ${when(best.slot.start, now)} : ${d.show?.title} — ${d.title}`);
console.log(`   Pourquoi : ${best.reasons.join(", ")}`);
console.log(`   Écouter le direct : ${best.station.liveStream}`);

if (others.length) {
  console.log("\nAutres options :");
  for (const c of others.slice(0, 4)) {
    const od = c.slot.diffusion;
    console.log(`- ${c.station.title}, ${when(c.slot.start, now)} : ${od.show?.title} — ${od.title}`);
  }
}
