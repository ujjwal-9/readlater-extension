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

// Add memoization for frequently used DOM elements
const DOM = {
  elements: new Map(),
  get(id) {
    if (!this.elements.has(id)) {
      this.elements.set(id, document.getElementById(id));
    }
    return this.elements.get(id);
  },
  clear() {
    this.elements.clear();
  }
};

// Add storage utility at the top of the file with other utilities
const storage = {
  async get(keys) {
    return new Promise(resolve => {
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

// Core initialization
document.addEventListener('DOMContentLoaded', async function() {
  try {
    cacheIconElements();
    
    // Update theme and icon immediately
    await updateTheme();
    
    loadItems();
    updateBadge();

    // Theme change listener
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', updateTheme);

    setupEventListeners();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
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
      DOM.get('downloadJson')?.click();
    } else if (target.closest('#sortBtn')) {
      handleSort();
    }
  });

  // Add search input handler
  DOM.get('searchInput')?.addEventListener('input', e => debouncedFilter(e.target.value));
  DOM.get('settingsShowBadge')?.addEventListener('change', handleBadgeToggle);
}

// Theme Management
async function updateTheme() {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  try {
    // First update storage
    await chrome.storage.local.set({ isDarkMode });
    
    // Notify background script to update icon
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'themeChanged', isDarkMode }, resolve);
    });

    // Update all cached icon elements in popup
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
  } catch (error) {
    console.error('Error updating theme:', error);
  }
}

// Search Functionality
function toggleSearch() {
  const searchContainer = DOM.get('searchContainer');
  const searchInput = DOM.get('searchInput');
  const searchBtn = DOM.get('searchBtn');
  
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
  const searchLower = searchTerm.toLowerCase().trim();
  let visibleCount = 0;
  
  // If search is empty, show all items
  if (!searchLower) {
    items.forEach(item => {
      item.style.display = '';
    });
    updateItemCount(items.length);
    return;
  }

  // Split search terms for multiple word search
  const searchTerms = searchLower.split(/\s+/);
  
  items.forEach(item => {
    const link = item.querySelector('a');
    if (!link) return;

    const title = link.textContent.toLowerCase();
    const url = link.href.toLowerCase();
    const originalTitle = link.getAttribute('data-original-title')?.toLowerCase() || '';
    
    // Check if any search term matches any of these conditions:
    // 1. Exact match in title, url, or original title
    // 2. Word starts with search term
    // 3. Search term is part of a word (minimum 3 characters)
    const isVisible = searchTerms.every(term => {
      // Skip very short search terms for partial matches
      if (term.length < 2) {
        return title.includes(term) || url.includes(term) || originalTitle.includes(term);
      }

      // Check for exact matches first
      if (title.includes(term) || url.includes(term) || originalTitle.includes(term)) {
        return true;
      }

      // Split into words and check for word starts
      const titleWords = title.split(/\s+/);
      const originalTitleWords = originalTitle.split(/\s+/);
      
      // Check if any word starts with the search term
      const wordStartMatch = [...titleWords, ...originalTitleWords].some(word => 
        word.startsWith(term)
      );
      if (wordStartMatch) return true;

      // For longer search terms (3+ chars), check for partial matches within words
      if (term.length >= 3) {
        return titleWords.some(word => word.includes(term)) || 
               originalTitleWords.some(word => word.includes(term));
      }

      return false;
    });
    
    item.style.display = isVisible ? '' : 'none';
    if (isVisible) visibleCount++;
  });
  
  updateItemCount(searchTerm ? `${visibleCount}/${items.length}` : items.length);
}

// Optimize debounce with a more efficient implementation
function debounce(func, wait) {
  let timeoutId;
  return function executedFunction(...args) {
    const later = () => {
      timeoutId = null;
      func(...args);
    };
    clearTimeout(timeoutId);
    timeoutId = setTimeout(later, wait);
  };
}

// Optimize search filtering
const debouncedFilter = debounce((searchTerm) => {
  filterItems(searchTerm);
}, 150);

// Reading List Management
function loadItems() {
  chrome.storage.local.get([STORAGE_KEYS.READING_LIST, STORAGE_KEYS.NEWEST_FIRST], function(result) {
    const readingList = result.readingList || [];
    const newestFirst = result.newestFirst !== false;
    const container = DOM.get('readingList');
    
    updateItemCount(readingList.length);
    
    // Create items in batches for better performance
    const batchSize = 50;
    const fragment = document.createDocumentFragment();
    
    // Sort the list once
    const sortedList = [...readingList].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return newestFirst ? dateB - dateA : dateA - dateB;
    });

    function processBatch(startIndex) {
      const endIndex = Math.min(startIndex + batchSize, sortedList.length);
      
      for (let i = startIndex; i < endIndex; i++) {
        createReadingItem(sortedList[i], fragment);
      }
      
      if (endIndex < sortedList.length) {
        requestAnimationFrame(() => processBatch(endIndex));
      } else {
        container.innerHTML = '';
        container.appendChild(fragment);
        resetSearch();
      }
    }

    processBatch(0);

    // Update sort button title
    const sortBtn = DOM.get('sortBtn');
    if (sortBtn) {
      sortBtn.title = newestFirst ? "Sort by oldest first" : "Sort by newest first";
    }
  });
}

// Optimize createReadingItem with element pooling
const elementPool = {
  items: [],
  get() {
    return this.items.pop() || document.createElement('div');
  },
  return(element) {
    this.items.push(element);
  }
};

