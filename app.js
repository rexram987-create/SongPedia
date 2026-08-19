const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const results = document.getElementById("results");
const status = document.getElementById("status");

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2";

const MUSIC_KEYWORDS_HE = [
  "שיר", "זמר", "זמרת", "להקה", "מוזיקה", "מוזיקלי", "אלבום", "סינגל",
  "מלחין", "מלחינה", "פזמונאי", "פזמונאית", "מילים", "לחן", "ביצוע",
  "הקלטה", "תקליט", "תקליטור", "הרכב", "מנצח", "זמר עברי"
];

const MUSIC_KEYWORDS_EN = [
  "song", "singer", "band", "music", "musical", "album", "single", "composer",
  "lyricist", "recording", "record", "vocalist", "musician", "discography",
  "performer", "track", "orchestra"
];

const NON_MUSIC_KEYWORDS_HE = [
  "צמח", "מין", "סוג", "משפחה", "בוטני", "בוטניקה", "בעל חיים", "עוף",
  "יונק", "דג", "חרק", "יישוב", "עיר", "כפר", "נהר", "הר", "מחלה",
  "תרופה", "כימיה", "פיזיקה", "מאכל"
];

const NON_MUSIC_KEYWORDS_EN = [
  "plant", "species", "genus", "family", "botanical", "botany", "animal", "bird",
  "mammal", "fish", "insect", "city", "village", "river", "mountain", "disease",
  "medicine", "chemical", "physics", "food"
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function containsHebrew(value) {
  return /[\u0590-\u05FF]/.test(value);
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .trim()
    .toLocaleLowerCase("he");
}

function wordsOf(value = "") {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function textSimilarityScore(candidate, query) {
  const a = normalizeText(candidate);
  const b = normalizeText(query);

  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 82;
  if (a.includes(b) || b.includes(a)) return 72;

  const aWords = new Set(wordsOf(a));
  const bWords = wordsOf(b);
  if (!bWords.length) return 0;

  const matches = bWords.filter((word) => aWords.has(word)).length;
  return Math.round((matches / bWords.length) * 60);
}

function calculateMusicRelevance(item, originalQuery) {
  const query = normalizeText(originalQuery);
  const title = normalizeText(item.title);
  const text = normalizeText(`${item.title} ${item.description || ""}`);
  const musicKeywords = item.lang === "he" ? MUSIC_KEYWORDS_HE : MUSIC_KEYWORDS_EN;
  const nonMusicKeywords = item.lang === "he" ? NON_MUSIC_KEYWORDS_HE : NON_MUSIC_KEYWORDS_EN;

  let score = 0;

  if (title === query) score += 12;
  if (title.includes(query)) score += 6;

  const queryWords = wordsOf(query).filter((word) => word.length > 2);
  for (const word of queryWords) {
    if (title.includes(word)) score += 2;
  }

  for (const keyword of musicKeywords) {
    if (text.includes(keyword)) score += 4;
  }

  for (const keyword of nonMusicKeywords) {
    if (text.includes(keyword)) score -= 5;
  }

  return score;
}

function filterWikipediaResults(items, originalQuery) {
  if (!items.length) return [];

  const scored = items
    .map((item) => ({ ...item, musicScore: calculateMusicRelevance(item, originalQuery) }))
    .sort((a, b) => b.musicScore - a.musicScore);

  const strong = scored.filter((item) => item.musicScore >= 4);
  if (strong.length) return strong.slice(0, 6);

  return [];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function searchMusicBrainz(query) {
  const escapedQuery = query.replaceAll('"', '\\"');
  const artistQuery = encodeURIComponent(`artist:"${escapedQuery}"`);
  const recordingQuery = encodeURIComponent(`recording:"${escapedQuery}"`);

  const [artistsData, recordingsData] = await Promise.all([
    fetchJson(`${MUSICBRAINZ_BASE}/artist/?query=${artistQuery}&fmt=json&limit=12`),
    fetchJson(`${MUSICBRAINZ_BASE}/recording/?query=${recordingQuery}&fmt=json&limit=16`)
  ]);

  const artists = (artistsData.artists || [])
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
    .filter((artist) => artist.relevance >= 68)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);

  const songs = (recordingsData.recordings || [])
    .map((recording) => {
      const performers = (recording["artist-credit"] || [])
        .map((credit) => credit.name || credit.artist?.name)
        .filter(Boolean)
        .join(", ");

      const firstRelease = recording.releases?.[0];
      const album = firstRelease?.title;
      const year = recording["first-release-date"]?.slice(0, 4);

      return {
        id: recording.id,
        type: "שיר",
        title: recording.title,
        subtitle: [performers, year].filter(Boolean).join(" · "),
        description: album ? `אלבום/מהדורה: ${album}` : "תוצאת הקלטה מתוך MusicBrainz",
        source: "MusicBrainz",
        url: `https://musicbrainz.org/recording/${recording.id}`,
        relevance: Math.max(textSimilarityScore(recording.title, query), Number(recording.score || 0))
      };
    })
    .filter((song) => song.relevance >= 68)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 8);

  return { artists, songs };
}

async function searchWikipedia(query) {
  const primaryLanguage = containsHebrew(query) ? "he" : "en";
  const secondaryLanguage = primaryLanguage === "he" ? "en" : "he";
  const musicQualifier = primaryLanguage === "he" ? "שיר מוזיקה" : "song music";

  const focused = await wikipediaSearchInLanguage(`${query} ${musicQualifier}`, primaryLanguage, 10);
  let combined = [...focused];

  if (combined.length < 6) {
    const rawPrimary = await wikipediaSearchInLanguage(query, primaryLanguage, 10);
    combined = mergeWikipediaResults(combined, rawPrimary);
  }

  if (combined.length < 6) {
    const focusedSecondary = await wikipediaSearchInLanguage(`${query} ${secondaryLanguage === "he" ? "שיר מוזיקה" : "song music"}`, secondaryLanguage, 8);
    combined = mergeWikipediaResults(combined, focusedSecondary);
  }

  return filterWikipediaResults(combined, query);
}

function mergeWikipediaResults(first, second) {
  const seen = new Set(first.map((item) => `${item.lang}:${item.pageid}`));
  return [...first, ...second.filter((item) => !seen.has(`${item.lang}:${item.pageid}`))];
}

async function wikipediaSearchInLanguage(query, lang, limit = 6) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: "pageimages|extracts|info",
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
  const pages = Object.values(data.query?.pages || {});

  return pages.map((page) => ({
    pageid: page.pageid,
    lang,
    type: "ויקיפדיה",
    title: page.title,
    subtitle: lang === "he" ? "ויקיפדיה העברית" : "Wikipedia",
    description: page.extract || "מידע נוסף בוויקיפדיה",
    thumbnail: page.thumbnail?.source || "",
    source: "Wikipedia",
    url: page.fullurl
  }));
}

