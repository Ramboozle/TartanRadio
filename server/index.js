/**
 * Tartan Radio Server - Core Application
 * 
 * This file serves as the main entry point for the Tartan Radio central server.
 * It manages:
 * 1. Express.js web server for the dashboard and API.
 * 2. Socket.io for real-time communication with audio clients.
 * 3. File management and distribution (music and adverts).
 * 4. Client monitoring via heartbeats and database tracking.
 * 5. Persistent storage using a local SQLite database.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

/**
 * LOGGER INITIALIZATION
 * Overrides console.log and console.error to write to 'server.log'.
 * Includes automatic 5MB rotation to prevent disk space issues.
 */
require('./logger')('server.log');

/**
 * DATABASE INITIALIZATION
 * Connects to 'radio.db' and ensures required tables (clients, groups, etc.) exist.
 * See database.js for the full schema.
 */
const db = require('./database');

/**
 * CONFIGURATION LOADING
 * Default settings are defined here but can be overridden by 'settings.json'.
 * - PORT: The port the dashboard and API will be accessible on (default 80).
 * - MUSIC_DIRECTORY: The root folder for audio assets.
 */
let settings = {
  PORT: 80,
  MUSIC_DIRECTORY: 'music'
};

const SETTINGS_PATH = path.join(__dirname, 'settings.json');
if (fs.existsSync(SETTINGS_PATH)) {
  try {
    const fileContent = fs.readFileSync(SETTINGS_PATH, 'utf8');
    settings = { ...settings, ...JSON.parse(fileContent) };
    console.log('[SYSTEM] Loaded custom settings from settings.json');
  } catch (e) { 
    console.error('[SYSTEM] Failed to parse settings.json, using defaults.'); 
  }
}

/**
 * SERVER SETUP
 * Initializes the Express app, HTTP server, and Socket.io server.
 * Configures CORS to allow cross-origin requests from clients and dashboard pages.
 */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for the audio distribution network
    methods: ["GET", "POST"]
  }
});

/**
 * MIDDLEWARE & STATIC ASSETS
 * - CORS: Enables cross-origin resource sharing.
 * - JSON: Parses incoming JSON request bodies.
 * - Public: Serves the dashboard HTML, CSS, and JS files.
 * - Music: Serves the audio files stored in the music directory.
 */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/' + settings.MUSIC_DIRECTORY, express.static(path.join(__dirname, settings.MUSIC_DIRECTORY)));

/**
 * DIRECTORY SANITIZATION
 * Ensures the required 'music/playlists' and 'music/adverts' folders exist
 * on the server filesystem. Creates them recursively if missing.
 */
const musicPath = path.join(__dirname, settings.MUSIC_DIRECTORY);
const playlistsPath = path.join(musicPath, 'playlists');
const advertsPath = path.join(musicPath, 'adverts');

[musicPath, playlistsPath, advertsPath].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- API Endpoints ---

/**
 * GET /api/files
 * Used by clients to fetch a complete manifest of all audio files available.
 * Returns an object with 'playlists' and 'adverts' arrays containing file metadata.
 * Metadata includes: filename, size (in bytes), and relative web path.
 */
app.get('/api/files', (req, res) => {
  const getFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    // Recursively read all files in the given directory
    return fs.readdirSync(dir, { recursive: true })
      .filter(file => fs.statSync(path.join(dir, file)).isFile())
      .map(file => ({
        name: file,
        size: fs.statSync(path.join(dir, file)).size,
        path: file.replace(/\\/g, '/') // Ensure web-friendly forward slashes
      }));
  };

  res.json({
    playlists: getFiles(playlistsPath),
    adverts: getFiles(advertsPath)
  });
});

/**
 * POST /api/heartbeat
 * Endpoint called by clients every 5 seconds to report their health.
 * Updates the 'clients' table with current playback status, volume, and metadata.
 * Uses an UPSERT (Insert or Update on Conflict) to manage client records.
 */
app.post('/api/heartbeat', (req, res) => {
  const { hostname, ip, current_song, volume, status, version } = req.body;
  
  const stmt = db.prepare(`
    INSERT INTO clients (hostname, ip_address, current_song, volume, status, version, last_ping)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(hostname) DO UPDATE SET
      ip_address = excluded.ip_address,
      current_song = excluded.current_song,
      volume = excluded.volume,
      status = excluded.status,
      version = excluded.version,
      last_ping = CURRENT_TIMESTAMP
  `);
  
  stmt.run(hostname, ip, current_song, volume, status, version);
  res.sendStatus(200);
});

