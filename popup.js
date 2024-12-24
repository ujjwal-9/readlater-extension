// Move filterItems function outside DOMContentLoaded
function filterItems(searchTerm) {
  const items = document.querySelectorAll('.reading-item');
  const searchLower = searchTerm.toLowerCase();
  let visibleCount = 0;
  
  items.forEach(item => {
    const link = item.querySelector('a');
    const title = link.textContent.toLowerCase();
    const url = link.href.toLowerCase();
    
    if (title.includes(searchLower) || url.includes(searchLower)) {
      item.classList.remove('hidden');
      visibleCount++;
    } else {
      item.classList.add('hidden');
    }
  });
  
  // Update count to show number of visible items
  const linkCount = document.getElementById('linkCount');
  if (linkCount) {
    linkCount.textContent = searchTerm ? `${visibleCount}/${items.length}` : items.length;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  // Load saved items when popup opens
  loadItems();
  updateBadge();

  // Save current page
  document.getElementById('saveButton').addEventListener('click', function() {
    saveCurrentPage();
  });

  // Clear all confirmation handlers
  document.getElementById('clearAll').addEventListener('click', function() {
    document.getElementById('confirmDialog').style.display = 'flex';
  });

  document.getElementById('cancelClear').addEventListener('click', function() {
    document.getElementById('confirmDialog').style.display = 'none';
  });

  document.getElementById('confirmClear').addEventListener('click', function() {
    chrome.storage.local.set({
      readingList: []
    }, function() {
      loadItems();
      updateBadge();
      document.getElementById('confirmDialog').style.display = 'none';
    });
  });

  // Add this after the DOMContentLoaded event listener
  document.getElementById('showBadge').addEventListener('change', function(e) {
    const showBadge = e.target.checked;
    chrome.storage.local.set({ showBadge }, function() {
      if (!showBadge) {
        chrome.action.setBadgeText({ text: '' });
      } else {
        updateBadge();
      }
    });
  });

  // Add this to the DOMContentLoaded event to initialize the checkboxes
  chrome.storage.local.get(['showBadge', 'newestFirst'], function(result) {
    document.getElementById('showBadge').checked = result.showBadge !== false;
    document.getElementById('newestFirst').checked = result.newestFirst !== false;
  });

  // Add sorting preference handler
  document.getElementById('newestFirst').addEventListener('change', function(e) {
    const newestFirst = e.target.checked;
    chrome.storage.local.set({ newestFirst }, function() {
      loadItems();
    });
  });

  // Add download JSON functionality
  document.getElementById('downloadJson').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.storage.local.get(['readingList'], function(result) {
      const readingList = result.readingList || [];
      const blob = new Blob([JSON.stringify(readingList, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'readlater-list.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  // Add this after the download handler
  document.getElementById('uploadButton').addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('uploadJson').click();
  });

  document.getElementById('uploadJson').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      let items = [];
      try {
        // Try parsing as JSON first
        items = JSON.parse(e.target.result);
      } catch (err) {
        // If not JSON, try parsing as text (one URL per line)
        items = e.target.result.split('\n')
          .map(line => line.trim())
          .filter(line => line && line.startsWith('http'))
          .map(url => ({ url }));
      }

      // Process items and add them to the reading list
      chrome.storage.local.get(['readingList'], function(result) {
        const currentList = result.readingList || [];
        const currentUrls = new Set(currentList.map(item => item.url));
        
        // Process each new item
        const processItems = items.map(item => {
          if (currentUrls.has(item.url)) return null;

          return {
            url: item.url,
            title: item.url, // Just use the URL as title
            date: item.date || new Date().toISOString()
          };
        }).filter(Boolean);

        // Wait for all items to be processed
        chrome.storage.local.set({
          readingList: [...currentList, ...processItems]
        }, function() {
          loadItems();
          updateBadge();
          e.target.value = ''; // Reset file input
        });
      });
    };

    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      reader.readAsText(file);
    } else {
      reader.readAsText(file); // Read as text for URL list
    }
  });

  // Add to your DOMContentLoaded event listener
  document.getElementById('editMode').addEventListener('click', function() {
    enterEditMode();
  });

  document.getElementById('doneEditing').addEventListener('click', function() {
    exitEditMode();
  });

  // Add this to your DOMContentLoaded event listener
  function updateTheme() {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Store the theme preference
    chrome.storage.local.set({ isDarkMode: isDarkMode }, function() {
      // Notify background script of theme change
      chrome.runtime.sendMessage({ 
        type: 'themeChanged', 
        isDarkMode: isDarkMode 
      });
      
      // Update badge background color based on theme
      chrome.action.setBadgeBackgroundColor({ 
        color: isDarkMode ? '#9aa0a6' : '#666666'
      });

      // Update header logo
      const headerLogo = document.getElementById('headerLogo');
      if (headerLogo) {
        headerLogo.src = isDarkMode ? 'icons/icon-256-dark.png' : 'icons/icon-256.png';
      }

      // Update search icon if it exists
      const searchIcon = document.querySelector('#searchToggle img');
      if (searchIcon) {
        searchIcon.src = isDarkMode ? 'icons/search-dark.png' : 'icons/search.png';
      }
    });
  }

  // Listen for theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);

  // Initial theme setup
  updateTheme();

  // Add to your DOMContentLoaded event listener
  document.getElementById('searchBtn').addEventListener('click', function() {
    const searchContainer = document.getElementById('searchContainer');
    const searchInput = document.getElementById('searchInput');
    
    if (searchContainer.style.display === 'none' || !searchContainer.style.display) {
      searchContainer.style.display = 'block';
      searchInput.focus();
      this.classList.add('active');
    } else {
      searchContainer.style.display = 'none';
      searchInput.value = '';
      filterItems('');
      this.classList.remove('active');
    }
  });

  document.getElementById('searchInput').addEventListener('input', function(e) {
    filterItems(e.target.value);
  });
});

