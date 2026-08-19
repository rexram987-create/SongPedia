// SongPedia ranking improvements for song-title searches.
// Loaded after app.js so it can extend the original search functions.

function songpediaPerformerNames(recording) {
  return (recording["artist-credit"] || [])
    .map((credit) => credit.name || credit.artist?.name)
    .filter(Boolean);
}

function songpediaReleaseCount(recording) {
  return Array.isArray(recording.releases) ? recording.releases.length : 0;
}

function songpediaRecordingRank(recording, query) {
  const titleScore = textSimilarityScore(recording.title || "", query);
  const apiScore = Number(recording.score || 0);
  const releaseBonus = Math.min(songpediaReleaseCount(recording) * 2, 40);
  const exactBonus = normalizeText(recording.title || "") === normalizeText(query) ? 60 : 0;
  return titleScore * 2 + apiScore + releaseBonus + exactBonus;
}

function songpediaUniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.id || `${normalizeText(item?.title || "")}:${item?.source || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function songpediaPerformerArtists(recordings) {
  const performerMap = new Map();

  for (const recording of recordings) {
    const recordingRank = songpediaRecordingRank(recording, recording.__query || recording.title || "");

    for (const credit of recording["artist-credit"] || []) {
      const artist = credit.artist;
      if (!artist?.id || !artist?.name) continue;

      const current = performerMap.get(artist.id) || {
        id: artist.id,
        name: artist.name,
        type: artist.type,
        country: artist.country,
        begin: artist["life-span"]?.begin,
        score: 0,
        appearances: 0
      };

      current.score += recordingRank;
      current.appearances += 1;
      performerMap.set(artist.id, current);
    }
  }

  return [...performerMap.values()]
    .sort((a, b) => (b.score + b.appearances * 30) - (a.score + a.appearances * 30))
    .slice(0, 6)
    .map((artist) => ({
      id: artist.id,
      type: "אמן",
      title: artist.name,
      subtitle: [artist.type, artist.country, artist.begin].filter(Boolean).join(" · "),
      description: "מבצע שנמצא בין ההקלטות המתאימות לשיר שחיפשת",
      source: "MusicBrainz",
      url: `https://musicbrainz.org/artist/${artist.id}`,
      relevance: artist.score
    }));
}

async function songpediaWikipediaSearchWithWikidata(query, lang) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "8",
    prop: "pageprops|extracts|info|pageimages",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "240",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    origin: "*",
    format: "json"
  });

  const data = await fetchJson(`${api}?${params}`);
  return Object.values(data.query?.pages || {}).map((page) => ({
    pageid: page.pageid,
    lang,
    type: "ויקיפדיה",
    title: page.title,
    subtitle: lang === "he" ? "ויקיפדיה העברית" : "Wikipedia",
    description: page.extract || "מידע נוסף בוויקיפדיה",
    thumbnail: page.thumbnail?.source || "",
    source: "Wikipedia",
    url: page.fullurl,
    wikidataId: page.pageprops?.wikibase_item || ""
  }));
}

async function songpediaGetWikidataPerformers(wikidataId, language = "en") {
  if (!wikidataId) return [];

  const entityParams = new URLSearchParams({
    action: "wbgetentities",
    ids: wikidataId,
    props: "claims",
    origin: "*",
    format: "json"
  });
  const entityData = await fetchJson(`https://www.wikidata.org/w/api.php?${entityParams}`);
  const entity = entityData.entities?.[wikidataId];
  const performerIds = (entity?.claims?.P175 || [])
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);

  if (!performerIds.length) return [];

  const labelsParams = new URLSearchParams({
    action: "wbgetentities",
    ids: performerIds.join("|"),
    props: "labels|sitelinks",
    languages: `${language}|en|he`,
    origin: "*",
    format: "json"
  });
  const labelsData = await fetchJson(`https://www.wikidata.org/w/api.php?${labelsParams}`);

  return performerIds.map((id) => {
    const performer = labelsData.entities?.[id] || {};
    const label = performer.labels?.[language]?.value || performer.labels?.en?.value || performer.labels?.he?.value || id;
    const enwiki = performer.sitelinks?.enwiki?.title;
    const hewiki = performer.sitelinks?.hewiki?.title;
    const wikiTitle = language === "he" ? (hewiki || enwiki) : (enwiki || hewiki);
    const wikiLang = language === "he" && hewiki ? "he" : "en";
    const url = wikiTitle
      ? `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replaceAll(" ", "_"))}`
      : `https://www.wikidata.org/wiki/${id}`;

    return {
      id: `wikidata-${id}`,
      type: "אמן",
      title: label,
      subtitle: "מבצע לפי Wikidata",
      description: "מבצע המקושר ליצירה במאגר Wikidata",
      source: "Wikidata",
      url,
      relevance: 1000
    };
  });
}