function createReadingItem(item, container) {
  const div = elementPool.get();
  div.className = 'reading-item';
  
  const deleteBtn = createDeleteButton(() => removeItem(item.url));
  const favicon = createFavicon(item.url);
  const link = createItemLink(item);
  
  // Add edit handler if in edit mode
  if (DOM.get('readingList')?.classList.contains('edit-mode')) {
    link.addEventListener('click', handleTitleEdit);
  }
  
  div.innerHTML = '';
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
  
  // Store original title for search
  if (item.originalTitle) {
    link.setAttribute('data-original-title', item.originalTitle);
  }
  
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
  
  // Add click handler for normal mode
  link.addEventListener('click', function(e) {
    if (!DOM.get('readingList').classList.contains('edit-mode')) {
      e.preventDefault();
      trackLinkOpen(item.url);
      window.open(item.url, '_blank');
    }
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
  const searchContainer = DOM.get('searchContainer');
  const searchInput = DOM.get('searchInput');
  const searchBtn = DOM.get('searchBtn');
  
  if (searchInput) {
    searchInput.value = '';
    searchContainer.style.display = 'none';
    searchBtn?.classList.remove('active');
    
    // Show all items
    const items = document.querySelectorAll('.reading-item');
    items.forEach(item => {
      item.style.display = '';
    });
  }
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
  DOM.get('editMode').style.display = 'none';
  DOM.get('doneEditing').style.display = 'inline-block';
  DOM.get('readingList').classList.add('edit-mode');
  DOM.get('editModePrompt').classList.add('show');

  // Add click handlers for editing titles
  const items = document.querySelectorAll('.reading-item');
  items.forEach(item => {
    const link = item.querySelector('a');
    if (link) {
      link.addEventListener('click', handleTitleEdit);
    }
  });
}

function exitEditMode() {
  DOM.get('editMode').style.display = 'inline-block';
  DOM.get('doneEditing').style.display = 'none';
  DOM.get('readingList').classList.remove('edit-mode');
  DOM.get('editModePrompt').classList.remove('show');

  // Remove click handlers for editing titles
  const items = document.querySelectorAll('.reading-item');
  items.forEach(item => {
    const link = item.querySelector('a');
    if (link) {
      link.removeEventListener('click', handleTitleEdit);
    }
  });
}

async function handleTitleEdit(e) {
  e.preventDefault();
  const link = e.target;
  const item = link.closest('.reading-item');
  const url = link.href;
  
  // Create edit input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = link.textContent;
  input.className = 'edit-input';
  
  // Replace link with input
  link.style.display = 'none';
  item.insertBefore(input, link);
  input.focus();
  input.select();
  
  const saveEdit = async () => {
    try {
      const newTitle = input.value.trim();
      if (newTitle) {
        // Get current reading list
        const result = await chrome.storage.local.get(STORAGE_KEYS.READING_LIST);
        const readingList = result.readingList || [];
        const itemIndex = readingList.findIndex(item => item.url === url);
        
        if (itemIndex !== -1) {
          readingList[itemIndex].title = newTitle;
          await chrome.storage.local.set({
            [STORAGE_KEYS.READING_LIST]: readingList
          });
          link.textContent = newTitle;
        }
      }
    } catch (error) {
      console.error('Error saving title:', error);
    } finally {
      // Cleanup
      input.remove();
      link.style.display = '';
    }
  };
  
  // Handle input events
  input.addEventListener('blur', saveEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.remove();
      link.style.display = '';
    }
  });
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
  
  const readingList = DOM.get('readingList');
  readingList.insertBefore(container, readingList.firstChild);
  
  input.focus();
  input.select();
  
  let isProcessing = false;
  
  const handleSave = async () => {
    if (isProcessing) return;
    isProcessing = true;
    
    const userTitle = input.value.trim() || defaultTitle;
    container.remove();
    
    // Get both reading list and sort order
    const result = await storage.get([STORAGE_KEYS.READING_LIST, STORAGE_KEYS.NEWEST_FIRST]);
    const readingList = result.readingList || [];
    const newestFirst = result.newestFirst !== false;
    const urlExists = readingList.some(item => item.url === url);
    
    if (!urlExists) {
      const newItem = {
        url: url,
        title: userTitle,
        originalTitle: defaultTitle,
        date: new Date().toISOString()
      };
      
      readingList.push(newItem);
      
      await storage.set({
        [STORAGE_KEYS.READING_LIST]: readingList
      });

      // Sort the list according to current sort order
      const sortedList = [...readingList].sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return newestFirst ? dateB - dateA : dateA - dateB;
      });

      // Find the correct position for the new item
      const newItemIndex = sortedList.findIndex(item => item.url === url);
      
      // Create the new item
      const fragment = document.createDocumentFragment();
      createReadingItem(newItem, fragment);
      
      // Add edit handler if in edit mode
      if (DOM.get('readingList').classList.contains('edit-mode')) {
        const link = fragment.querySelector('a');
        if (link) {
          link.addEventListener('click', handleTitleEdit);
        }
      }
      
      // Insert at the correct position
      const container = DOM.get('readingList');
      const items = container.children;
      if (newItemIndex < items.length) {
        container.insertBefore(fragment, items[newItemIndex]);
      } else {
        container.appendChild(fragment);
      }
      
      updateBadge();
    }
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