/**
 * GET /api/clients
 * Fetches the status of all registered clients from the database.
 * Calculates an 'is_online' flag based on whether the last ping was within 15 seconds.
 */
app.get('/api/clients', (req, res) => {
  const clients = db.prepare(`
    SELECT *, 
    (strftime('%s', 'now') - strftime('%s', last_ping)) < 15 AS is_online
    FROM clients
  `).all();
  res.json(clients);
});

/**
 * GET /api/directories
 * Returns a list of subdirectory names within 'playlists' and 'adverts'.
 * Used by the dashboard to show category/album selections.
 */
app.get('/api/directories', (req, res) => {
  const getDirs = (basePath) => {
    if (!fs.existsSync(basePath)) return [];
    return fs.readdirSync(basePath).filter(file => fs.statSync(path.join(basePath, file)).isDirectory());
  };
  res.json({
    playlists: getDirs(playlistsPath),
    adverts: getDirs(advertsPath)
  });
});

/**
 * POST /api/command
 * Sends a playback or control command to clients via Socket.io.
 * - target: 'all', 'hostname', or 'group:ID'
 * - type: 'play', 'stop', 'sync', 'volume', 'set_playlists'
 * - value: The data associated with the command (e.g. volume level or playlist names)
 * 
 * Special Logic: If the command is 'play', a 'stop' command is sent first with a
 * 500ms delay to ensure the client's local player resets cleanly.
 */
app.post('/api/command', (req, res) => {
  const { target, type, value } = req.body;
  
  const send = (t, cmd) => {
    if (t === 'all') {
      io.emit('command', cmd); // Global broadcast
    } else if (t.startsWith('group:')) {
      const groupId = parseInt(t.split(':')[1]);
      const members = db.prepare('SELECT hostname FROM clients WHERE group_id = ?').all(groupId);
      // Send to each member of the group individually
      members.forEach(m => io.to(m.hostname).emit('command', cmd));
    } else {
      io.to(t).emit('command', cmd); // Direct message to specific hostname room
    }
  };

  const processCommand = (target, type, value) => {
    if (type === 'play') {
      // Clean reset for playback commands
      send(target, { type: 'stop' });
      setTimeout(() => {
        send(target, { type, value });
      }, 500);
    } else {
      send(target, { type, value });
    }
  };

  processCommand(target, type, value);
  res.sendStatus(200);
});

/**
 * POST /api/clients/settings
 * Updates specific persistent settings for a client in the database.
 * Currently supports 'songs_per_ad' (ad rotation frequency).
 */
app.post('/api/clients/settings', (req, res) => {
  const { hostname, songs_per_ad } = req.body;
  db.prepare('UPDATE clients SET songs_per_ad = ? WHERE hostname = ?').run(songs_per_ad, hostname);
  res.sendStatus(200);
});

/**
 * DELETE /api/clients/:hostname
 * Permanently removes a client's registration from the database.
 */
app.delete('/api/clients/:hostname', (req, res) => {
  db.prepare('DELETE FROM clients WHERE hostname = ?').run(req.params.hostname);
  res.sendStatus(200);
});

// --- Faulty Reports ---

/**
 * POST /api/report-faulty
 * Records a song that a client or user has flagged as problematic.
 * Problematic songs are stored in the 'faulty_reports' table for administrator review.
 */
app.post('/api/report-faulty', (req, res) => {
  const { hostname, song, reason } = req.body;
  const reportReason = reason || 'faulty';
  console.warn(`Song report by ${hostname}: ${song} (Reason: ${reportReason})`);
  db.prepare('INSERT INTO faulty_reports (hostname, song_name, reason) VALUES (?, ?, ?)').run(hostname, song, reportReason);
  res.sendStatus(200);
});

/**
 * GET /api/reports
 * Fetches all pending faulty song reports, sorted by the most recent first.
 */
app.get('/api/reports', (req, res) => {
  res.json(db.prepare('SELECT * FROM faulty_reports ORDER BY reported_at DESC').all());
});

/**
 * DELETE /api/reports/:id
 * Dismisses a faulty report (deletes the report entry, but keeps the file).
 */
app.delete('/api/reports/:id', (req, res) => {
  db.prepare('DELETE FROM faulty_reports WHERE id = ?').run(req.params.id);
  res.sendStatus(200);
});

/**
 * POST /api/reports/remove-file
 * Administrative action to permanently delete a faulty file from the server disk
 * and clear all associated reports from the database.
 * This effectively prevents the file from being synced to clients in the future.
 */
