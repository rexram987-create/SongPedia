const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const results = document.getElementById("results");
const status = document.getElementById("status");

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2";

const MUSIC_KEYWORDS_HE = ["שיר", "זמר", "זמרת", "להקה", "מוזיקה", "מוזיקלי", "אלבום", "סינגל", "מלחין", "מלחינה", "פזמונאי", "פזמונאית", "מילים", "לחן", "ביצוע", "הקלטה", "תקליט", "תקליטור", "הרכב", "מנצח", "זמר עברי"];
const MUSIC_KEYWORDS_EN = ["song", "singer", "band", "music", "musical", "album", "single", "composer", "lyricist", "recording", "record", "vocalist", "musician", "discography", "performer", "track", "orchestra"];
const NON_MUSIC_KEYWORDS_HE = ["צמח", "מין", "סוג", "משפחה", "בוטני", "בוטניקה", "בעל חיים", "עוף", "יונק", "דג", "חרק", "יישוב", "עיר", "כפר", "נהר", "הר", "מחלה", "תרופה", "כימיה", "פיזיקה", "מאכל"];
const NON_MUSIC_KEYWORDS_EN = ["plant", "species", "genus", "family", "botanical", "botany", "animal", "bird", "mammal", "fish", "insect", "city", "village", "river", "mountain", "disease", "medicine", "chemical", "physics", "food"];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function containsHebrew(value) {
  return /[\u0590-\u05FF]/.test(value);
}

function normalizeText(value = "") {
  return String(value).normalize("NFKD").replace(/[\u0591-\u05C7]/g, "").trim().toLocaleLowerCase("he");
}

function wordsOf(value = "") {
  return normalizeText(value).replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
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
  for (const word of wordsOf(query).filter((word) => word.length > 2)) if (title.includes(word)) score += 2;
  for (const keyword of musicKeywords) if (text.includes(keyword)) score += 4;
  for (const keyword of nonMusicKeywords) if (text.includes(keyword)) score -= 5;
  return score;
}

function filterWikipediaResults(items, originalQuery) {
  if (!items.length) return [];
  const scored = items.map((item) => ({ ...item, musicScore: calculateMusicRelevance(item, originalQuery) })).sort((a, b) => b.musicScore - a.musicScore);
  const strong = scored.filter((item) => item.musicScore >= 4);
  return strong.length ? strong.slice(0, 6) : [];
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

  const artists = (artistsData.artists || []).map((artist) => ({
    id: artist.id,
    type: "אמן",
    title: artist.name,
    subtitle: [artist.type, artist.country, artist["life-span"]?.begin].filter(Boolean).join(" · "),
    description: artist.disambiguation || "תוצאת אמן מתוך MusicBrainz",
    source: "MusicBrainz",
    url: `https://musicbrainz.org/artist/${artist.id}`,
    relevance: Math.max(textSimilarityScore(artist.name, query), Number(artist.score || 0))
  })).filter((artist) => artist.relevance >= 68).sort((a, b) => b.relevance - a.relevance).slice(0, 6);

  const songs = (recordingsData.recordings || []).map((recording) => {
    const performers = (recording["artist-credit"] || []).map((credit) => credit.name || credit.artist?.name).filter(Boolean).join(", ");
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
  }).filter((song) => song.relevance >= 68).sort((a, b) => b.relevance - a.relevance).slice(0, 8);

  return { artists, songs };
}

async function searchWikipedia(query) {
  const primaryLanguage = containsHebrew(query) ? "he" : "en";
  const secondaryLanguage = primaryLanguage === "he" ? "en" : "he";
  const musicQualifier = primaryLanguage === "he" ? "שיר מוזיקה" : "song music";
  const focused = await wikipediaSearchInLanguage(`${query} ${musicQualifier}`, primaryLanguage, 10);
  let combined = [...focused];
  if (combined.length < 6) combined = mergeWikipediaResults(combined, await wikipediaSearchInLanguage(query, primaryLanguage, 10));
  if (combined.length < 6) combined = mergeWikipediaResults(combined, await wikipediaSearchInLanguage(`${query} ${secondaryLanguage === "he" ? "שיר מוזיקה" : "song music"}`, secondaryLanguage, 8));
  return filterWikipediaResults(combined, query);
}