// Function to save the reading list to Chrome sync storage
function saveReadingList() {
    const readingList = []; // Collect your reading list items here
    // Example: readingList.push({ title: 'Example Title', url: 'http://example.com' });

    chrome.storage.sync.set({ readingList: readingList }, function() {
        console.log('Reading list saved to sync storage.');
    });
}

// Function to load the reading list from Chrome sync storage
function loadReadingList() {
    chrome.storage.sync.get(['readingList'], function(result) {
        const readingList = result.readingList || [];
        // Populate your reading list UI with the items
        console.log('Reading list loaded from sync storage:', readingList);
    });
}

// Call loadReadingList on script load to populate the UI
loadReadingList();

function saveCurrentPage() {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    showTitlePrompt(currentTab.url, currentTab.title);
  });
}

function showTitlePrompt(url, defaultTitle) {
  // Create and show the title input container
  const container = document.createElement('div');
  container.className = 'title-prompt-container';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultTitle;
  input.className = 'title-prompt-input';
  input.placeholder = 'Enter title and press Enter';
  
  container.appendChild(input);
  
  // Insert at the top of the reading list
  const readingList = document.getElementById('readingList');
  readingList.insertBefore(container, readingList.firstChild);
  
  // Focus the input
  input.focus();
  input.select();
  
  // Handle input events
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const title = input.value.trim() || defaultTitle;
      container.remove();
      saveItem(url, title);
    } else if (e.key === 'Escape') {
      container.remove();
    }
  });
  
  // Handle blur event
  input.addEventListener('blur', function() {
    const title = input.value.trim() || defaultTitle;
    container.remove();
    saveItem(url, title);
  });
}

function saveItem(url, title) {
  chrome.storage.local.get(['readingList'], function(result) {
    const readingList = result.readingList || [];
    
    const urlExists = readingList.some(item => item.url === url);
    
    if (!urlExists) {
      readingList.push({
        url: url,
        title: title,
        date: new Date().toISOString()
      });
      
      chrome.storage.local.set({
        readingList: readingList
      }, function() {
        loadItems();
        updateBadge();
      });
    }
  });
}