app.post('/api/reports/remove-file', (req, res) => {
  const { song_name } = req.body;
  
  const findAndDelete = (basePath) => {
    const files = fs.readdirSync(basePath, { recursive: true });
    for (const file of files) {
      // Match the basename to find the file regardless of subdirectory
      if (path.basename(file) === song_name) {
        const fullPath = path.join(basePath, file);
        if (fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath); // Delete from filesystem
          console.log(`Permanently deleted faulty file: ${fullPath}`);
          return true;
        }
      }
    }
    return false;
  };

  const deletedFromPlaylists = findAndDelete(playlistsPath);
  const deletedFromAdverts = findAndDelete(advertsPath);

  if (deletedFromPlaylists || deletedFromAdverts) {
    db.prepare('DELETE FROM faulty_reports WHERE song_name = ?').run(song_name);
    res.sendStatus(200);
  } else {
    res.status(404).send('File not found on server');
  }
});

/**
 * POST /api/clients/assign-group
 * Links a client to a specific group for categorical control.
 */
app.post('/api/clients/assign-group', (req, res) => {
  const { hostname, group_id } = req.body;
  db.prepare('UPDATE clients SET group_id = ? WHERE hostname = ?').run(group_id, hostname);
  res.sendStatus(200);
});

/**
 * GET /api/groups
 * Retrieves all defined groups and includes an array of member hostnames for each.
 */
app.get('/api/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  const groupsWithMembers = groups.map(group => {
    const members = db.prepare('SELECT hostname FROM clients WHERE group_id = ?').all(group.id);
    return { ...group, members: members.map(m => m.hostname) };
  });
  res.json(groupsWithMembers);
});

/**
 * POST /api/groups
 * Creates a new organizational group.
 */
app.post('/api/groups', (req, res) => {
  const { name, description } = req.body;
  db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)').run(name, description);
  res.sendStatus(201);
});

/**
 * DELETE /api/groups/:id
 * Deletes a group and unlinks all clients currently assigned to it.
 */
app.delete('/api/groups/:id', (req, res) => {
  const groupId = req.params.id;
  db.prepare('UPDATE clients SET group_id = NULL WHERE group_id = ?').run(groupId);
  db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  res.sendStatus(200);
});

// --- File Management APIs ---

/**
 * POST /api/playlists/create
 * Creates a new physical subdirectory in either 'playlists' or 'adverts'.
 */
app.post('/api/playlists/create', (req, res) => {
  const { name, type } = req.body;
  const targetDir = path.join(musicPath, type, name);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    res.sendStatus(201);
  } else {
    res.status(400).send('Directory already exists');
  }
});

/**
 * DELETE /api/playlists/delete
 * Recursively deletes a subdirectory and all its audio contents.
 */
app.delete('/api/playlists/delete', (req, res) => {
  const { name, type } = req.query;
  const targetDir = path.join(musicPath, type, name);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    res.sendStatus(200);
  } else {
    res.status(404).send('Directory not found');
  }
});

/**
 * DELETE /api/files/delete
 * Deletes a single file from the music directory.
 */
app.delete('/api/files/delete', (req, res) => {
  const { filePath } = req.query;
  const fullPath = path.join(musicPath, filePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    res.sendStatus(200);
  } else {
    res.status(404).send('File not found');
  }
});

/**
 * POST /api/upload
 * Handles raw file uploads via a stream.
 * Files are streamed directly to the destination folder to handle large MP3s efficiently.
 */
app.post('/api/upload', (req, res) => {
  const fileName = req.query.name;
  const targetDir = req.query.dir;
  
  if (!fileName || !targetDir) {
    return res.status(400).send('Missing file name or directory');
  }

  const fullDir = path.join(musicPath, targetDir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const fullPath = path.join(fullDir, fileName);
  const fileStream = fs.createWriteStream(fullPath);
  
  // Pipe the incoming request stream directly into the file stream
  req.pipe(fileStream);
  
  fileStream.on('finish', () => {
    console.log(`Uploaded file: ${fullPath}`);
    res.sendStatus(201);
  });

  fileStream.on('error', (err) => {
    console.error('Upload failed:', err);
    res.status(500).send(err.message);
  });
});

// --- Socket.io ---

/**
 * Socket.io Connection Logic
 * Manages active connections from clients. Each client joins a room
 * named after its 'hostname' to allow the server to target commands
 * to specific devices easily.
 */
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (hostname) => {
    socket.join(hostname);
    console.log(`Pi registered: ${hostname}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --- Start Server ---

/**
 * SERVER STARTUP
 * Binds the server to all network interfaces (0.0.0.0) on the configured port.
 */
const PORT = settings.PORT;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

