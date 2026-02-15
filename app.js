/*
  Mărțișor — WhatsApp-style mock
  - Slower, more sporadic chat-list intro animation
  - Special interactive threads:
      • Event Details (includes the green outgoing martisor.gif bubble + RSVP popup link)
      • Art Details (concept sketch + 3 lines + optional martisor-scans.gif)
      • Mărțișor History (text sequence)
      • RSVP (embedded Tally iframe inside the chat)
  - No contenteditable anywhere
  - No hide/reveal address panel
  - Fixed avatars for special threads
  - Generic chats cycle through avatar + preview options before repeating
*/

const app = document.getElementById("app");
const chatList = document.getElementById("chatList");
const backBtn = document.getElementById("backBtn");
const replayBtn = document.getElementById("replayBtn");

const chatNameEl = document.getElementById("chatName");
const chatStatusEl = document.getElementById("chatStatus");
const chatAvatarEl = document.getElementById("chatAvatar");
const chatAvatarImg = document.getElementById("chatAvatarImg");

const dynamicMount = document.getElementById("dynamicMount");

if (!app || !chatList || !dynamicMount) {
  // Fail safely if the HTML structure isn't present.
  // eslint-disable-next-line no-console
  console.warn("Missing required DOM nodes — app.js not initialized.");
}

// -----------------------------
// Helpers
// -----------------------------

let introToken = 0;
let sequenceToken = 0;
let introTimeoutId = null;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeShuffledCycle(items) {
  let bag = shuffle(items);
  let last = null;

  return function next() {
    if (bag.length === 0) {
      bag = shuffle(items);
      // Avoid immediate repeat across cycles.
      if (bag.length > 1 && bag[0] === last) {
        bag.push(bag.shift());
      }
    }
    const val = bag.shift();
    last = val;
    return val;
  };
}

function guardSequence(token) {
  return token === sequenceToken;
}

function scrollChatToBottom() {
  const chatScroll = document.querySelector("#pageChat .chat");
  if (!chatScroll) return;
  window.setTimeout(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }, 0);
}

function formatNowTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function updateStatusBarTimes() {
  const t = formatNowTime();
  document.querySelectorAll(".statusbar__time").forEach((el) => {
    el.textContent = t;
  });
}

function startClock() {
  updateStatusBarTimes();
  window.setInterval(updateStatusBarTimes, 1000);
}

function markAvatarFallback(containerEl, imgEl) {
  if (!containerEl || !imgEl) return;
  containerEl.classList.remove("is-missing");
  imgEl.addEventListener(
    "error",
    () => containerEl.classList.add("is-missing"),
    { once: true },
  );
}

function clearDynamicMessages() {
  if (!dynamicMount) return;
  dynamicMount.innerHTML = "";
  if (dynamicMount.dataset) dynamicMount.dataset.thread = "";
}

// -----------------------------
// Tally helpers (popup + embeds)
// -----------------------------

const TALLY_FORM_ID = "KYldG7";
const TALLY_SCRIPT_URL = "https://tally.so/widgets/embed.js";

