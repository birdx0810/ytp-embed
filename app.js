import {
  applyStaticTranslations,
  getLang,
  hasExplicitLangInUrl,
  initI18n,
  setLang,
  t,
} from "./i18n.js";

const form = document.getElementById("url-form");
const urlInput = document.getElementById("url-input");
const stage = document.getElementById("stage");
const empty = document.getElementById("empty");
const playlistEl = document.getElementById("playlist");
const playlistTitleEl = document.getElementById("playlist-title");
const playlistCountEl = document.getElementById("playlist-count");
const playlistStatusEl = document.getElementById("playlist-status");
const currentTitleEl = document.getElementById("current-title");
const currentMetaEl = document.getElementById("current-meta");
const langSelect = document.getElementById("lang-select");
const shuffleToggle = document.getElementById("shuffle-toggle");
const loopToggle = document.getElementById("loop-toggle");

const META_KEY = "yt-playlist-wrapper:meta";
const PLAYBACK_KEY = "yt-playlist-wrapper:playback";

/** @type {YT.Player | null} */
let player = null;
let ytApiReady = null;
/** @type {{ id: string, title: string | null, videos: { id: string, title: string, author: string | null, authorUrl: string | null, thumbnail: string }[] } | null} */
let playlist = null;
let activeVideoId = null;
/** @type {Record<string, { title?: string, author?: string, authorUrl?: string }>} */
let knownMeta = loadKnownMeta();
/** Bumps when a new playlist loads so in-flight title fetches are ignored. */
let metaFetchToken = 0;
/** Last status key/message so language switches can refresh it. */
let lastStatus = /** @type {{ key?: string, message?: string, isError: boolean, vars?: Record<string, string | number> } | null} */ (
  null
);
let loopEnabled = false;
let shuffleEnabled = false;
/** Remaining ids in the current shuffle pass (excludes the video now playing). */
/** @type {string[]} */
let shuffleQueue = [];

function loadKnownMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function loadPlaybackPrefs() {
  const params = new URLSearchParams(window.location.search);
  let loop = params.get("loop");
  let shuffle = params.get("shuffle");

  if (loop == null || shuffle == null) {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYBACK_KEY) || "{}") || {};
      if (loop == null && typeof saved.loop === "boolean") loop = saved.loop ? "1" : "0";
      if (shuffle == null && typeof saved.shuffle === "boolean") {
        shuffle = saved.shuffle ? "1" : "0";
      }
    } catch {
      // ignore
    }
  }

  loopEnabled = loop === "1" || loop === "true";
  shuffleEnabled = shuffle === "1" || shuffle === "true";
}

function savePlaybackPrefs() {
  try {
    localStorage.setItem(
      PLAYBACK_KEY,
      JSON.stringify({ loop: loopEnabled, shuffle: shuffleEnabled }),
    );
  } catch {
    // ignore
  }
}

function syncPlaybackToggles() {
  if (shuffleToggle) {
    shuffleToggle.setAttribute("aria-pressed", shuffleEnabled ? "true" : "false");
    shuffleToggle.title = t("playback.shuffle");
    shuffleToggle.setAttribute("aria-label", t("playback.shuffle"));
  }
  if (loopToggle) {
    loopToggle.setAttribute("aria-pressed", loopEnabled ? "true" : "false");
    loopToggle.title = t("playback.loop");
    loopToggle.setAttribute("aria-label", t("playback.loop"));
  }
  const group = document.querySelector(".playback-toggles");
  group?.setAttribute("aria-label", t("playback.options"));
}

/**
 * @param {string[]} ids
 * @returns {string[]}
 */
