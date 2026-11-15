import { KEYS, getList, updateList, savePage, isSaveableUrl } from './shared.js';

const $ = id => document.getElementById(id);

const el = {
  header: document.querySelector('.header'),
  content: document.querySelector('.content-wrapper'),
  list: $('readingList'),
  count: $('linkCount'),
  empty: $('emptyState'),
  searchBtn: $('searchBtn'),
  searchBox: $('searchContainer'),
  searchInput: $('searchInput'),
  editBtn: $('editMode'),
  doneBtn: $('doneEditing'),
  editHint: $('editModePrompt'),
  sortBtn: $('sortBtn'),
  addBtn: $('saveButton'),
  addPrompt: $('titlePrompt'),
  addInput: $('titlePromptInput'),
  settingsBtn: $('settingsBtn'),
  settings: $('settingsPanel'),
  settingsBack: $('settingsBack'),
  showBadge: $('settingsShowBadge'),
  fontSelect: $('fontSelect'),
  exportLinks: [$('downloadJson'), $('settingsDownload')],
  importBtn: $('uploadButton'),
  importFile: $('uploadJson'),
  clearBtn: $('settingsClearAll'),
  confirmDialog: $('confirmDialog'),
  confirmMessage: $('confirmMessage'),
  toast: $('toast'),
};

const state = {
  items: [],          // the stored list, unsorted
  newestFirst: true,
  query: '',
  editing: false,
  pendingPage: null,  // { url, pageTitle } while the "add page" prompt is open
  shortcut: '',       // e.g. "⇧⌘L", shown in the empty state
};

const darkScheme = matchMedia('(prefers-color-scheme: dark)');

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

init().catch(error => console.error('Read Later: popup failed to start', error));

async function init() {
  bindEvents();
  syncTheme();

  const [stored, commands] = await Promise.all([
    chrome.storage.local.get([KEYS.LIST, KEYS.NEWEST_FIRST, KEYS.SHOW_BADGE, KEYS.FONT]),
    chrome.commands.getAll(),
  ]);
  state.items = asList(stored[KEYS.LIST]);
  state.newestFirst = stored[KEYS.NEWEST_FIRST] !== false;
  state.shortcut = commands.find(c => c.name === 'save-page')?.shortcut ?? '';
  el.showBadge.checked = stored[KEYS.SHOW_BADGE] !== false;
  applyFont(stored[KEYS.FONT]);
  updateSortButton();
  render();

  // Single source of truth: every change to the list (from here or from the
  // keyboard shortcut) is stored first and rendered from this listener.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(KEYS.LIST in changes)) return;
    state.items = asList(changes[KEYS.LIST].newValue);
    render();
  });
}

function bindEvents() {
  el.searchBtn.addEventListener('click', () => setSearchOpen(el.searchBox.hidden));
  el.searchInput.addEventListener('input', debounce(() => {
    state.query = el.searchInput.value;
    render();
  }, 100));

  el.editBtn.addEventListener('click', () => setEditing(true));
  el.doneBtn.addEventListener('click', () => setEditing(false));
  el.sortBtn.addEventListener('click', toggleSort);
  el.addBtn.addEventListener('click', promptForCurrentPage);

  el.list.addEventListener('click', onListClick);
  el.list.addEventListener('auxclick', onListClick);
  // Favicon errors don't bubble, so listen in the capture phase.
  el.list.addEventListener('error', e => e.target.classList?.add('missing'), true);

  el.addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      closeAddPrompt({ save: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAddPrompt({ save: false });
    }
  });
  el.addInput.addEventListener('blur', () => closeAddPrompt({ save: true }));

  el.settingsBtn.addEventListener('click', () => setSettingsOpen(true));
  el.settingsBack.addEventListener('click', () => setSettingsOpen(false));
  el.showBadge.addEventListener('change', () =>
    chrome.storage.local.set({ [KEYS.SHOW_BADGE]: el.showBadge.checked }));
  el.fontSelect.addEventListener('change', () => {
    applyFont(el.fontSelect.value);
    chrome.storage.local.set({ [KEYS.FONT]: el.fontSelect.value });
  });

  for (const link of el.exportLinks) {
    link.addEventListener('click', e => {
      e.preventDefault();
      exportList();
    });
  }
  el.importBtn.addEventListener('click', e => {
    e.preventDefault();
    el.importFile.click();
  });
  el.importFile.addEventListener('change', () => {
    const [file] = el.importFile.files;
    el.importFile.value = ''; // allow re-importing the same file
    if (file) importList(file);
  });

  el.clearBtn.addEventListener('click', confirmClearAll);
  el.confirmDialog.addEventListener('close', () => {
    if (el.confirmDialog.returnValue === 'confirm') updateList(() => []);
  });
  // A click on the dialog element itself (not its contents) is a backdrop click.
  el.confirmDialog.addEventListener('click', e => {
    if (e.target === el.confirmDialog) el.confirmDialog.close();
  });

  document.addEventListener('keydown', onEscape);
  darkScheme.addEventListener('change', syncTheme);
}

