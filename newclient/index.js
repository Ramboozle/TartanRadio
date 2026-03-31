const axios = require('axios');
const io = require('socket.io-client');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const express = require('express');

// Initialize file logging
require('./logger')('client.log');

const { syncFiles, getSyncStatus } = require('./sync');
const player = require('./player');

// Load external settings
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
  } catch (e) { console.error('[SYSTEM] Failed to parse settings.json, using defaults.'); }
}

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
let shouldPlay = false;
let isLooping = false; // Prevent multiple playback loops

// Load saved config
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
    } catch (e) { console.error('[CONFIG] Failed to load config.json'); }
  }
}

function saveConfig() {
  try {
    fs.writeJsonSync(CONFIG_PATH, {
      volume,
      songsPerAd,
      currentPlaylist,
      currentAdPlaylist,
      shouldPlay
    });
  } catch (e) { console.error('[CONFIG] Failed to save config.json'); }
}

function updateVolume(newVol) {
  volume = parseInt(newVol);
  player.setVolume(volume);
  saveConfig();
  console.log(`[SYSTEM] Volume updated to ${volume}%`);
}

function formatSongName(name) {
  if (!name || name === 'None') return name;
  return name.replace(/_/g, ' ').replace(/\.mp3$/i, '');
}

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

  // Prioritize non-APIPA addresses (169.254.x.x)
  const realAddress = addresses.find(addr => !addr.startsWith('169.254'));
  return realAddress || addresses[0] || '127.0.0.1';
}

