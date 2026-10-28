// @ts-check
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4328',
    // headless: false makes Playwright use the GTK-based MiniBrowser on Linux
    // (the WPE "headless" variant requires system libraries not present here).
    // Tests are run with Xvfb so there is still no visible window.
    headless: false,
  },
  projects: [
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 1366, height: 768 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
      },
    },
  ],
};

module.exports = config;