async function songpediaFindWikidataPerformers(query) {
  const primaryLang = containsHebrew(query) ? "he" : "en";
  const qualifier = primaryLang === "he" ? "שיר" : "song";
  const candidates = await songpediaWikipediaSearchWithWikidata(`${query} ${qualifier}`, primaryLang);

  const ranked = candidates
    .map((item) => ({ ...item, score: calculateMusicRelevance(item, query) + textSimilarityScore(item.title, query) }))
    .filter((item) => item.wikidataId && item.score >= 50)
    .sort((a, b) => b.score - a.score);

  for (const candidate of ranked.slice(0, 3)) {
    try {
      const performers = await songpediaGetWikidataPerformers(candidate.wikidataId, primaryLang);
      if (performers.length) return performers;
    } catch (error) {
      console.warn("Could not load Wikidata performers", candidate.wikidataId, error);
    }
  }

  return [];
}

const songpediaOriginalSearchMusicBrainz = searchMusicBrainz;

searchMusicBrainz = async function improvedSearchMusicBrainz(query) {
  const escapedQuery = query.replaceAll('"', '\\"');
  const artistQuery = encodeURIComponent(`artist:"${escapedQuery}"`);
  const recordingQuery = encodeURIComponent(`recording:"${escapedQuery}"`);

  const [artistsData, recordingsData, wikidataPerformersResult] = await Promise.all([
    fetchJson(`${MUSICBRAINZ_BASE}/artist/?query=${artistQuery}&fmt=json&limit=15`),
    fetchJson(`${MUSICBRAINZ_BASE}/recording/?query=${recordingQuery}&fmt=json&limit=100`),
    songpediaFindWikidataPerformers(query).catch(() => [])
  ]);

  const directArtists = (artistsData.artists || [])
    .map((artist) => ({
      id: artist.id,
      type: "אמן",
      title: artist.name,
      subtitle: [artist.type, artist.country, artist["life-span"]?.begin].filter(Boolean).join(" · "),
      description: artist.disambiguation || "תוצאת אמן מתוך MusicBrainz",
      source: "MusicBrainz",
      url: `https://musicbrainz.org/artist/${artist.id}`,
      relevance: Math.max(textSimilarityScore(artist.name, query), Number(artist.score || 0))
    }))
    .filter((artist) => artist.relevance >= 78)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);

  const rawRecordings = (recordingsData.recordings || [])
    .map((recording) => ({ ...recording, __query: query }))
    .filter((recording) => textSimilarityScore(recording.title || "", query) >= 82)
    .sort((a, b) => songpediaRecordingRank(b, query) - songpediaRecordingRank(a, query));

  const prominentPerformers = songpediaPerformerArtists(rawRecordings.slice(0, 50));

  // Wikidata performers get priority because they are attached to the song/creative work,
  // while MusicBrainz search order can omit a famous recording for very common titles.
  const artists = songpediaUniqueById([
    ...wikidataPerformersResult,
    ...directArtists,
    ...prominentPerformers
  ]).slice(0, 10);

  const songs = rawRecordings.slice(0, 16).map((recording) => {
    const performers = songpediaPerformerNames(recording).join(", ");
    const datedReleases = (recording.releases || [])
      .filter((release) => release.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const firstRelease = datedReleases[0] || recording.releases?.[0];
    const album = firstRelease?.title;
    const year = recording["first-release-date"]?.slice(0, 4) || firstRelease?.date?.slice(0, 4);

    return {
      id: recording.id,
      type: "שיר",
      title: recording.title,
      subtitle: [performers, year].filter(Boolean).join(" · "),
      description: album
        ? `אלבום/מהדורה: ${album}`
        : `הקלטה של ${performers || "מבצע לא ידוע"}`,
      source: "MusicBrainz",
      url: `https://musicbrainz.org/recording/${recording.id}`,
      relevance: songpediaRecordingRank(recording, query)
    };
  });

  return { artists, songs };
};
