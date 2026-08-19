// SongPedia ranking improvements for song-title searches.
// Loaded after app.js so it replaces the original MusicBrainz search function.

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
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
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

searchMusicBrainz = async function improvedSearchMusicBrainz(query) {
  const escapedQuery = query.replaceAll('"', '\\"');
  const artistQuery = encodeURIComponent(`artist:"${escapedQuery}"`);
  const recordingQuery = encodeURIComponent(`recording:"${escapedQuery}"`);

  const [artistsData, recordingsData] = await Promise.all([
    fetchJson(`${MUSICBRAINZ_BASE}/artist/?query=${artistQuery}&fmt=json&limit=15`),
    fetchJson(`${MUSICBRAINZ_BASE}/recording/?query=${recordingQuery}&fmt=json&limit=100`)
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

  const prominentPerformers = songpediaPerformerArtists(rawRecordings.slice(0, 35));

  const artists = songpediaUniqueById([...directArtists, ...prominentPerformers]).slice(0, 8);

  const songs = rawRecordings.slice(0, 12).map((recording) => {
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
