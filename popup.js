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

  // Add this to the DOMContentLoaded event to initialize the checkbox
  chrome.storage.local.get(['showBadge'], function(result) {
    document.getElementById('showBadge').checked = result.showBadge !== false;
  });
});

function saveCurrentPage() {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    saveItem(currentTab.url, currentTab.title);
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
  chrome.storage.local.get(['readingList'], function(result) {
    const readingList = result.readingList || [];
    const container = document.getElementById('readingList');
    container.innerHTML = '';

    const linkCount = document.getElementById('linkCount');
    linkCount.textContent = readingList.length;

    readingList.reverse().forEach(function(item) {
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
      
      // Try to get the original favicon from the website
      const url = new URL(item.url);
      favicon.src = `${url.protocol}//${url.hostname}/favicon.ico`;
      
      // Fallback to Google's service if the direct favicon fails
      favicon.onerror = function() {
        favicon.src = `https://www.google.com/s2/favicons?domain=${url.hostname}`;
        favicon.onerror = function() {
          favicon.style.display = 'none';
        };
      };
      div.appendChild(favicon);
      
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      
      link.textContent = item.title || item.url;
      div.appendChild(link);

      container.appendChild(div);
    });
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