// --- Local Client UI ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', async (req, res) => {
  let playlistOptions = [];
  let advertOptions = [];
  try {
    const dirRes = await axios.get(`${SERVER_URL}/api/directories`);
    playlistOptions = dirRes.data.playlists;
    advertOptions = dirRes.data.adverts;
  } catch (e) { console.error('Failed to fetch options for local UI'); }

  const playlistHtml = playlistOptions.map(p => `<option value="${p}" ${currentPlaylist === p ? 'selected' : ''}>${p}</option>`).join('');
  const advertHtml = advertOptions.map(a => `<option value="${a}" ${currentAdPlaylist === a ? 'selected' : ''}>${a}</option>`).join('');

  res.send(`
    <html>
      <head>
        <title>${HOSTNAME}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
        <style>
          :root {
              --primary-color: #00a711;      
              --primary-dark: #005a09;       
              --primary-light: #20c231;      
              --background-dark: #0a140a;    
              --card-dark: #142814;          
              --secondary-dark: #1c351c;     
              --text-light: #e0f2e0;         
              --text-muted: #a0c0a0;         
              --accent-blue-light: #00adfd;  
              --accent-blue-dark: #0077c4;   
              --text-on-primary: #ffffff;
          }

          html, body {
              margin: 0;
              padding: 0;
              background-color: var(--background-dark);
              overflow-x: hidden;
          }

          body {
              color: var(--text-light);
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              min-height: 100vh;
              -webkit-tap-highlight-color: transparent;
          }

          .section {
              padding: 1.5rem 0.75rem;
          }

          .box {
              background-color: var(--card-dark);
              color: var(--text-light);
              border-radius: 8px;
              box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
              border: 1px solid var(--secondary-dark);
              border-top: 4px solid var(--primary-color);
              padding: 1.25rem;
          }

          .table th {
              background-color: var(--secondary-dark);
              color: var(--primary-color) !important;
              border-bottom: 2px solid var(--primary-color) !important;
          }

          .title {
              color: var(--primary-color) !important;
              font-weight: 700;
              font-size: 1.75rem;
              word-break: break-all;
          }

          .subtitle {
              color: var(--text-muted) !important;
          }

          strong {
              color: #a0c0a0 !important;
          }

          .navbar.is-dark {
              background-color: var(--card-dark) !important;
              border-bottom: 1px solid var(--primary-dark);
          }

          .navbar-brand {
              padding: 0 0.5rem;
          }

          .button {
              height: 3rem;
              font-weight: 600;
              transition: transform 0.1s;
          }

          .button:active {
              transform: scale(0.98);
          }

          .button.is-primary {
              background-color: var(--primary-color) !important;
              color: var(--text-on-primary) !important;
              border-color: transparent !important;
          }

          .button.is-primary:hover {
              background-color: var(--primary-light) !important;
          }

          .button.is-link {
              background-color: var(--accent-blue-dark) !important;
              color: #ffffff !important;
          }

          .button.is-info {
              background-color: var(--accent-blue-light) !important;
              color: #ffffff !important;
          }

          .input, .select select, .textarea {
              background-color: var(--background-dark) !important;
              border-color: var(--secondary-dark) !important;
              color: var(--text-light) !important;
              height: 3rem;
          }

          .input:focus, .select select:focus {
              border-color: var(--primary-color) !important;
              box-shadow: 0 0 0 0.125em rgba(0, 167, 17, 0.25) !important;
          }

          .label {
              color: var(--text-muted) !important;
              margin-bottom: 0.75rem;
          }

          /* Volume Slider Optimization */
          .volume-container {
              padding: 1rem 0;
          }

          input[type=range] {
              -webkit-appearance: none;
              width: 100%;
              height: 12px;
              background: var(--secondary-dark);
              border-radius: 10px;
              outline: none;
              margin: 1.5rem 0;
          }

          input[type=range]::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 28px;
              height: 28px;
              background: var(--primary-color);
              cursor: pointer;
              border-radius: 50%;
              border: 3px solid #ffffff;
              box-shadow: 0 0 10px rgba(0,0,0,0.5);
          }

          input[type=range]::-moz-range-thumb {
              width: 28px;
              height: 28px;
              background: var(--primary-color);
              cursor: pointer;
              border-radius: 50%;
              border: 3px solid #ffffff;
              box-shadow: 0 0 10px rgba(0,0,0,0.5);
          }

          .footer-contact {
              margin-top: 3rem;
              padding: 2.5rem 1rem;
              background-color: #050a05;
              border-top: 5px solid var(--primary-color);
              text-align: center;
              font-size: 0.9rem;
              color: var(--text-light);
          }

          .footer-contact strong {
              color: var(--primary-color) !important;
          }

          .footer-contact a {
              color: var(--accent-blue-light);
              text-decoration: underline;
          }

          /* Mobile Tweaks */
          @media screen and (max-width: 768px) {
              .section { padding-top: 1rem; }
              .title { font-size: 1.5rem; margin-bottom: 1.5rem !important; }
              .column { padding: 0.5rem 0.75rem; }
              .buttons .button { width: 100%; margin-right: 0 !important; margin-bottom: 0.75rem; }
              .navbar-brand strong { font-size: 1.1rem; }
              .box { padding: 1.25rem 1rem; margin-bottom: 1.5rem; }
              .is-size-5-mobile { font-size: 1.25rem !important; }
              .label { font-size: 0.9rem; }
              
              /* Navbar Menu Mobile Theme */
              .navbar-menu {
                  background-color: var(--card-dark) !important;
                  border-bottom: 2px solid var(--primary-dark);
                  padding: 0.5rem;
                  box-shadow: 0 8px 16px rgba(0,0,0,0.5);
              }
              .navbar-item {
                  color: var(--text-light) !important;
                  border-bottom: 1px solid var(--secondary-dark);
                  padding: 1rem;
              }
              .navbar-item:hover {
                  background-color: var(--secondary-dark) !important;
                  color: var(--primary-color) !important;
              }
              .navbar-burger {
                  color: var(--primary-color) !important;
                  height: 3.25rem;
                  width: 3.25rem;
              }

              /* Ensure dropdowns are easy to use */
              .select, .select select { width: 100% !important; height: 3.5rem !important; }
              
              /* Volume Slider Touch Optimization */
              input[type=range]::-webkit-slider-thumb { width: 34px; height: 34px; }
              input[type=range]::-moz-range-thumb { width: 34px; height: 34px; }
          }
        </style>
      </head>
      <body>
        <div id="app">
          <nav class="navbar is-dark" role="navigation" aria-label="main navigation">
              <div class="navbar-brand">
                  <a class="navbar-item" href="/">
                      <img src="${SERVER_URL}/DMK-logo.png" style="max-height: 40px; margin-right: 10px;">
                      <strong>Tartan Radio</strong>
                      <span class="tag is-success ml-2">v${VERSION}</span>
                  </a>
                  <a role="button" class="navbar-burger" aria-label="menu" aria-expanded="false" data-target="navbarMenu">
                      <span aria-hidden="true"></span>
                      <span aria-hidden="true"></span>
                      <span aria-hidden="true"></span>
                  </a>
              </div>
              <div id="navbarMenu" class="navbar-menu">
                  <div class="navbar-end">
                      <a class="navbar-item" href="${SERVER_URL}" target="_blank">Open Server Dashboard</a>
                  </div>
              </div>
          </nav>

          <div class="container">
            <section class="section">
              <div class="box">
                <h1 class="title mb-5">${HOSTNAME}</h1>
                
                <div class="columns is-mobile is-multiline mb-0">
                  <div class="column is-12-mobile is-7-tablet">
                    <p class="label mb-1">NOW PLAYING</p>
                    <p id="currentSongDisplay" class="has-text-white is-size-5 is-size-5-mobile has-text-weight-bold" style="line-height: 1.2;">
                      ${formatSongName(currentSong)}
                    </p>
                  </div>
                  <div class="column is-12-mobile is-5-tablet">
                    <p class="label mb-1">STATUS</p>
                    <span class="tag is-medium is-fullwidth-mobile ${player.getStatus() === 'playing' ? 'is-success' : 'is-warning'}" style="height: 2.5rem; font-weight: 700;">
                      ${player.getStatus().toUpperCase()}
                    </span>
                  </div>
                </div>

                <hr style="background-color: var(--secondary-dark); height: 1px; border: none; margin: 1.5rem 0;">

                <div class="field volume-container">
                  <div class="is-flex is-justify-content-space-between is-align-items-center mb-2">
                    <label class="label mb-0">System Volume</label>
                    <span id="volDisplay" class="has-text-white is-size-5 has-text-weight-bold">${volume}%</span>
                  </div>
                  <div class="control">
                    <input type="range" min="0" max="100" value="${volume}" 
                      oninput="document.getElementById('volDisplay').innerText = this.value + '%'" 
                      onchange="fetch('/set-volume?v=' + this.value)">
                  </div>
                </div>

                <div class="columns is-multiline mt-2">
                  <div class="column is-12-mobile is-4-tablet">
                    <div class="field">
                      <label class="label">Music Playlist</label>
                      <div class="control">
                        <div class="select is-fullwidth">
                          <select id="musicSelect">
                            ${playlistHtml}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="column is-12-mobile is-4-tablet">
                    <div class="field">
                      <label class="label">Advert Playlist</label>
                      <div class="control">
                        <div class="select is-fullwidth">
                          <select id="adSelect">
                            ${advertHtml}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="column is-12-mobile is-4-tablet">
                    <div class="field">
                      <label class="label">Ad Frequency</label>
                      <div class="control">
                        <div class="select is-fullwidth">
                          <select id="freqSelect">
                            ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}" ${songsPerAd === n ? 'selected' : ''}>Every ${n} songs</option>`).join('')}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div id="syncProgress" class="mb-4" style="display: none;">
                  <p class="label mb-1" id="syncHeader">SYNCING FILES...</p>
                  <progress id="syncBar" class="progress is-info is-small" value="0" max="100">0%</progress>
                  <p id="syncText" class="is-size-7 has-text-centered mt-1" style="color: var(--text-muted);">Checking...</p>
                </div>

                <div class="buttons mt-5">
                  <button class="button is-primary is-fullwidth" style="height: 3.5rem;" onclick="applySettings()">APPLY & PLAY</button>
                  <div class="columns is-mobile is-gapless mt-2" style="width: 100%">
                    <div class="column mr-1">
                      <button class="button is-warning is-fullwidth" onclick="fetch('/stop').then(()=>location.reload())">STOP</button>
                    </div>
                    <div class="column ml-1">
                      <button class="button is-info is-fullwidth" onclick="fetch('/sync').then(()=>updateSyncStatus())">SYNC</button>
                    </div>
                  </div>
                </div>

                <hr style="background-color: var(--secondary-dark); height: 1px; border: none; margin: 1.5rem 0;">

                <div class="columns is-mobile">
                  <div class="column">
                    <button class="button is-danger is-outlined is-small is-fullwidth" style="height: 3rem;" onclick="report('bad')">Bad Song</button>
                  </div>
                  <div class="column">
                    <button class="button is-danger is-small is-fullwidth" style="height: 3rem;" onclick="report('faulty')">Faulty Song</button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <footer class="footer-contact">
              <div class="container">
                <p><strong>Hostname:</strong> ${HOSTNAME}</p>
                <p><strong>IP:</strong> ${getIPAddress()} | <strong>v:</strong> ${VERSION}</p>
                <p class="is-size-7 mt-3" style="opacity: 0.6">Connected to: ${SERVER_URL}</p>
                <hr style="background-color: var(--secondary-dark); margin: 1.5rem 0;">
                <p><strong>Support:</strong> Oliver Nield<br><a href="mailto:oliver.nield@dmkeith.com">oliver.nield@dmkeith.com</a> | Ext: 2096</p>
              </div>
          </footer>
        </div>


        <script>
          function applySettings() {
            const music = document.getElementById('musicSelect').value;
            const ads = document.getElementById('adSelect').value;
            const freq = document.getElementById('freqSelect').value;
            fetch('/set-playlists?music=' + music + '&ads=' + ads + '&frequency=' + freq)
              .then(() => fetch('/play'))
              .then(() => setTimeout(() => location.reload(), 1000));
          }
          function report(reason) {
            const label = reason === 'bad' ? 'Bad Song' : 'Faulty Song';
            const songName = document.getElementById('currentSongDisplay').innerText;
            if(confirm('Report "' + songName + '" as ' + label + ' to server?')) {
              fetch('/report-song?reason=' + reason).then(() => alert('Reported'));
            }
          }

          let lastSyncState = null;
          function updateSyncStatus() {
            fetch('/api/sync-status')
              .then(res => res.json())
              .then(status => {
                const container = document.getElementById('syncProgress');
                
                // If it's active, always show it
                if (status.active) {
                  lastSyncState = 'active';
                  if (window.syncHideTimeout) {
                    clearTimeout(window.syncHideTimeout);
                    window.syncHideTimeout = null;
                  }
                  container.style.display = 'block';
                  const progress = status.totalFiles > 0 ? (status.completedFiles / status.totalFiles) * 100 : 0;
                  document.getElementById('syncBar').value = progress;
                  document.getElementById('syncText').innerText = 'Downloading: ' + status.currentFile + ' (' + status.completedFiles + '/' + status.totalFiles + ')';
                  document.getElementById('syncHeader').innerText = "SYNCING FILES...";
                  return;
                }

                // If it's NOT active, but it JUST finished (transition from active to complete/up-to-date)
                const isFinishedState = status.currentFile === 'Sync Complete' || status.currentFile === 'Up to date' || status.currentFile === 'Sync Failed';
                
                if (isFinishedState && lastSyncState === 'active') {
                   lastSyncState = 'finished';
                   container.style.display = 'block';
                   document.getElementById('syncText').innerText = status.currentFile;
                   document.getElementById('syncBar').value = 100;
                   document.getElementById('syncHeader').innerText = status.currentFile === 'Sync Failed' ? 'SYNC ERROR' : "SYNC FINISHED";
                   
                   // Only hide it once, 5 seconds after it finishes
                   window.syncHideTimeout = setTimeout(() => {
                     container.style.display = 'none';
                     lastSyncState = 'hidden';
                     window.syncHideTimeout = null;
                   }, 5000);
                } else if (lastSyncState !== 'finished' && lastSyncState !== 'active') {
                  // If we aren't actively syncing or in the 5-second "cooldown", keep it hidden
                  container.style.display = 'none';
                }
              });
          }

          function updateInfo() {
            fetch('/api/status')
              .then(res => res.json())
              .then(data => {
                document.getElementById('currentSongDisplay').innerText = data.currentSong;
                const statusTag = document.querySelector('.tag.is-medium');
                statusTag.innerText = data.status.toUpperCase();
                statusTag.className = 'tag is-medium is-fullwidth-mobile ' + (data.status === 'playing' ? 'is-success' : 'is-warning');
                
                // Update volume display and slider IF not currently being dragged
                // We check if the mouse is down on the range input
                const slider = document.querySelector('input[type=range]');
                if (document.activeElement !== slider) {
                  document.getElementById('volDisplay').innerText = data.volume + '%';
                  slider.value = data.volume;
                }
              });
          }

          // Check sync status every 2 seconds for smoother UI
          setInterval(updateSyncStatus, 2000);
          updateSyncStatus(); // Initial check

          // Refresh general info every 5 seconds
          setInterval(updateInfo, 5000);
          updateInfo(); // Initial check

          // Burger menu toggle
          document.addEventListener('DOMContentLoaded', () => {
              const $navbarBurgers = Array.prototype.slice.call(document.querySelectorAll('.navbar-burger'), 0);
              $navbarBurgers.forEach( el => {
                  el.addEventListener('click', () => {
                      const target = el.dataset.target;
                      const $target = document.getElementById(target);
                      el.classList.toggle('is-active');
                      $target.classList.toggle('is-active');
                  });
              });
          });
        </script>
      </body>
    </html>
  `);
});

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

async function startClient() {
  console.log(`Starting Tartan Radio Client: ${HOSTNAME}`);
  
  loadConfig();

  // Initial Sync
  console.log('[SYSTEM] Performing initial file sync...');
  await syncFiles();
  
  // Connect to Socket.io
  socket = io(SERVER_URL);
  socket.on('connect', () => {
    console.log(`[SOCKET] Connected to server at ${SERVER_URL}`);
    socket.emit('register', HOSTNAME);
  });

  // Handle Socket Commands
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

  // Auto-resume playback if it was playing before
  if (shouldPlay) {
    console.log('[SYSTEM] Resuming playback...');
    startPlayback();
  }

  // Heartbeat Loop
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
      console.error('Heartbeat failed:', e.message);
    }
  }, HEARTBEAT_INTERVAL);

  // Sync Loop
  setInterval(syncFiles, SYNC_INTERVAL);
}

let playbackHistory = [];

async function startPlayback() {
  if (isLooping) return;
  isLooping = true;

  while (isLooping) {
    if (player.getStatus() === 'playing') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    // Bug Workaround: Check for rapid playback error
    const now = Date.now();
    playbackHistory.push(now);
    // Keep only the last 5 attempts
    if (playbackHistory.length > 5) playbackHistory.shift();

    if (playbackHistory.length === 5) {
      const fiveSongsTime = playbackHistory[4] - playbackHistory[0];
      if (fiveSongsTime < 5000) {
        console.error(`[SYSTEM] Rapid playback error detected (5 songs in ${fiveSongsTime}ms). Resetting playback...`);
        isLooping = false;
        player.stop();
        playbackHistory = [];
        
        // Wait 10 seconds and try again if we should still be playing
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
        await player.play(filePath);
        if (isAd) {
          songsPlayed = 0;
        } else {
          songsPlayed++;
        }
      } catch (e) {
        console.error('Playback failed:', e.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } else {
      console.log('No files to play, waiting...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

async function getRandomFile(subDir) {
  const baseDir = path.join(__dirname, 'music', subDir);
  const selectedSubDir = subDir === 'playlists' ? currentPlaylist : currentAdPlaylist;
  
  let targetDir = baseDir;
  if (selectedSubDir && selectedSubDir !== 'default') {
    targetDir = path.join(baseDir, selectedSubDir);
  }

  if (!fs.existsSync(targetDir)) {
    targetDir = baseDir;
  }

  const files = await fs.readdir(targetDir, { recursive: true });
  const audioFiles = files.filter(f => f.toLowerCase().endsWith('.mp3'));
  
  if (audioFiles.length === 0 && targetDir !== baseDir) {
    const fallbackFiles = await fs.readdir(baseDir, { recursive: true });
    const fallbackAudio = fallbackFiles.filter(f => f.toLowerCase().endsWith('.mp3'));
    if (fallbackAudio.length === 0) return null;
    const randomFile = fallbackAudio[Math.floor(Math.random() * fallbackAudio.length)];
    return path.join(baseDir, randomFile);
  }

  if (audioFiles.length === 0) return null;
  const randomFile = audioFiles[Math.floor(Math.random() * audioFiles.length)];
  return path.join(targetDir, randomFile);
}

async function reportFaulty(songName, reason) {
  try {
    await axios.post(`${SERVER_URL}/api/report-faulty`, { hostname: HOSTNAME, song: songName, reason: reason });
  } catch (e) {}
}

startClient();
