// Initialize badge when browser starts
chrome.runtime.onStartup.addListener(function() {
  updateBadge();
});

// Also handle installation/update
chrome.runtime.onInstalled.addListener(function() {
  updateBadge();
});

function updateBadge() {
  chrome.storage.local.get(['readingList', 'showBadge'], function(result) {
    const count = (result.readingList || []).length;
    const showBadge = result.showBadge !== false;
    
    chrome.action.setBadgeText({ 
      text: showBadge && count > 0 ? count.toString() : '' 
    });
    chrome.action.setBadgeBackgroundColor({ color: '#666666' });
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
  