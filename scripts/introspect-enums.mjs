import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// 1. One request using __schema (the entry point we know works;
//    __type(name: ...) returned HTTP 500 on this API).
//    - types: every type in the API; we keep only the enums in JS below.
//    - queryType: arguments of every query, looking 3 levels deep
//      so wrapped types (lists, required) are visible.
const query = `
  {
    __schema {
      types {
        name
        kind
        enumValues { name }
      }
      queryType {
        fields {
          name
          args {
            name
            type { kind name ofType { kind name ofType { kind name } } }
          }
        }
      }
    }
  }
`;

// 2. Turn a nested type into readable text.
//    Example: LIST → NON_NULL → String  becomes  "[String!]"
//    This is a recursive function: it calls itself on the inner type.
function typeToText(type) {
  if (!type) return "?";
  if (type.kind === "NON_NULL") return `${typeToText(type.ofType)}!`;
  if (type.kind === "LIST") return `[${typeToText(type.ofType)}]`;
  return type.name;
}

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

  if (result.errors?.length) {
    console.error("Erreurs GraphQL :", result.errors);
  } else {
    const { types, queryType } = result.data.__schema;

    // Keep only our own enums (names starting with "__" are GraphQL internals)
    const enums = types.filter(
      (t) => t.kind === "ENUM" && !t.name.startsWith("__")
    );

    for (const e of enums) {
      console.log(`\n${e.name} :`);
      console.log(e.enumValues.map((v) => v.name).join(", "));
    }

    // 3. Only show the two queries we care about for discovery.
    console.log("\nArguments détaillés :");
    for (const field of queryType.fields) {
      if (field.name !== "taxonomies" && field.name !== "diffusions") continue;

      console.log(`\n${field.name}`);
      for (const arg of field.args) {
        console.log(`  - ${arg.name}: ${typeToText(arg.type)}`);
      }
    }
  }

  console.log(`\nLatence : ${latency.toFixed(0)} ms`);
} catch (error) {
  console.error("Erreur :", error.message);
}
