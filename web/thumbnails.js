'use strict';

// ---------------------------------------------------------------------------
// Timeline thumbnails -- one 160x90 frame per second of game, packed into
// 10x10 sprite sheets (100 seconds per JPEG) so a 90-minute game is ~55 files
// and ~20 MB. Generated once per video by ffmpeg in a background queue (about
// a minute per game) and served statically from /analysis/<videoId>/.
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const INTERVAL_SEC = 1;
const THUMB_W = 160;
const THUMB_H = 90;
const COLS = 10;
const ROWS = 10;

function createThumbnailService({ videoDir, analysisDir }) {
  fs.mkdirSync(analysisDir, { recursive: true });

  const queue = [];
  // videoId -> { state: 'queued' | 'running' | 'error', progress, error }
  const jobs = new Map();
  let running = false;

  const dirFor = (videoId) => path.join(analysisDir, String(videoId));
  const metaPath = (videoId) => path.join(dirFor(videoId), 'meta.json');

  function readMeta(videoId) {
    try {
      return JSON.parse(fs.readFileSync(metaPath(videoId), 'utf8'));
    } catch {
      return null;
    }
  }

  function status(videoId) {
    const meta = readMeta(videoId);
    if (meta) return { status: 'ready', ...meta };
    const job = jobs.get(videoId);
    if (job) return { status: job.state, progress: job.progress, error: job.error };
    return { status: 'missing' };
  }

  function enqueue(video) {
    if (readMeta(video.id)) return;
    const job = jobs.get(video.id);
    if (job && job.state !== 'error') return;
    jobs.set(video.id, { state: 'queued', progress: 0 });
    queue.push(video);
    pump();
  }

  function probeDuration(file) {
    return new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
        (err, stdout) => {
          if (err) return reject(err);
          const d = parseFloat(stdout);
          return Number.isFinite(d) ? resolve(d) : reject(new Error('Could not read duration'));
        }
      );
    });
  }

  async function generate(video) {
    const job = jobs.get(video.id);
    const src = path.join(videoDir, video.file_path);
    // Write into a temp dir and rename at the end, so a half-finished run is
    // never mistaken for a complete one.
    const tmp = `${dirFor(video.id)}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });

    const duration = await probeDuration(src);
    const filter =
      `fps=1/${INTERVAL_SEC},` +
      `scale=${THUMB_W}:${THUMB_H}:force_original_aspect_ratio=decrease,` +
      `pad=${THUMB_W}:${THUMB_H}:(ow-iw)/2:(oh-ih)/2,` +
      `tile=${COLS}x${ROWS}`;

    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-v', 'error', '-nostats', '-progress', 'pipe:1',
        '-i', src, '-vf', filter, '-q:v', '6',
        path.join(tmp, 'sprite_%03d.jpg'),
      ]);
      let stderr = '';
      ff.stdout.on('data', (chunk) => {
        const m = /out_time_us=(\d+)/.exec(chunk.toString());
        if (m) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / duration);
      });
      ff.stderr.on('data', (chunk) => { stderr += chunk; });
      ff.on('error', reject);
      ff.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited ${code}`))
      );
    });

    const sheets = fs.readdirSync(tmp).filter((f) => f.startsWith('sprite_')).length;
    const meta = {
      interval: INTERVAL_SEC,
      width: THUMB_W,
      height: THUMB_H,
      cols: COLS,
      rows: ROWS,
      sheets,
      duration,
    };
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta));
    fs.rmSync(dirFor(video.id), { recursive: true, force: true });
    fs.renameSync(tmp, dirFor(video.id));
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const video = queue.shift();
      const job = jobs.get(video.id);
      job.state = 'running';
      const started = Date.now();
      try {
        await generate(video);
        jobs.delete(video.id);
        console.log(`[thumbnails] video ${video.id} done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
      } catch (e) {
        job.state = 'error';
        job.error = e.message;
        console.error(`[thumbnails] video ${video.id} failed: ${e.message}`);
      }
    }
    running = false;
  }

  return { enqueue, status };
}

module.exports = { createThumbnailService };
