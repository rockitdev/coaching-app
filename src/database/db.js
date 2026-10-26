const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app, ipcMain } = require('electron');

// Database connection
let db;

// ─────────────────────────────────────────────
// Schema migrations — add one object per version
// Each migration runs exactly once (guarded by
// PRAGMA user_version which SQLite persists).
// ─────────────────────────────────────────────
const MIGRATIONS = [
  // v1 → baseline (tables are created in createTables before migrations run,
  //   so v1 is a no-op sentinel that just marks the DB as versioned)
  {
    version: 1,
    up(db) {
      return Promise.resolve();
    }
  },
  // v2 → add net + result columns to events (goalie shot tracking, Phase 1)
  {
    version: 2,
    up(db) {
      return new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run(`ALTER TABLE events ADD COLUMN net TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
              return reject(err);
            }
          });
          db.run(`ALTER TABLE events ADD COLUMN result TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
              return reject(err);
            }
            resolve();
          });
        });
      });
    }
  },
  // v3 → add is_my_goalie flag to players
  {
    version: 3,
    up(db) {
      return new Promise((resolve, reject) => {
        db.run(`ALTER TABLE players ADD COLUMN is_my_goalie INTEGER NOT NULL DEFAULT 0`, (err) => {
          if (err && !err.message.includes('duplicate column')) {
            return reject(err);
          }
          resolve();
        });
      });
    }
  }
];

// Run any pending migrations using PRAGMA user_version as the version counter.
function runMigrations() {
  return new Promise((resolve, reject) => {
    db.get('PRAGMA user_version', (err, row) => {
      if (err) return reject(err);

      const currentVersion = row.user_version;
      const pending = MIGRATIONS.filter(m => m.version > currentVersion);

      if (pending.length === 0) {
        console.log(`DB schema at v${currentVersion}, no migrations needed`);
        return resolve();
      }

      // Run migrations sequentially
      pending.reduce((chain, migration) => {
        return chain.then(() => {
          console.log(`Running migration to v${migration.version}…`);
          return migration.up(db).then(() => {
            return new Promise((res, rej) => {
              db.run(`PRAGMA user_version = ${migration.version}`, (err) => {
                if (err) return rej(err);
                console.log(`Schema now at v${migration.version}`);
                res();
              });
            });
          });
        });
      }, Promise.resolve())
        .then(resolve)
        .catch(reject);
    });
  });
}

// Initialize database and create tables if they don't exist
function initDatabase() {
  return new Promise((resolve, reject) => {
    // Create a database in the user's app data directory
    const dbPath = path.join(app.getPath('userData'), 'hockey-coach.db');
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Could not connect to database', err);
        reject(err);
        return;
      }

      console.log('Connected to the SQLite database');

      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON', (err) => {
        if (err) {
          console.error('Could not enable foreign keys', err);
          reject(err);
          return;
        }

        // Create base tables, seed defaults, then run migrations
        createTables()
          .then(() => insertDefaultEventTypes())
          .then(() => runMigrations())
          .then(resolve)
          .catch(reject);
      });
    });

    // Set up IPC handlers for database operations
    setupIpcHandlers();
  });
}

// Create all necessary tables
function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Players table
      db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )`, (err) => {
        if (err) {
          console.error('Error creating players table', err);
          reject(err);
          return;
        }
      });

      // Event types table
      db.run(`CREATE TABLE IF NOT EXISTS event_types (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        is_custom BOOLEAN NOT NULL
      )`, (err) => {
        if (err) {
          console.error('Error creating event_types table', err);
          reject(err);
          return;
        }
      });

      // Videos table
      db.run(`CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL
      )`, (err) => {
        if (err) {
          console.error('Error creating videos table', err);
          reject(err);
          return;
        }
      });

      // Events table
      db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY,
        video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
        event_type_id INTEGER REFERENCES event_types(id) ON DELETE CASCADE,
        timestamp REAL NOT NULL
      )`, (err) => {
        if (err) {
          console.error('Error creating events table', err);
          reject(err);
          return;
        }
      });

      // Event player associations table
      db.run(`CREATE TABLE IF NOT EXISTS event_player_associations (
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
        PRIMARY KEY (event_id, player_id)
      )`, (err) => {
        if (err) {
          console.error('Error creating event_player_associations table', err);
          reject(err);
          return;
        }
      });

      resolve();
    });
  });
}

