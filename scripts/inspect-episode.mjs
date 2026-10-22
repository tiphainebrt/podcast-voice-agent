import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// Scenario 2 test: from an episode URL found on the web, find the episode
// in the API through its show, and inspect its tags, people, duration, audio.
// Nothing is saved: results are printed.
const EPISODE_URL =
  "https://www.radiofrance.fr/franceculture/podcasts/concordance-des-temps/les-guerres-de-napoleon-une-empreinte-durable-4108882";

// Show URL = episode URL without its last segment
const SHOW_URL = EPISODE_URL.split("/").slice(0, -1).join("/");
const EPISODE_ID = EPISODE_URL.match(/-(\d+)$/)[1];

const PAGE_SIZE = 50;
const MAX_PAGES = 20; // safety limit: at most 1,000 episodes

// Field names come from scripts/introspect-enums.mjs
const query = `
  query ($url: String!, $after: String) {
    diffusionsOfShowByUrl(url: $url, first: ${PAGE_SIZE}, after: $after) {
      edges {
        cursor
        node {
          id
          title
          url
          published_date
          podcastEpisode { duration playerUrl url }
          taxonomiesConnection { edges { relation node { type path title } } }
          personalitiesConnection { edges { relation info node { name } } }
        }
      }
    }
  }
`;

async function graphql(variables) {
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
  return result.data?.diffusionsOfShowByUrl?.edges ?? [];
}

console.log(`Émission : ${SHOW_URL}`);
console.log(`Épisode recherché : ${EPISODE_ID}\n`);

const start = performance.now();
let after = null;
let pages = 0;
let count = 0;
let withAudio = 0;
let found = null;

try {
  while (pages < MAX_PAGES && !found) {
    const edges = await graphql({ url: SHOW_URL, after });
    pages++;

    for (const edge of edges) {
      if (!edge?.node) continue;
      after = edge.cursor;
      count++;
      if (edge.node.podcastEpisode) withAudio++;

      // Match on the numeric id at the end of the URL
      if (edge.node.url?.endsWith(`-${EPISODE_ID}`)) {
        found = edge.node;
        break;
      }
    }

    process.stdout.write(`Page ${pages} : ${count} épisodes parcourus\r`);
    if (edges.length < PAGE_SIZE) break;
  }
} catch (error) {
  console.error("\nErreur :", error.message);
}

const seconds = ((performance.now() - start) / 1000).toFixed(1);

console.log("\n\n--- BILAN ---");
console.log(`Pages lues : ${pages}${pages === MAX_PAGES ? " (limite atteinte)" : ""}`);
console.log(`Épisodes parcourus : ${count}, dont ${withAudio} avec audio`);
console.log(`Temps : ${seconds} s`);

if (!found) {
  console.log("\nÉpisode NON trouvé.");
} else {
  const ep = found.podcastEpisode;
  console.log("\nÉpisode TROUVÉ :");
  console.log(`- Titre : ${found.title}`);
  console.log(`- Date : ${found.published_date}`);
  console.log(`- URL : ${found.url}`);
  console.log(
    ep
      ? `- Audio : durée ${ep.duration} (≈ ${Math.round(ep.duration / 60)} min si en secondes) | ${ep.playerUrl ?? ep.url}`
      : "- Audio : aucun (podcastEpisode null)"
  );

  console.log("- Taxonomies :");
  for (const e of found.taxonomiesConnection?.edges ?? []) {
    console.log(`    [${e.node?.type}] ${e.node?.path} — ${e.node?.title} (relation : ${e.relation})`);
  }

  console.log("- Personnalités :");
  for (const e of found.personalitiesConnection?.edges ?? []) {
    console.log(`    ${e.node?.name} (relation : ${e.relation}${e.info ? `, ${e.info}` : ""})`);
  }
}