function shuffledCopy(ids) {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/**
 * Rebuild the remaining shuffle queue, optionally keeping the current video out.
 * @param {string | null} [excludeId]
 */
function rebuildShuffleQueue(excludeId = activeVideoId) {
  if (!playlist?.videos.length) {
    shuffleQueue = [];
    return;
  }
  const ids = playlist.videos.map((video) => video.id);
  shuffleQueue = shuffledCopy(ids.filter((id) => id !== excludeId));
}

function rememberMeta(videoId, title, author, authorUrl) {
  const prev = knownMeta[videoId] || {};
  const next = {
    title: title || prev.title,
    author: author || prev.author || null,
    authorUrl: authorUrl || prev.authorUrl || null,
  };
  if (
    next.title === prev.title &&
    next.author === prev.author &&
    next.authorUrl === prev.authorUrl
  ) {
    return;
  }
  knownMeta[videoId] = next;
  try {
    localStorage.setItem(META_KEY, JSON.stringify(knownMeta));
  } catch {
    // ignore quota errors
  }
}

function loadYouTubeApi() {
  if (ytApiReady) return ytApiReady;
  ytApiReady = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return ytApiReady;
}

const PLAYER_HOST = "https://www.youtube-nocookie.com";

/**
 * Builds the embed iframe ourselves so `referrerpolicy` is in place before the
 * first load. YouTube refuses embeds that arrive without a Referer header
 * (error 153), and an iframe created by the IFrame API is already loading by the
 * time we could add the attribute.
 * @param {string} path
 * @param {Record<string, string | number>} params
 * @returns {HTMLIFrameElement}
 */
function createEmbedIframe(path, params) {
  const url = new URL(`${PLAYER_HOST}/embed/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
  );
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("frameborder", "0");
  iframe.src = url.toString();
  return iframe;
}

/**
 * @param {string} raw
 * @returns {{ listId: string | null, videoId: string | null }}
 */
function parseYouTubeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { listId: null, videoId: null };

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    if (/^[\w-]{10,}$/.test(trimmed) && trimmed.startsWith("PL")) {
      return { listId: trimmed, videoId: null };
    }
    return { listId: null, videoId: null };
  }

  const host = url.hostname.replace(/^www\./, "");
  const params = url.searchParams;
  let listId = params.get("list");
  let videoId = params.get("v");

  if (host === "youtu.be") {
    videoId = url.pathname.slice(1).split("/")[0] || videoId;
  } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
      if (parts[1] && parts[1] !== "videoseries") {
        videoId = parts[1];
      }
    } else if (parts[0] === "playlist") {
      listId = listId || params.get("list");
    }
  }

  return { listId, videoId };
}

function setStatus(messageOrKey, isError = false, vars = {}, isKey = false) {
  if (!messageOrKey) {
    lastStatus = null;
    playlistStatusEl.hidden = true;
    playlistStatusEl.textContent = "";
    playlistStatusEl.classList.remove("error");
    return;
  }

  lastStatus = isKey
    ? { key: messageOrKey, isError, vars }
    : { message: messageOrKey, isError };
  const text = isKey ? t(messageOrKey, vars) : messageOrKey;
  playlistStatusEl.hidden = false;
  playlistStatusEl.textContent = text;
  playlistStatusEl.classList.toggle("error", isError);
}

function setStatusKey(key, isError = false, vars = {}) {
  setStatus(key, isError, vars, true);
}

function syncUrlState(listId, videoId) {
  const next = new URL(window.location.href);
  next.searchParams.set("list", listId);
  if (hasExplicitLangInUrl()) next.searchParams.set("lang", getLang());
  else next.searchParams.delete("lang");
  if (videoId) next.searchParams.set("v", videoId);
  else next.searchParams.delete("v");
  if (loopEnabled) next.searchParams.set("loop", "1");
  else next.searchParams.delete("loop");
  if (shuffleEnabled) next.searchParams.set("shuffle", "1");
  else next.searchParams.delete("shuffle");
  history.replaceState(null, "", next);
  localStorage.setItem(
    "yt-playlist-wrapper:last",
    JSON.stringify({ listId, videoId, url: urlInput.value }),
  );
}

function thumbnailFor(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function videoFromId(videoId, index) {
  const cached = knownMeta[videoId] || {};
  return {
    id: videoId,
    title: cached.title || t("video.placeholder", { n: index + 1 }),
    author: cached.author || null,
    authorUrl: cached.authorUrl || null,
    thumbnail: thumbnailFor(videoId),
  };
}

function formatCount(n) {
  return t(n === 1 ? "count.one" : "count.other", { n });
}

/**
 * @param {HTMLElement} host
 * @param {string} text
 * @param {string | null} href
 * @param {string} [className]
 */
function setLinkedText(host, text, href, className) {
  host.replaceChildren();
  if (!text) {
    host.textContent = "—";
    return;
  }
  if (!href) {
    host.textContent = text;
    if (className) host.className = className;
    return;
  }
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  if (className) link.className = className;
  host.appendChild(link);
}

function refreshLocalizedUi() {
  applyStaticTranslations();
  syncPlaybackToggles();

  if (lastStatus?.key) {
    setStatusKey(lastStatus.key, lastStatus.isError, lastStatus.vars || {});
  } else if (lastStatus?.message) {
    setStatus(lastStatus.message, lastStatus.isError);
  }

  if (!playlist) {
    playlistTitleEl.textContent = t("playlist.label");
    return;
  }

  if (!playlist.videos.length) {
    playlistTitleEl.textContent = lastStatus?.isError
      ? t("playlist.loadFailed")
      : t("playlist.label");
    return;
  }

  playlistCountEl.textContent = formatCount(playlist.videos.length);
  playlist.videos = playlist.videos.map((video, index) => {
    const cached = knownMeta[video.id] || {};
    return {
      ...video,
      title: cached.title || t("video.placeholder", { n: index + 1 }),
      author: cached.author || video.author,
      authorUrl: cached.authorUrl || video.authorUrl || null,
    };
  });
  playlistTitleEl.textContent = playlist.title || t("playlist.label");
  renderPlaylist(playlist.videos, activeVideoId);
  updateNowPlaying(playlist.videos.find((video) => video.id === activeVideoId));
}

function updateNowPlaying(video) {
  if (!video) {
    currentTitleEl.textContent = "—";
    currentMetaEl.textContent = "—";
    return;
  }
  setLinkedText(currentTitleEl, video.title, watchUrl(video.id));
  setLinkedText(
    currentMetaEl,
    video.author || "YouTube",
    video.authorUrl || null,
    "meta",
  );
}

function renderPlaylist(videos, currentId) {
  playlistEl.replaceChildren();
  const fragment = document.createDocumentFragment();

  videos.forEach((video, index) => {
    const li = document.createElement("li");
    li.className = "playlist-item" + (video.id === currentId ? " active" : "");
    li.dataset.videoId = video.id;
    if (video.id === currentId) {
      li.setAttribute("aria-current", "true");
    }
    li.addEventListener("click", () => playVideo(video.id));

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "playlist-play";
    playBtn.setAttribute("aria-label", video.title);
    playBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      playVideo(video.id);
    });

    const indexEl = document.createElement("span");
    indexEl.className = "index";
    indexEl.textContent = String(index + 1);

    const thumbWrap = document.createElement("span");
    thumbWrap.className = "thumb-wrap";
    const img = document.createElement("img");
    img.src = video.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    thumbWrap.appendChild(img);
    playBtn.append(indexEl, thumbWrap);

    const copy = document.createElement("span");
    copy.className = "item-copy";

    const title = document.createElement("a");
    title.className = "title";
    title.href = watchUrl(video.id);
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = video.title;
    // Primary click plays in-page; modified clicks still open YouTube.
    title.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      playVideo(video.id);
    });
    copy.appendChild(title);

    if (video.author) {
      const author = document.createElement("span");
      author.className = "author";
      author.textContent = video.author;
      copy.appendChild(author);
    }

    li.append(playBtn, copy);
    fragment.appendChild(li);
  });

  playlistEl.appendChild(fragment);
  const active = playlistEl.querySelector(".playlist-item.active");
  active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function markActive(videoId) {
  activeVideoId = videoId;
  playlistEl.querySelectorAll(".playlist-item").forEach((el) => {
    const isActive = el.dataset.videoId === videoId;
    el.classList.toggle("active", isActive);
    if (isActive) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  });
  const video = playlist?.videos.find((item) => item.id === videoId);
  updateNowPlaying(video);
  if (playlist) syncUrlState(playlist.id, videoId);
  const active = playlistEl.querySelector(".playlist-item.active");
  active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function patchPlaylistItem(videoId, title, author, authorUrl) {
  if (!playlist) return;
  const index = playlist.videos.findIndex((item) => item.id === videoId);
  if (index < 0) return;

  const video = playlist.videos[index];
  const nextTitle = title || video.title;
  const nextAuthor = author || video.author;
  const nextAuthorUrl = authorUrl || video.authorUrl;
  if (
    video.title === nextTitle &&
    video.author === nextAuthor &&
    video.authorUrl === nextAuthorUrl
  ) {
    return;
  }

  playlist.videos[index] = {
    ...video,
    title: nextTitle,
    author: nextAuthor,
    authorUrl: nextAuthorUrl,
  };

  const row = playlistEl.querySelector(`[data-video-id="${CSS.escape(videoId)}"]`);
  if (row) {
    const titleEl = row.querySelector(".item-copy .title");
    if (titleEl) {
      titleEl.textContent = nextTitle;
      titleEl.setAttribute("href", watchUrl(videoId));
    }
    const copy = row.querySelector(".item-copy");
    let authorEl = row.querySelector(".item-copy .author");
    if (nextAuthor && copy) {
      if (!authorEl) {
        authorEl = document.createElement("span");
        authorEl.className = "author";
        copy.appendChild(authorEl);
      } else if (authorEl instanceof HTMLAnchorElement) {
        const plain = document.createElement("span");
        plain.className = "author";
        authorEl.replaceWith(plain);
        authorEl = plain;
      }
      authorEl.textContent = nextAuthor;
    }
  }

  if (videoId === activeVideoId) updateNowPlaying(playlist.videos[index]);
}

function applyVideoData(data) {
  const videoId = data?.video_id;
  if (!videoId || !playlist) return;

  const title = data.title || null;
  const author = data.author || null;
  if (title) rememberMeta(videoId, title, author);
  patchPlaylistItem(videoId, title, author);

  if (videoId !== activeVideoId) markActive(videoId);
}

/**
 * Prefetch titles/authors via noembed (CORS-enabled YouTube oEmbed proxy).
 * @param {string[]} ids
 * @param {number} token
 */
async function enrichTitles(ids, token) {
  const missing = ids.filter((id) => !knownMeta[id]?.title);
  if (!missing.length) return;

  const concurrency = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < missing.length) {
      if (token !== metaFetchToken) return;
      const id = missing[cursor++];
      try {
        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        const response = await fetch(
          `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`,
        );
        if (!response.ok) continue;
        const data = await response.json();
        if (token !== metaFetchToken) return;
        if (!data?.title) continue;
        rememberMeta(id, data.title, data.author_name || null, data.author_url || null);
        patchPlaylistItem(id, data.title, data.author_name || null, data.author_url || null);
      } catch {
        // keep placeholder title
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()),
  );
}

/**
 * Public Invidious instances used to read playlist metadata without an API key.
 * Order is preference; first successful response wins. Each attempt is time-boxed
 * so a hung/challenge page can't block the YouTube player fallback.
 */
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://yewtu.be",
  "https://invidious.privacyredirect.com",
];
const INVIDIOUS_TIMEOUT_MS = 10000;

/**
 * @param {string} listId
 * @returns {Promise<{ title: string | null, videos: { id: string, title: string | null, author: string | null, authorUrl: string | null }[] } | null>}
 */
async function fetchPlaylistFromInvidious(listId) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetch(
        `${base}/api/v1/playlists/${encodeURIComponent(listId)}`,
        { signal: AbortSignal.timeout(INVIDIOUS_TIMEOUT_MS) },
      );
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      // Bot-protection / challenge pages often return 200 HTML without CORS.
      if (!contentType.includes("application/json")) continue;
      const data = await response.json();
      const videos = (data.videos || [])
        .map((item) => {
          const id = item?.videoId;
          if (!id || typeof id !== "string") return null;
          let authorUrl = item.authorUrl || null;
          if (authorUrl && !/^https?:/i.test(authorUrl)) {
            authorUrl = `https://www.youtube.com${authorUrl}`;
          } else if (!authorUrl && item.authorId) {
            authorUrl = `https://www.youtube.com/channel/${item.authorId}`;
          }
          return {
            id,
            title: item.title || null,
            author: item.author || null,
            authorUrl,
          };
        })
        .filter(Boolean);
      if (!videos.length) continue;
      return { title: data.title || null, videos };
    } catch {
      // CORS, timeout, network, or non-JSON — try next instance
    }
  }
  return null;
}

