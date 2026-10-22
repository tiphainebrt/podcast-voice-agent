
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;

if (!apiKey) {
  throw new Error("Clé API manquante");
}

// Requête GraphQL : récupérer 5 diffusions France Culture

const query = `
  {
    diffusionsOfShowByUrl(
      url: "https://www.radiofrance.fr/franceculture/podcasts/fictions-theatre-et-cie"
      first: 2
    ) {
      edges {
        node {
          id
          title
          standFirst
          url
          podcastEpisode {
            id
            title
            duration
            playerUrl
          }
        }
      }
    }
  }
`;

// Mesurer le temps de réponse
const start = performance.now();

try {
  const response = await fetch(
    "https://openapi.radiofrance.fr/v1/graphql",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-token": apiKey,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    }
  );

  const text = await response.text();
  const latency = performance.now() - start;

  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status}`);
  }

  const result = JSON.parse(text);

  if (result.errors?.length) {
    console.error("Erreurs GraphQL :", result.errors);
  } else {
    const diffusions = result.data?.diffusionsOfShowByUrl?.edges;

    if (!diffusions) {
      console.log("Aucune diffusion disponible.");
    } else {
      console.log("\nDIFFUSIONS FRANCE CULTURE\n");

      diffusions.forEach(({ node }, index) => {

        // Afficher toutes les données demandées
        // pour le premier épisode
        if (index === 0) {
          console.log(
            "DÉTAILS DU PREMIER ÉPISODE :",
            JSON.stringify(node, null, 2)
          );
        }

        console.log(`${index + 1}. ${node.title}`);
        console.log(
          `Description : ${node.standFirst ?? "Non disponible"}`
        );
        console.log(
          `URL : ${node.url ?? "Non disponible"}`
        );

        // Informations du podcast associé
        const podcast = node.podcastEpisode;

        if (podcast) {
          console.log(`Durée brute : ${podcast.duration}`);
          console.log(
            `Lecteur : ${podcast.playerUrl ?? "Non disponible"}`
          );
        } else {
          console.log("Aucun podcast associé");
        }

        console.log("------------------------------\n");
      });
    }
  }

  console.log(`Latence : ${latency.toFixed(0)} ms`);

} catch (error) {
  console.error("Erreur :", error.message);
}
