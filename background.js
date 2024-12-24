// Function to update icon based on theme
async function updateIcon() {
  try {
    // Get system color scheme using chrome.storage.local
    const result = await chrome.storage.local.get('isDarkMode');
    const isDark = result.isDarkMode; // Extract the boolean value
    
    chrome.action.setIcon({
      path: isDark ? {
        "48": "icons/icon-48-dark.png",
        "128": "icons/icon-128-dark.png",
        "256": "icons/icon-256-dark.png"
      } : {
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png",
        "256": "icons/icon-256.png"
      }
    });
  } catch (error) {
    console.error('Error updating icon:', error);
  }
}

// Update badge and icon when extension starts
chrome.runtime.onStartup.addListener(async function() {
  await updateBadge();
  await updateIcon();
});

// Also handle installation/update
chrome.runtime.onInstalled.addListener(async function() {
  await updateBadge();
  await updateIcon();
});

// Listen for theme change messages from popup
chrome.runtime.onMessage.addListener(async function(message) {
  if (message.type === 'themeChanged') {
    await updateIcon();
  }
});

// Cache the badge state
let lastBadgeText = '';
let lastBadgeColor = '';

function updateBadge() {
  chrome.storage.local.get(['readingList', 'showBadge'], function(result) {
    const count = (result.readingList || []).length;
    const showBadge = result.showBadge !== false;
    const newBadgeText = showBadge && count > 0 ? count.toString() : '';
    
    // Only update if changed
    if (newBadgeText !== lastBadgeText) {
      chrome.action.setBadgeText({ text: newBadgeText });
      lastBadgeText = newBadgeText;
    }
    
    const newBadgeColor = '#666666';
    if (newBadgeColor !== lastBadgeColor) {
      chrome.action.setBadgeBackgroundColor({ color: newBadgeColor });
      lastBadgeColor = newBadgeColor;
    }
  });
}

chrome.commands.onCommand.addListener(function(command) {
  if (command === "save-page") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      
      // Get both readingList and showBadge settings
      chrome.storage.local.get(['readingList', 'showBadge'], function(result) {
        const readingList = result.readingList || [];
        const showBadge = result.showBadge !== false;
        const urlExists = readingList.some(item => item.url === currentTab.url);
        
        if (!urlExists) {
          readingList.push({
            url: currentTab.url,
            title: currentTab.title,
            date: new Date().toISOString()
          });
          
          chrome.storage.local.set({
            readingList: readingList
          }, function() {
            const count = readingList.length;
            
            // Show checkmark feedback
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#666666' });
            
            // After 2 seconds, either show count or clear badge
            setTimeout(() => {
              if (showBadge) {
                chrome.action.setBadgeText({ 
                  text: count > 0 ? count.toString() : '' 
                });
              } else {
                chrome.action.setBadgeText({ text: '' });
              }
            }, 2000);
          });
        }
      });
    });
  }
});
  