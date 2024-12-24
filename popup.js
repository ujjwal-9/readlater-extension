// Constants
const STORAGE_KEYS = {
  READING_LIST: 'readingList',
  SHOW_BADGE: 'showBadge',
  IS_DARK_MODE: 'isDarkMode',
  NEWEST_FIRST: 'newestFirst'
};

// Cache DOM queries for icons
const iconElements = {};
function cacheIconElements() {
  const iconMappings = {
    'icon': '#headerLogo',
    'search': '#searchBtn img[alt="Search"], .search-icon',
    'edit': '#editMode img[alt="Edit"]',
    'done': '#doneEditing img[alt="Done"]',
    'sort': '#sortBtn img[alt="Sort"]',
    'settings': '#settingsBtn img[alt="Settings"]',
    'add': '#saveButton img[alt="Add"]',
    'back': '#settingsBack img[alt="Back"]',
    'backup': 'img[alt="Backup"]',
    'restore': 'img[alt="Restore"]',
    'clearall': 'img[alt="Clear All"]',
    'badge': '.settings-item img[alt="Badge"]'
  };

  Object.entries(iconMappings).forEach(([key, selector]) => {
    iconElements[key] = document.querySelectorAll(selector);
  });
}

// Core initialization
document.addEventListener('DOMContentLoaded', function() {
  cacheIconElements();
  loadItems();
  updateBadge();
  updateTheme();

  // Theme change listener
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', updateTheme);

  setupEventListeners();
});

function setupEventListeners() {
  // Use a single event listener for the document
  document.addEventListener('click', function(e) {
    const target = e.target;
    
    // Handle different button clicks
    if (target.closest('#saveButton')) {
      saveCurrentPage();
    } else if (target.closest('#searchBtn')) {
      toggleSearch();
    } else if (target.closest('#editMode')) {
      enterEditMode();
    } else if (target.closest('#doneEditing')) {
      exitEditMode();
    } else if (target.closest('#settingsBtn')) {
      showSettingsPanel();
    } else if (target.closest('#settingsBack')) {
      hideSettingsPanel();
    } else if (target.closest('#settingsClearAll')) {
      handleClearAll();
    } else if (target.closest('#downloadJson')) {
      downloadReadingList(e);
    } else if (target.closest('#settingsDownload')) {
      e.preventDefault();
      document.getElementById('downloadJson')?.click();
    } else if (target.closest('#sortBtn')) {
      handleSort();
    }
  });

  // Add remaining necessary event listeners
  document.getElementById('searchInput')?.addEventListener('input', e => debouncedFilter(e.target.value));
  document.getElementById('settingsShowBadge')?.addEventListener('change', handleBadgeToggle);
}