// Insert default event types
function insertDefaultEventTypes() {
  return new Promise((resolve, reject) => {
    const defaultEventTypes = [
      { name: 'Shot', is_custom: 0 },
      { name: 'Faceoff', is_custom: 0 },
      { name: 'Zone Entry', is_custom: 0 },
      { name: 'Turnover', is_custom: 0 },
      { name: 'Goal', is_custom: 0 },
      { name: 'Penalty', is_custom: 0 },
      { name: 'Save', is_custom: 0 }
    ];

    // Check if default event types exist
    db.get('SELECT COUNT(*) as count FROM event_types WHERE is_custom = 0', (err, row) => {
      if (err) {
        console.error('Error checking event types', err);
        reject(err);
        return;
      }

      // If no default event types exist, insert them
      if (row.count === 0) {
        const stmt = db.prepare('INSERT INTO event_types (name, is_custom) VALUES (?, ?)');

        defaultEventTypes.forEach(eventType => {
          stmt.run(eventType.name, eventType.is_custom);
        });

        stmt.finalize((err) => {
          if (err) {
            console.error('Error inserting default event types', err);
            reject(err);
            return;
          }

          console.log('Default event types inserted');
          resolve();
        });
      } else {
        // Default event types already exist
        resolve();
      }
    });
  });
}