// ---------------------------------------------------------------- rendering

function render() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = sortByDate(state.items, state.newestFirst).filter(item => matches(item, terms));

  const fragment = document.createDocumentFragment();
  for (const item of visible) fragment.append(renderItem(item));
  el.list.replaceChildren(fragment);

  el.count.textContent = terms.length
    ? `${visible.length}/${state.items.length}`
    : String(state.items.length);

  el.empty.hidden = visible.length > 0;
  if (!visible.length) {
    el.empty.textContent = state.items.length
      ? 'No matching items'
      : `Nothing saved yet. Click + ${state.shortcut ? `or press ${state.shortcut} ` : ''}to save the current page.`;
  }
}

function renderItem(item) {
  const title = item.title || item.url;

  const row = document.createElement('div');
  row.className = 'reading-item';
  row.dataset.url = item.url; // the exact stored URL; link.href would normalize it

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-btn';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.setAttribute('aria-label', `Remove ${title}`);

  const icon = document.createElement('img');
  icon.className = 'site-icon';
  icon.alt = '';
  icon.loading = 'lazy';
  const iconSrc = faviconUrl(item.url);
  if (iconSrc) icon.src = iconSrc;
  else icon.classList.add('missing');

  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.textContent = title;
  link.title = [
    item.originalTitle || title,
    '',
    `Added: ${formatDate(item.date)}`,
    `Last Opened: ${item.lastOpened ? formatDate(item.lastOpened) : 'Never'}`,
  ].join('\n');

  row.append(remove, icon, link);
  return row;
}

function matches(item, terms) {
  if (!terms.length) return true;
  const haystack = `${item.title ?? ''}\n${item.originalTitle ?? ''}\n${item.url}`.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function sortByDate(items, newestFirst) {
  const time = item => Date.parse(item.date) || 0;
  const direction = newestFirst ? -1 : 1;
  return [...items].sort((a, b) => direction * (time(a) - time(b)));
}

function faviconUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (!hostname || (protocol !== 'http:' && protocol !== 'https:')) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  } catch {
    return '';
  }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : dateFormat.format(date);
}

// ------------------------------------------------------------------- items

function onListClick(event) {
  const row = event.target.closest('.reading-item');
  if (!row) return;
  const { url } = row.dataset;
  const link = event.target.closest('a');
  const isMiddleClick = event.type === 'auxclick';
  if (isMiddleClick && (event.button !== 1 || !link)) return;

  if (!isMiddleClick && event.target.closest('.delete-btn')) {
    removeItem(url);
    return;
  }
  if (!link) return;

  event.preventDefault();
  if (state.editing) startRename(row, link);
  else openItem(url, { background: isMiddleClick || event.metaKey || event.ctrlKey });
}

async function openItem(url, { background = false } = {}) {
  const now = new Date().toISOString();
  // Write before opening: an active tab closes the popup and would cut the write off.
  await updateList(list => list.map(item => (item.url === url ? { ...item, lastOpened: now } : item)));
  await chrome.tabs.create({ url, active: !background });
}

function removeItem(url) {
  return updateList(list => list.filter(item => item.url !== url));
}

