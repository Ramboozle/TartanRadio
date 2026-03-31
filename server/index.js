const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize file logging
require('./logger')('server.log');

const db = require('./database');

// Load external settings
let settings = {
  PORT: 80,
  MUSIC_DIRECTORY: 'music'
};

const SETTINGS_PATH = path.join(__dirname, 'settings.json');
if (fs.existsSync(SETTINGS_PATH)) {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    console.log('[SYSTEM] Loaded custom settings from settings.json');
  } catch (e) { console.error('[SYSTEM] Failed to parse settings.json, using defaults.'); }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/' + settings.MUSIC_DIRECTORY, express.static(path.join(__dirname, settings.MUSIC_DIRECTORY)));

// Ensure music directories exist
const musicPath = path.join(__dirname, settings.MUSIC_DIRECTORY);
const playlistsPath = path.join(musicPath, 'playlists');
const advertsPath = path.join(musicPath, 'adverts');

[musicPath, playlistsPath, advertsPath].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- API Endpoints ---

// Get file list for syncing
app.get('/api/files', (req, res) => {
  const getFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { recursive: true })
      .filter(file => fs.statSync(path.join(dir, file)).isFile())
      .map(file => ({
        name: file,
        size: fs.statSync(path.join(dir, file)).size,
        path: file.replace(/\\/g, '/')
      }));
  };

  res.json({
    playlists: getFiles(playlistsPath),
    adverts: getFiles(advertsPath)
  });
});

// Heartbeat endpoint
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

// Get all clients
app.get('/api/clients', (req, res) => {
  const clients = db.prepare(`
    SELECT *, 
    (strftime('%s', 'now') - strftime('%s', last_ping)) < 15 AS is_online
    FROM clients
  `).all();
  res.json(clients);
});

// Get directory names for playlists and adverts
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

// Send command to specific Pi or all
app.post('/api/command', (req, res) => {
  const { target, type, value } = req.body; // target is hostname or 'all' or 'group:ID'
  
  const send = (t, cmd) => {
    if (t === 'all') {
      io.emit('command', cmd);
    } else if (t.startsWith('group:')) {
      const groupId = parseInt(t.split(':')[1]);
      const members = db.prepare('SELECT hostname FROM clients WHERE group_id = ?').all(groupId);
      members.forEach(m => io.to(m.hostname).emit('command', cmd));
    } else {
      io.to(t).emit('command', cmd);
    }
  };

  const processCommand = (target, type, value) => {
    if (type === 'play') {
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

// Update client settings (volume, songs_per_ad, etc)
app.post('/api/clients/settings', (req, res) => {
  const { hostname, songs_per_ad } = req.body;
  db.prepare('UPDATE clients SET songs_per_ad = ? WHERE hostname = ?').run(songs_per_ad, hostname);
  res.sendStatus(200);
});

// Delete client
app.delete('/api/clients/:hostname', (req, res) => {
  db.prepare('DELETE FROM clients WHERE hostname = ?').run(req.params.hostname);
  res.sendStatus(200);
});

// --- Faulty Reports ---

// Report faulty song
app.post('/api/report-faulty', (req, res) => {
  const { hostname, song, reason } = req.body;
  const reportReason = reason || 'faulty';
  console.warn(`Song report by ${hostname}: ${song} (Reason: ${reportReason})`);
  db.prepare('INSERT INTO faulty_reports (hostname, song_name, reason) VALUES (?, ?, ?)').run(hostname, song, reportReason);
  res.sendStatus(200);
});

// Get all reports
app.get('/api/reports', (req, res) => {
  res.json(db.prepare('SELECT * FROM faulty_reports ORDER BY reported_at DESC').all());
});

// Dismiss report
app.delete('/api/reports/:id', (req, res) => {
  db.prepare('DELETE FROM faulty_reports WHERE id = ?').run(req.params.id);
  res.sendStatus(200);
});

// Remove file from server and dismiss all related reports
app.post('/api/reports/remove-file', (req, res) => {
  const { song_name } = req.body;
  
  const findAndDelete = (basePath) => {
    const files = fs.readdirSync(basePath, { recursive: true });
    for (const file of files) {
      if (path.basename(file) === song_name) {
        const fullPath = path.join(basePath, file);
        if (fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
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

// Assign client to group
app.post('/api/clients/assign-group', (req, res) => {
  const { hostname, group_id } = req.body;
  db.prepare('UPDATE clients SET group_id = ? WHERE hostname = ?').run(group_id, hostname);
  res.sendStatus(200);
});

// Group management
app.get('/api/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  // For each group, get its members
  const groupsWithMembers = groups.map(group => {
    const members = db.prepare('SELECT hostname FROM clients WHERE group_id = ?').all(group.id);
    return { ...group, members: members.map(m => m.hostname) };
  });
  res.json(groupsWithMembers);
});

app.post('/api/groups', (req, res) => {
  const { name, description } = req.body;
  db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)').run(name, description);
  res.sendStatus(201);
});

app.delete('/api/groups/:id', (req, res) => {
  const groupId = req.params.id;
  db.prepare('UPDATE clients SET group_id = NULL WHERE group_id = ?').run(groupId);
  db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  res.sendStatus(200);
});

// --- File Management APIs ---

// Create new playlist directory
app.post('/api/playlists/create', (req, res) => {
  const { name, type } = req.body; // type is 'playlists' or 'adverts'
  const targetDir = path.join(musicPath, type, name);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    res.sendStatus(201);
  } else {
    res.status(400).send('Directory already exists');
  }
});

// Delete playlist directory
app.delete('/api/playlists/delete', (req, res) => {
  const { name, type } = req.query; // type is 'playlists' or 'adverts'
  const targetDir = path.join(musicPath, type, name);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    res.sendStatus(200);
  } else {
    res.status(404).send('Directory not found');
  }
});

// Delete file
app.delete('/api/files/delete', (req, res) => {
  const { filePath } = req.query; // e.g., playlists/DMK Dance/1999.mp3
  const fullPath = path.join(musicPath, filePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    res.sendStatus(200);
  } else {
    res.status(404).send('File not found');
  }
});

// Basic file upload handler using raw body
app.post('/api/upload', (req, res) => {
  const fileName = req.query.name;
  const targetDir = req.query.dir; // e.g., playlists/DMK Dance
  
  if (!fileName || !targetDir) {
    return res.status(400).send('Missing file name or directory');
  }

  const fullDir = path.join(musicPath, targetDir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const fullPath = path.join(fullDir, fileName);
  const fileStream = fs.createWriteStream(fullPath);
  
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

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (hostname) => {
    socket.join(hostname); // Each Pi joins a room with its hostname
    console.log(`Pi registered: ${hostname}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --- Start Server ---
const PORT = settings.PORT;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
