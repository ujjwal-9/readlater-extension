// Shared by the service worker (background.js) and the popup (popup.js).

export const KEYS = Object.freeze({
  LIST: 'readingList',
  SHOW_BADGE: 'showBadge',
  DARK_MODE: 'isDarkMode',
  NEWEST_FIRST: 'newestFirst',
  FONT: 'fontFamily',
});

export const TOOLBAR_ICONS = Object.freeze({
  light: { 48: 'icons/icon-48.png', 128: 'icons/icon-128.png', 256: 'icons/icon-256.png' },
  dark: { 48: 'icons/icon-48-dark.png', 128: 'icons/icon-128-dark.png', 256: 'icons/icon-256-dark.png' },
});

const SAVEABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

/** Only real pages can be saved. This also keeps javascript:/data: URLs out of imports. */
export function isSaveableUrl(url) {
  try {
    return SAVEABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function getList() {
  const { [KEYS.LIST]: list } = await chrome.storage.local.get(KEYS.LIST);
  return Array.isArray(list) ? list : [];
}

/**
 * Read-modify-write the reading list. `update` receives the stored list and
 * returns the next one; returning the same array skips the write.
 */
export async function updateList(update) {
  const list = await getList();
  const next = update(list);
  if (next !== list) await chrome.storage.local.set({ [KEYS.LIST]: next });
  return next;
}

/**
 * Add a page unless it is already saved.
 * @returns {Promise<'added' | 'exists' | 'invalid'>}
 */
export async function savePage({ url, title, pageTitle = title }) {
  if (!isSaveableUrl(url)) return 'invalid';
  let result = 'exists';
  await updateList(list => {
    if (list.some(item => item.url === url)) return list;
    result = 'added';
    return [...list, {
      url,
      title: title || pageTitle || url,
      originalTitle: pageTitle || url,
      date: new Date().toISOString(),
    }];
  });
  return result;
}
