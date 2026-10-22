import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.RADIOFRANCE_API_KEY;
if (!apiKey) {
  throw new Error("Clé API manquante");
}

// Feasibility test for the "live radio copilot" idea:
// for each station, ONE request returning what is on air now,
// the next 3 hours of programming (with themes), and the live stream URL.
// Nothing is saved: results are printed.
const STATIONS = ["FRANCECULTURE", "FRANCEINTER", "FRANCEINFO", "MOUV", "FIP"];
const HOURS_AHEAD = 3;

// Step is an "interface": a grid slot can be a DiffusionStep (a programme),
// a TrackStep (a song) or a BlankStep. "... on DiffusionStep { ... }" is an
// inline fragment: it asks for these fields only when the slot is of that type.
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
    live(station: $station) {
      show { start end ... on DiffusionStep { ${DIFFUSION_FIELDS} } }
      song { track { title mainArtists } }
    }
    grid(start: $start, end: $end, station: $station) {
      start
      end
      ... on DiffusionStep { ${DIFFUSION_FIELDS} }
    }
  }
`;

// Unix timestamps (seconds) → "14:05"
function time(ts) {
  return ts
    ? new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "?";
}

// One line describing a diffusion: show — title [themes] (people tagged)
function describe(diffusion) {
  if (!diffusion) return "(pas de programme identifié)";
  const themes = (diffusion.taxonomiesConnection?.edges ?? [])
    .map((e) => e?.node?.title)
    .filter(Boolean);
  const people = (diffusion.personalitiesConnection?.edges ?? [])
    .filter((e) => e?.relation === "tag" && e.node?.name)
    .map((e) => e.node.name);
  return (
    `${diffusion.show?.title ?? "?"} — ${diffusion.title}` +
    (themes.length ? ` [${[...new Set(themes)].join(", ")}]` : "") +
    (people.length ? ` (sujets : ${people.join(", ")})` : "")
  );
}

const now = Math.floor(Date.now() / 1000);
const summary = [];

for (const station of STATIONS) {
  const start = performance.now();

  try {
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
      signal: AbortSignal.timeout(30000),
    });

    const latency = Math.round(performance.now() - start);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erreur HTTP ${response.status} : ${body.slice(0, 300)}`);
    }

    const result = await response.json();
    if (result.errors?.length) {
      console.error("Erreurs GraphQL :", result.errors.map((e) => e.message));
    }

    const { brand, live, grid } = result.data ?? {};
    const slots = (grid ?? []).filter((s) => s?.diffusion);
    const withThemes = slots.filter(
      (s) => s.diffusion.taxonomiesConnection?.edges?.length
    ).length;

    console.log(`\n=== ${brand?.title ?? station} (${latency} ms) ===`);
    console.log(`Direct : ${brand?.liveStream ?? "pas de lien"}`);
    console.log(
      `Maintenant (${time(live?.show?.start)}–${time(live?.show?.end)}) : ${describe(live?.show?.diffusion)}`
    );
    if (live?.song?.track) {
      const t = live.song.track;
      console.log(`Morceau : ${t.title} — ${(t.mainArtists ?? []).join(", ")}`);
    }

    console.log(`Prochaines ${HOURS_AHEAD} h :`);
    for (const s of slots) {
      console.log(`  ${time(s.start)} ${describe(s.diffusion)}`);
    }

    summary.push({ station, latency, slots: slots.length, withThemes, stream: !!brand?.liveStream });
  } catch (error) {
    console.error(`\n=== ${station} === Erreur : ${error.message}`);
    summary.push({ station, latency: Math.round(performance.now() - start), error: true });
  }
}

console.log("\n--- BILAN ---");
for (const s of summary) {
  console.log(
    s.error
      ? `${s.station} : ÉCHEC après ${s.latency} ms`
      : `${s.station} : ${s.latency} ms, ${s.slots} programmes à venir, ` +
          `${s.withThemes} avec thèmes, direct ${s.stream ? "oui" : "non"}`
  );
}
