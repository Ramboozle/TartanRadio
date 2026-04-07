/**
 * Tartan Radio - Audio Client Application
 * 
 * This is the core logic for the audio playback device (Raspberry Pi or Windows).
 * Responsibilities:
 * 1. Maintain a Socket.io connection to the central server for real-time commands.
 * 2. Manage a background playback loop with intelligent music/advert rotation.
 * 3. Periodically sync local audio files with the server manifest.
 * 4. Serve a local web dashboard for direct device control.
 * 5. Report status via heartbeats every 5 seconds.
 */

const axios = require('axios');
const io = require('socket.io-client');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const express = require('express');

/**
 * LOGGER INITIALIZATION
 * Redirects all console output to 'client.log' with 5MB rotation.
 */
require('./logger')('client.log');

const { syncFiles, getSyncStatus } = require('./sync');
const player = require('./player');

/**
 * CONFIGURATION & DEFAULTS
 * Settings are primarily loaded from 'settings.json'.
 * - SERVER_URL: The address of the central management server.
 * - SYNC_INTERVAL_MS: Frequency of full file manifest checks (default 1 hour).
 * - HEARTBEAT_INTERVAL_MS: Frequency of status reports to the server (default 5 seconds).
 */
let settings = {
  PORT: 3001,
  SERVER_URL: 'http://music:80',
  SYNC_INTERVAL_MS: 3600000,
  HEARTBEAT_INTERVAL_MS: 5000,
  VERSION: '2.1'
};

const SETTINGS_PATH = path.join(__dirname, 'settings.json');
if (fs.existsSync(SETTINGS_PATH)) {
  try {
    settings = { ...settings, ...fs.readJsonSync(SETTINGS_PATH) };
    console.log('[SYSTEM] Loaded custom settings from settings.json');
  } catch (e) { 
    console.error('[SYSTEM] Failed to parse settings.json, using defaults.'); 
  }
}

// Global state variables
const app = express();
const SERVER_URL = settings.SERVER_URL;
const VERSION = settings.VERSION;
const HOSTNAME = os.hostname();
const PORT = settings.PORT;
const SYNC_INTERVAL = settings.SYNC_INTERVAL_MS;
const HEARTBEAT_INTERVAL = settings.HEARTBEAT_INTERVAL_MS;
const CONFIG_PATH = path.join(__dirname, 'config.json');

let socket = null;
let currentSong = 'None';
let volume = 50;
let songsPlayed = 0;
let songsPerAd = 3;
let currentPlaylist = 'default';
let currentAdPlaylist = 'default';
let shouldPlay = false; // Persistent intent to play
let isLooping = false;  // Safeguard against starting multiple playback loops

/**
 * loadConfig()
 * Reads 'config.json' to restore state after a reboot.
 * This ensures the Pi resumes the same volume, playlist, and playback state.
 */
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const config = fs.readJsonSync(CONFIG_PATH);
      if (config.volume !== undefined) {
        volume = config.volume;
        player.setVolume(volume);
      }
      if (config.songsPerAd !== undefined) songsPerAd = config.songsPerAd;
      if (config.currentPlaylist !== undefined) currentPlaylist = config.currentPlaylist;
      if (config.currentAdPlaylist !== undefined) currentAdPlaylist = config.currentAdPlaylist;
      if (config.shouldPlay !== undefined) shouldPlay = config.shouldPlay;
      console.log('[CONFIG] Loaded settings from config.json');
    } catch (e) { 
      console.error('[CONFIG] Failed to load config.json'); 
    }
  }
}

/**
 * saveConfig()
 * Persists current state to 'config.json'.
 */
function saveConfig() {
  try {
    fs.writeJsonSync(CONFIG_PATH, {
      volume,
      songsPerAd,
      currentPlaylist,
      currentAdPlaylist,
      shouldPlay
    });
  } catch (e) { 
    console.error('[CONFIG] Failed to save config.json'); 
  }
}

/**
 * updateVolume(newVol)
 * Updates system volume and saves the preference.
 */
function updateVolume(newVol) {
  volume = parseInt(newVol);
  player.setVolume(volume);
  saveConfig();
  console.log(`[SYSTEM] Volume updated to ${volume}%`);
}

/**
 * formatSongName(name)
 * Cleans up filenames for display (removes extension and underscores).
 */
function formatSongName(name) {
  if (!name || name === 'None') return name;
  return name.replace(/_/g, ' ').replace(/\.mp3$/i, '');
}

/**
 * getIPAddress()
 * Scans network interfaces to find the local IPv4 address.
 * Prioritizes actual network IPs over self-assigned (APIPA) addresses.
 */
function getIPAddress() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  // Filter out 169.254.x.x addresses which indicate DHCP failure
  const realAddress = addresses.find(addr => !addr.startsWith('169.254'));
  return realAddress || addresses[0] || '127.0.0.1';
}