function mergeWikipediaResults(first, second) {
  const seen = new Set(first.map((item) => `${item.lang}:${item.pageid}`));
  return [...first, ...second.filter((item) => !seen.has(`${item.lang}:${item.pageid}`))];
}

async function wikipediaSearchInLanguage(query, lang, limit = 6) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: query, gsrlimit: String(limit), prop: "pageimages|extracts|info", inprop: "url", piprop: "thumbnail", pithumbsize: "240", exintro: "1", explaintext: "1", exsentences: "3", origin: "*", format: "json" });
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
    url: page.fullurl
  }));
}

function uniqueNames(values) {
  return [...new Set(values.filter(Boolean))];
}

function relationArtistName(relation) {
  return relation.artist?.name || relation.artist?.["sort-name"] || "";
}

async function fetchSongDetails(recordingId) {
  const inc = encodeURIComponent("artist-credits+releases+work-rels+work-level-rels+artist-rels");
  const recording = await fetchJson(`${MUSICBRAINZ_BASE}/recording/${recordingId}?inc=${inc}&fmt=json`);

  const performers = uniqueNames((recording["artist-credit"] || []).map((credit) => credit.name || credit.artist?.name));
  const releases = recording.releases || [];
  const datedReleases = releases.filter((release) => release.date).sort((a, b) => a.date.localeCompare(b.date));
  const earliestRelease = datedReleases[0] || releases[0];
  const releaseYear = earliestRelease?.date?.slice(0, 4) || "לא נמצא";
  const album = earliestRelease?.title || "לא נמצא";

  const workRelations = (recording.relations || []).filter((relation) => relation.work);
  const works = [];

  for (const relation of workRelations) {
    let work = relation.work;
    if (!Array.isArray(work.relations)) {
      try {
        work = await fetchJson(`${MUSICBRAINZ_BASE}/work/${work.id}?inc=artist-rels&fmt=json`);
      } catch (error) {
        console.warn("Could not load work", work.id, error);
      }
    }
    works.push({ work, recordingRelation: relation });
  }

  const composers = [];
  const lyricists = [];
  const writers = [];
  const arrangers = [];

  for (const { work } of works) {
    for (const relation of work.relations || []) {
      const type = normalizeText(relation.type || "");
      const name = relationArtistName(relation);
      if (!name) continue;
      if (type === "composer") composers.push(name);
      else if (type === "lyricist") lyricists.push(name);
      else if (type === "writer") writers.push(name);
      else if (type === "arranger") arrangers.push(name);
    }
  }

  const workTitles = uniqueNames(works.map(({ work }) => work.title));
  const iswcs = uniqueNames(works.flatMap(({ work }) => work.iswcs || (work.iswc ? [work.iswc] : [])));

  return {
    id: recording.id,
    title: recording.title,
    performers,
    composers: uniqueNames(composers),
    lyricists: uniqueNames(lyricists),
    writers: uniqueNames(writers),
    arrangers: uniqueNames(arrangers),
    releaseYear,
    album,
    workTitles,
    iswcs,
    sourceUrl: `https://musicbrainz.org/recording/${recording.id}`
  };
}

function detailValue(values, fallback = "לא נמצא במקור זה") {
  if (Array.isArray(values)) return values.length ? values.join(", ") : fallback;
  return values || fallback;
}