function loadItems() {
  chrome.storage.local.get(['readingList', 'newestFirst'], function(result) {
    const readingList = result.readingList || [];
    const newestFirst = result.newestFirst !== false;
    const container = document.getElementById('readingList');
    container.innerHTML = '';

    const linkCount = document.getElementById('linkCount');
    linkCount.textContent = readingList.length;

    // Create a copy of the array before reversing if needed
    const sortedList = [...readingList];
    if (newestFirst) {
      sortedList.reverse();
    }

    sortedList.forEach(function(item) {
      const div = document.createElement('div');
      div.className = 'reading-item';
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.onclick = function() {
        removeItem(item.url);
      };
      div.appendChild(deleteBtn);
      
      const favicon = document.createElement('img');
      favicon.className = 'site-icon';
      
      let url;
      try {
        url = new URL(item.url);
        // Check if the favicon is already cached
        const cachedFavicon = localStorage.getItem(`favicon-${url.hostname}`);
        if (cachedFavicon) {
          favicon.src = cachedFavicon;
        } else {
          // Use Google's favicon service directly
          const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}`;
          favicon.src = googleFaviconUrl;
          favicon.onload = function() {
            localStorage.setItem(`favicon-${url.hostname}`, googleFaviconUrl);
          };
        }
        
        favicon.onerror = function() {
          favicon.style.display = 'none';
        };
      } catch (err) {
        favicon.style.display = 'none';
      }

      div.appendChild(favicon);
      
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      
      link.textContent = item.title || item.url;
      div.appendChild(link);

      container.appendChild(div);
    });

    // Reset search
    const searchContainer = document.getElementById('searchContainer');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    if (searchInput) {
      searchInput.value = '';
      searchContainer.style.display = 'none';
      searchBtn.classList.remove('active');
    }
    filterItems('');
  });
}

function removeItem(urlToRemove) {
  chrome.storage.local.get(['readingList'], function(result) {
    const readingList = result.readingList || [];
    const updatedList = readingList.filter(item => item.url !== urlToRemove);
    
    chrome.storage.local.set({
      readingList: updatedList
    }, function() {
      loadItems();
      updateBadge();
    });
  });
}

function updateBadge() {
  chrome.storage.local.get(['readingList', 'showBadge'], function(result) {
    const count = (result.readingList || []).length;
    const showBadge = result.showBadge !== false; // default to true if not set
    
    chrome.action.setBadgeText({ 
      text: showBadge && count > 0 ? count.toString() : '' 
    });
    chrome.action.setBadgeBackgroundColor({ color: '#666666' });
  });
}

function enterEditMode() {
  document.getElementById('editMode').style.display = 'none';
  document.getElementById('doneEditing').style.display = 'inline-block';
  document.getElementById('readingList').classList.add('edit-mode');
  
  // Make all titles editable
  const links = document.querySelectorAll('.reading-item a');
  links.forEach(link => {
    link.addEventListener('click', handleEditClick);
    link.style.cursor = 'text';
  });
}

function exitEditMode() {
  document.getElementById('editMode').style.display = 'inline-block';
  document.getElementById('doneEditing').style.display = 'none';
  document.getElementById('readingList').classList.remove('edit-mode');
  
  // Remove edit listeners and restore normal behavior
  const links = document.querySelectorAll('.reading-item a');
  links.forEach(link => {
    link.removeEventListener('click', handleEditClick);
    link.style.cursor = '';
  });
}

function handleEditClick(e) {
  e.preventDefault();
  const link = e.target;
  const url = link.href;
  const currentTitle = link.textContent;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.className = 'edit-input';
  
  link.replaceWith(input);
  input.focus();
  
  input.addEventListener('blur', function() {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      updateTitle(url, newTitle);
    } else {
      const newLink = link.cloneNode(true);
      newLink.addEventListener('click', handleEditClick);
      input.replaceWith(newLink);
    }
  });
  
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      const newLink = link.cloneNode(true);
      newLink.addEventListener('click', handleEditClick);
      input.replaceWith(newLink);
    }
  });
}

function updateTitle(url, newTitle) {
  chrome.storage.local.get(['readingList'], function(result) {
    const readingList = result.readingList || [];
    const itemIndex = readingList.findIndex(item => item.url === url);
    
    if (itemIndex !== -1) {
      readingList[itemIndex].title = newTitle;
      chrome.storage.local.set({ readingList }, function() {
        loadItems();
      });
    }
  });
}