// --- Local Client UI (Express) ---

app.use(express.static(path.join(__dirname, 'public')));

/**
 * GET /
 * Serves the mobile-responsive local control dashboard.
 * Dynamically fetches available playlists from the server for the dropdowns.
 */
app.get('/', async (req, res) => {
  let playlistOptions = [];
  let advertOptions = [];
  try {
    // Fetch latest folder names from server to populate UI
    const dirRes = await axios.get(`${SERVER_URL}/api/directories`);
    playlistOptions = dirRes.data.playlists;
    advertOptions = dirRes.data.adverts;
  } catch (e) { 
    console.error('Failed to fetch options for local UI'); 
  }

  const playlistHtml = playlistOptions.map(p => `<option value="${p}" ${currentPlaylist === p ? 'selected' : ''}>${p}</option>`).join('');
  const advertHtml = advertOptions.map(a => `<option value="${a}" ${currentAdPlaylist === a ? 'selected' : ''}>${a}</option>`).join('');

  // HTML content omitted for brevity in comments, see original file for full source.
  // ... (Full HTML/JS response)
  res.send(`...`); 
});

/**
 * Local API Endpoints
 * These allow the local dashboard JS to control the client directly.
 */

app.get('/report-song', (req, res) => {
  const reason = req.query.reason || 'faulty';
  console.log(`[LOCAL UI] Received request to report song as ${reason}: ${currentSong}`);
  reportFaulty(currentSong, reason);
  res.sendStatus(200);
});

app.get('/set-playlists', (req, res) => {
  currentPlaylist = req.query.music || 'default';
  currentAdPlaylist = req.query.ads || 'default';
  songsPerAd = parseInt(req.query.frequency) || 3;
  saveConfig();
  res.sendStatus(200);
});

app.get('/set-volume', (req, res) => {
  const v = parseInt(req.query.v);
  if (!isNaN(v)) {
    updateVolume(v);
  }
  res.sendStatus(200);
});

app.get('/play', (req, res) => { 
  shouldPlay = true;
  saveConfig();
  startPlayback(); 
  res.sendStatus(200); 
});

app.get('/stop', (req, res) => { 
  shouldPlay = false;
  saveConfig();
  isLooping = false; 
  player.stop(); 
  res.sendStatus(200); 
});

app.get('/sync', (req, res) => { 
  syncFiles(); 
  res.sendStatus(200); 
});

app.get('/api/sync-status', (req, res) => {
  res.json(getSyncStatus());
});