/**
 * Reads playlist video ids through a throwaway player. Kept as a fallback when
 * Invidious instances are unreachable. The visible player must not keep playlist
 * context, or YouTube overlays its own next/previous chrome.
 * @param {string} listId
 * @returns {Promise<string[] | null>}
 */
async function fetchPlaylistIdsFromPlayer(listId, timeoutMs = 15000) {
  await loadYouTubeApi();

  const shell = document.createElement("div");
  shell.className = "probe-player";
  const host = createEmbedIframe("videoseries", {
    list: listId,
    enablejsapi: 1,
    origin: window.location.origin,
    autoplay: 0,
    controls: 0,
    disablekb: 1,
    fs: 0,
    modestbranding: 1,
    playsinline: 1,
    rel: 0,
  });
  shell.appendChild(host);
  document.body.appendChild(shell);

  /** @type {YT.Player | null} */
  let probe = null;

  try {
    return await new Promise((resolve) => {
      const started = Date.now();
      let settled = false;

      const finish = (ids) => {
        if (settled) return;
        settled = true;
        resolve(ids);
      };

      const tryRead = () => {
        if (settled || !probe) return false;
        try {
          const ids = probe.getPlaylist?.();
          if (Array.isArray(ids) && ids.length) {
            finish(ids);
            return true;
          }
        } catch {
          // player may not be ready
        }
        return false;
      };

      probe = new YT.Player(host, {
        events: {
          onReady(event) {
            try {
              event.target.cuePlaylist({ list: listId, listType: "playlist" });
            } catch {
              // list may already be loading from the iframe src
            }
            tryRead();
          },
          onStateChange(event) {
            if (
              event.data === YT.PlayerState.CUED ||
              event.data === YT.PlayerState.PLAYING ||
              event.data === YT.PlayerState.PAUSED ||
              event.data === YT.PlayerState.BUFFERING
            ) {
              tryRead();
            }
          },
          onError() {
            // Playlist ids can still become available after a video-level error.
            tryRead();
          },
        },
      });

      const tick = () => {
        if (settled) return;
        if (tryRead()) return;
        if (Date.now() - started >= timeoutMs) {
          finish(null);
          return;
        }
        setTimeout(tick, 250);
      };
      setTimeout(tick, 300);
    });
  } finally {
    try {
      probe?.destroy?.();
    } catch {
      // player may already be torn down
    }
    shell.remove();
  }
}

