import nextEnv from "@next/env";

// 1. Load the API key from .env.local (same pattern as your other scripts).
//    The key is used in the request header but never printed.
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// 2. The introspection query.
//    "__schema" is built into GraphQL: it asks the API to describe itself.
//    "queryType.fields" = the list of top-level queries we are allowed to call.
//    For each one we ask for its name, description, and arguments.
//    "type { name kind ofType { name } }" tells us each argument's type.
//    Types can be wrapped (e.g. "required String"), so we look one level deeper.
const query = `
  {
    __schema {
      queryType {
        fields {
          name
          description
          args {
            name
            type { name kind ofType { name kind } }
          }
        }
      }
    }
  }
`;

// 3. Send the request, measuring time like in your other scripts.
const start = performance.now();

try {
  const response = await fetch("https://openapi.radiofrance.fr/v1/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-token": apiKey,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30000), // give up after 30 s
  });

  const latency = performance.now() - start;

  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status}`);
  }

  const result = await response.json();

  // Some APIs disable introspection: in that case we get an error, not data.
  if (result.errors?.length) {
    console.error("Erreurs GraphQL :", result.errors);
  } else {
    const fields = result.data.__schema.queryType.fields;

    console.log(`\n${fields.length} requêtes disponibles :\n`);

    // 4. Print one compact line per query: name(arg: Type, ...)
    for (const field of fields) {
      const args = field.args
        .map((a) => `${a.name}: ${a.type.name ?? a.type.ofType?.name}`)
        .join(", ");

      console.log(`- ${field.name}(${args})`);
      if (field.description) {
        console.log(`    ${field.description}`);
      }
    }
  }

  console.log(`\nLatence : ${latency.toFixed(0)} ms`);
} catch (error) {
  console.error("Erreur :", error.message);
}
