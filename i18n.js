/** @typedef {Record<string, string>} LocaleDict */

/** @type {Record<string, LocaleDict>} */
export const locales = {
  en: {
    "doc.title": "Playlist Wrapper",
    "form.label": "YouTube playlist URL",
    "form.placeholder": "YouTube playlist URL",
    "form.submit": "Open",
    "empty.hint": "Paste a playlist URL (any link with a {list} parameter).",
    "playlist.label": "Playlist",
    "playlist.aria": "Playlist",
    "status.loading": "Loading playlist…",
    "status.invalidUrl":
      "That doesn’t look like a playlist URL. Include a list=… parameter.",
    "status.readFailed":
      "Couldn’t read this playlist from YouTube. Check the link and try again.",
    "status.loadFailed": "Failed to load playlist",
    "status.playFailed":
      "This video couldn’t be played. Try another item in the playlist.",
    "status.embedMissingList": "Missing playlist id. Use ?embed=1&list=PL…",
    "playlist.loadFailed": "Couldn’t load playlist",
    "count.one": "{n} video",
    "count.other": "{n} videos",
    "video.placeholder": "Video {n}",
    "lang.label": "Language",
    "lang.auto": "Auto (browser)",
    "playback.shuffle": "Shuffle",
    "playback.loop": "Loop",
    "playback.options": "Playback options",
  },
  "zh-TW": {
    "doc.title": "播放清單",
    "form.label": "YouTube 播放清單網址",
    "form.placeholder": "YouTube 播放清單網址",
    "form.submit": "開啟",
    "empty.hint": "貼上播放清單網址（需包含 {list} 參數）。",
    "playlist.label": "播放清單",
    "playlist.aria": "播放清單",
    "status.loading": "正在載入播放清單…",
    "status.invalidUrl": "這不像是播放清單網址。請包含 list=… 參數。",
    "status.readFailed": "無法從 YouTube 讀取此播放清單。請檢查網址後再試一次。",
    "status.loadFailed": "載入播放清單失敗",
    "status.playFailed": "無法播放此影片。請改選清單中的其他項目。",
    "status.embedMissingList": "缺少播放清單 id。請使用 ?embed=1&list=PL…",
    "playlist.loadFailed": "無法載入播放清單",
    "count.one": "{n} 部影片",
    "count.other": "{n} 部影片",
    "video.placeholder": "影片 {n}",
    "lang.label": "語言",
    "lang.auto": "自動（瀏覽器）",
    "playback.shuffle": "隨機播放",
    "playback.loop": "循環播放",
    "playback.options": "播放選項",
  },
  "zh-CN": {
    "doc.title": "播放列表",
    "form.label": "YouTube 播放列表链接",
    "form.placeholder": "YouTube 播放列表链接",
    "form.submit": "打开",
    "empty.hint": "粘贴播放列表链接（需包含 {list} 参数）。",
    "playlist.label": "播放列表",
    "playlist.aria": "播放列表",
    "status.loading": "正在加载播放列表…",
    "status.invalidUrl": "这不像是播放列表链接。请包含 list=… 参数。",
    "status.readFailed": "无法从 YouTube 读取此播放列表。请检查链接后重试。",
    "status.loadFailed": "加载播放列表失败",
    "status.playFailed": "无法播放此视频。请改选列表中的其他项目。",
    "status.embedMissingList": "缺少播放列表 id。请使用 ?embed=1&list=PL…",
    "playlist.loadFailed": "无法加载播放列表",
    "count.one": "{n} 个视频",
    "count.other": "{n} 个视频",
    "video.placeholder": "视频 {n}",
    "lang.label": "语言",
    "lang.auto": "自动（浏览器）",
    "playback.shuffle": "随机播放",
    "playback.loop": "循环播放",
    "playback.options": "播放选项",
  },
};

const LANG_KEY = "yt-playlist-wrapper:lang";
const DEFAULT_LANG = "en";

/** @type {string} */
let currentLang = DEFAULT_LANG;
/** @type {"auto" | string} preference shown in the picker */
let langPreference = "auto";