function renderSongDetails(details) {
  const existing = document.getElementById("songDetailsPanel");
  if (existing) existing.remove();

  const panel = document.createElement("section");
  panel.id = "songDetailsPanel";
  panel.className = "song-details-panel";
  panel.innerHTML = `
    <div class="song-details-header">
      <div>
        <span class="result-type">כרטיס שיר</span>
        <h2>${escapeHtml(details.title)}</h2>
      </div>
      <button class="details-close" type="button" aria-label="סגור">×</button>
    </div>
    <dl class="song-facts">
      <div><dt>מבצע</dt><dd>${escapeHtml(detailValue(details.performers))}</dd></div>
      <div><dt>מילים</dt><dd>${escapeHtml(detailValue(details.lyricists.length ? details.lyricists : details.writers))}</dd></div>
      <div><dt>לחן</dt><dd>${escapeHtml(detailValue(details.composers.length ? details.composers : details.writers))}</dd></div>
      <div><dt>עיבוד</dt><dd>${escapeHtml(detailValue(details.arrangers))}</dd></div>
      <div><dt>שנת יציאה</dt><dd>${escapeHtml(details.releaseYear)}</dd></div>
      <div><dt>אלבום / מהדורה</dt><dd>${escapeHtml(details.album)}</dd></div>
      <div><dt>היצירה ב־MusicBrainz</dt><dd>${escapeHtml(detailValue(details.workTitles))}</dd></div>
      <div><dt>ISWC</dt><dd>${escapeHtml(detailValue(details.iswcs))}</dd></div>
      <div><dt>מבצע מקורי</dt><dd>לא ניתן לקבוע בוודאות מההקלטה הנוכחית בלבד</dd></div>
    </dl>
    <p class="details-note">הקרדיטים מוצגים רק כאשר הם קיימים במאגר MusicBrainz. חוסר מידע אינו אומר שאין כותב, מלחין או מעבד — אלא שהפרט לא נמצא במקור הזה.</p>
    <a class="source-link" href="${escapeHtml(details.sourceUrl)}" target="_blank" rel="noopener noreferrer">מקור: MusicBrainz</a>
  `;
  results.prepend(panel);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.querySelector(".details-close").addEventListener("click", () => panel.remove());
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
      ${item.type === "שיר" ? `<button class="song-details-button" type="button" data-recording-id="${escapeHtml(item.id)}">פרטי השיר</button>` : ""}
      <a class="source-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">מקור: ${escapeHtml(item.source)}</a>
    </article>
  `).join("");
  return `<div class="result-section"><h2 class="section-title">${escapeHtml(title)}</h2><div class="result-grid">${cards}</div></div>`;
}

function renderResults({ artists = [], songs = [], wikipedia = [] }) {
  results.innerHTML = [renderSection("אמנים", artists), renderSection("שירים והקלטות", songs), renderSection("מידע מוזיקלי מוויקיפדיה", wikipedia)].join("");
  if (!artists.length && !songs.length && !wikipedia.length) results.innerHTML = `<div class="empty-state">לא נמצאו תוצאות מוזיקליות מתאימות. נסה איות אחר או חיפוש בעברית/באנגלית.</div>`;
}

results.addEventListener("click", async (event) => {
  const button = event.target.closest(".song-details-button");
  if (!button) return;
  const recordingId = button.dataset.recordingId;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "טוען פרטים...";
  try {
    const details = await fetchSongDetails(recordingId);
    renderSongDetails(details);
  } catch (error) {
    console.error(error);
    status.textContent = "לא הצלחנו לטעון כרגע את פרטי השיר המלאים.";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  status.textContent = `מחפש את “${query}”...`;
  results.innerHTML = "";
  try {
    const [musicBrainzResult, wikipediaResult] = await Promise.allSettled([searchMusicBrainz(query), searchWikipedia(query)]);
    const music = musicBrainzResult.status === "fulfilled" ? musicBrainzResult.value : { artists: [], songs: [] };
    const wikipedia = wikipediaResult.status === "fulfilled" ? wikipediaResult.value : [];
    renderResults({ ...music, wikipedia });
    const failures = [];
    if (musicBrainzResult.status === "rejected") failures.push("MusicBrainz");
    if (wikipediaResult.status === "rejected") failures.push("Wikipedia");
    status.textContent = failures.length ? `החיפוש הושלם, אך לא הצלחנו לקבל כרגע מידע מ־${failures.join(" ו־")}.` : `נמצאו תוצאות מוזיקליות עבור “${query}”.`;
  } catch (error) {
    console.error(error);
    status.textContent = "אירעה שגיאה בחיפוש. נסה שוב בעוד רגע.";
    renderResults({});
  }
});

results.innerHTML = `<div class="empty-state">חפש אמן, להקה או שיר כדי לקבל תוצאות מוזיקליות מ־MusicBrainz ומ־Wikipedia.</div>`;
