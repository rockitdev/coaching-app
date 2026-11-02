'use strict';

// ---------------------------------------------------------------------------
// Highlight reels -- cut a window around each selected tag and join them into
// one MP4. Each clip is its own fast-seeked ffmpeg input (`-ss` before `-i`),
// normalised to a common size / frame rate / audio format, optionally
// captioned, then joined with the concat filter in a single re-encode pass so
// cuts land on the exact frame rather than the nearest keyframe.
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const FONT = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';
const MAX_CLIPS = 150;
const KEEP_MS = 24 * 60 * 60 * 1000; // finished reels are deleted after a day

function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', file],
      (err, stdout) => {
        if (err) return reject(err);
        const streams = JSON.parse(stdout).streams || [];
        const v = streams.find((s) => s.codec_type === 'video');
        if (!v) return reject(new Error(`No video stream in ${path.basename(file)}`));
        resolve({ width: v.width, height: v.height, hasAudio: streams.some((s) => s.codec_type === 'audio') });
      }
    );
  });
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function createExportService({ videoDir, exportDir }) {
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.mkdirSync(exportDir, { recursive: true });

  // id -> { state: queued|running|ready|error, progress, error, file, downloadName, clips, duration }
  const jobs = new Map();
  const queue = [];
  let running = false;

  function status(id) {
    const job = jobs.get(id);
    if (!job) return null;
    const { state, progress, error, clips, duration } = job;
    return { id, state, progress, error, clips: clips.length, duration };
  }

  function fileFor(id) {
    const job = jobs.get(id);
    return job && job.state === 'ready' ? { path: job.file, downloadName: job.downloadName } : null;
  }

  // clips: [{ file, start, end, caption }] in output order.
  function start({ clips, downloadName }) {
    if (clips.length === 0) throw new Error('No clips to export');
    if (clips.length > MAX_CLIPS) throw new Error(`Too many clips (${clips.length}); the limit is ${MAX_CLIPS}`);
    const id = crypto.randomBytes(6).toString('hex');
    const duration = clips.reduce((s, c) => s + (c.end - c.start), 0);
    jobs.set(id, { state: 'queued', progress: 0, clips, duration, downloadName });
    queue.push(id);
    pump();
    return status(id);
  }

  async function render(id) {
    const job = jobs.get(id);
    const work = path.join(exportDir, `${id}.tmp`);
    fs.mkdirSync(work, { recursive: true });

    const sources = new Map();
    for (const c of job.clips) {
      if (!sources.has(c.file)) sources.set(c.file, await probe(path.join(videoDir, c.file)));
    }
    // Output at the largest source size (capped at 1080p) so mixed games line up.
    const tallest = [...sources.values()].reduce((a, b) => (b.height > a.height ? b : a));
    const height = even(Math.min(1080, tallest.height));
    const width = even((height * tallest.width) / tallest.height);
    const captions = fs.existsSync(FONT);

    const args = ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-y'];
    const filters = [];
    const joins = [];
    job.clips.forEach((c, i) => {
      const len = (c.end - c.start).toFixed(3);
      args.push('-ss', c.start.toFixed(3), '-t', len, '-i', path.join(videoDir, c.file));
      let v =
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      if (captions && c.caption) {
        // textfile= sidesteps drawtext's escaping rules for names and symbols.
        const textFile = path.join(work, `caption_${i}.txt`);
        fs.writeFileSync(textFile, c.caption);
        v +=
          `,drawtext=fontfile=${FONT}:textfile=${textFile}:fontsize=h/22:fontcolor=white:` +
          `box=1:boxcolor=black@0.6:boxborderw=12:x=24:y=h-th-28`;
      }
      filters.push(`${v}[v${i}]`);
      if (sources.get(c.file).hasAudio) {
        filters.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${len}[a${i}]`);
      }
      joins.push(`[v${i}][a${i}]`);
    });
    filters.push(`${joins.join('')}concat=n=${job.clips.length}:v=1:a=1[v][a]`);

    // A filter graph this long can exceed argv limits, so pass it as a file.
    const graphFile = path.join(work, 'graph.txt');
    fs.writeFileSync(graphFile, filters.join(';\n'));
    const out = path.join(exportDir, `${id}.mp4`);
    args.push(
      '-filter_complex_script', graphFile,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      out
    );

    try {
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', args);
        let stderr = '';
        ff.stdout.on('data', (chunk) => {
          const m = /out_time_us=(\d+)/.exec(chunk.toString());
          if (m) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / job.duration);
        });
        ff.stderr.on('data', (chunk) => { stderr += chunk; });
        ff.on('error', reject);
        ff.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited ${code}`))
        );
      });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    job.file = out;
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const id = queue.shift();
      const job = jobs.get(id);
      job.state = 'running';
      const started = Date.now();
      try {
        await render(id);
        job.state = 'ready';
        job.progress = 1;
        console.log(`[exports] ${id}: ${job.clips.length} clips in ${((Date.now() - started) / 1000).toFixed(0)}s`);
      } catch (e) {
        job.state = 'error';
        job.error = e.message;
        console.error(`[exports] ${id} failed: ${e.message}`);
      }
      setTimeout(() => {
        if (job.file) fs.rmSync(job.file, { force: true });
        jobs.delete(id);
      }, KEEP_MS).unref();
    }
    running = false;
  }

  return { start, status, fileFor };
}

module.exports = { createExportService };
