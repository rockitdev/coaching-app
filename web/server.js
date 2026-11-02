'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');
const { createThumbnailService } = require('./thumbnails');
const { createExportService } = require('./exports');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 4321;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const DB_PATH = path.join(DATA_DIR, 'hockey-coach.db');
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');

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

// Teams: the coach runs more than one roster (e.g. TASA and Metro West
// Force). Every game and every player belongs to one team, and the UI shows
// one team at a time.
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE
  );
`);
const teamCount = db.prepare('SELECT COUNT(*) as c FROM teams').get();
if (teamCount.c === 0) {
  const insertTeam = db.prepare('INSERT INTO teams (name) VALUES (?)');
  for (const name of ['TASA', 'Metro West Force']) insertTeam.run(name);
  console.log('Default teams inserted');
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
// Hockey semantics (idempotent column adds)
//   events.team      'us' | 'them'  -- the team that performed the action
//   events.period    1-3, 4 = OT
//   events.strength  'EV' | 'PP' | 'PK' (from our point of view)
//   players.number / players.position
//   event_types.zone_rule -- how a tag of this type moves the zone ribbon:
//     entry  team carried the puck into its offensive zone
//     exit   team got the puck out of its defensive zone
//     attack team is attacking (shot, goal) -> its offensive zone
//     defend team is defending (save, block) -> its defensive zone
//     none   says nothing about zone
// ---------------------------------------------------------------------------
const TEAMS = ['us', 'them'];
const STRENGTHS = ['EV', 'PP', 'PK'];
const ZONE_RULES = ['entry', 'exit', 'attack', 'defend', 'none'];

// Shot details. A goal is a shot whose result is 'goal': the Shot and Goal tag
// types are both shot_kind types and are kept in step with shot_result (see
// syncShot), so the Goal hotkey still works and counts toward shot totals.
// Location is in feet on a half rink seen from the shooter, attacked net at
// the top: loc_x 0-85 across from the left boards, loc_y 0-100 from the end
// boards (goal line 11, blue line 75, centre line 100).
const SHOT_RESULTS = ['goal', 'saved', 'missed', 'blocked'];
const SHOT_TYPES = ['wrist', 'snap', 'slap', 'backhand', 'tip', 'wrap'];
const SHOT_SITUATIONS = ['rush', 'cycle', 'rebound', 'faceoff', 'point'];
const SHOT_COLS = 'e.shot_result, e.shot_type, e.shot_situation, e.loc_x, e.loc_y';
// Optional per-event fields accepted by POST / PATCH /api/events.
const EVENT_DETAIL_FIELDS = ['team', 'period', 'strength', 'shot_result', 'shot_type', 'shot_situation', 'loc_x', 'loc_y'];
const inList = (values) => values.map((v) => `'${v}'`).join(', ');

function addColumn(table, column, ddl) {
  const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
  if (cols.includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`Added ${column} column to ${table}`);
  return true;
}

addColumn('events', 'team', "TEXT CHECK (team IN ('us', 'them'))");
addColumn('events', 'period', 'INTEGER CHECK (period BETWEEN 1 AND 4)');
addColumn('events', 'strength', "TEXT CHECK (strength IN ('EV', 'PP', 'PK'))");
addColumn('players', 'number', 'INTEGER');
addColumn('players', 'position', 'TEXT');
addColumn('videos', 'team_id', 'INTEGER REFERENCES teams(id)');
addColumn('players', 'team_id', 'INTEGER REFERENCES teams(id)');
// Games and players from before teams existed belong to the first team.
{
  const firstTeam = db.prepare('SELECT id FROM teams ORDER BY id LIMIT 1').get();
  if (firstTeam) {
    db.prepare('UPDATE videos SET team_id = ? WHERE team_id IS NULL').run(firstTeam.id);
    db.prepare('UPDATE players SET team_id = ? WHERE team_id IS NULL').run(firstTeam.id);
  }
}
if (addColumn('event_types', 'zone_rule', "TEXT NOT NULL DEFAULT 'none'")) {
  // First run: give the built-in types their natural zone meaning.
  const setRule = db.prepare('UPDATE event_types SET zone_rule = ? WHERE name = ? AND is_custom = 0');
  for (const [name, rule] of [['Zone Entry', 'entry'], ['Shot', 'attack'], ['Goal', 'attack'], ['Save', 'defend']]) {
    setRule.run(rule, name);
  }
}
addColumn('events', 'shot_result', `TEXT CHECK (shot_result IN (${inList(SHOT_RESULTS)}))`);
addColumn('events', 'shot_type', `TEXT CHECK (shot_type IN (${inList(SHOT_TYPES)}))`);
addColumn('events', 'shot_situation', `TEXT CHECK (shot_situation IN (${inList(SHOT_SITUATIONS)}))`);
addColumn('events', 'loc_x', 'REAL CHECK (loc_x BETWEEN 0 AND 85)');
addColumn('events', 'loc_y', 'REAL CHECK (loc_y BETWEEN 0 AND 100)');
if (addColumn('event_types', 'shot_kind', "TEXT CHECK (shot_kind IN ('shot', 'goal'))")) {
  db.prepare("UPDATE event_types SET shot_kind = 'shot' WHERE name = 'Shot' AND is_custom = 0").run();
  db.prepare("UPDATE event_types SET shot_kind = 'goal' WHERE name = 'Goal' AND is_custom = 0").run();
  const n = db.prepare(`UPDATE events SET shot_result = 'goal'
    WHERE event_type_id IN (SELECT id FROM event_types WHERE shot_kind = 'goal')`).run().changes;
  console.log(`Marked ${n} existing Goal tags as shots with result goal`);
}
if (!db.prepare("SELECT 1 FROM event_types WHERE name = 'Zone Exit'").get()) {
  db.prepare("INSERT INTO event_types (name, is_custom, zone_rule) VALUES ('Zone Exit', 0, 'exit')").run();
  console.log('Added Zone Exit event type');
}

// Validates the optional hockey fields on an event write. Returns an error
// string, or null. `undefined` means "not provided"; null clears the field.
function validateEventFields({ team, period, strength, shot_result, shot_type, shot_situation, loc_x, loc_y }) {
  const oneOf = (v, list) => v === undefined || v === null || list.includes(v);
  if (!oneOf(shot_result, SHOT_RESULTS)) return `shot_result must be one of ${SHOT_RESULTS.join(', ')} or null`;
  if (!oneOf(shot_type, SHOT_TYPES)) return `shot_type must be one of ${SHOT_TYPES.join(', ')} or null`;
  if (!oneOf(shot_situation, SHOT_SITUATIONS)) {
    return `shot_situation must be one of ${SHOT_SITUATIONS.join(', ')} or null`;
  }
  if ((loc_x === undefined) !== (loc_y === undefined) || (loc_x === null) !== (loc_y === null)) {
    return 'loc_x and loc_y must be set (or cleared) together';
  }
  if (loc_x !== undefined && loc_x !== null) {
    const ok = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
    if (!ok(loc_x, 85) || !ok(loc_y, 100)) return 'loc_x must be 0-85 and loc_y 0-100 (feet)';
  }
  if (team !== undefined && team !== null && !TEAMS.includes(team)) return 'team must be us, them or null';
  if (period !== undefined && period !== null && !(Number.isInteger(period) && period >= 1 && period <= 4)) {
    return 'period must be 1-4 or null';
  }
  if (strength !== undefined && strength !== null && !STRENGTHS.includes(strength)) {
    return 'strength must be EV, PP, PK or null';
  }
  return null;
}

// Keeps the Shot / Goal tag type and shot_result in step on an event write.
// `fields` holds what is being written; `current` is the stored row (or null
// on create). Mutates `fields`.
function syncShot(fields, current) {
  const kindOf = (typeId) => db.prepare('SELECT shot_kind FROM event_types WHERE id = ?').get(typeId)?.shot_kind ?? null;
  const typeOfKind = (kind) => db.prepare('SELECT id FROM event_types WHERE shot_kind = ? ORDER BY id').get(kind)?.id;
  const typeId = fields.event_type_id ?? current?.event_type_id;
  const kind = kindOf(typeId);
  if (fields.shot_result !== undefined) {
    // Result decides the type: a goal is filed under Goal, anything else under Shot.
    if (fields.shot_result === 'goal' && kind === 'shot') fields.event_type_id = typeOfKind('goal') ?? typeId;
    if (fields.shot_result !== 'goal' && kind === 'goal') fields.event_type_id = typeOfKind('shot') ?? typeId;
  } else if (kind === 'goal') {
    fields.shot_result = 'goal';
  } else if (kind === 'shot' && fields.event_type_id !== undefined && current?.shot_result === 'goal') {
    fields.shot_result = null;
  }
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

// ---------------------------------------------------------------------------
// Timeline thumbnails (see thumbnails.js)
// ---------------------------------------------------------------------------
const thumbnails = createThumbnailService({ videoDir: VIDEO_DIR, analysisDir: ANALYSIS_DIR });

// Sprite sheets: immutable once written, so let browsers cache them hard.
app.use('/analysis', express.static(ANALYSIS_DIR, { maxAge: '30d', immutable: true }));

// GET /api/videos/:id/thumbnails -- { status: ready|queued|running|error|missing, ... }
app.get('/api/videos/:id/thumbnails', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const video = db.prepare('SELECT id, file_path FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  // Self-healing: anything without thumbnails (older uploads, a failed run) is
  // queued the first time someone opens it.
  const s = thumbnails.status(id);
  if (s.status === 'missing') {
    thumbnails.enqueue(video);
    return res.json(thumbnails.status(id));
  }
  res.json(s);
});

// ---------------------------------------------------------------------------
// Highlight reels (see exports.js)
// ---------------------------------------------------------------------------
const exportsService = createExportService({ videoDir: VIDEO_DIR, exportDir: EXPORT_DIR });

function periodName(p) {
  return p === 4 ? 'OT' : `P${p}`;
}

// POST /api/exports { videoId, typeIds, team: 'us'|'them'|null, pre, post, captions }
// Builds one clip per matching tag (overlapping windows are merged, so a shot
// and the goal two seconds later play as one clip) and queues the render.
app.post('/api/exports', (req, res) => {
  const { videoId, typeIds, team = null, pre = 6, post = 4, captions = true } = req.body || {};
  const video = db.prepare('SELECT id, file_path FROM videos WHERE id = ?').get(parseInt(videoId, 10));
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!Array.isArray(typeIds) || typeIds.length === 0 || !typeIds.every(Number.isInteger)) {
    return res.status(400).json({ error: 'typeIds must be a non-empty array of ids' });
  }
  if (team !== null && !TEAMS.includes(team)) return res.status(400).json({ error: 'Invalid team' });
  const preSec = Number(pre);
  const postSec = Number(post);
  if (!(preSec >= 0 && preSec <= 60 && postSec >= 0 && postSec <= 60 && preSec + postSec >= 1)) {
    return res.status(400).json({ error: 'pre and post must be 0-60 seconds' });
  }

  const events = db.prepare(`
    SELECT e.id, e.timestamp, e.team, e.period, e.strength, e.shot_type, e.shot_situation, et.name AS type
    FROM events e JOIN event_types et ON e.event_type_id = et.id
    WHERE e.video_id = ? AND e.event_type_id IN (${typeIds.map(() => '?').join(',')})
      ${team ? 'AND e.team = ?' : ''}
    ORDER BY e.timestamp
  `).all(video.id, ...typeIds, ...(team ? [team] : []));
  const playersFor = db.prepare(`
    SELECT p.name, p.number FROM event_player_associations epa
    JOIN players p ON epa.player_id = p.id WHERE epa.event_id = ?
    ORDER BY p.number IS NULL, p.number, p.name
  `);

  const clips = [];
  for (const e of events) {
    const start = Math.max(0, e.timestamp - preSec);
    const end = e.timestamp + postSec;
    const labels = [];
    const notes = [e.team === 'them' && 'them', e.shot_type, e.shot_situation].filter(Boolean);
    const typeLabel = notes.length ? `${e.type} (${notes.join(', ')})` : e.type;
    const players = playersFor.all(e.id).map((p) => (p.number !== null ? `#${p.number} ${p.name}` : p.name));
    const prev = clips[clips.length - 1];
    if (prev && start <= prev.end) {
      prev.end = Math.max(prev.end, end);
      if (!prev.types.includes(typeLabel)) prev.types.push(typeLabel);
      for (const p of players) if (!prev.players.includes(p)) prev.players.push(p);
      continue;
    }
    if (e.period) labels.push(periodName(e.period));
    if (e.strength && e.strength !== 'EV') labels.push(e.strength);
    clips.push({ file: video.file_path, start, end, labels, types: [typeLabel], players });
  }
  for (const c of clips) {
    c.caption = captions ? [...c.labels, c.types.join(' + '), ...(c.players.length ? [c.players.join(', ')] : [])].join('  ·  ') : '';
  }

  const title = video.file_path.replace(/^\d+_/, '').replace(/\.[^.]+$/, '');
  try {
    res.status(202).json(exportsService.start({ clips, downloadName: `${title} - highlights.mp4` }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/exports/:id -- { state: queued|running|ready|error, progress, clips, duration }
app.get('/api/exports/:id', (req, res) => {
  const s = exportsService.status(req.params.id);
  if (!s) return res.status(404).json({ error: 'Export not found (reels are kept for a day)' });
  res.json(s);
});

// GET /exports/:id -- the finished MP4, as a download
app.get('/exports/:id', (req, res) => {
  const f = exportsService.fileFor(req.params.id);
  if (!f) return res.status(404).json({ error: 'Export not ready' });
  res.download(f.path, f.downloadName);
});

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

// --- Teams ---

function parseTeamId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = parseInt(value, 10);
  return Number.isInteger(id) ? id : null;
}

// GET /api/teams
app.get('/api/teams', (_req, res) => {
  res.json(db.prepare('SELECT * FROM teams ORDER BY id').all());
});

// POST /api/teams -- add a team
app.post('/api/teams', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('INSERT INTO teams (name) VALUES (?)').run(name);
    res.json({ id: result.lastInsertRowid, name });
  } catch (e) {
    res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500).json({ error: e.message });
  }
});