// Set up IPC handlers for database operations
function setupIpcHandlers() {
  // Players CRUD operations
  ipcMain.handle('db-get-players', () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM players ORDER BY name', (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  });

  ipcMain.handle('db-add-player', (event, name) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO players (name) VALUES (?)', [name], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({id: this.lastID, name, is_my_goalie: 0});
      });
    });
  });

  ipcMain.handle('db-update-player', (event, id, name) => {
    return new Promise((resolve, reject) => {
      db.run('UPDATE players SET name = ? WHERE id = ?', [name, id], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({id, name, changes: this.changes});
      });
    });
  });

  ipcMain.handle('db-set-my-goalie', (event, playerId) => {
    return new Promise((resolve, reject) => {
      // Clear existing my-goalie flag, then set on the specified player
      db.run('UPDATE players SET is_my_goalie = 0', (err) => {
        if (err) return reject(err);
        if (playerId === null) return resolve({ cleared: true });
        db.run('UPDATE players SET is_my_goalie = 1 WHERE id = ?', [playerId], function(err) {
          if (err) return reject(err);
          resolve({ playerId, changes: this.changes });
        });
      });
    });
  });

  ipcMain.handle('db-delete-player', (event, id) => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM players WHERE id = ?', [id], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({id, changes: this.changes});
      });
    });
  });

  // Event types operations
  ipcMain.handle('db-get-event-types', () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM event_types ORDER BY name', (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  });

  ipcMain.handle('db-add-event-type', (event, name, isCustom) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO event_types (name, is_custom) VALUES (?, ?)',
        [name, isCustom ? 1 : 0],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({id: this.lastID, name, is_custom: isCustom ? 1 : 0});
        }
      );
    });
  });

  // Videos operations
  ipcMain.handle('db-add-video', (event, filePath) => {
    return new Promise((resolve, reject) => {
      // Check if the video already exists
      db.get('SELECT id FROM videos WHERE file_path = ?', [filePath], (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (row) {
          // Video already exists, return its ID
          resolve({id: row.id, file_path: filePath});
        } else {
          // Insert new video
          db.run('INSERT INTO videos (file_path) VALUES (?)', [filePath], function(err) {
            if (err) {
              reject(err);
              return;
            }
            resolve({id: this.lastID, file_path: filePath});
          });
        }
      });
    });
  });

  ipcMain.handle('db-get-videos', () => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM videos', (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  });

  // Events operations — extended to accept optional net + result for shot-against events
  ipcMain.handle('db-add-event', (event, videoId, eventTypeId, timestamp, net, result) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO events (video_id, event_type_id, timestamp, net, result) VALUES (?, ?, ?, ?, ?)',
        [videoId, eventTypeId, timestamp, net || null, result || null],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({
            id: this.lastID,
            video_id: videoId,
            event_type_id: eventTypeId,
            timestamp,
            net: net || null,
            result: result || null
          });
        }
      );
    });
  });

  ipcMain.handle('db-add-event-player-association', (event, eventId, playerId) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO event_player_associations (event_id, player_id) VALUES (?, ?)',
        [eventId, playerId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({
            event_id: eventId,
            player_id: playerId,
            changes: this.changes
          });
        }
      );
    });
  });

  ipcMain.handle('db-get-player-events', (event, playerId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT e.id, e.timestamp, e.video_id, v.file_path, et.name as event_type_name, et.id as event_type_id,
               e.net, e.result
        FROM events e
        JOIN event_player_associations epa ON e.id = epa.event_id
        JOIN videos v ON e.video_id = v.id
        JOIN event_types et ON e.event_type_id = et.id
        WHERE epa.player_id = ?
        ORDER BY v.file_path, e.timestamp
      `;

      db.all(query, [playerId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  });

  ipcMain.handle('db-get-video-events', (event, videoId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT e.id, e.timestamp, e.event_type_id, et.name as event_type_name,
               e.net, e.result,
               GROUP_CONCAT(p.id || ':' || p.name, ';') as players
        FROM events e
        JOIN event_types et ON e.event_type_id = et.id
        LEFT JOIN event_player_associations epa ON e.id = epa.event_id
        LEFT JOIN players p ON epa.player_id = p.id
        WHERE e.video_id = ?
        GROUP BY e.id
        ORDER BY e.timestamp
      `;

      db.all(query, [videoId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // Parse players string into array of objects
        const events = rows.map(row => {
          const players = [];
          if (row.players) {
            row.players.split(';').forEach(playerStr => {
              const [id, name] = playerStr.split(':');
              players.push({ id: parseInt(id), name });
            });
          }

          return {
            id: row.id,
            timestamp: row.timestamp,
            event_type_id: row.event_type_id,
            event_type_name: row.event_type_name,
            net: row.net || null,
            result: row.result || null,
            players
          };
        });

        resolve(events);
      });
    });
  });

  ipcMain.handle('db-get-event', (event, eventId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT e.id, e.timestamp, e.event_type_id, e.video_id, et.name as event_type_name,
               e.net, e.result,
               GROUP_CONCAT(p.id || ':' || p.name, ';') as players
        FROM events e
        JOIN event_types et ON e.event_type_id = et.id
        LEFT JOIN event_player_associations epa ON e.id = epa.event_id
        LEFT JOIN players p ON epa.player_id = p.id
        WHERE e.id = ?
        GROUP BY e.id
      `;

      db.get(query, [eventId], (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        // Parse players string into array of objects
        const players = [];
        if (row.players) {
          row.players.split(';').forEach(playerStr => {
            if (playerStr) {
              const [id, name] = playerStr.split(':');
              players.push({ id: parseInt(id), name });
            }
          });
        }

        const result = {
          id: row.id,
          timestamp: row.timestamp,
          event_type_id: row.event_type_id,
          event_type_name: row.event_type_name,
          video_id: row.video_id,
          net: row.net || null,
          result: row.result || null,
          players
        };

        resolve(result);
      });
    });
  });

  // Update player associations for an event
  ipcMain.handle('db-update-event-players', (event, eventId, playerIds) => {
    return new Promise((resolve, reject) => {
      // Begin transaction
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(err);
          return;
        }

        // First delete all existing player associations
        db.run('DELETE FROM event_player_associations WHERE event_id = ?', [eventId], (err) => {
          if (err) {
            db.run('ROLLBACK');
            reject(err);
            return;
          }

          // If no players to add, just commit the transaction
          if (!playerIds || playerIds.length === 0) {
            db.run('COMMIT', (err) => {
              if (err) {
                db.run('ROLLBACK');
                reject(err);
                return;
              }
              resolve({ eventId, updated: true });
            });
            return;
          }

          // Prepare statement for adding new associations
          const stmt = db.prepare('INSERT INTO event_player_associations (event_id, player_id) VALUES (?, ?)');

          let completed = 0;
          let error = null;

          // Add each player association
          playerIds.forEach(playerId => {
            stmt.run(eventId, playerId, (err) => {
              if (err && !error) {
                error = err;
              }

              completed++;

              // When all inserts are done
              if (completed === playerIds.length) {
                stmt.finalize();

                if (error) {
                  db.run('ROLLBACK');
                  reject(error);
                  return;
                }

                db.run('COMMIT', (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    reject(err);
                    return;
                  }
                  resolve({ eventId, updated: true });
                });
              }
            });
          });
        });
      });
    });
  });

  // Delete an event
  ipcMain.handle('db-delete-event', (event, eventId) => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM events WHERE id = ?', [eventId], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ eventId, deleted: true, changes: this.changes });
      });
    });
  });

  // ─── Goalie stat rollup ───────────────────────────────────────────────────
  // Returns shots-against count, saves count, and save% for the given video.
  // Only counts events with net='own' (shots the goalie faced).
  ipcMain.handle('db-get-goalie-line', (event, videoId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT
          COUNT(*) as shots_against,
          SUM(CASE WHEN result = 'save' THEN 1 ELSE 0 END) as saves,
          SUM(CASE WHEN result = 'goal' THEN 1 ELSE 0 END) as goals_against,
          SUM(CASE WHEN result = 'miss'    THEN 1 ELSE 0 END) as misses,
          SUM(CASE WHEN result = 'rebound' THEN 1 ELSE 0 END) as rebounds
        FROM events
        WHERE video_id = ? AND net = 'own' AND result IS NOT NULL
      `;
      db.get(query, [videoId], (err, row) => {
        if (err) return reject(err);
        const shots = row.shots_against || 0;
        const saves = row.saves || 0;
        resolve({
          shots_against: shots,
          saves,
          goals_against: row.goals_against || 0,
          misses: row.misses || 0,
          rebounds: row.rebounds || 0,
          save_pct: shots > 0 ? (saves / shots) : null
        });
      });
    });
  });

  // Returns all shot-against events for a video (net='own'), sorted by timestamp
  ipcMain.handle('db-get-shots', (event, videoId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT e.id, e.timestamp, e.net, e.result, et.name as event_type_name
        FROM events e
        JOIN event_types et ON e.event_type_id = et.id
        WHERE e.video_id = ? AND e.net = 'own' AND e.result IS NOT NULL
        ORDER BY e.timestamp
      `;
      db.all(query, [videoId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  });
}

module.exports = {
  initDatabase
};