function renderSection(title, items) {
  if (!items.length) return "";

  const cards = items.map((item) => `
    <article class="result-card">
      ${item.thumbnail ? `<img class="result-image" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy">` : ""}
      <span class="result-type">${escapeHtml(item.type)}</span>
      <h2>${escapeHtml(item.title)}</h2>
      ${item.subtitle ? `<p class="result-subtitle">${escapeHtml(item.subtitle)}</p>` : ""}
      <p>${escapeHtml(item.description)}</p>
      <a class="source-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
        מקור: ${escapeHtml(item.source)}
      </a>
    </article>
  `).join("");

  return `
    <div class="result-section">
      <h2 class="section-title">${escapeHtml(title)}</h2>
      <div class="result-grid">${cards}</div>
    </div>
  `;
}

function renderResults({ artists = [], songs = [], wikipedia = [] }) {
  results.innerHTML = [
    renderSection("אמנים", artists),
    renderSection("שירים והקלטות", songs),
    renderSection("מידע מוזיקלי מוויקיפדיה", wikipedia)
  ].join("");

  if (!artists.length && !songs.length && !wikipedia.length) {
    results.innerHTML = `
      <div class="empty-state">
        לא נמצאו תוצאות מוזיקליות מתאימות. נסה איות אחר או חיפוש בעברית/באנגלית.
      </div>
    `;
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = searchInput.value.trim();
  if (!query) return;

  status.textContent = `מחפש את “${query}”...`;
  results.innerHTML = "";

  try {
    const [musicBrainzResult, wikipediaResult] = await Promise.allSettled([
      searchMusicBrainz(query),
      searchWikipedia(query)
    ]);

    const music = musicBrainzResult.status === "fulfilled"
      ? musicBrainzResult.value
      : { artists: [], songs: [] };

    const wikipedia = wikipediaResult.status === "fulfilled"
      ? wikipediaResult.value
      : [];

    renderResults({ ...music, wikipedia });

    const failures = [];
    if (musicBrainzResult.status === "rejected") failures.push("MusicBrainz");
    if (wikipediaResult.status === "rejected") failures.push("Wikipedia");

    status.textContent = failures.length
      ? `החיפוש הושלם, אך לא הצלחנו לקבל כרגע מידע מ־${failures.join(" ו־")}.`
      : `נמצאו תוצאות מוזיקליות עבור “${query}”.`;
  } catch (error) {
    console.error(error);
    status.textContent = "אירעה שגיאה בחיפוש. נסה שוב בעוד רגע.";
    renderResults({});
  }
});

results.innerHTML = `
  <div class="empty-state">
    חפש אמן, להקה או שיר כדי לקבל תוצאות מוזיקליות מ־MusicBrainz ומ־Wikipedia.
  </div>
`;
