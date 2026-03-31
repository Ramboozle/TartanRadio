const { Client } = require('ssh2');
const { spawn } = require('child_process');
const os = require('os');

/**
 * "The Instant Stream" - Ultra-Low Latency Raw PCM Listener.
 * Optimized for <30ms delay on Raspbian.
 */

const config = {
    host: '10.0.32.93',
    port: 22,
    username: 'music',
    password: 'LS101DY22013'
};

const UDP_PORT = 1234;
let gstProcess = null;
let isShuttingDown = false;

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

function startGStreamer() {
    if (gstProcess || isShuttingDown) return;

    console.log(`[LOCAL] Starting Raw PCM Listener on port ${UDP_PORT}...`);
    
    /**
     * GStreamer Pipeline:
     * - udpsrc: We add "caps" to tell GStreamer exactly what the raw bits are.
     * - rawaudioparse: Interprets the raw PCM stream.
     * - alsasink: Direct hardware output.
     */
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

function connect() {
    if (isShuttingDown) return;

    const conn = new Client();
    console.log(`[SSH] Connecting to ${config.host}...`);

    conn.on('ready', () => {
        console.log(`[SSH] Connected. Triggering Raw PCM stream...`);
        
        /**
         * Optimized arecord flags:
         * -f S16_LE: Raw 16-bit Little Endian (Fastest)
         * -r 44100: CD quality
         * -c 2: Stereo
         * -B 10000: FORCE 10ms buffer time (Crucial for speed)
         * -t raw: Don't add a WAV header
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
            setTimeout(connect, 2000);
        }
    });

    conn.connect(config);
}

console.log('--- Tartan Radio INSTANT STREAM (GStreamer + Raw PCM) ---');
startGStreamer();
connect();

process.on('SIGINT', () => {
    isShuttingDown = true;
    if (gstProcess) gstProcess.kill();
    process.exit();
});
