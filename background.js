// Cache icon paths and badge colors
const THEME = {
  ICONS: {
    light: {
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
      "256": "icons/icon-256.png"
    },
    dark: {
      "48": "icons/icon-48-dark.png",
      "128": "icons/icon-128-dark.png",
      "256": "icons/icon-256-dark.png"
    }
  },
  COLORS: {
    light: '#666666',
    dark: '#9aa0a6'
  }
};

// Cache states
const state = {
  iconTheme: null,
  badgeText: '',
  badgeColor: '',
  updateTimeout: null,
  pendingUpdates: new Set()
};

// Optimize icon and badge updates
const extensionUI = {
  async updateIcon(isDark) {
    if (state.iconTheme === isDark) return;
    
    state.iconTheme = isDark;
    await Promise.all([
      chrome.action.setIcon({
        path: isDark ? THEME.ICONS.dark : THEME.ICONS.light
      }),
      chrome.action.setBadgeBackgroundColor({ 
        color: isDark ? THEME.COLORS.dark : THEME.COLORS.light
      })
    ]);
  },

  async updateBadge(text, color) {
    const updates = [];
    
    if (text !== state.badgeText) {
      state.badgeText = text;
      updates.push(chrome.action.setBadgeText({ text }));
    }
    
    if (color !== state.badgeColor) {
      state.badgeColor = color;
      updates.push(chrome.action.setBadgeBackgroundColor({ color }));
    }
    
    if (updates.length) {
      await Promise.all(updates);
    }
  },

  scheduleBadgeUpdate(text, color) {
    if (state.updateTimeout) {
      clearTimeout(state.updateTimeout);
    }
    
    state.updateTimeout = setTimeout(() => {
      this.updateBadge(text, color);
      state.updateTimeout = null;
    }, 16);
  }
};

// Cached storage operations
const storage = {
  async get(keys) {
    return new Promise(resolve => {
      // Handle both single key and array of keys
      const keysToGet = Array.isArray(keys) ? keys : (keys ? [keys] : null);
      chrome.storage.local.get(keysToGet, resolve);
    });
  },
  
  async set(data) {
    return new Promise(resolve => {
      chrome.storage.local.set(data, resolve);
    });
  }
};

// Main functions
async function handleThemeChange() {
  const result = await storage.get('isDarkMode');
  await extensionUI.updateIcon(result.isDarkMode);
}

async function updateBadgeCount() {
  const result = await storage.get(['readingList', 'showBadge']);
  const count = (result.readingList || []).length;
  const showBadge = result.showBadge !== false;
  const text = showBadge && count > 0 ? count.toString() : '';
  
  extensionUI.scheduleBadgeUpdate(text, THEME.COLORS.light);
}

async function saveCurrentPage(tab) {
  const result = await storage.get(['readingList', 'showBadge']);
  const readingList = result.readingList || [];
  const showBadge = result.showBadge !== false;
  
  if (readingList.some(item => item.url === tab.url)) return;
  
  readingList.push({
    url: tab.url,
    title: tab.title,
    date: new Date().toISOString()
  });
  
  await storage.set({ readingList });
  
  // Show checkmark feedback
  await extensionUI.updateBadge('✓', THEME.COLORS.light);
  
  // Reset badge after delay
  setTimeout(async () => {
    const text = showBadge ? readingList.length.toString() : '';
    await extensionUI.updateBadge(text, THEME.COLORS.light);
  }, 2000);
}

// Event listeners
chrome.runtime.onStartup.addListener(async () => {
  await handleThemeChange();
  await updateBadgeCount();
});

chrome.runtime.onInstalled.addListener(async () => {
  await handleThemeChange();
  await updateBadgeCount();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'themeChanged') {
    handleThemeChange().then(() => sendResponse({ success: true }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "save-page") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await saveCurrentPage(tab);
    }
  }
});
  