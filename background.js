import { KEYS, TOOLBAR_ICONS, savePage } from './shared.js';

const BADGE_COLOR = '#666666';
const ERROR_COLOR = '#d32f2f';
const FLASH_MS = 1500;

let flashTimer = null;

/** Show the item count on the toolbar icon, unless the user turned the badge off. */
async function refreshBadge() {
  const { [KEYS.LIST]: list, [KEYS.SHOW_BADGE]: showBadge = true } =
    await chrome.storage.local.get([KEYS.LIST, KEYS.SHOW_BADGE]);
  if (flashTimer) return; // a ✓/✕ is showing; the flash restores the count when it ends
  const count = Array.isArray(list) ? list.length : 0;
  await chrome.action.setBadgeText({ text: showBadge && count ? String(count) : '' });
}

/** Briefly replace the badge with a status symbol, then go back to the count. */
async function flashBadge(text, color = BADGE_COLOR) {
  clearTimeout(flashTimer);
  flashTimer = setTimeout(async () => {
    flashTimer = null;
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await refreshBadge();
  }, FLASH_MS);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeText({ text }),
  ]);
}

/** The service worker can't read prefers-color-scheme, so the popup stores it for us. */
async function applyToolbarIcon(isDark) {
  if (isDark === undefined) {
    ({ [KEYS.DARK_MODE]: isDark } = await chrome.storage.local.get(KEYS.DARK_MODE));
  }
  await chrome.action.setIcon({ path: TOOLBAR_ICONS[isDark ? 'dark' : 'light'] });
}

// Badge text and icon don't survive a browser restart, so restore them.
async function restoreActionState() {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await Promise.all([applyToolbarIcon(), refreshBadge()]);
}

chrome.runtime.onInstalled.addListener(restoreActionState);
chrome.runtime.onStartup.addListener(restoreActionState);

// Every change to the list, from the popup or the shortcut, flows through here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (KEYS.LIST in changes || KEYS.SHOW_BADGE in changes) refreshBadge();
  if (KEYS.DARK_MODE in changes) applyToolbarIcon(Boolean(changes[KEYS.DARK_MODE].newValue));
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-page') return;
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return;
  const result = await savePage({ url: tab.url, title: tab.title });
  await (result === 'invalid' ? flashBadge('✕', ERROR_COLOR) : flashBadge('✓'));
});