/**
 * @param {string} listId
 * @returns {Promise<{ title: string | null, videos: { id: string, title: string | null, author: string | null, authorUrl: string | null }[] } | null>}
 */
async function fetchPlaylist(listId) {
  const fromApi = await fetchPlaylistFromInvidious(listId);
  if (fromApi) return fromApi;

  const ids = await fetchPlaylistIdsFromPlayer(listId);
  if (!ids?.length) return null;
  return {
    title: null,
    videos: ids.map((id) => ({
      id,
      title: null,
      author: null,
      authorUrl: null,
    })),
  };
}

function setPlaylistVideos(entries, playlistTitle) {
  if (!playlist) return;

  playlist.videos = entries.map((entry, index) => {
    const id = typeof entry === "string" ? entry : entry.id;
    if (typeof entry !== "string" && entry.title) {
      rememberMeta(id, entry.title, entry.author, entry.authorUrl);
    }
    const cached = knownMeta[id] || {};
    const title =
      (typeof entry === "string" ? null : entry.title) ||
      cached.title ||
      t("video.placeholder", { n: index + 1 });
    const author =
      (typeof entry === "string" ? null : entry.author) || cached.author || null;
    const authorUrl =
      (typeof entry === "string" ? null : entry.authorUrl) ||
      cached.authorUrl ||
      null;
    return {
      id,
      title,
      author,
      authorUrl,
      thumbnail: thumbnailFor(id),
    };
  });

  playlistTitleEl.textContent = playlistTitle || t("playlist.label");
  if (playlistTitle) playlist.title = playlistTitle;
  playlistCountEl.textContent = formatCount(playlist.videos.length);

  const ids = playlist.videos.map((video) => video.id);
  const preferred =
    activeVideoId && ids.includes(activeVideoId) ? activeVideoId : ids[0];
  activeVideoId = preferred;

  renderPlaylist(playlist.videos, preferred);
  updateNowPlaying(playlist.videos.find((video) => video.id === preferred));
  rebuildShuffleQueue(preferred);
  metaFetchToken += 1;
  enrichTitles(ids, metaFetchToken);
}

