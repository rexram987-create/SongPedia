// SongPedia multi-source song detail enrichment.
// Loaded after app.js and ranking-fix.js.

const songpediaBaseFetchSongDetails = fetchSongDetails;

function songpediaClaimEntityIds(entity, property) {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function songpediaClaimTime(entity, property) {
  const raw = (entity?.claims?.[property] || [])[0]?.mainsnak?.datavalue?.value?.time;
  if (!raw) return "";
  const match = raw.match(/[+-](\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] : "";
}

async function songpediaLabelsForIds(ids, preferredLanguage) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};

  const result = {};
  for (let i = 0; i < unique.length; i += 45) {
    const batch = unique.slice(i, i + 45);
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels",
      languages: `${preferredLanguage}|he|en`,
      origin: "*",
      format: "json"
    });
    const data = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
    for (const id of batch) {
      const item = data.entities?.[id] || {};
      result[id] = item.labels?.[preferredLanguage]?.value || item.labels?.he?.value || item.labels?.en?.value || id;
    }
  }
  return result;
}

async function songpediaWikidataSearchEntities(query, language) {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language,
    uselang: language,
    type: "item",
    limit: "8",
    origin: "*",
    format: "json"
  });
  const data = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
  return data.search || [];
}

async function songpediaGetWikidataEntity(id) {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    props: "claims|labels|sitelinks",
    languages: "he|en",
    origin: "*",
    format: "json"
  });
  const data = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
  return data.entities?.[id] || null;
}

function songpediaEntityHasMusicCredits(entity) {
  return Boolean(
    entity?.claims?.P175?.length || // performer
    entity?.claims?.P86?.length ||  // composer
    entity?.claims?.P676?.length || // lyrics by
    entity?.claims?.P50?.length     // author
  );
}

async function songpediaFindWikidataSongEntity(title, performers = []) {
  const language = containsHebrew(title) ? "he" : "en";
  const performer = performers?.[0] || "";
  const queries = [
    performer ? `${title} ${performer}` : title,
    `${title} ${language === "he" ? "שיר" : "song"}`,
    title
  ];

  const seen = new Set();
  const candidates = [];
  for (const query of queries) {
    try {
      const found = await songpediaWikidataSearchEntities(query, language);
      for (const item of found) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          candidates.push(item);
        }
      }
    } catch (error) {
      console.warn("Wikidata search failed", query, error);
    }
  }

  let best = null;
  let bestScore = -Infinity;

  for (const candidate of candidates.slice(0, 12)) {
    try {
      const entity = await songpediaGetWikidataEntity(candidate.id);
      if (!entity || !songpediaEntityHasMusicCredits(entity)) continue;

      const label = entity.labels?.[language]?.value || entity.labels?.he?.value || entity.labels?.en?.value || candidate.label || "";
      let score = textSimilarityScore(label, title) * 2;
      if (normalizeText(label) === normalizeText(title)) score += 80;

      if (performer) {
        const performerIds = songpediaClaimEntityIds(entity, "P175");
        const labels = await songpediaLabelsForIds(performerIds, language);
        const performerLabels = Object.values(labels);
        if (performerLabels.some((name) => textSimilarityScore(name, performer) >= 72)) score += 100;
      }

      if (entity.claims?.P86?.length) score += 20;
      if (entity.claims?.P676?.length || entity.claims?.P50?.length) score += 20;

      if (score > bestScore) {
        bestScore = score;
        best = entity;
      }
    } catch (error) {
      console.warn("Could not inspect Wikidata candidate", candidate.id, error);
    }
  }

  return bestScore >= 150 ? best : null;
}

async function songpediaWikidataCredits(title, performers) {
  const language = containsHebrew(title) ? "he" : "en";
  const entity = await songpediaFindWikidataSongEntity(title, performers);
  if (!entity) return null;

  const performerIds = songpediaClaimEntityIds(entity, "P175");
  const composerIds = songpediaClaimEntityIds(entity, "P86");
  const lyricistIds = songpediaClaimEntityIds(entity, "P676");
  const authorIds = songpediaClaimEntityIds(entity, "P50");
  const allIds = [...performerIds, ...composerIds, ...lyricistIds, ...authorIds];
  const labels = await songpediaLabelsForIds(allIds, language);

  const wikiTitle = entity.sitelinks?.hewiki?.title || entity.sitelinks?.enwiki?.title;
  const wikiLang = entity.sitelinks?.hewiki?.title ? "he" : "en";

  return {
    id: entity.id,
    performers: performerIds.map((id) => labels[id]).filter(Boolean),
    composers: composerIds.map((id) => labels[id]).filter(Boolean),
    lyricists: lyricistIds.map((id) => labels[id]).filter(Boolean),
    writers: authorIds.map((id) => labels[id]).filter(Boolean),
    releaseYear: songpediaClaimTime(entity, "P577"),
    sourceUrl: wikiTitle
      ? `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replaceAll(" ", "_"))}`
      : `https://www.wikidata.org/wiki/${entity.id}`
  };
}

function songpediaPrefer(primary, fallback) {
  if (Array.isArray(primary)) return primary.length ? primary : (fallback || []);
  return primary || fallback || "";
}

fetchSongDetails = async function enrichedFetchSongDetails(recordingId) {
  const base = await songpediaBaseFetchSongDetails(recordingId);
  let wikidata = null;

  try {
    wikidata = await songpediaWikidataCredits(base.title, base.performers);
  } catch (error) {
    console.warn("Wikidata detail enrichment failed", error);
  }

  if (!wikidata) {
    return { ...base, sources: ["MusicBrainz"] };
  }

  return {
    ...base,
    performers: songpediaPrefer(base.performers, wikidata.performers),
    composers: songpediaPrefer(base.composers, wikidata.composers),
    lyricists: songpediaPrefer(base.lyricists, wikidata.lyricists),
    writers: songpediaPrefer(base.writers, wikidata.writers),
    releaseYear: base.releaseYear && base.releaseYear !== "לא נמצא" ? base.releaseYear : (wikidata.releaseYear || "לא נמצא"),
    wikidataUrl: wikidata.sourceUrl,
    sources: ["MusicBrainz", "Wikidata"]
  };
};

const songpediaBaseRenderSongDetails = renderSongDetails;

renderSongDetails = function enrichedRenderSongDetails(details) {
  songpediaBaseRenderSongDetails(details);
  const panel = document.getElementById("songDetailsPanel");
  if (!panel) return;

  const note = panel.querySelector(".details-note");
  if (note) {
    note.textContent = details.sources?.includes("Wikidata")
      ? "הכרטיס משלב מידע מ־MusicBrainz ומ־Wikidata. כאשר מקור אחד חסר פרט, SongPedia מנסה להשלים אותו מהמקור השני; מידע שלא נמצא נשאר מסומן כחסר."
      : "המידע הזמין לכרטיס זה הגיע מ־MusicBrainz. פרטים שלא נמצאו במקור אינם מוצגים כניחוש.";
  }

  if (details.wikidataUrl) {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = details.wikidataUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "מקור נוסף: Wikidata / Wikipedia";
    link.style.marginInlineStart = "14px";
    panel.appendChild(link);
  }
};
