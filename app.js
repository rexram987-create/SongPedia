const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const results = document.getElementById("results");
const status = document.getElementById("status");

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2";

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
  const encoded = encodeURIComponent(query);

  const [artistsData, recordingsData] = await Promise.all([
    fetchJson(`${MUSICBRAINZ_BASE}/artist/?query=${encoded}&fmt=json&limit=6`),
    fetchJson(`${MUSICBRAINZ_BASE}/recording/?query=${encoded}&fmt=json&limit=8`)
  ]);

  const artists = (artistsData.artists || []).map((artist) => ({
    id: artist.id,
    type: "אמן",
    title: artist.name,
    subtitle: [artist.type, artist.country, artist["life-span"]?.begin].filter(Boolean).join(" · "),
    description: artist.disambiguation || "תוצאת אמן מתוך MusicBrainz",
    source: "MusicBrainz",
    url: `https://musicbrainz.org/artist/${artist.id}`
  }));

  const songs = (recordingsData.recordings || []).map((recording) => {
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
      url: `https://musicbrainz.org/recording/${recording.id}`
    };
  });

  return { artists, songs };
}

async function searchWikipedia(query) {
  const primaryLanguage = containsHebrew(query) ? "he" : "en";
  const secondaryLanguage = primaryLanguage === "he" ? "en" : "he";

  const first = await wikipediaSearchInLanguage(query, primaryLanguage);
  if (first.length >= 4) return first;

  const second = await wikipediaSearchInLanguage(query, secondaryLanguage);
  const seen = new Set(first.map((item) => `${item.lang}:${item.pageid}`));
  return [...first, ...second.filter((item) => !seen.has(`${item.lang}:${item.pageid}`))].slice(0, 6);
}

async function wikipediaSearchInLanguage(query, lang) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "6",
    prop: "pageimages|extracts|info",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "240",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
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
    renderSection("מידע מוויקיפדיה", wikipedia)
  ].join("");

  if (!artists.length && !songs.length && !wikipedia.length) {
    results.innerHTML = `
      <div class="empty-state">
        לא נמצאו תוצאות. נסה איות אחר או חיפוש בעברית/באנגלית.
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
      : `נמצאו תוצאות עבור “${query}”.`;
  } catch (error) {
    console.error(error);
    status.textContent = "אירעה שגיאה בחיפוש. נסה שוב בעוד רגע.";
    renderResults({});
  }
});

results.innerHTML = `
  <div class="empty-state">
    חפש אמן, להקה או שיר כדי לקבל תוצאות אמיתיות מ־MusicBrainz ומ־Wikipedia.
  </div>
`;
