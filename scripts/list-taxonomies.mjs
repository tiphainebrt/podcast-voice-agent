import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// Test whether Napoleon exists as a taxonomy, by asking for specific paths.
// Hypothesis: API paths mirror the website URLs
// (radiofrance.fr/personnes/napoleon-bonaparte → personnes/napoleon-bonaparte).
// No "types" filter, so both THEME and TAG can match.
// The shape (edges > node > id, path, type, title) comes from the
// introspection done in introspect-enums.mjs.
const query = `
  {
    taxonomies(
      source: UNIFIED
      paths: [
        "sujets/guerre-de-cent-ans"
        "sujets/napoleon"
        "personnes/napoleon"
        "sujets/napoleon-bonaparte"
        "personnes/napoleon-bonaparte"
        "sujets/napoleon-ier"
        "sujets/premier-empire"
      ]
      first: 10
    ) {
      edges {
        node { id path type title }
      }
    }
  }
`;

const start = performance.now();

try {
  const response = await fetch("https://openapi.radiofrance.fr/v1/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-token": apiKey,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30000),
  });

  const latency = performance.now() - start;

  if (!response.ok) {
    // Read the server's explanation before giving up
    const body = await response.text();
    throw new Error(`Erreur HTTP ${response.status} : ${body.slice(0, 500)}`);
  }

  const result = await response.json();

  // GraphQL can return partial data AND errors together:
  // show the errors, then whatever data came back.
  if (result.errors?.length) {
    console.error("Erreurs GraphQL :", result.errors.map((e) => e.message));
  }

  const edges = result.data?.taxonomies?.edges ?? [];

  console.log(`\n${edges.length} taxonomies reçues :\n`);

  // One line per taxonomy: [type] path — title (skip nodes nulled by an error)
  for (const edge of edges) {
    if (!edge?.node) continue;
    console.log(`- [${edge.node.type}] ${edge.node.path} — ${edge.node.title}`);
  }

  console.log(`\nLatence : ${latency.toFixed(0)} ms`);
} catch (error) {
  console.error("Erreur :", error.message);
}
