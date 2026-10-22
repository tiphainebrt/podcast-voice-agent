
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;

if (!apiKey) {
  throw new Error("Clé API manquante");
}

const url = "https://openapi.radiofrance.fr/v1/graphql";

const query = `
  query {
    __typename
  }
`;

const latencies = [];
let failures = 0;

for (let i = 1; i <= 5; i++) {
  const start = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-token": apiKey,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15000),
    });

    const latency = performance.now() - start;
    const text = await response.text();

    const success =
      response.ok &&
      text.includes('"__typename":"Query"');

    if (success) {
      latencies.push(latency);
      console.log(`Test ${i} : succès en ${latency.toFixed(0)} ms`);
    } else {
      failures++;
      console.log(`Test ${i} : erreur HTTP ${response.status}`);
    }
  } catch (error) {
    failures++;
    console.log(
      `Test ${i} : échec après ${(performance.now() - start).toFixed(0)} ms`
    );
    console.log(`Raison : ${error.cause?.code ?? error.name}`);
  }
}

console.log("\n--- BILAN ---");
console.log(`Succès : ${latencies.length}/5`);
console.log(`Échecs : ${failures}/5`);

if (latencies.length > 0) {
  const average =
    latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log(`Latence moyenne des succès : ${average.toFixed(0)} ms`);
}
