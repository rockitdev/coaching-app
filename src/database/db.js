const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app, ipcMain } = require('electron');

// Database connection
let db;

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
        
        // Create tables if they don't exist
        createTables()
          .then(() => insertDefaultEventTypes())
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
        resolve({id: this.lastID, name});
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
  
  // Events operations
  ipcMain.handle('db-add-event', (event, videoId, eventTypeId, timestamp) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO events (video_id, event_type_id, timestamp) VALUES (?, ?, ?)',
        [videoId, eventTypeId, timestamp],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({
            id: this.lastID,
            video_id: videoId,
            event_type_id: eventTypeId,
            timestamp
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
        SELECT e.id, e.timestamp, e.video_id, v.file_path, et.name as event_type_name, et.id as event_type_id
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
            players
          };
        });
        
        resolve(events);
      });
    });
  });
}

module.exports = {
  initDatabase
};