function startRename(row, link) {
  if (row.querySelector('.edit-input')) return;
  const { url } = row.dataset;
  const original = link.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = original;
  input.setAttribute('aria-label', 'Title');
  link.hidden = true;
  link.before(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async save => {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    if (save && title && title !== original) {
      await updateList(list => list.map(item => (item.url === url ? { ...item, title } : item)));
      link.textContent = title;
    }
    // On a real change the storage listener re-renders the row anyway.
    input.remove();
    link.hidden = false;
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // cancel the rename, but stay in edit mode
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------------------------------------------------------- add a new page

async function promptForCurrentPage() {
  if (state.pendingPage) {
    el.addInput.focus();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSaveableUrl(tab.url)) {
    toast("This page can't be saved", { error: true });
    return;
  }
  if (state.items.some(item => item.url === tab.url)) {
    toast('Already in your list');
    return;
  }
  state.pendingPage = { url: tab.url, pageTitle: tab.title || tab.url };
  el.addInput.value = state.pendingPage.pageTitle;
  el.addPrompt.hidden = false;
  el.addInput.focus();
  el.addInput.select();
}

async function closeAddPrompt({ save }) {
  const page = state.pendingPage;
  if (!page) return;
  state.pendingPage = null;
  el.addPrompt.hidden = true;
  if (!save) return;
  const title = el.addInput.value.trim() || page.pageTitle;
  const result = await savePage({ url: page.url, title, pageTitle: page.pageTitle });
  if (result === 'exists') toast('Already in your list');
}

// --------------------------------------------------------- header controls

function setSearchOpen(open) {
  el.searchBox.hidden = !open;
  el.searchBtn.setAttribute('aria-pressed', String(open));
  if (open) {
    el.searchInput.focus();
  } else if (state.query || el.searchInput.value) {
    el.searchInput.value = '';
    state.query = '';
    render();
  }
}

function setEditing(on) {
  state.editing = on;
  el.list.classList.toggle('edit-mode', on);
  el.editBtn.hidden = on;
  el.doneBtn.hidden = !on;
  el.editHint.hidden = !on;
}

function toggleSort() {
  state.newestFirst = !state.newestFirst;
  updateSortButton();
  render();
  chrome.storage.local.set({ [KEYS.NEWEST_FIRST]: state.newestFirst });
}

function updateSortButton() {
  el.sortBtn.title = state.newestFirst ? 'Sort by oldest first' : 'Sort by newest first';
}

function onEscape(event) {
  if (event.key !== 'Escape' || el.confirmDialog.open) return; // the dialog handles its own
  if (el.settings.classList.contains('open')) setSettingsOpen(false);
  else if (!el.searchBox.hidden) setSearchOpen(false);
  else if (state.editing) setEditing(false);
  else return; // nothing to close: let Escape close the popup
  event.preventDefault();
}

// ---------------------------------------------------------------- settings

function setSettingsOpen(open) {
  el.settings.classList.toggle('open', open);
  // Keep keyboard focus out of the list while settings cover it.
  el.header.inert = open;
  el.content.inert = open;
}

function applyFont(value) {
  const options = [...el.fontSelect.options];
  const option = options.find(o => o.value === value) ?? options[0];
  el.fontSelect.value = option.value;
  loadWebFont(option.dataset.googleFont);
  document.documentElement.style.setProperty('--list-font', option.value);
}

/** Fetch a Google Font only once someone picks it, instead of on every popup open. */
function loadWebFont(family) {
  if (!family || document.querySelector(`link[data-font="${family}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  link.dataset.font = family;
  document.head.append(link);
}

async function exportList() {
  const blob = new Blob([JSON.stringify(await getList(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `readlater-list-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importList(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("That file isn't valid JSON", { error: true });
    return;
  }
  const incoming = Array.isArray(data) ? data.map(normalizeImportedItem).filter(Boolean) : [];
  if (!incoming.length) {
    toast('No valid items found in that file', { error: true });
    return;
  }

  let added = 0;
  await updateList(list => {
    const known = new Set(list.map(item => item.url));
    const fresh = [];
    for (const item of incoming) {
      if (known.has(item.url)) continue; // already saved, or repeated within the file
      known.add(item.url);
      fresh.push(item);
    }
    added = fresh.length;
    return added ? [...list, ...fresh] : list;
  });
  toast(added ? `Imported ${added} new item${added === 1 ? '' : 's'}` : 'Everything in that file is already saved');
}

/** Accept only well-formed entries with a safe URL; fill in what's missing. */
function normalizeImportedItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string' || !isSaveableUrl(raw.url)) return null;
  const isDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
  const item = {
    url: raw.url,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : raw.url,
    date: isDate(raw.date) ? raw.date : new Date().toISOString(),
  };
  if (typeof raw.originalTitle === 'string') item.originalTitle = raw.originalTitle;
  if (isDate(raw.lastOpened)) item.lastOpened = raw.lastOpened;
  return item;
}

function confirmClearAll() {
  const count = state.items.length;
  if (!count) {
    toast('Your list is already empty');
    return;
  }
  el.confirmMessage.textContent = count === 1
    ? 'Are you sure you want to delete the 1 saved item? This cannot be undone.'
    : `Are you sure you want to delete all ${count} items? This cannot be undone.`;
  el.confirmDialog.returnValue = '';
  el.confirmDialog.showModal();
}

// -------------------------------------------------------------------- misc

/** The toolbar icon lives in the service worker, which can't see the color scheme. */
async function syncTheme() {
  const isDark = darkScheme.matches;
  const { [KEYS.DARK_MODE]: stored } = await chrome.storage.local.get(KEYS.DARK_MODE);
  if (stored !== isDark) await chrome.storage.local.set({ [KEYS.DARK_MODE]: isDark });
}

let toastTimer;
function toast(message, { error = false } = {}) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', error);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2500);
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
