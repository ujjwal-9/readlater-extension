// Constants
const STORAGE_KEYS = {
  READING_LIST: 'readingList',
  SHOW_BADGE: 'showBadge',
  IS_DARK_MODE: 'isDarkMode'
};

// Core initialization
document.addEventListener('DOMContentLoaded', function() {
  loadItems();
  updateBadge();
  updateTheme();

  // Theme change listener
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', updateTheme);

  setupEventListeners();
});

function setupEventListeners() {
  // Save current page
  document.getElementById('saveButton')?.addEventListener('click', saveCurrentPage);

  // Search functionality
  document.getElementById('searchBtn')?.addEventListener('click', toggleSearch);
  document.getElementById('searchInput')?.addEventListener('input', e => filterItems(e.target.value));

  // Edit mode
  document.getElementById('editMode')?.addEventListener('click', enterEditMode);
  document.getElementById('doneEditing')?.addEventListener('click', exitEditMode);

  // Settings panel
  document.getElementById('settingsBtn')?.addEventListener('click', showSettingsPanel);
  document.getElementById('settingsBack')?.addEventListener('click', hideSettingsPanel);
  document.getElementById('settingsShowBadge')?.addEventListener('change', handleBadgeToggle);
  document.getElementById('settingsClearAll')?.addEventListener('click', handleClearAll);

  // Download/Upload
  document.getElementById('downloadJson')?.addEventListener('click', downloadReadingList);
  document.getElementById('settingsDownload')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('downloadJson')?.click();
  });
}

// Theme Management
function updateTheme() {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  chrome.storage.local.set({ isDarkMode }, function() {
    chrome.runtime.sendMessage({ type: 'themeChanged', isDarkMode });
    
    chrome.action.setBadgeBackgroundColor({ 
      color: isDarkMode ? '#9aa0a6' : '#666666'
    });

    // Define all available icons with their light/dark variants
    const iconMappings = {
      'headerLogo': {
        selector: '#headerLogo',
        light: 'icons/icon-256.png',
        dark: 'icons/icon-256-dark.png'
      },
      'search': {
        selector: '#searchBtn img[alt="Search"]',
        light: 'icons/search.png',
        dark: 'icons/search-dark.png'
      },
      'edit': {
        selector: '#editMode img[alt="Edit"]',
        light: 'icons/edit.png',
        dark: 'icons/edit-dark.png'
      },
      'done': {
        selector: '#doneEditing img[alt="Done"]',
        light: 'icons/done.png',
        dark: 'icons/done-dark.png'
      },
      'search-icon': {
        selector: '.search-icon',
        light: 'icons/search.png',
        dark: 'icons/search-dark.png'
      },
      'sort': {
        selector: '#sortBtn img[alt="Sort"]',
        light: 'icons/sort.png',
        dark: 'icons/sort-dark.png'
      },
      'settings': {
        selector: '#settingsBtn img[alt="Settings"]',
        light: 'icons/settings.png',
        dark: 'icons/settings-dark.png'
      },
      'add': {
        selector: '#saveButton img[alt="Add"]',
        light: 'icons/add.png',
        dark: 'icons/add-dark.png'
      },
      'back': {
        selector: '#settingsBack img[alt="Back"]',
        light: 'icons/back.png',
        dark: 'icons/back-dark.png'
      },
      'backup': {
        selector: 'img[alt="Backup"]',
        light: 'icons/backup.png',
        dark: 'icons/backup-dark.png'
      },
      'restore': {
        selector: 'img[alt="Restore"]',
        light: 'icons/restore.png',
        dark: 'icons/restore-dark.png'
      },
      'clearall': {
        selector: 'img[alt="Clear All"]',
        light: 'icons/clearall.png',
        dark: 'icons/clearall-dark.png'
      }
    };

    // Update each icon based on theme
    Object.values(iconMappings).forEach(icon => {
      const elements = document.querySelectorAll(icon.selector);
      elements.forEach(element => {
        if (element) {
          const newSrc = isDarkMode ? icon.dark : icon.light;
          if (!element.src.endsWith(newSrc)) {
            element.src = newSrc;
          }
        }
      });
    });
  });
}

// Search Functionality
function toggleSearch() {
  const searchContainer = document.getElementById('searchContainer');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  
  const isHidden = searchContainer.style.display === 'none' || !searchContainer.style.display;
  
  searchContainer.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    searchInput?.focus();
    searchBtn?.classList.add('active');
  } else {
    searchInput.value = '';
    filterItems('');
    searchBtn?.classList.remove('active');
  }
}

function filterItems(searchTerm) {
  const items = document.querySelectorAll('.reading-item');
  const searchLower = searchTerm.toLowerCase();
  let visibleCount = 0;
  
  items.forEach(item => {
    const link = item.querySelector('a');
    const isVisible = link?.textContent.toLowerCase().includes(searchLower) || 
                     link?.href.toLowerCase().includes(searchLower);
    
    item.classList.toggle('hidden', !isVisible);
    if (isVisible) visibleCount++;
  });
  
  updateItemCount(searchTerm ? `${visibleCount}/${items.length}` : items.length);
}

// Reading List Management
function loadItems() {
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST], function(result) {
    const readingList = result.readingList || [];
    const container = document.getElementById('readingList');
    
    updateItemCount(readingList.length);
    container.innerHTML = '';

    readingList.forEach(item => createReadingItem(item, container));
    resetSearch();
  });
}

