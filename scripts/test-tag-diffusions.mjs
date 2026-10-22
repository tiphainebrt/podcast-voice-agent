import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// End-to-end test of scenario 1: fetch ALL diffusions with a given tag,
// station by station (station is mandatory), page by page.
// Nothing is saved: results are printed.
const TAG = "sujets/empire-ottoman";
const STATIONS = ["FRANCECULTURE", "FRANCEINTER", "FRANCEINFO"];
const PAGE_SIZE = 50;
const MAX_PAGES = 10; // safety limit: at most 500 diffusions per station

// Field names come from scripts/explore-radiofrance.mjs
const query = `
  query ($station: StationsEnum!, $tags: [String!], $after: String) {
    diffusions(station: $station, tags: $tags, first: ${PAGE_SIZE}, after: $after) {
      edges {
        cursor
        node {
          id
          title
          standFirst
          url
          podcastEpisode { id duration playerUrl }
        }
      }
    }
  }
`;

async function graphql(query, variables) {
  const response = await fetch("https://openapi.radiofrance.fr/v1/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-token": apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Erreur HTTP ${response.status} : ${body.slice(0, 500)}`);
  }

  const result = await response.json();
  if (result.errors?.length) {
    console.error("Erreurs GraphQL :", result.errors.map((e) => e.message));
  }
  return result.data;
}

async function fetchPage(station, tagId, after) {
  const data = await graphql(query, { station, tags: [tagId], after });
  return data?.diffusions?.edges ?? [];
}

// "tags" expects the taxonomy id, not its path ("Bad id" otherwise):
// look the id up from the path first.
const lookup = await graphql(
  `query ($paths: [String!]) {
    taxonomies(source: UNIFIED, paths: $paths, first: 1) {
      edges { node { id path title } }
    }
  }`,
  { paths: [TAG] }
);

const tag = lookup?.taxonomies?.edges?.[0]?.node;
if (!tag) {
  throw new Error(`Tag introuvable : ${TAG}`);
}
console.log(`Tag "${tag.title}" → id ${tag.id}`);

const summary = [];

for (const station of STATIONS) {
  console.log(`\n=== ${station} — tag ${TAG} ===\n`);

  const start = performance.now();
  let after = null;
  let pages = 0;
  let count = 0;
  let withAudio = 0;

  try {
    while (pages < MAX_PAGES) {
      const edges = await fetchPage(station, tag.id, after);
      pages++;

      for (const edge of edges) {
        if (!edge?.node) continue;
        after = edge.cursor;
        count++;

        const d = edge.node;
        const episode = d.podcastEpisode;
        if (episode) withAudio++;

        // duration is printed raw: we don't know its unit yet
        const audio = episode ? `durée brute ${episode.duration}` : "pas d'audio";
        console.log(`${count}. ${d.title}`);
        console.log(`   ${audio} | ${d.url ?? "pas d'URL"}`);
      }

      if (edges.length < PAGE_SIZE) break;
    }
  } catch (error) {
    console.error("Erreur :", error.message);
  }

  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  summary.push({ station, count, withAudio, pages, seconds });
}

console.log("\n--- BILAN ---");
for (const s of summary) {
  const limit = s.pages === MAX_PAGES ? " (limite atteinte)" : "";
  console.log(
    `${s.station} : ${s.count} diffusions, ${s.withAudio} avec audio, ` +
      `${s.pages} page(s)${limit}, ${s.seconds} s`
  );
}