function stopAtEnd() {
  try {
    player?.stopVideo?.();
  } catch {
    // ignore
  }
}

function playNextVideo() {
  if (!playlist?.videos.length || !activeVideoId) return;
  const videos = playlist.videos;
  const index = videos.findIndex((video) => video.id === activeVideoId);

  if (shuffleEnabled) {
    if (!shuffleQueue.length) {
      if (!loopEnabled) {
        stopAtEnd();
        return;
      }
      rebuildShuffleQueue(activeVideoId);
    }
    const nextId = shuffleQueue.shift();
    if (!nextId) {
      stopAtEnd();
      return;
    }
    playVideo(nextId);
    return;
  }

  if (index < 0) {
    playVideo(videos[0].id);
    return;
  }

  if (index >= videos.length - 1) {
    if (loopEnabled) {
      playVideo(videos[0].id);
      return;
    }
    stopAtEnd();
    return;
  }

  playVideo(videos[index + 1].id);
}

function onPlayerStateChange(event) {
  if (
    event.data === YT.PlayerState.PLAYING ||
    event.data === YT.PlayerState.BUFFERING ||
    event.data === YT.PlayerState.CUED
  ) {
    applyVideoData(event.target.getVideoData?.());
  } else if (event.data === YT.PlayerState.ENDED) {
    playNextVideo();
  }
}