// PATCH /api/teams/:id -- rename a team
app.patch('/api/teams/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
    res.json({ id: parseInt(req.params.id, 10), name });
  } catch (e) {
    res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500).json({ error: e.message });
  }
});

// DELETE /api/teams/:id -- only an empty team (no games, no players) can go
app.delete('/api/teams/:id', (req, res) => {
  const { id } = req.params;
  const games = db.prepare('SELECT COUNT(*) AS c FROM videos WHERE team_id = ?').get(id).c;
  const roster = db.prepare('SELECT COUNT(*) AS c FROM players WHERE team_id = ?').get(id).c;
  if (games || roster) {
    return res.status(409).json({ error: `Team still has ${games} game(s) and ${roster} player(s)` });
  }
  const result = db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  res.json({ id: parseInt(id, 10), changes: result.changes });
});

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
    const teamId = parseTeamId(req.body.team_id);

    try {
      const existing = db.prepare('SELECT id, file_path, game_date, competition_id, team_id FROM videos WHERE file_path = ?').get(filePath);
      if (existing) {
        return res.json(existing);
      }
      const result = db.prepare(
        'INSERT INTO videos (file_path, game_date, competition_id, team_id) VALUES (?, ?, ?, ?)'
      ).run(filePath, gameDate, competitionId, teamId);
      thumbnails.enqueue({ id: result.lastInsertRowid, file_path: filePath });
      res.json({ id: result.lastInsertRowid, file_path: filePath, game_date: gameDate, competition_id: competitionId, team_id: teamId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /api/videos[?teamId=N] -- latest-first by game_date, then by id DESC
app.get('/api/videos', (req, res) => {
  const teamId = parseTeamId(req.query.teamId);
  const rows = db.prepare(`
    SELECT v.id, v.file_path, v.game_date, v.competition_id, v.team_id,
           c.name AS competition_name, c.is_custom AS competition_is_custom,
           t.name AS team_name
    FROM videos v
    LEFT JOIN competitions c ON v.competition_id = c.id
    LEFT JOIN teams t ON v.team_id = t.id
    ${teamId !== null ? 'WHERE v.team_id = ?' : ''}
    ORDER BY
      CASE WHEN v.game_date IS NULL THEN 1 ELSE 0 END,
      v.game_date DESC,
      v.id DESC
  `).all(...(teamId !== null ? [teamId] : []));
  res.json(rows);
});

// PATCH /api/videos/:id -- update game_date, competition_id and/or team_id
app.patch('/api/videos/:id', (req, res) => {
  const { id } = req.params;
  const { game_date, competition_id, team_id } = req.body;

  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const newDate = game_date !== undefined ? (game_date || null) : video.game_date;
  const newComp = competition_id !== undefined ? (competition_id || null) : video.competition_id;
  const newTeam = team_id !== undefined ? parseTeamId(team_id) : video.team_id;

  db.prepare('UPDATE videos SET game_date = ?, competition_id = ?, team_id = ? WHERE id = ?')
    .run(newDate, newComp, newTeam, id);

  const updated = db.prepare(`
    SELECT v.id, v.file_path, v.game_date, v.competition_id, v.team_id,
           c.name AS competition_name, t.name AS team_name
    FROM videos v
    LEFT JOIN competitions c ON v.competition_id = c.id
    LEFT JOIN teams t ON v.team_id = t.id
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
  const zoneRule = req.body.zone_rule ?? 'none';
  if (!ZONE_RULES.includes(zoneRule)) return res.status(400).json({ error: 'invalid zone_rule' });
  const result = db.prepare('INSERT INTO event_types (name, is_custom, zone_rule) VALUES (?, ?, ?)')
    .run(name, is_custom ? 1 : 0, zoneRule);
  res.json({ id: result.lastInsertRowid, name, is_custom: is_custom ? 1 : 0, zone_rule: zoneRule });
});

// PATCH /api/event-types/:id -- rename and/or change zone_rule
app.patch('/api/event-types/:id', (req, res) => {
  const { id } = req.params;
  const { name, zone_rule } = req.body;
  if (zone_rule !== undefined && !ZONE_RULES.includes(zone_rule)) {
    return res.status(400).json({ error: 'invalid zone_rule' });
  }
  if (name !== undefined && !(typeof name === 'string' && name.trim())) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  const row = db.prepare('SELECT * FROM event_types WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Event type not found' });
  db.prepare('UPDATE event_types SET name = ?, zone_rule = ? WHERE id = ?')
    .run(name !== undefined ? name.trim() : row.name, zone_rule ?? row.zone_rule, id);
  res.json(db.prepare('SELECT * FROM event_types WHERE id = ?').get(id));
});

// --- Players ---

// GET /api/players[?teamId=N]
app.get('/api/players', (req, res) => {
  const teamId = parseTeamId(req.query.teamId);
  // Jersey order (numberless players last), the way a bench card reads
  res.json(db.prepare(`
    SELECT * FROM players ${teamId !== null ? 'WHERE team_id = ?' : ''}
    ORDER BY number IS NULL, number, name
  `).all(...(teamId !== null ? [teamId] : [])));
});

function parsePlayerFields(body) {
  const number = body.number === undefined || body.number === null || body.number === '' ? null : Number(body.number);
  if (number !== null && !(Number.isInteger(number) && number >= 0 && number <= 99)) {
    return { error: 'number must be 0-99 or empty' };
  }
  const position = typeof body.position === 'string' && body.position.trim() ? body.position.trim() : null;
  return { number, position };
}

// POST /api/players
app.post('/api/players', (req, res) => {
  const { name } = req.body;
  const f = parsePlayerFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  const teamId = parseTeamId(req.body.team_id);
  const result = db.prepare('INSERT INTO players (name, number, position, team_id) VALUES (?, ?, ?, ?)')
    .run(name, f.number, f.position, teamId);
  res.json({ id: result.lastInsertRowid, name, number: f.number, position: f.position, team_id: teamId });
});

// PUT /api/players/:id
app.put('/api/players/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const f = parsePlayerFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  const current = db.prepare('SELECT team_id FROM players WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Player not found' });
  const teamId = req.body.team_id !== undefined ? parseTeamId(req.body.team_id) : current.team_id;
  const result = db.prepare('UPDATE players SET name = ?, number = ?, position = ?, team_id = ? WHERE id = ?')
    .run(name, f.number, f.position, teamId, id);
  res.json({ id: parseInt(id), name, number: f.number, position: f.position, team_id: teamId, changes: result.changes });
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
    SELECT e.id, e.timestamp, e.video_id, e.team, e.period, e.strength, ${SHOT_COLS}, v.file_path, v.game_date,
           v.competition_id, v.team_id,
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
    SELECT e.id, e.timestamp, e.event_type_id, e.team, e.period, e.strength, ${SHOT_COLS},
           et.name as event_type_name
    FROM events e
    JOIN event_types et ON e.event_type_id = et.id
    WHERE e.video_id = ?
    ORDER BY e.timestamp
  `).all(videoId);

  // Fetch player associations
  const events = rows.map((row) => {
    const players = db.prepare(`
      SELECT p.id, p.name, p.number
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
    SELECT e.id, e.timestamp, e.event_type_id, e.video_id, e.team, e.period, e.strength, ${SHOT_COLS},
           et.name as event_type_name
    FROM events e
    JOIN event_types et ON e.event_type_id = et.id
    WHERE e.id = ?
  `).get(id);

  if (!row) return res.status(404).json({ error: 'Event not found' });

  const players = db.prepare(`
    SELECT p.id, p.name, p.number
    FROM event_player_associations epa
    JOIN players p ON epa.player_id = p.id
    WHERE epa.event_id = ?
  `).all(id);

  res.json({ ...row, players });
});

// GET /api/shots[?videoId=N][&teamId=N] -- every Shot / Goal tag (one game,
// one team's games, or all games) with its details, for the shot map.
app.get('/api/shots', (req, res) => {
  const videoId = req.query.videoId !== undefined ? parseInt(req.query.videoId, 10) : null;
  if (videoId !== null && isNaN(videoId)) return res.status(400).json({ error: 'invalid videoId' });
  const teamId = parseTeamId(req.query.teamId);
  const where = [];
  const params = [];
  if (videoId !== null) { where.push('e.video_id = ?'); params.push(videoId); }
  if (teamId !== null) { where.push('v.team_id = ?'); params.push(teamId); }
  const rows = db.prepare(`
    SELECT e.id, e.video_id, e.timestamp, e.event_type_id, e.team, e.period, e.strength, ${SHOT_COLS},
           et.name AS event_type_name, v.file_path, v.game_date
    FROM events e
    JOIN event_types et ON e.event_type_id = et.id
    JOIN videos v ON e.video_id = v.id
    WHERE et.shot_kind IS NOT NULL ${where.map((w) => `AND ${w}`).join(' ')}
    ORDER BY v.game_date, e.video_id, e.timestamp
  `).all(...params);
  const playersFor = db.prepare(`
    SELECT p.id, p.name, p.number FROM event_player_associations epa
    JOIN players p ON epa.player_id = p.id WHERE epa.event_id = ?
  `);
  res.json(rows.map((r) => ({ ...r, players: playersFor.all(r.id) })));
});

// POST /api/events
app.post('/api/events', (req, res) => {
  const { videoId, eventTypeId, timestamp } = req.body;
  const err = validateEventFields(req.body);
  if (err) return res.status(400).json({ error: err });
  const row = { event_type_id: eventTypeId };
  for (const k of EVENT_DETAIL_FIELDS) row[k] = req.body[k] ?? null;
  if (req.body.shot_result === undefined) delete row.shot_result; // let syncShot decide
  syncShot(row, null);
  row.shot_result ??= null;
  const cols = Object.keys(row);
  const result = db.prepare(
    `INSERT INTO events (video_id, timestamp, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`
  ).run(videoId, timestamp, ...cols.map((k) => row[k]));
  res.json({ id: result.lastInsertRowid, video_id: videoId, timestamp, ...row });
});

// PATCH /api/events/:id  -- update any of timestamp, event type, team, period, strength
app.patch('/api/events/:id', (req, res) => {
  const { id } = req.params;
  const { timestamp, event_type_id } = req.body;
  if (timestamp !== undefined && (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0)) {
    return res.status(400).json({ error: 'timestamp must be a non-negative number' });
  }
  const err = validateEventFields(req.body);
  if (err) return res.status(400).json({ error: err });
  if (event_type_id !== undefined && !db.prepare('SELECT 1 FROM event_types WHERE id = ?').get(event_type_id)) {
    return res.status(400).json({ error: 'unknown event_type_id' });
  }

  const fields = { timestamp, event_type_id };
  for (const k of EVENT_DETAIL_FIELDS) fields[k] = req.body[k];
  const before = db.prepare('SELECT video_id, period, event_type_id, shot_result FROM events WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ error: 'Event not found' });
  syncShot(fields, before);
  const sets = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });
  const cascade = req.body.cascade_period === true && fields.period !== undefined && fields.period !== before.period;

  // cascade_period: the later tags that were in this tag's old period (the
  // unbroken run right after it, in time order) move to the new period too --
  // e.g. fixing the first tag after an intermission fixes the rest of the period.
  const cascaded = [];
  db.transaction(() => {
    db.prepare(`UPDATE events SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...sets.map((k) => fields[k]), id);
    if (!cascade) return;
    const ordered = db.prepare('SELECT id, period FROM events WHERE video_id = ? ORDER BY timestamp, id')
      .all(before.video_id);
    const move = db.prepare('UPDATE events SET period = ? WHERE id = ?');
    for (const e of ordered.slice(ordered.findIndex((e) => e.id === Number(id)) + 1)) {
      if (e.period !== before.period) break;
      move.run(fields.period, e.id);
      cascaded.push(e.id);
    }
  })();
  res.json({ id: parseInt(id), ...Object.fromEntries(sets.map((k) => [k, fields[k]])), cascaded });
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

  // Backfill thumbnails for any game that doesn't have them yet.
  for (const video of db.prepare('SELECT id, file_path FROM videos ORDER BY id DESC').all()) {
    thumbnails.enqueue(video);
  }
});