function ensureTallyScriptLoaded() {
  return new Promise((resolve) => {
    if (typeof window.Tally !== "undefined" && typeof window.Tally.loadEmbeds === "function") {
      resolve(true);
      return;
    }

    const existing = document.querySelector(`script[src="${TALLY_SCRIPT_URL}"]`);
    if (existing) {
      // Script is present but may still be loading. Poll briefly.
      const startedAt = Date.now();
      const poll = window.setInterval(() => {
        if (typeof window.Tally !== "undefined" && typeof window.Tally.loadEmbeds === "function") {
          window.clearInterval(poll);
          resolve(true);
        } else if (Date.now() - startedAt > 2500) {
          window.clearInterval(poll);
          resolve(false);
        }
      }, 60);
      return;
    }

    const s = document.createElement("script");
    s.src = TALLY_SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

async function loadTallyEmbeds() {
  await ensureTallyScriptLoaded();

  // Preferred: Tally API
  if (typeof window.Tally !== "undefined" && typeof window.Tally.loadEmbeds === "function") {
    window.Tally.loadEmbeds();
    return;
  }

  // Fallback: set src from data-tally-src
  document
    .querySelectorAll('iframe[data-tally-src]:not([src])')
    .forEach((iframe) => {
      // eslint-disable-next-line no-param-reassign
      iframe.src = iframe.dataset.tallySrc;
    });
}

const RSVP_POPUP_LINK_HTML = `
  <a
    class="tally-popup-link"
    href="#tally-open=${TALLY_FORM_ID}&tally-emoji-text=👋&tally-emoji-animation=wave"
    data-tally-open="${TALLY_FORM_ID}"
    data-tally-emoji-text="👋"
    data-tally-emoji-animation="wave"
  >Click here for RSVP</a>
`;

const RSVP_EMBED_URL = `https://tally.so/embed/${TALLY_FORM_ID}?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1`;

// Art assets (we try a few paths so it works whether you store images in /images or project root)
const CONCEPT_IMAGE_CANDIDATES = [
  "images/conceptsketc.jpg",
  "conceptsketc.jpg",
  "images/conceptsketch.jpg",
  "conceptsketch.jpg",
];

let conceptImageUrl = CONCEPT_IMAGE_CANDIDATES[0];
let conceptImageResolved = false;

async function resolveConceptImageUrl() {
  if (conceptImageResolved) return conceptImageUrl;
  for (const c of CONCEPT_IMAGE_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await assetExists(c);
    if (ok) {
      conceptImageUrl = c;
      break;
    }
  }
  conceptImageResolved = true;
  return conceptImageUrl;
}

// -----------------------------
// Chat list data
// -----------------------------

const romanianNames = [
  "Ana Popescu",
  "Mihai Ionescu",
  "Ioana Dumitrescu",
  "Andrei Stan",
  "Elena Marinescu",
  "Radu Petrescu",
  "Cătălina Georgescu",
  "Ștefan Rusu",
  "Cristina Matei",
  "Vlad Popa",
  "Alina Toma",
  "Bogdan Enache",
  "Teodora Ilie",
  "Daria Stoica",
  "Sorin Dobre",
  "Irina Pavel",
  "Rareș Ciobanu",
  "Bianca Șerban",
  "Dragoș Vasile",
  "Maria Nistor",
  "Nicoleta Cristea",
  "Gabriel Munteanu",
  "Oana Sava",
  "Mădălina Răduț",
  "Florin Neagu",
  "Alexia Bălan",
  "Dinu Barbu",
  "Iulia Chiriac",
  "Săndel Păun",
  "Roxana Bîrsan",
];

const previewOptions = [
  "Happy Mărțișor!",
  "Noroc, sănătate și multă voie bună!",
  "Happy March 1st!",
  "Happy Spring!!!",
  "Un simbol mic pentru o prietenie mare. Să ai un Martie de vis!",
];

const timeOptions = [
  "11:08 AM",
  "12:44 AM",
  "9:11 AM",
  "8:33 AM",
  "Yesterday",
  "Yesterday",
  "7:02 AM",
  "6:18 AM",
  "10:29 PM",
];

const GENERIC_AVATARS = [
  "images/a.jpg",
  "images/b.jpg",
  "images/c.jpg",
  "images/d.jpg",
  "images/e.jpg",
  "images/f.jpg",
  "images/g.jpg",
  "images/h.jpg",
];

const nextGenericAvatar = makeShuffledCycle(GENERIC_AVATARS);
const nextGenericPreview = makeShuffledCycle(previewOptions);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatDisplayName(fullName) {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return String(fullName).trim();
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first} ${last.charAt(0)}.`;
}

const SPECIAL = {
  event: {
    id: "event",
    name: "Event Details",
    preview: "Celebrate spring the Romanian way!",
    time: "12:30 PM",
    badge: "1",
    avatarSrc: "images/a.jpg",
    thread: "event",
  },
  art: {
    id: "art",
    name: "Art Details",
    preview: "Concept sketch + artist statement",
    time: "12:29 PM",
    badge: "",
    avatarSrc: "images/b.jpg",
    thread: "art",
  },
  history: {
    id: "history",
    name: "Mărțișor History",
    preview: "What is Mărțișor?",
    time: "12:28 PM",
    badge: "",
    avatarSrc: "images/c.jpg",
    thread: "history",
  },
  rsvp: {
    id: "rsvp",
    name: "RSVP",
    preview: "Tap to RSVP",
    time: "12:27 PM",
    badge: "",
    avatarSrc: "images/d.jpg",
    thread: "rsvp",
  },
};

function generateGenericChat() {
  const id = `c_${Math.random().toString(16).slice(2)}`;
  return {
    id,
    name: formatDisplayName(pick(romanianNames)),
    preview: nextGenericPreview(),
    time: pick(timeOptions),
    badge: "99+",
    avatarSrc: nextGenericAvatar(),
    thread: "generic",
  };
}

function createChatRow(chat) {
  const row = document.createElement("div");
  row.className = "row is-entering";
  row.dataset.chatId = chat.id;

  const badgeHtml = chat.badge
    ? `<div class="badge" spellcheck="false">${chat.badge}</div>`
    : "";

  row.innerHTML = `
    <div class="avatar">
      <img src="${chat.avatarSrc}" alt="" />
      <div class="avatar-fallback" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2-8 4.5V21h16v-2.5C20 16 16.42 14 12 14Z"/></svg>
      </div>
    </div>

    <div class="row__main">
      <div class="row__top">
        <div class="row__name" spellcheck="false">${chat.name}</div>
        <div class="row__time" spellcheck="false">${chat.time}</div>
      </div>
      <div class="row__bottom">
        <div class="row__preview" spellcheck="false">${chat.preview}</div>
        <div class="row__meta">
          ${badgeHtml}
        </div>
      </div>
    </div>
  `;

  const avatar = row.querySelector(".avatar");
  const avatarImg = row.querySelector(".avatar img");
  markAvatarFallback(avatar, avatarImg);

  row.addEventListener("click", () => {
    openChat(chat);
  });

  return row;
}

function addInitialChats(count = 10) {
  for (let i = 0; i < count; i += 1) {
    const chat = generateGenericChat();
    const row = createChatRow(chat);
    row.classList.remove("is-entering");
    row.classList.add("is-entered");
    chatList.appendChild(row);
  }
}

function stopIntro() {
  introToken += 1;
  if (introTimeoutId) {
    window.clearTimeout(introTimeoutId);
    introTimeoutId = null;
  }
}

function animateIntroThenOpen() {
  stopIntro();
  const token = introToken;

  const plan = [
    { type: "random" },
    { type: "special", key: "rsvp" },
    { type: "special", key: "history" },
    { type: "special", key: "art" },
    { type: "special", key: "event" },
  ];

  let idx = 0;
  let lastRow = null;

  const step = () => {
    if (token !== introToken) return;

    const entry = plan[idx];
    if (!entry) return;

    const chat =
      entry.type === "random" ? generateGenericChat() : { ...SPECIAL[entry.key] };

    const row = createChatRow(chat);
    chatList.prepend(row);

    // Animate row in
    requestAnimationFrame(() => row.classList.add("is-entered"));

    lastRow = row;
    idx += 1;

    // After the last insert (Event Details), highlight and auto-open.
    if (idx >= plan.length) {
      introTimeoutId = window.setTimeout(() => {
        if (token !== introToken) return;
        if (lastRow) lastRow.classList.add("is-selected");

        window.setTimeout(() => {
          if (token !== introToken) return;
          openChat(SPECIAL.event);
        }, 700);
      }, 600);
      return;
    }

    // Slower + irregular delay between incoming chats.
    const nextDelay = randInt(900, 1700);
    introTimeoutId = window.setTimeout(step, nextDelay);
  };

  // Give the list a beat before the first new chat appears.
  introTimeoutId = window.setTimeout(step, 900);
}

// -----------------------------
// Message builders
// -----------------------------

function createTypingMsg() {
  const msg = document.createElement("div");
  msg.className = "msg msg--incoming msg--typing";

  msg.innerHTML = `
    <div class="bubble bubble--incoming bubble--typing" aria-label="Typing">
      <div class="typing" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;

  return msg;
}

async function showTyping(token, durationMs = 900) {
  if (!guardSequence(token)) return;

  const typingEl = createTypingMsg();
  dynamicMount.appendChild(typingEl);
  chatStatusEl.textContent = "typing…";
  scrollChatToBottom();

  await sleep(durationMs);
  if (!guardSequence(token)) return;

  typingEl.remove();
  chatStatusEl.textContent = "online";
  scrollChatToBottom();
}

function createPhoto(src) {
  const photo = document.createElement("div");
  photo.className = "photo";

  const img = document.createElement("img");
  img.src = src;
  img.alt = "Attached image";

  const missing = document.createElement("div");
  missing.className = "photo__missing";
  missing.setAttribute("aria-hidden", "true");
  missing.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5 11 16.01l3.5-4.5L19 18H5l3.5-4.5Z"/></svg>';

  img.addEventListener(
    "error",
    () => {
      photo.classList.add("is-missing");
    },
    { once: true },
  );

  photo.appendChild(img);
  photo.appendChild(missing);
  return photo;
}

function appendTextMsg({ direction = "incoming", html = "", timeText = "" }) {
  const msg = document.createElement("div");
  msg.className = `msg msg--${direction}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble bubble--${direction}`;

  const text = document.createElement("div");
  text.className = "bubble__text";
  text.innerHTML = html;

  bubble.appendChild(text);

  if (timeText) {
    const meta = document.createElement("div");
    meta.className = "bubble__meta";
    meta.innerHTML = `<span class="bubble__time" spellcheck="false">${timeText}</span>`;
    bubble.appendChild(meta);
  }

  msg.appendChild(bubble);
  dynamicMount.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

function appendPhotoMsg({ direction = "incoming", src, caption = "", timeText = "" }) {
  const msg = document.createElement("div");
  msg.className = `msg msg--${direction}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble bubble--${direction}`;

  bubble.appendChild(createPhoto(src));

  if (caption) {
    const cap = document.createElement("div");
    cap.className = "bubble__caption";
    cap.textContent = caption;
    bubble.appendChild(cap);
  }

  if (timeText) {
    const meta = document.createElement("div");
    meta.className = "bubble__meta";
    meta.innerHTML = `<span class="bubble__time" spellcheck="false">${timeText}</span>`;
    bubble.appendChild(meta);
  }

  msg.appendChild(bubble);
  dynamicMount.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

function appendEmbedMsg({ title = "RSVP to Mărțișor Event" } = {}) {
  const msg = document.createElement("div");
  msg.className = "msg msg--incoming";

  const bubble = document.createElement("div");
  bubble.className = "bubble bubble--incoming bubble--embed";

  const wrap = document.createElement("div");
  wrap.className = "bubble__embed";

  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-tally-src", RSVP_EMBED_URL);
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("width", "100%");
  iframe.setAttribute("height", "356");
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("marginheight", "0");
  iframe.setAttribute("marginwidth", "0");
  iframe.setAttribute("title", title);

  wrap.appendChild(iframe);
  bubble.appendChild(wrap);
  msg.appendChild(bubble);
  dynamicMount.appendChild(msg);
  scrollChatToBottom();

  // Activate the embed (dynamic height, etc.)
  loadTallyEmbeds();

  return msg;
}

function assetExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

// -----------------------------
// Thread content
// -----------------------------

const played = {
  event: false,
  art: false,
  history: false,
};

const EVENT_DETAILS_TEXTS = [
  "Celebrate spring the Romanian way!",
  "Experience the live creation of a <strong>large-scale Mărțișor</strong> — a work exploring memory.",
  "Join us for the performance, food, and community. Open to all.",
  "<strong>Sunday, March 1st @ 2:00 PM</strong>",
  "<strong>366 Devoe Street, Brooklyn</strong>",
  RSVP_POPUP_LINK_HTML,
];

const ART_DETAILS_TEXTS = [
  "The mărțișor is a Romanian spring tradition: a small braided token of red and white thread, exchanged on March 1st as a symbol of renewal and connection.",
  "Memory is sustained in presence and in practice. Through memory, objects and events become distorted but durational, carried by the collective, across time and place.",
  "Together we will weave a large mărțișor, strung with bead constructed of a large amalgamation of objects related to memory.",
];

const HISTORY_TEXTS = [
  "Mărțișor is an ancient Romanian celebration on March 1st marking the arrival of spring and the victory of light over winter.",
  "The name is a diminutive of Martie, literally translating to \"little March.\"",
  "The core symbol is a red and white twisted string representing the transition from the white of winter to the red vitality of spring.",
  "It was added to the UNESCO Intangible Cultural Heritage list in 2017 to preserve its historical and cultural significance.",
  "Historical roots date back over 2,000 years to Roman and Dacian times, possibly tied to the feast of the god Mars.",
  "People traditionally wear the string pinned to their clothing or around their wrist for the first 9 to 12 days of the month.",
  "In modern times, the string is usually attached to small charms like snowdrops, ladybugs, or four-leaf clovers for good luck.",
  "The tradition concludes by tying the red and white string to the branch of a flowering fruit tree to ensure health and prosperity.",
];

async function playEventDetails(token) {
  if (!guardSequence(token)) return;
  dynamicMount.dataset.thread = "event";

  // Green outgoing bubble (ONLY in Event Details)
  appendPhotoMsg({
    direction: "outgoing",
    src: "images/martisor.gif",
    caption: "Happy Mărțișor!",
    timeText: "",
  });

  await sleep(randInt(220, 520));
  if (!guardSequence(token)) return;

  // Incoming messages with typing in-between
  for (const html of EVENT_DETAILS_TEXTS) {
    await showTyping(token, randInt(850, 1500));
    if (!guardSequence(token)) return;

    appendTextMsg({ direction: "incoming", html });
    // Ensure popup link is wired up
    if (html.includes("data-tally-open")) loadTallyEmbeds();

    await sleep(randInt(320, 920));
    if (!guardSequence(token)) return;
  }

  played.event = true;
}

function renderEventDetailsFinal() {
  dynamicMount.dataset.thread = "event";
  appendPhotoMsg({
    direction: "outgoing",
    src: "images/martisor.gif",
    caption: "Happy Mărțișor!",
  });
  EVENT_DETAILS_TEXTS.forEach((html) => appendTextMsg({ direction: "incoming", html }));
  loadTallyEmbeds();
}

async function playArtDetails(token) {
  if (!guardSequence(token)) return;
  dynamicMount.dataset.thread = "art";

  // Resolve asset path once (supports both /images and project root)
  await resolveConceptImageUrl();
  if (!guardSequence(token)) return;

  // Concept sketch image (as an image message)
  await showTyping(token, randInt(650, 1200));
  if (!guardSequence(token)) return;

  appendPhotoMsg({
    direction: "incoming",
    src: conceptImageUrl,
    caption: "",
  });

  await sleep(randInt(260, 640));
  if (!guardSequence(token)) return;

  for (const t of ART_DETAILS_TEXTS) {
    await showTyping(token, randInt(800, 1400));
    if (!guardSequence(token)) return;

    appendTextMsg({ direction: "incoming", html: t });
    await sleep(randInt(280, 760));
    if (!guardSequence(token)) return;
  }

  // Optional scans gif (only if it exists)
  const scansCandidates = ["images/martisor-scans.gif", "martisor-scans.gif"];
  let scansUrl = null;
  for (const c of scansCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await assetExists(c);
    if (ok) {
      scansUrl = c;
      break;
    }
  }

  if (scansUrl) {
    await showTyping(token, randInt(750, 1350));
    if (!guardSequence(token)) return;
    appendPhotoMsg({ direction: "incoming", src: scansUrl });
  }

  played.art = true;
}

function renderArtDetailsFinal() {
  dynamicMount.dataset.thread = "art";
  appendPhotoMsg({ direction: "incoming", src: conceptImageUrl });
  ART_DETAILS_TEXTS.forEach((t) => appendTextMsg({ direction: "incoming", html: t }));
  // Intentionally do not force-send martisor-scans.gif here; only if it exists at runtime.
}

async function playHistory(token) {
  if (!guardSequence(token)) return;
  dynamicMount.dataset.thread = "history";

  for (const t of HISTORY_TEXTS) {
    await showTyping(token, randInt(780, 1500));
    if (!guardSequence(token)) return;

    appendTextMsg({ direction: "incoming", html: t });
    await sleep(randInt(220, 620));
    if (!guardSequence(token)) return;
  }

  played.history = true;
}

function renderHistoryFinal() {
  dynamicMount.dataset.thread = "history";
  HISTORY_TEXTS.forEach((t) => appendTextMsg({ direction: "incoming", html: t }));
}

async function playRSVP(token) {
  if (!guardSequence(token)) return;
  dynamicMount.dataset.thread = "rsvp";

  await showTyping(token, randInt(520, 980));
  if (!guardSequence(token)) return;

  appendEmbedMsg();
}

// -----------------------------
// Navigation
// -----------------------------

function openChat(chat) {
  if (!chat) return;

  // Stop intro if user interacts
  stopIntro();

  // Cancel any running message sequence
  sequenceToken += 1;
  const token = sequenceToken;

  // Update header
  chatNameEl.textContent = chat.name;
  chatStatusEl.textContent = "online";

  // Avatar in chat header
  chatAvatarEl.classList.remove("is-missing");
  chatAvatarImg.src = chat.avatarSrc;
  chatAvatarImg.onerror = () => chatAvatarEl.classList.add("is-missing");

  // Show chat page
  app.classList.add("show-chat");

  // Render messages
  clearDynamicMessages();

  if (chat.thread === "event") {
    if (played.event) {
      renderEventDetailsFinal();
    } else {
      playEventDetails(token);
    }
  } else if (chat.thread === "art") {
    if (played.art) {
      renderArtDetailsFinal();
    } else {
      playArtDetails(token);
    }
  } else if (chat.thread === "history") {
    if (played.history) {
      renderHistoryFinal();
    } else {
      playHistory(token);
    }
  } else if (chat.thread === "rsvp") {
    playRSVP(token);
  } else {
    // Generic chat (lightweight)
    appendTextMsg({ direction: "incoming", html: pick(previewOptions) });
  }

  scrollChatToBottom();
}

function closeChat() {
  sequenceToken += 1;
  app.classList.remove("show-chat");
}

function resetExperience() {
  stopIntro();
  sequenceToken += 1;

  // Reset special thread playback
  played.event = false;
  played.art = false;
  played.history = false;

  // Return to list view
  app.classList.remove("show-chat");

  // Clear chat + list
  clearDynamicMessages();
  chatList.innerHTML = "";

  // Rebuild + replay intro
  addInitialChats(10);
  animateIntroThenOpen();
}

// -----------------------------
// Wire events + init
// -----------------------------

if (backBtn) backBtn.addEventListener("click", closeChat);
if (replayBtn) replayBtn.addEventListener("click", resetExperience);

startClock();
// Pre-resolve the concept image path so it loads as soon as possible.
resolveConceptImageUrl();
addInitialChats(10);
animateIntroThenOpen();