async function ensurePlayer(videoId) {
  await loadYouTubeApi();

  if (player) {
    player.loadVideoById(videoId);
    return;
  }

  const mount = document.getElementById("player");
  const iframe = createEmbedIframe(videoId, {
    enablejsapi: 1,
    origin: window.location.origin,
    autoplay: 0,
    rel: 0,
    modestbranding: 1,
    playsinline: 1,
  });
  iframe.id = "player";
  mount?.replaceWith(iframe);

  await new Promise((resolve) => {
    player = new YT.Player(iframe, {
      events: {
        onReady() {
          resolve();
        },
        onStateChange: onPlayerStateChange,
        onError() {
          setStatusKey("status.playFailed", true);
        },
      },
    });
  });
}

function playVideo(videoId) {
  setStatus("");
  markActive(videoId);
  if (shuffleEnabled) {
    shuffleQueue = shuffleQueue.filter((id) => id !== videoId);
  }
  if (!player) return;
  player.loadVideoById(videoId);
}

async function openPlaylist(rawUrl) {
  const { listId, videoId } = parseYouTubeUrl(rawUrl);
  if (!listId) {
    setStatusKey("status.invalidUrl", true);
    return;
  }

  empty.hidden = true;
  stage.hidden = false;
  setStatusKey("status.loading");
  playlistTitleEl.textContent = t("playlist.label");
  playlistCountEl.textContent = "—";
  playlistEl.replaceChildren();
  updateNowPlaying(null);

  playlist = { id: listId, title: null, videos: [] };
  activeVideoId = videoId;
  metaFetchToken += 1;
  syncUrlState(listId, videoId);

  try {
    const data = await fetchPlaylist(listId);
    if (!data) {
      setStatusKey("status.readFailed", true);
      return;
    }
    setPlaylistVideos(data.videos, data.title);
    await ensurePlayer(activeVideoId);
    setStatus("");
  } catch (error) {
    if (error instanceof Error && error.message) {
      setStatus(error.message, true);
    } else {
      setStatusKey("status.loadFailed", true);
    }
    playlistTitleEl.textContent = t("playlist.loadFailed");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  openPlaylist(urlInput.value);
});

langSelect?.addEventListener("change", () => {
  setLang(langSelect.value);
  refreshLocalizedUi();
});

shuffleToggle?.addEventListener("click", () => {
  shuffleEnabled = !shuffleEnabled;
  savePlaybackPrefs();
  syncPlaybackToggles();
  if (shuffleEnabled) rebuildShuffleQueue(activeVideoId);
  else shuffleQueue = [];
  if (playlist) syncUrlState(playlist.id, activeVideoId);
});

loopToggle?.addEventListener("click", () => {
  loopEnabled = !loopEnabled;
  savePlaybackPrefs();
  syncPlaybackToggles();
  if (playlist) syncUrlState(playlist.id, activeVideoId);
});

function bootstrapFromLocation() {
  // YouTube refuses embeds whose Referer is an IP host (error 150 / UNPLAYABLE).
  // python -m http.server prints 127.0.0.1 — bounce to localhost so local testing works.
  if (window.location.hostname === "127.0.0.1") {
    const next = new URL(window.location.href);
    next.hostname = "localhost";
    window.location.replace(next.toString());
    return;
  }

  initI18n();
  loadPlaybackPrefs();
  syncPlaybackToggles();
  playlistTitleEl.textContent = t("playlist.label");

  const params = new URLSearchParams(window.location.search);
  const list = params.get("list");
  const video = params.get("v");
  const embed = params.get("embed") === "1" || params.get("embed") === "true";

  if (embed) {
    document.body.classList.add("embed");
    form.hidden = true;
    empty.hidden = true;
  }

  if (list) {
    const url = video
      ? `https://www.youtube.com/watch?v=${video}&list=${list}`
      : `https://www.youtube.com/playlist?list=${list}`;
    urlInput.value = url;
    openPlaylist(url);
    return;
  }

  if (embed) {
    setStatusKey("status.embedMissingList", true);
    stage.hidden = false;
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem("yt-playlist-wrapper:last") || "null");
    if (saved?.url) {
      urlInput.value = saved.url;
    }
  } catch {
    // ignore
  }
}

bootstrapFromLocation();