app.get('/api/status', (req, res) => {
  res.json({
    currentSong: formatSongName(currentSong),
    status: player.getStatus(),
    volume: volume,
    shouldPlay: shouldPlay
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Local UI running on http://localhost:${PORT}`);
});

/**
 * startClient()
 * Main initialization sequence. Runs once on startup.
 */
async function startClient() {
  console.log(`Starting Tartan Radio Client: ${HOSTNAME}`);
  
  loadConfig();

  // Perform a sync immediately on boot to ensure files are ready
  console.log('[SYSTEM] Performing initial file sync...');
  await syncFiles();
  
  /**
   * SOCKET.IO CONNECTION
   * Connects to the server for real-time command processing.
   */
  socket = io(SERVER_URL);
  socket.on('connect', () => {
    console.log(`[SOCKET] Connected to server at ${SERVER_URL}`);
    socket.emit('register', HOSTNAME); // Announce identity to server
  });

  /**
   * Command Handler
   * Processes incoming messages from the server dashboard.
   */
  socket.on('command', (cmd) => {
    console.log(`[SOCKET] Received command:`, JSON.stringify(cmd));
    switch (cmd.type) {
      case 'play': 
        shouldPlay = true;
        saveConfig();
        startPlayback(); 
        break;
      case 'stop': 
        shouldPlay = false;
        saveConfig();
        isLooping = false; 
        player.stop(); 
        break;
      case 'sync': 
        syncFiles(); 
        break;
      case 'volume': 
        updateVolume(cmd.value);
        break;
      case 'set_playlists':
        currentPlaylist = cmd.value.music;
        currentAdPlaylist = cmd.value.ads;
        if (cmd.value.frequency) songsPerAd = parseInt(cmd.value.frequency);
        saveConfig();
        break;
    }
  });

  // Resume playback automatically if the user hadn't stopped it before the last exit
  if (shouldPlay) {
    console.log('[SYSTEM] Resuming playback...');
    startPlayback();
  }

  /**
   * HEARTBEAT LOOP
   * Sends current status to the server every 5 seconds.
   */
  setInterval(async () => {
    try {
      await axios.post(`${SERVER_URL}/api/heartbeat`, {
        hostname: HOSTNAME,
        ip: getIPAddress(),
        current_song: currentSong,
        volume: volume,
        status: player.getStatus(),
        version: VERSION
      });
    } catch (e) {
      // Quietly fail if server is down
      console.error('Heartbeat failed:', e.message);
    }
  }, HEARTBEAT_INTERVAL);

  /**
   * SYNC LOOP
   * Triggers a file sync periodically (default every hour).
   */
  setInterval(syncFiles, SYNC_INTERVAL);
}

// Track playback timing to detect "rapid playback" bugs (corrupted audio drivers)
let playbackHistory = [];

/**
 * startPlayback()
 * The main audio loop. Stays active as long as shouldPlay is true.
 * Handles:
 * - Sequential track selection
 * - Advert insertion (rotation)
 * - Fault tolerance and auto-restart on skip errors
 */
async function startPlayback() {
  if (isLooping) return; // Prevent double execution
  isLooping = true;

  while (isLooping) {
    // If a song is already playing, wait and check again
    if (player.getStatus() === 'playing') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    /**
     * RAPID PLAYBACK BUG WORKAROUND
     * On some systems, audio drivers crash and "skip" through songs instantly.
     * We track the timestamps of the last 5 songs. If 5 songs played in < 5 seconds,
     * we stop, wait 10s, and reset the player to clear the glitch.
     */
    const now = Date.now();
    playbackHistory.push(now);
    if (playbackHistory.length > 5) playbackHistory.shift();

    if (playbackHistory.length === 5) {
      const fiveSongsTime = playbackHistory[4] - playbackHistory[0];
      if (fiveSongsTime < 5000) {
        console.error(`[SYSTEM] Rapid playback error detected (5 songs in ${fiveSongsTime}ms). Resetting playback...`);
        isLooping = false;
        player.stop();
        playbackHistory = [];
        
        setTimeout(() => {
          if (shouldPlay) {
            console.log('[SYSTEM] Attempting to resume playback after error reset...');
            startPlayback();
          }
        }, 10000);
        return;
      }
    }

    let filePath;
    let isAd = false;
    
    // DECISION LOGIC: Is it time for an advert?
    if (songsPlayed >= songsPerAd) {
      filePath = await getRandomFile('adverts');
      isAd = true;
    } else {
      filePath = await getRandomFile('playlists');
    }

    if (filePath && isLooping) {
      currentSong = path.basename(filePath);
      console.log(`Playing: ${currentSong}`);
      try {
        // Await the player to finish the song
        await player.play(filePath);
        
        // Update rotation counters
        if (isAd) {
          songsPlayed = 0;
        } else {
          songsPlayed++;
        }
      } catch (e) {
        console.error('Playback failed:', e.message);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Cool down on error
      }
    } else {
      console.log('No files to play, waiting...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

/**
 * getRandomFile(subDir)
 * Selects a random .mp3 from the specified category.
 * Respects the user-selected playlist/advert folder.
 * Falls back to the root category if the subfolder is empty or missing.
 */
async function getRandomFile(subDir) {
  const baseDir = path.join(__dirname, 'music', subDir);
  const selectedSubDir = subDir === 'playlists' ? currentPlaylist : currentAdPlaylist;
  
  let targetDir = baseDir;
  if (selectedSubDir && selectedSubDir !== 'default') {
    targetDir = path.join(baseDir, selectedSubDir);
  }

  // Ensure directory exists
  if (!fs.existsSync(targetDir)) {
    targetDir = baseDir;
  }

  try {
    const files = await fs.readdir(targetDir, { recursive: true });
    const audioFiles = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    
    // Fallback logic if subfolder is empty
    if (audioFiles.length === 0 && targetDir !== baseDir) {
      const fallbackFiles = await fs.readdir(baseDir, { recursive: true });
      const fallbackAudio = fallbackFiles.filter(f => f.toLowerCase().endsWith('.mp3'));
      if (fallbackAudio.length === 0) return null;
      const randomFile = fallbackAudio[Math.floor(Math.random() * fallbackAudio.length)];
      return path.join(baseDir, randomFile);
    }

    if (audioFiles.length === 0) return null;
    
    // Pick random index
    const randomFile = audioFiles[Math.floor(Math.random() * audioFiles.length)];
    return path.join(targetDir, randomFile);
  } catch (e) {
    return null;
  }
}

/**
 * reportFaulty(songName, reason)
 * Sends a notification to the server that a song is bad or broken.
 */
async function reportFaulty(songName, reason) {
  try {
    await axios.post(`${SERVER_URL}/api/report-faulty`, { 
      hostname: HOSTNAME, 
      song: songName, 
      reason: reason 
    });
  } catch (e) {}
}

// Start the application
startClient();

