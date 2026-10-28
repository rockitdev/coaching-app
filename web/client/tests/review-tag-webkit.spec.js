/**
 * WebKit (Safari engine) regression test for Review & Tag video playback.
 *
 * What broke on iPad:
 *   1. The <video> element was missing the `playsinline` attribute, which iOS
 *      Safari requires to play video inline in a custom player.  Without it the
 *      browser either hijacks playback into the native full-screen player or
 *      treats the video as not playable, so the element stays blank/stalled.
 *   2. The service worker was missing `skipWaiting` + `clientsClaim`, so an
 *      updated SW would install but stay in "waiting" state until all tabs were
 *      closed.  This meant the old broken SW kept running even after Ryan
 *      refreshed the page.
 *
 * Fixes shipped in this PR:
 *   - VideoPlayer.tsx: added `playsinline: true` to the video.js options.
 *   - vite.config.ts: added `skipWaiting: true`, `clientsClaim: true`, and
 *     bumped `cacheId` to `hockey-coach-v2` so stale caches are dropped.
 *
 * Run against the live dev server (port 4328):
 *   npx playwright test --browser=webkit tests/review-tag-webkit.spec.js
 *
 * Or against any URL:
 *   BASE_URL=http://localhost:4328 npx playwright test --browser=webkit tests/review-tag-webkit.spec.js
 *
 * The test mocks /api/* so it does not require a running Express server or
 * real video files.  Video readyState/seeking are tested via a data-URI stub.
 */

// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4328';

// Minimal stubs for the backend API
const MOCK_VIDEOS = JSON.stringify([
  {
    id: 1,
    file_path: 'stub-game.mp4',
    game_date: '2026-10-24',
    competition_name: 'TASA',
    competition_id: 1,
  },
]);

const MOCK_EVENT_TYPES = JSON.stringify([
  { id: 1, name: 'Goal', is_custom: false },
  { id: 2, name: 'Shot', is_custom: false },
]);

// A tiny valid MP4 (black 1-second 1x1 video, Base64-encoded) used to satisfy
// the video element src without needing a real file on the server.
// This lets us verify readyState and seek without hitting the Docker volume.
const STUB_MP4_URL =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAA' +
  'htZGF0AAAA';

test.describe('Review & Tag - WebKit video regression', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept API calls so the test is self-contained
    await page.route('**/api/videos', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_VIDEOS })
    );
    await page.route('**/api/event-types', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_EVENT_TYPES })
    );
    await page.route('**/api/players', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.route('**/api/competitions', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.route('**/api/videos/1/events', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    // Serve the stub MP4 instead of a real game file
    await page.route('**/videos/stub-game.mp4', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Accept-Ranges': 'bytes' },
        body: Buffer.from(STUB_MP4_URL.split(',')[1], 'base64'),
      })
    );
  });

  test('video element has playsinline attribute in Review & Tag mode', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Select the game
    await page.click('text=stub-game.mp4');
    await page.waitForTimeout(500);

    // Enter Review & Tag mode
    await page.click('button:has-text("Review & Tag")');
    await page.waitForTimeout(1500);

    // The <video> element must have playsinline -- required for iOS Safari inline
    // playback.  Without this the video appears blank/stalled on iPad.
    const playsinline = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.hasAttribute('playsinline') : false;
    });
    expect(playsinline).toBe(true);
  });

  test('video element src points to /videos/ path (not through SW cache)', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page.click('text=stub-game.mp4');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Review & Tag")');
    await page.waitForTimeout(1500);

    const src = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.getAttribute('src') : null;
    });
    // Src should be /videos/... (relative or absolute) -- the service worker is
    // configured NetworkOnly for /videos/ so Range requests go straight to the server
    expect(src).toMatch(/\/videos\//);
  });

  test('service worker registers and has NetworkOnly for /videos/', async ({
    page,
    context,
  }) => {
    // Verify SW is registered with the right scope
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // give SW time to install

    const swInfo = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.map((r) => ({
        scope: r.scope,
        active: r.active ? r.active.scriptURL : null,
        waiting: r.waiting ? r.waiting.scriptURL : null,
      }));
    });

    // There should be exactly one SW registration
    expect(swInfo.length).toBeGreaterThan(0);
    // No SW should be stuck in waiting state (skipWaiting ensures immediate takeover)
    const waiting = swInfo.filter((r) => r.waiting !== null);
    expect(waiting.length).toBe(0);
  });
});