// Theme Management
function updateTheme() {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  chrome.storage.local.set({ isDarkMode }, function() {
    chrome.runtime.sendMessage({ type: 'themeChanged', isDarkMode });
    
    chrome.action.setBadgeBackgroundColor({ 
      color: isDarkMode ? '#9aa0a6' : '#666666'
    });

    // Update all cached icon elements
    Object.entries(iconElements).forEach(([key, elements]) => {
      const newSrc = key === 'icon' ?
        `icons/icon-256${isDarkMode ? '-dark' : ''}.png` :
        `icons/${key}${isDarkMode ? '-dark' : ''}.png`;
      
      elements.forEach(element => {
        if (element && !element.src.endsWith(newSrc)) {
          element.src = newSrc;
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

// Add debounce helper
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Optimize search with debouncing
const debouncedFilter = debounce((searchTerm) => {
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
}, 150);

// Reading List Management
function loadItems() {
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST, STORAGE_KEYS.NEWEST_FIRST], function(result) {
    const readingList = result.readingList || [];
    const newestFirst = result.newestFirst !== false;
    const container = document.getElementById('readingList');
    
    updateItemCount(readingList.length);
    
    // Create document fragment for batch DOM update
    const fragment = document.createDocumentFragment();
    
    // Sort the list
    const sortedList = [...readingList].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return newestFirst ? dateB - dateA : dateA - dateB;
    });

    sortedList.forEach(item => createReadingItem(item, fragment));
    
    // Single DOM update
    container.innerHTML = '';
    container.appendChild(fragment);
    
    resetSearch();

    // Update sort button title
    const sortBtn = document.getElementById('sortBtn');
    if (sortBtn) {
      sortBtn.title = newestFirst ? "Sort by oldest first" : "Sort by newest first";
    }
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
  
  // Format dates for tooltip
  const addedDate = formatDate(item.date);
  const lastOpenedDate = item.lastOpened ? formatDate(item.lastOpened) : 'Never';
  
  // Create tooltip content
  const tooltipContent = [
    `${item.originalTitle || item.title}`,
    ``,
    `Added: ${addedDate}`,
    `Last Opened: ${lastOpenedDate}`
  ].join('\n');
  
  link.title = tooltipContent;
  
  link.addEventListener('click', function(e) {
    e.preventDefault();
    trackLinkOpen(item.url);
    window.open(item.url, '_blank');
  });
  
  return link;
}

// Add this helper function for date formatting
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Add this function to track when links are opened
function trackLinkOpen(url) {
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST], function(result) {
    const readingList = result.readingList || [];
    const itemIndex = readingList.findIndex(item => item.url === url);
    
    if (itemIndex !== -1) {
      readingList[itemIndex].lastOpened = new Date().toISOString();
      chrome.storage.local.set({
        [STORAGE_KEYS.READING_LIST]: readingList
      });
    }
  });
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
  // Get the current reading list count first
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST], function(result) {
    const readingList = result.readingList || [];
    const itemCount = readingList.length;
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Create and style the confirmation dialog
    const confirmDialog = document.createElement('div');
    confirmDialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-color);
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 1000;
      width: 300px;
      text-align: center;
    `;

    // Add icon and content with item count
    confirmDialog.innerHTML = `
      <div style="margin-bottom: 15px;">
        <img src="icons/icon-128${isDarkMode ? '-dark' : ''}.png" alt="Read Later" style="width: 48px; height: 48px;">
      </div>
      <div style="margin-bottom: 20px; color: var(--text-color);">
        Are you sure you want to delete all ${itemCount} items? This cannot be undone.
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button id="cancelClear" class="action-btn" style="padding: 8px 16px;">Cancel</button>
        <button id="confirmClear" class="action-btn" 
                style="padding: 8px 16px; border: 1px solid #d32f2f; background: none; color: #d32f2f;">Delete All</button>
      </div>
    `;

    // Add overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 999;
    `;

    // Add to document
    document.body.appendChild(overlay);
    document.body.appendChild(confirmDialog);

    // Style the buttons with hover effects
    const confirmBtn = document.getElementById('confirmClear');
    if (confirmBtn) {
      confirmBtn.addEventListener('mouseover', () => {
        confirmBtn.style.background = '#fff1f1';
      });
      confirmBtn.addEventListener('mouseout', () => {
        confirmBtn.style.background = 'none';
      });
    }

    const cancelBtn = document.getElementById('cancelClear');
    if (cancelBtn) {
      cancelBtn.addEventListener('mouseover', () => {
        cancelBtn.style.background = 'var(--hover-bg)';
      });
      cancelBtn.addEventListener('mouseout', () => {
        cancelBtn.style.background = 'none';
      });
    }

    // Handle button clicks
    document.getElementById('cancelClear').onclick = () => {
      overlay.remove();
      confirmDialog.remove();
    };

    document.getElementById('confirmClear').onclick = () => {
      chrome.storage.local.set({
        [STORAGE_KEYS.READING_LIST]: []
      }, function() {
        loadItems();
        updateBadge();
        overlay.remove();
        confirmDialog.remove();
      });
    };

    // Close on overlay click
    overlay.onclick = () => {
      overlay.remove();
      confirmDialog.remove();
    };
  });
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

// Add these new functions
function handleSort() {
  chrome.storage.local.get([STORAGE_KEYS.NEWEST_FIRST], function(result) {
    const newestFirst = !result.newestFirst; // Toggle the sort order
    chrome.storage.local.set({ 
      [STORAGE_KEYS.NEWEST_FIRST]: newestFirst 
    }, function() {
      loadItems();
      // Update the sort button title
      const sortBtn = document.getElementById('sortBtn');
      if (sortBtn) {
        sortBtn.title = newestFirst ? "Sort by oldest first" : "Sort by newest first";
      }
    });
  });
}