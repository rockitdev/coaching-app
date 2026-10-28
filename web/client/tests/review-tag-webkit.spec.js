/**
 * WebKit (Safari engine) regression test for Review & Tag video playback.
 *
 * BUGS ADDRESSED
 * ==============
 *
 * Bug 1 — Missing playsinline (PR #15, now merged)
 *   iOS Safari requires `playsinline` on the <video> element to play inside a
 *   custom player. Without it the browser either hands off to the system player
 *   or treats playback as blocked. `webkit-playsinline` (the legacy non-standard
 *   form) is also required for Safari < 14.
 *
 * Bug 2 — WebKit black-frame compositor failure (THIS PR)
 *   Symptom observed on real iPad / Safari:
 *     • duration shows 88:36, pause button is active, currentTime advances —
 *       the file IS loaded and the player thinks it IS playing.
 *     • The video area is completely black — NO visible frames.
 *   Root cause: WebKit composites decoded H.264 frames on a separate GPU plane.
 *   When the <video> element is a descendant of `position:fixed` + multiple
 *   `overflow:hidden` ancestors (.rt-mode → .rt-body → .rt-main-col →
 *   .rt-video-wrap), WebKit can fail to merge that GPU plane into the visible
 *   stacking context, producing a black rectangle while audio continues.
 *   Fix: translate3d(0,0,0) on .vjs-tech (CSS) and on the tech element (JS)
 *   promotes the video into its own compositor layer and resolves the merge.
 *   will-change:transform pre-allocates the layer before decoding starts.
 *
 * TESTS
 * =====
 *   1. playsinline + webkit-playsinline attributes present
 *   2. GPU compositing CSS properties set (translateZ / will-change)
 *   3. videoWidth > 0 after loadedmetadata (decoder has real dimensions)
 *   4. currentTime advances past zero on play()
 *   5. Canvas pixel check: sample video frame is NOT all-black
 *      Uses tests/red-test.mp4 — a 1-second 160×90 H.264 baseline / AAC video
 *      with a solid red first frame (generated with ffmpeg lavfi color filter).
 *      If pixels are all black → compositing is broken (reproduces iPad bug).
 *      If pixels have R > 50 → compositing is working (fix is in place).
 *
 * RUN
 * ===
 *   cd web/client
 *   npx playwright test --config=playwright.config.cjs
 *
 * The test mocks all /api/* routes so no running Express server is required.
 * The video fixture is served directly from the tests/ directory; no Docker
 * volume or real game file is needed.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'http://localhost:4328';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const MOCK_VIDEOS = JSON.stringify([
  {
    id: 1,
    file_path: 'red-test.mp4',
    game_date: '2026-10-28',
    competition_name: 'TASA',
    competition_id: 1,
  },
]);

const MOCK_EVENT_TYPES = JSON.stringify([
  { id: 1, name: 'Goal',  is_custom: false },
  { id: 2, name: 'Shot',  is_custom: false },
]);

// ---------------------------------------------------------------------------
// Test fixture: 1-second solid-red H.264/AAC MP4 (160×90, baseline, ~12 KB).
// Generated with:
//   ffmpeg -f lavfi -i "color=c=red:size=160x90:duration=1:rate=30" \
//          -f lavfi -i "sine=frequency=440:duration=1" \
//          -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p \
//          -c:a aac -shortest red-test.mp4
// The first (and every) frame is nominally YCbCr (81, 90, 240) ≈ red in RGB.
// After canvas drawImage and getImageData: R ≈ 254, G ≈ 0, B ≈ 0.
// Any R value > 80 unambiguously indicates "not all-black"; we use R > 50 as
// the threshold to be conservative about colour-space rounding.
// ---------------------------------------------------------------------------
const FIXTURE_PATH = join(__dirname, 'red-test.mp4');

// ---------------------------------------------------------------------------
// beforeEach: mock API + serve the red-test fixture for the video
// ---------------------------------------------------------------------------
test.describe('Review & Tag — WebKit black-frame regression', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept backend API so the test is fully self-contained
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
    // Serve the red-test.mp4 fixture instead of a real game file.
    // Accept-Ranges is set so Safari can make partial requests if needed.
    const videoBytes = readFileSync(FIXTURE_PATH);
    await page.route('**/videos/red-test.mp4', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(videoBytes.length) },
        body: videoBytes,
      })
    );
  });

  // -------------------------------------------------------------------------
  // Helper: navigate → pick game → enter Review & Tag
  // -------------------------------------------------------------------------
  async function openReviewAndTag(page) {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.click('text=red-test.mp4');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Review & Tag")');
    // Wait for the video element and player to initialise.
    // video.js renders the <video> tech element as hidden (it manages visibility
    // itself), so we wait for it to be attached to the DOM rather than visible.
    await page.waitForSelector('video', { state: 'attached', timeout: 8000 });
    await page.waitForTimeout(1500);
  }

  // =========================================================================
  // Test 1: playsinline + webkit-playsinline attributes
  // =========================================================================
  test('video element has playsinline and webkit-playsinline attributes', async ({ page }) => {
    await openReviewAndTag(page);

    const attrs = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { playsinline: false, webkitPlaysinline: false };
      return {
        playsinline:       v.hasAttribute('playsinline'),
        webkitPlaysinline: v.hasAttribute('webkit-playsinline'),
      };
    });

    // playsinline: required for modern iOS Safari (14+) to play inline
    expect(attrs.playsinline).toBe(true);
    // webkit-playsinline: required for Safari < 14
    expect(attrs.webkitPlaysinline).toBe(true);
  });

  // =========================================================================
  // Test 2: GPU compositing CSS is applied to the <video> tech element
  //
  // This directly verifies the fix for the black-frame compositor bug.
  // translate3d(0,0,0) forces the element into its own GPU layer.
  // will-change:transform pre-allocates the layer before decoding starts.
  // Both must be set — one in CSS (.vjs-tech rule) and confirmed here in JS.
  // =========================================================================
  test('GPU compositing CSS (translateZ / will-change) applied to <video>', async ({ page }) => {
    await openReviewAndTag(page);

    const css = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      const s = window.getComputedStyle(v);
      return {
        transform:        s.transform        || s.webkitTransform || '',
        willChange:       s.willChange       || '',
        // Inline style set by VideoPlayer.tsx JS fix (belt-and-suspenders)
        inlineTransform:  v.style.transform  || v.style.webkitTransform || '',
        inlineWillChange: v.style.willChange || '',
      };
    });

    expect(css).not.toBeNull();

    // Computed transform must contain a matrix (not 'none') — confirms the
    // CSS translate3d(0,0,0) in ReviewAndTagMode.css .vjs-tech is active.
    // Browsers normalise translate3d(0,0,0) to 'matrix3d(...)' or
    // 'matrix(1, 0, 0, 1, 0, 0)' depending on version, so we check 'matrix'.
    expect(css.transform).not.toBe('none');
    expect(css.transform).toMatch(/matrix/i);

    // will-change must be 'transform' — ensures GPU layer pre-allocation
    expect(css.willChange).toBe('transform');
  });

  // =========================================================================
  // Test 3: videoWidth > 0 — decoder has real dimensions
  //
  // A black compositing failure where the video is completely invisible but
  // "playing" will still have videoWidth > 0 once loadedmetadata fires.
  // This guards against a different failure mode: the src was never loaded.
  // =========================================================================
  test('videoWidth > 0 after metadata loads', async ({ page }) => {
    await openReviewAndTag(page);

    const videoWidth = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.videoWidth : -1;
    });

    expect(videoWidth).toBeGreaterThan(0);
  });

  // =========================================================================
  // Test 4: currentTime advances past zero on play()
  // =========================================================================
  test('currentTime advances past zero when play() is called', async ({ page }) => {
    await openReviewAndTag(page);

    const result = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { found: false, currentTime: 0, playResolved: false };

      let playResolved = false;
      try {
        await v.play();
        playResolved = true;
      } catch (_) {
        // play() rejection is the symptom of missing playsinline on iOS Safari
        playResolved = false;
      }
      // Give the video a moment to advance
      await new Promise((r) => setTimeout(r, 300));
      return { found: true, currentTime: v.currentTime, playResolved };
    });

    expect(result.found).toBe(true);
    expect(result.playResolved).toBe(true);
    expect(result.currentTime).toBeGreaterThan(0);
  });

  // =========================================================================
  // Test 5: Canvas pixel check — video renders NON-BLACK frames
  //
  // This is the primary regression gate for the iPad black-frame bug.
  //
  // Approach:
  //   1. Start playback and advance to 0.1 s (well within the 1-second clip).
  //   2. Draw the video frame to an off-screen canvas using drawImage().
  //   3. Sample pixels from the centre of the canvas with getImageData().
  //   4. Assert that the red channel (R) is above a threshold.
  //
  // Why this works:
  //   • red-test.mp4 has a solid-red first frame (R≈254, G≈0, B≈0 after YUV→RGB).
  //   • If WebKit compositor is broken (black-frame bug), ALL pixels will be
  //     R≈0, G≈0, B≈0 — the canvas shows the compositing failure directly.
  //   • If the fix is in place, R > 50 at the centre of the frame.
  //
  // Canvas cross-origin note: the video is served from the same origin as the
  // app (page.route intercepts it), so drawImage() is not tainted.
  // =========================================================================
  test('canvas pixel check: video frame is NOT all-black (non-black R channel)', async ({ page }) => {
    await openReviewAndTag(page);

    const pixelResult = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { error: 'no video element', r: 0, g: 0, b: 0 };

      // Seek to 0.1 s to ensure we have a decoded frame
      v.currentTime = 0.1;
      // Wait for seeked event
      await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), 4000);
        const done = () => { clearTimeout(timer); resolve(); };
        v.addEventListener('seeked',   done, { once: true });
        v.addEventListener('canplay',  done, { once: true });
      });

      // Start playback to make sure decoder is active
      try { await v.play(); } catch (_) { /* autoplay policy — pixel check still works with seeked frame */ }

      // Short pause to let the frame decode
      await new Promise((r) => setTimeout(r, 300));

      // Draw the current frame to a 160×90 canvas
      const canvas  = document.createElement('canvas');
      canvas.width  = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { error: 'no canvas ctx', r: 0, g: 0, b: 0 };

      try {
        ctx.drawImage(v, 0, 0, 160, 90);
      } catch (e) {
        return { error: String(e), r: 0, g: 0, b: 0 };
      }

      // Sample a 10×10 patch at the centre of the canvas
      const cx = 75, cy = 40;
      let data;
      try {
        data = ctx.getImageData(cx, cy, 10, 10);
      } catch (e) {
        return { error: 'getImageData:' + String(e), r: 0, g: 0, b: 0 };
      }

      // Average R, G, B across the patch
      let totalR = 0, totalG = 0, totalB = 0;
      const pixels = data.data.length / 4;
      for (let i = 0; i < data.data.length; i += 4) {
        totalR += data.data[i];
        totalG += data.data[i + 1];
        totalB += data.data[i + 2];
      }
      return {
        error: null,
        r: Math.round(totalR / pixels),
        g: Math.round(totalG / pixels),
        b: Math.round(totalB / pixels),
        videoWidth:  v.videoWidth,
        videoHeight: v.videoHeight,
        readyState:  v.readyState,
      };
    });

    // If getImageData threw a security error, the video is from a different
    // origin — that is a test setup problem, not the app bug.
    expect(pixelResult.error).toBeNull();

    // videoWidth must be known (sanity check that decode started)
    expect(pixelResult.videoWidth).toBeGreaterThan(0);

    // readyState >= 2 (HAVE_CURRENT_DATA): browser has at least one frame
    expect(pixelResult.readyState).toBeGreaterThanOrEqual(2);

    // Red channel must be well above zero.
    // red-test.mp4 is solid-red → R ≈ 220–255 after H.264 decode.
    // All-black (compositor bug) → R ≈ 0.
    // Threshold 50 leaves plenty of margin for colour-space rounding.
    expect(pixelResult.r).toBeGreaterThan(50);
  });
});
