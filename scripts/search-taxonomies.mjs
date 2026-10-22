import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// Walk through ALL tags page by page, and keep only those whose title
// matches one of our keywords. Nothing is saved: matches are printed.
const KEYWORDS = ["napol", "bonaparte", "empire"];
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety limit: at most 5,000 tags

// Lowercase and remove accents, so "Napoléon" and "napoleon" both match.
// normalize("NFD") splits "é" into "e" + accent; the regex then drops the accent.
function simplify(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// The "after" cursor tells the API where the previous page ended.
// We pass it as a GraphQL variable ($after) instead of pasting it in the text.
const query = `
  query ($after: String) {
    taxonomies(source: UNIFIED, types: [TAG], first: ${PAGE_SIZE}, after: $after) {
      edges {
        cursor
        node { id path type title }
      }
    }
  }
`;

let after = null;
let pages = 0;
let totalTags = 0;
let nullTags = 0;
const matches = [];
const start = performance.now();

try {
  while (pages < MAX_PAGES) {
    const response = await fetch("https://openapi.radiofrance.fr/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-token": apiKey,
      },
      body: JSON.stringify({ query, variables: { after } }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Erreur HTTP ${response.status} (page ${pages + 1}) : ${body.slice(0, 500)}`
      );
    }

    const result = await response.json();
    const edges = result.data?.taxonomies?.edges ?? [];
    pages++;

    for (const edge of edges) {
      if (!edge?.node) {
        nullTags++; // tag nulled by a server-side error (e.g. missing path)
        continue;
      }
      totalTags++;
      after = edge.cursor;

      const title = simplify(edge.node.title);
      if (KEYWORDS.some((k) => title.includes(k))) {
        matches.push(edge.node);
      }
    }

    process.stdout.write(`Page ${pages} : ${edges.length} tags\r`);

    // A page shorter than PAGE_SIZE means we reached the end
    if (edges.length < PAGE_SIZE) break;
  }

  const seconds = ((performance.now() - start) / 1000).toFixed(1);

  console.log("\n\n--- BILAN ---");
  console.log(`Pages lues : ${pages}${pages === MAX_PAGES ? " (limite atteinte, liste incomplète)" : ""}`);
  console.log(`Tags lus : ${totalTags} (+ ${nullTags} vides)`);
  console.log(`Temps total : ${seconds} s`);

  console.log(`\nCorrespondances (${KEYWORDS.join(", ")}) : ${matches.length}\n`);
  for (const m of matches) {
    console.log(`- ${m.path} — ${m.title}`);
  }
} catch (error) {
  console.error("\nErreur :", error.message);
}