function createReadingItem(item, container) {
  const div = document.createElement('div');
  div.className = 'reading-item';
  
  const deleteBtn = createDeleteButton(() => removeItem(item.url));
  const favicon = createFavicon(item.url);
  const link = createItemLink(item);
  
  div.append(deleteBtn, favicon, link);
  container.appendChild(div);
}

function createDeleteButton(onDelete) {
  const btn = document.createElement('button');
  btn.className = 'delete-btn';
  btn.innerHTML = '&times;';
  btn.onclick = onDelete;
  return btn;
}

function createFavicon(url) {
  const favicon = document.createElement('img');
  favicon.className = 'site-icon';
  
  try {
    const urlObj = new URL(url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}`;
    favicon.onerror = () => favicon.style.display = 'none';
  } catch {
    favicon.style.display = 'none';
  }
  
  return favicon;
}

function createItemLink(item) {
  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.textContent = item.title || item.url;
  
  link.addEventListener('click', function(e) {
    e.preventDefault();
    window.open(item.url, '_blank');
  });
  
  return link;
}

function removeItem(url) {
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST], function(result) {
    const readingList = result.readingList || [];
    const updatedList = readingList.filter(item => item.url !== url);
    
    chrome.storage.local.set({
      [STORAGE_KEYS.READING_LIST]: updatedList
    }, function() {
      loadItems();
      updateBadge();
    });
  });
}

function updateBadge() {
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST, STORAGE_KEYS.SHOW_BADGE], function(result) {
    const count = (result.readingList || []).length;
    const showBadge = result.showBadge !== false;
    
    chrome.action.setBadgeText({ 
      text: showBadge && count > 0 ? count.toString() : '' 
    });
  });
}

// Helper Functions
function updateItemCount(count) {
  const linkCount = document.getElementById('linkCount');
  if (linkCount) {
    linkCount.textContent = count;
  }
}

function resetSearch() {
  const searchContainer = document.getElementById('searchContainer');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  
  if (searchInput) {
    searchInput.value = '';
    searchContainer.style.display = 'none';
    searchBtn?.classList.remove('active');
  }
  filterItems('');
}

// Settings Panel Functions
function showSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  panel.style.display = 'block';
  setTimeout(() => panel.classList.add('show'), 0);
}

function hideSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  panel.classList.remove('show');
  setTimeout(() => panel.style.display = 'none', 300);
}

function handleBadgeToggle(e) {
  chrome.storage.local.set({ 
    [STORAGE_KEYS.SHOW_BADGE]: e.target.checked 
  }, updateBadge);
}

function handleClearAll() {
  if (confirm('Are you sure you want to delete all items? This cannot be undone.')) {
    chrome.storage.local.set({
      [STORAGE_KEYS.READING_LIST]: []
    }, function() {
      loadItems();
      updateBadge();
    });
  }
}

// Edit Mode Functions
function enterEditMode() {
  document.getElementById('editMode').style.display = 'none';
  document.getElementById('doneEditing').style.display = 'inline-block';
  document.getElementById('readingList').classList.add('edit-mode');
  document.getElementById('editModePrompt').classList.add('show');
}

function exitEditMode() {
  document.getElementById('editMode').style.display = 'inline-block';
  document.getElementById('doneEditing').style.display = 'none';
  document.getElementById('readingList').classList.remove('edit-mode');
  document.getElementById('editModePrompt').classList.remove('show');
}

// Save Page Functions
function saveCurrentPage() {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    showTitlePrompt(currentTab.url, currentTab.title);
  });
}

function showTitlePrompt(url, defaultTitle) {
  const container = document.createElement('div');
  container.className = 'title-prompt-container';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultTitle;
  input.className = 'title-prompt-input';
  input.placeholder = 'Enter title and press Enter';
  
  container.appendChild(input);
  
  const readingList = document.getElementById('readingList');
  readingList.insertBefore(container, readingList.firstChild);
  
  input.focus();
  input.select();
  
  let isProcessing = false;
  
  const handleSave = () => {
    if (isProcessing) return;
    isProcessing = true;
    
    const userTitle = input.value.trim() || defaultTitle;
    container.remove();
    
    chrome.storage.local.get([STORAGE_KEYS.READING_LIST], function(result) {
      const readingList = result.readingList || [];
      const urlExists = readingList.some(item => item.url === url);
      
      if (!urlExists) {
        readingList.push({
          url: url,
          title: userTitle,
          originalTitle: defaultTitle,
          date: new Date().toISOString()
        });
        
        chrome.storage.local.set({
          [STORAGE_KEYS.READING_LIST]: readingList
        }, function() {
          loadItems();
          updateBadge();
        });
      }
    });
  };
  
  const handleCancel = () => {
    if (isProcessing) return;
    isProcessing = true;
    container.remove();
  };
  
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  });
  
  input.addEventListener('blur', function() {
    setTimeout(handleSave, 100);
  });
}

// Download Function
function downloadReadingList(e) {
  e.preventDefault();
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST], function(result) {
    const readingList = result.readingList || [];
    const blob = new Blob([JSON.stringify(readingList, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'readlater-list.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}