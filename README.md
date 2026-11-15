# readlater-extension

A minimal Chrome extension for saving pages to read later.

- **Save** the current page with the **+** button (you can edit the title first) or with
  **⌘⇧L** / **Ctrl+Shift+L**. The badge flashes ✓ when a page is saved and ✕ for pages that
  can't be saved, such as `chrome://` pages.
- **Search** titles and URLs, **sort** by date, **rename** items in edit mode, and remove them with ×.
- **Open** an item with a click. ⌘/Ctrl-click or middle-click opens it in a background tab and
  keeps the popup open.
- **Back up and restore** your list as JSON from Settings.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.

You can change the keyboard shortcut at `chrome://extensions/shortcuts`.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration |
| `background.js` | Service worker: keyboard shortcut, toolbar badge and icon |
| `popup.html` / `popup.css` / `popup.js` | The popup UI |
| `shared.js` | Storage helpers used by both the popup and the service worker |

## Permissions and privacy

- `storage` keeps your list locally in `chrome.storage.local`.
- `activeTab` lets the extension read the URL and title of the current tab, and only when you click
  the toolbar button or press the shortcut. The extension does not need the broader `tabs`
  permission ("Read your browsing history").
- Favicons are loaded from Google's favicon service (`www.google.com/s2/favicons`), which receives
  the domain of each saved page. If you choose a font other than System Default, it is loaded from
  Google Fonts.
