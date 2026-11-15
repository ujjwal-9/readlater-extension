# End-to-end tests

`e2e.mjs` loads the extension unpacked in Playwright's Chromium and drives the popup like a user would. It checks rendering, sort, search, rename, add and delete, the badge, import and export, the clear-all dialog, fonts, dark mode, long-list scrolling, and the keyboard-shortcut save path in the service worker. It also saves light and dark screenshots of each screen to `output/`.

```sh
cd tests
npm install
npx playwright install chromium
npm test
```

Notes:
- The tests need Playwright's bundled Chromium. Google Chrome 137+ ignores `--load-extension`.
- The tests run against a copy of the extension in `output/extension`. That copy adds `host_permissions` so `tabs.query` returns the URL and title. A real toolbar click grants this through `activeTab`, which a test can't trigger. Check the + button and the shortcut by hand before a release.
- If `npx playwright install chromium` hangs after the download finishes (seen with Node 26), fetch the zip and unzip it yourself:
  `curl -LO https://playwright.azureedge.net/builds/chromium/1148/chromium-mac-arm64.zip`, then unzip it into `~/Library/Caches/ms-playwright/chromium-1148/` and create an empty `INSTALLATION_COMPLETE` file there.
- Leave `tests/` out of the zip you upload to the Chrome Web Store.
