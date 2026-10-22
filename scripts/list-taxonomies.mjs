import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// First real data query: list 30 tags to see what a "path" looks like.
// The shape (edges > node > id, path, type, title) comes from the
// introspection done in introspect-enums.mjs.
const query = `
  {
    taxonomies(source: UNIFIED, types: [TAG], first: 30) {
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

  console.log(`\n${edges.length} tags reçus :\n`);

  // One line per tag: path — title (skip nodes nulled by an error)
  for (const edge of edges) {
    if (!edge?.node) continue;
    console.log(`- ${edge.node.path} — ${edge.node.title}`);
  }

  console.log(`\nLatence : ${latency.toFixed(0)} ms`);
} catch (error) {
  console.error("Erreur :", error.message);
}