/**
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeLang(raw) {
  if (!raw) return null;
  const value = raw.trim().replace(/_/g, "-");
  if (value.toLowerCase() === "auto") return "auto";
  if (locales[value]) return value;

  const lower = value.toLowerCase();
  if (
    lower === "zh-hant" ||
    lower.startsWith("zh-hant") ||
    lower.startsWith("zh-tw") ||
    lower === "zh-hk" ||
    lower.startsWith("zh-hk") ||
    lower === "zh-mo" ||
    lower.startsWith("zh-mo")
  ) {
    return "zh-TW";
  }
  if (
    lower === "zh-hans" ||
    lower.startsWith("zh-hans") ||
    lower.startsWith("zh-cn") ||
    lower === "zh-sg" ||
    lower.startsWith("zh-sg") ||
    lower === "zh"
  ) {
    return "zh-CN";
  }
  const base = lower.split("-")[0];
  if (base === "en") return "en";
  return null;
}

/**
 * @returns {string}
 */
export function browserLang() {
  const candidates = [...(navigator.languages || []), navigator.language, navigator.userLanguage];
  for (const candidate of candidates) {
    const match = normalizeLang(candidate || "");
    if (match && match !== "auto") return match;
  }
  return DEFAULT_LANG;
}

/**
 * Resolve active UI language from query → saved preference → browser.
 * @returns {{ lang: string, preference: "auto" | string }}
 */
export function detectLang() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = normalizeLang(params.get("lang") || "");
  if (fromQuery && fromQuery !== "auto") {
    return { lang: fromQuery, preference: fromQuery };
  }
  if (fromQuery === "auto") {
    return { lang: browserLang(), preference: "auto" };
  }

  try {
    const saved = normalizeLang(localStorage.getItem(LANG_KEY) || "");
    if (saved && saved !== "auto") {
      return { lang: saved, preference: saved };
    }
  } catch {
    // ignore
  }

  return { lang: browserLang(), preference: "auto" };
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function t(key, vars = {}) {
  const dict = locales[currentLang] || locales[DEFAULT_LANG];
  const fallback = locales[DEFAULT_LANG];
  let text = dict[key] ?? fallback[key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/**
 * @returns {string}
 */
export function getLang() {
  return currentLang;
}

/**
 * @returns {"auto" | string}
 */
export function getLangPreference() {
  return langPreference;
}

/**
 * Whether the URL should carry an explicit lang= override.
 * @returns {boolean}
 */
export function hasExplicitLangInUrl() {
  return langPreference !== "auto";
}

/**
 * @param {string} langOrAuto
 * @param {{ persist?: boolean, syncUrl?: boolean }} [options]
 */
export function setLang(langOrAuto, options = {}) {
  const normalized = normalizeLang(langOrAuto) || "auto";
  langPreference = normalized === "auto" ? "auto" : normalized;
  currentLang = langPreference === "auto" ? browserLang() : langPreference;
  document.documentElement.lang = currentLang;

  if (options.persist !== false) {
    try {
      if (langPreference === "auto") localStorage.removeItem(LANG_KEY);
      else localStorage.setItem(LANG_KEY, langPreference);
    } catch {
      // ignore
    }
  }

  if (options.syncUrl !== false) {
    const url = new URL(window.location.href);
    if (langPreference === "auto") url.searchParams.delete("lang");
    else url.searchParams.set("lang", langPreference);
    history.replaceState(null, "", url);
  }

  applyStaticTranslations();
}

export function applyStaticTranslations() {
  document.title = t("doc.title");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const mode = el.getAttribute("data-i18n-mode") || "text";
    if (mode === "html") {
      el.innerHTML = t(key, { list: "<code>list</code>" });
    } else {
      el.textContent = t(key);
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key || !("placeholder" in el)) return;
    el.placeholder = t(key);
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    if (!key) return;
    el.setAttribute("aria-label", t(key));
  });

  const select = document.getElementById("lang-select");
  if (select instanceof HTMLSelectElement) {
    const autoOption = select.querySelector('option[value="auto"]');
    if (autoOption) autoOption.textContent = t("lang.auto");
    select.value = langPreference;
    select.setAttribute("aria-label", t("lang.label"));
  }
}

export function initI18n() {
  const detected = detectLang();
  langPreference = detected.preference;
  currentLang = detected.lang;
  document.documentElement.lang = currentLang;
  applyStaticTranslations();
}
