'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 4321;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const DB_PATH = path.join(DATA_DIR, 'hockey-coach.db');

// Ensure directories exist
fs.mkdirSync(VIDEO_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Core tables (unchanged from original)
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_types (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS videos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id      INTEGER NOT NULL REFERENCES videos(id)      ON DELETE CASCADE,
    event_type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
    timestamp     REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_player_associations (
    event_id  INTEGER NOT NULL REFERENCES events(id)  ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, player_id)
  );
`);

// Competitions table (new)
db.exec(`
  CREATE TABLE IF NOT EXISTS competitions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0
  );
`);

// Seed default competition types if none exist
const compCount = db.prepare('SELECT COUNT(*) as c FROM competitions WHERE is_custom = 0').get();
if (compCount.c === 0) {
  const insertComp = db.prepare('INSERT INTO competitions (name, is_custom) VALUES (?, 0)');
  for (const name of ['Regular season', 'Pre-season', 'Playoffs']) insertComp.run(name);
  console.log('Default competition types inserted');
}

// Add game_date and competition_id columns to videos if missing (idempotent)
const videosCols = db.pragma('table_info(videos)').map(c => c.name);
if (!videosCols.includes('game_date')) {
  db.exec('ALTER TABLE videos ADD COLUMN game_date TEXT');
  console.log('Added game_date column to videos');
}
if (!videosCols.includes('competition_id')) {
  db.exec('ALTER TABLE videos ADD COLUMN competition_id INTEGER REFERENCES competitions(id)');
  console.log('Added competition_id column to videos');
}

// Backfill the 3 existing games (idempotent: only if game_date IS NULL)
const regularSeasonRow = db.prepare("SELECT id FROM competitions WHERE name = 'Regular season'").get();
if (regularSeasonRow) {
  const rid = regularSeasonRow.id;
  // Game 1 = 2026-10-18, Game 2 = 2026-10-24, Game 3 = 2026-10-25
  const backfills = [
    { id: 1, date: '2026-10-18' },
    { id: 2, date: '2026-10-24' },
    { id: 3, date: '2026-10-25' },
  ];
  const upd = db.prepare(
    'UPDATE videos SET game_date = ?, competition_id = ? WHERE id = ? AND game_date IS NULL'
  );
  for (const row of backfills) upd.run(row.date, rid, row.id);
}

// Insert default event types if none exist
const defaultTypes = ['Shot', 'Faceoff', 'Zone Entry', 'Turnover', 'Goal', 'Penalty', 'Save'];
const typeCount = db.prepare('SELECT COUNT(*) as c FROM event_types WHERE is_custom = 0').get();
if (typeCount.c === 0) {
  const insert = db.prepare('INSERT INTO event_types (name, is_custom) VALUES (?, 0)');
  for (const name of defaultTypes) insert.run(name);
  console.log('Default event types inserted');
}

// ---------------------------------------------------------------------------
// File upload -- multer config
// ---------------------------------------------------------------------------
const ALLOWED_EXTENSIONS = new Set(['mp4', 'webm']);
const REJECTED_EXTENSIONS = new Set(['mov', 'avi', 'mkv', 'wmv']);

function getExt(filename) {
  return path.extname(filename).toLowerCase().replace(/^\./, '');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEO_DIR),
  filename: (_req, file, cb) => {
    // Prefix with timestamp to avoid collisions on duplicate filenames
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = getExt(file.originalname);
    if (REJECTED_EXTENSIONS.has(ext)) {
      return cb(new Error(
        `Unsupported format: .${ext} files do not play in browsers. ` +
        `Please export your video as MP4 (H.264) first. ` +
        `(MOV, AVI, MKV, WMV are not supported.)`
      ));
    }
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported format: .${ext}. Accepted formats: MP4, WebM.`));
    }
    cb(null, true);
  },
  // Limit to 10 GB to be safe, but no artificial lower limit
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Video file serving with byte-range support (for seeking in video.js)
// ---------------------------------------------------------------------------
app.get('/videos/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(VIDEO_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    // Parse Range header: "bytes=start-end"
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 10 * 1024 * 1024, fileSize - 1);

    if (start >= fileSize || end >= fileSize || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }

    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fileStream.pipe(res);
  } else {
    // No range -- serve the whole file (small files, or initial metadata load)
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// --- Competitions ---

// GET /api/competitions
app.get('/api/competitions', (_req, res) => {
  res.json(db.prepare('SELECT * FROM competitions ORDER BY is_custom, id').all());
});

// POST /api/competitions  -- add a custom competition
app.post('/api/competitions', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('INSERT INTO competitions (name, is_custom) VALUES (?, 1)').run(name.trim());
    res.json({ id: result.lastInsertRowid, name: name.trim(), is_custom: 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Videos ---

// POST /api/upload -- upload a video file
// game_date and competition_id are optional multipart text fields
app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      return res.status(415).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file received' });
    }

    // Store only the basename as file_path (the server knows where to find it)
    const filePath = req.file.filename;
    const gameDate = (req.body.game_date || '').trim() || null;
    const competitionId = req.body.competition_id ? parseInt(req.body.competition_id, 10) || null : null;

    try {
      const existing = db.prepare('SELECT id, file_path, game_date, competition_id FROM videos WHERE file_path = ?').get(filePath);
      if (existing) {
        return res.json(existing);
      }
      const result = db.prepare(
        'INSERT INTO videos (file_path, game_date, competition_id) VALUES (?, ?, ?)'
      ).run(filePath, gameDate, competitionId);
      res.json({ id: result.lastInsertRowid, file_path: filePath, game_date: gameDate, competition_id: competitionId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /api/videos -- latest-first by game_date, then by id DESC
app.get('/api/videos', (_req, res) => {
  const rows = db.prepare(`
    SELECT v.id, v.file_path, v.game_date, v.competition_id,
           c.name AS competition_name, c.is_custom AS competition_is_custom
    FROM videos v
    LEFT JOIN competitions c ON v.competition_id = c.id
    ORDER BY
      CASE WHEN v.game_date IS NULL THEN 1 ELSE 0 END,
      v.game_date DESC,
      v.id DESC
  `).all();
  res.json(rows);
});

// PATCH /api/videos/:id -- update game_date and/or competition_id
app.patch('/api/videos/:id', (req, res) => {
  const { id } = req.params;
  const { game_date, competition_id } = req.body;

  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const newDate = game_date !== undefined ? (game_date || null) : video.game_date;
  const newComp = competition_id !== undefined ? (competition_id || null) : video.competition_id;

  db.prepare('UPDATE videos SET game_date = ?, competition_id = ? WHERE id = ?')
    .run(newDate, newComp, id);

  const updated = db.prepare(`
    SELECT v.id, v.file_path, v.game_date, v.competition_id,
           c.name AS competition_name
    FROM videos v
    LEFT JOIN competitions c ON v.competition_id = c.id
    WHERE v.id = ?
  `).get(id);

  res.json(updated);
});

// --- Event types ---

// GET /api/event-types
app.get('/api/event-types', (_req, res) => {
  res.json(db.prepare('SELECT * FROM event_types ORDER BY id').all());
});

// POST /api/event-types
app.post('/api/event-types', (req, res) => {
  const { name, is_custom } = req.body;
  const result = db.prepare('INSERT INTO event_types (name, is_custom) VALUES (?, ?)').run(name, is_custom ? 1 : 0);
  res.json({ id: result.lastInsertRowid, name, is_custom: is_custom ? 1 : 0 });
});

// --- Players ---

// GET /api/players
app.get('/api/players', (_req, res) => {
  res.json(db.prepare('SELECT * FROM players ORDER BY name').all());
});

// POST /api/players
app.post('/api/players', (req, res) => {
  const { name } = req.body;
  const result = db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
  res.json({ id: result.lastInsertRowid, name });
});

// PUT /api/players/:id
app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const result = db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, id);
  res.json({ id: parseInt(id), name, changes: result.changes });
});

// DELETE /api/players/:id
app.delete('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(id);
  res.json({ id: parseInt(id), changes: result.changes });
});

// GET /api/players/:id/events
app.get('/api/players/:id/events', (req, res) => {
  const { id } = req.params;
  const rows = db.prepare(`
    SELECT e.id, e.timestamp, e.video_id, v.file_path, v.game_date,
           c.name AS competition_name,
           et.name as event_type_name, et.id as event_type_id
    FROM events e
    JOIN event_player_associations epa ON e.id = epa.event_id
    JOIN videos v ON e.video_id = v.id
    JOIN event_types et ON e.event_type_id = et.id
    LEFT JOIN competitions c ON v.competition_id = c.id
    WHERE epa.player_id = ?
    ORDER BY v.game_date DESC, v.file_path, e.timestamp
  `).all(id);
  res.json(rows);
});

// --- Events ---

// GET /api/events?videoId=N
app.get('/api/events', (req, res) => {
  const videoId = parseInt(req.query.videoId);
  if (isNaN(videoId)) return res.status(400).json({ error: 'videoId required' });

  const rows = db.prepare(`
    SELECT e.id, e.timestamp, e.event_type_id, et.name as event_type_name
    FROM events e
    JOIN event_types et ON e.event_type_id = et.id
    WHERE e.video_id = ?
    ORDER BY e.timestamp
  `).all(videoId);

  // Fetch player associations
  const events = rows.map((row) => {
    const players = db.prepare(`
      SELECT p.id, p.name
      FROM event_player_associations epa
      JOIN players p ON epa.player_id = p.id
      WHERE epa.event_id = ?
    `).all(row.id);
    return { ...row, players };
  });

  res.json(events);
});

// GET /api/events/:id
app.get('/api/events/:id', (req, res) => {
  const { id } = req.params;
  const row = db.prepare(`
    SELECT e.id, e.timestamp, e.event_type_id, e.video_id, et.name as event_type_name
    FROM events e
    JOIN event_types et ON e.event_type_id = et.id
    WHERE e.id = ?
  `).get(id);

  if (!row) return res.status(404).json({ error: 'Event not found' });

  const players = db.prepare(`
    SELECT p.id, p.name
    FROM event_player_associations epa
    JOIN players p ON epa.player_id = p.id
    WHERE epa.event_id = ?
  `).all(id);

  res.json({ ...row, players });
});

// POST /api/events
app.post('/api/events', (req, res) => {
  const { videoId, eventTypeId, timestamp } = req.body;
  const result = db.prepare(
    'INSERT INTO events (video_id, event_type_id, timestamp) VALUES (?, ?, ?)'
  ).run(videoId, eventTypeId, timestamp);
  res.json({ id: result.lastInsertRowid, video_id: videoId, event_type_id: eventTypeId, timestamp });
});

// POST /api/events/:id/players  -- add a single player association
app.post('/api/events/:id/players', (req, res) => {
  const { id } = req.params;
  const { playerId } = req.body;
  db.prepare(
    'INSERT OR IGNORE INTO event_player_associations (event_id, player_id) VALUES (?, ?)'
  ).run(id, playerId);
  res.json({ event_id: parseInt(id), player_id: playerId });
});

// PUT /api/events/:id/players  -- replace all player associations
app.put('/api/events/:id/players', (req, res) => {
  const { id } = req.params;
  const { playerIds } = req.body;

  const doUpdate = db.transaction(() => {
    db.prepare('DELETE FROM event_player_associations WHERE event_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO event_player_associations (event_id, player_id) VALUES (?, ?)');
    for (const pid of (playerIds || [])) ins.run(id, pid);
  });
  doUpdate();

  res.json({ eventId: parseInt(id), updated: true });
});

// DELETE /api/events/:id
app.delete('/api/events/:id', (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.json({ eventId: parseInt(id), deleted: true, changes: result.changes });
});

// ---------------------------------------------------------------------------
// Catch-all: serve index.html for any non-API route (SPA fallback)
// ---------------------------------------------------------------------------
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hockey Coach Web running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Videos stored in: ${VIDEO_DIR}`);
});
