/**
 * Tartan Radio - Remote Listener (Instant Stream)
 * 
 * This component is designed for ultra-low latency (<30ms) audio streaming 
 * between two Raspberry Pis. It uses SSH to trigger a raw PCM audio capture 
 * on a remote Pi and receives the stream via UDP using GStreamer.
 * 
 * Workflow:
 * 1. Initialize local GStreamer pipeline to listen for raw audio bits on a UDP port.
 * 2. Connect via SSH to the "Source Pi" (where the music is physically playing).
 * 3. Execute 'arecord' on the remote Pi to capture live audio and pipe it 
 *    directly to 'nc' (netcat) targeting this listener's IP and port.
 */

const { Client } = require('ssh2');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * LOGGER INITIALIZATION
 * Captures all console output and redirects it to 'listener.log'.
 * Includes 5MB rotation to protect SD card life on Raspberry Pis.
 */
require('./logger')('listener.log');

/**
 * CONFIGURATION & DEFAULTS
 * Settings are loaded from 'settings.json'.
 * - REMOTE_PI_IP: The address of the Pi providing the audio source.
 * - SSH_USERNAME/PASSWORD: Credentials for the remote Pi.
 * - UDP_PORT: The network port used for the raw audio transmission.
 */
let settings = {
    REMOTE_PI_IP: '10.0.32.93',
    SSH_USERNAME: 'music',
    SSH_PASSWORD: 'password',
    UDP_PORT: 1234
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

const config = {
    host: settings.REMOTE_PI_IP,
    port: 22,
    username: settings.SSH_USERNAME,
    password: settings.SSH_PASSWORD
};

const UDP_PORT = settings.UDP_PORT;
let gstProcess = null;
let isShuttingDown = false;

/**
 * getLocalIP()
 * Determines the local IPv4 address of this listener Pi.
 * This is sent to the remote Pi so it knows where to "shoot" the audio packets.
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const LISTENER_IP = getLocalIP();

/**
 * startGStreamer()
 * Spawns the local GStreamer process to decode and play the incoming stream.
 * 
 * Pipeline Explanation:
 * - udpsrc: Listens for raw UDP packets.
 * - caps: Explicitly defines the audio format (S16LE, 44.1kHz, Stereo).
 * - rawaudioparse: Interprets the raw bitstream into audio frames.
 * - alsasink: Direct output to the ALSA audio driver.
 * - sync=false: Disables clock synchronization to prioritize speed over perfect timing.
 */
function startGStreamer() {
    if (gstProcess || isShuttingDown) return;

    console.log(`[LOCAL] Starting Raw PCM Listener on port ${UDP_PORT}...`);
    
    const gstArgs = [
        'udpsrc', `port=${UDP_PORT}`, 'caps=audio/x-raw,format=S16LE,rate=44100,channels=2,layout=interleaved',
        '!', 'rawaudioparse', 'format=pcm', 'pcm-format=s16le', 'sample-rate=44100', 'num-channels=2',
        '!', 'audioconvert',
        '!', 'audioresample',
        '!', 'alsasink', 'sync=false', 'buffer-time=150000', 'latency-time=37500'
    ];

    gstProcess = spawn('gst-launch-1.0', gstArgs, { stdio: 'inherit' });

    gstProcess.on('exit', (code) => {
        gstProcess = null;
        if (!isShuttingDown) {
            console.log(`[LOCAL] GStreamer exited. Restarting...`);
            setTimeout(startGStreamer, 1000);
        }
    });
}

/**
 * connect()
 * Manages the SSH connection to the remote source Pi.
 * Once connected, it executes the 'arecord' command remotely to begin the stream.
 */
function connect() {
    if (isShuttingDown) return;

    const conn = new Client();
    console.log(`[SSH] Connecting to ${config.host}...`);

    conn.on('ready', () => {
        console.log(`[SSH] Connected. Triggering Raw PCM stream...`);
        
        /**
         * REMOTE COMMAND:
         * - arecord: Captures audio from the default input device (Loopback or Mic).
         * - -f S16_LE: Raw 16-bit bits.
         * - -B 150000: Sets a very small buffer to reduce transmission delay.
         * - -t raw: Outputs a raw stream with no headers.
         * - | nc -u: Pipes the raw audio into netcat to send it via UDP.
         */
        const streamCommand = `arecord -f S16_LE -r 44100 -c 2 -B 150000 -t raw | nc -u ${LISTENER_IP} ${UDP_PORT}`;
        
        conn.exec(streamCommand, (err, stream) => {
            if (err) {
                console.error(`[SSH] Exec error: ${err.message}`);
                conn.end();
                return;
            }

            stream.on('close', (code) => {
                console.log(`[REMOTE] Stream stopped.`);
                conn.end();
            });

            stream.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) console.log(`[PI]: ${msg}`);
            });
        });
    });

    conn.on('error', (err) => {
        console.error(`[SSH] Connection error: ${err.message}`);
    });

    conn.on('close', () => {
        if (!isShuttingDown) {
            // Auto-reconnect if connection is lost
            setTimeout(connect, 2000);
        }
    });

    conn.connect(config);
}

// Startup
console.log('--- Tartan Radio INSTANT STREAM (GStreamer + Raw PCM) ---');
startGStreamer();
connect();

/**
 * Shutdown Handler
 * Ensures background processes are killed when the Node process exits.
 */
process.on('SIGINT', () => {
    isShuttingDown = true;
    if (gstProcess) gstProcess.kill();
    process.exit();
});

