const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const results = document.getElementById("results");
const status = document.getElementById("status");

const demoData = [
  {
    type: "אמן",
    title: "Frank Sinatra",
    aliases: ["פרנק סינטרה", "frank sinatra"],
    description: "זמר ושחקן אמריקאי. בהמשך נחבר את הכרטיס למקורות מידע חיים."
  },
  {
    type: "אמן",
    title: "הגבעטרון",
    aliases: ["hagevatron", "הגבעטרון"],
    description: "להקת זמר ישראלית. מכאן נוכל להציג שירים, אלבומים וקרדיטים."
  },
  {
    type: "שיר",
    title: "ים השיבולים",
    aliases: ["yam hashibolim", "ים השיבולים"],
    description: "מילים: יצחק קינן · לחן: חיים אגמון · ביצוע מזוהה: הגבעטרון."
  },
  {
    type: "שיר",
    title: "My Way",
    aliases: ["my way"],
    description: "שיר מוכר בביצוע פרנק סינטרה. בהמשך נציג כותבים, מלחינים, גרסאות ואלבומים."
  }
];

function normalize(value) {
  return value.trim().toLocaleLowerCase("he");
}

function renderResults(items) {
  results.innerHTML = "";

  if (!items.length) {
    results.innerHTML = `
      <div class="empty-state">
        לא נמצאה התאמה בנתוני ההדגמה. בשלב הבא נחבר את SongPedia למקורות מידע אמיתיים.
      </div>
    `;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <span class="result-type">${item.type}</span>
      <h2>${item.title}</h2>
      <p>${item.description}</p>
    `;
    results.appendChild(card);
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const query = normalize(searchInput.value);
  if (!query) return;

  status.textContent = `מחפש: ${searchInput.value.trim()}`;

  const matches = demoData.filter((item) => {
    const searchable = [item.title, ...item.aliases].map(normalize);
    return searchable.some((value) => value.includes(query));
  });

  renderResults(matches);
});

renderResults([]);
