/**
 * Tartan Radio - Audio Player Engine
 * 
 * This module abstracts the differences between Windows and Linux/Raspberry Pi audio.
 * It provides a unified API for playing, stopping, and controlling volume.
 */

const { spawn, exec } = require('child_process');
const os = require('os');
const path = require('path');

// Identify the operating system to choose the appropriate playback engine
const isWindows = os.platform() === 'win32';

/**
 * For Linux (Raspberry Pi), we use the 'play-sound' wrapper.
 * This expects 'mpg123' to be installed on the system: sudo apt-get install mpg123
 */
const playerLibrary = !isWindows ? require('play-sound')(opts = {}) : null;

// Track active playback state
let currentProcess = null;
let isPlaying = false;
let currentVolume = 50; // Local volume state (0-100)

/**
 * play(filePath)
 * Starts playing an MP3 file.
 * 
 * @param {string} filePath Absolute or relative path to the MP3
 * @returns {Promise} Resolves when the song finishes, rejects on error
 */
async function play(filePath) {
  stop(); // Ensure any currently playing song is stopped before starting a new one
  isPlaying = true;

  if (isWindows) {
    /**
     * WINDOWS NATIVE PLAYBACK
     * Uses a PowerShell script to initialize the 'System.Windows.Media.MediaPlayer' class.
     * This avoids the need for external .exe players on Windows machines.
     * 
     * The script:
     * 1. Opens the file.
     * 2. Waits for the duration to be loaded.
     * 3. Plays the song and blocks the thread until completion.
     */
    const absolutePath = path.resolve(filePath).replace(/\\/g, '\\\\');
    const psCommand = `
      Add-Type -AssemblyName presentationCore;
      $player = New-Object system.windows.media.mediaplayer;
      $player.Volume = ${currentVolume / 100};
      $player.open('${absolutePath}');
      while($player.NaturalDuration.HasTimeSpan -eq $false) { Start-Sleep -Milliseconds 100 };
      $player.play();
      while($player.Position -lt $player.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 500 };
      $player.stop();
      $player.close();
    `;
    
    return new Promise((resolve, reject) => {
      // Spawn powershell in a separate process
      currentProcess = spawn('powershell', ['-Command', psCommand]);
      
      currentProcess.on('exit', (code) => {
        isPlaying = false;
        currentProcess = null;
        if (code !== 0 && code !== null) {
          reject(new Error(`PowerShell exited with code ${code}`));
        } else {
          resolve(); // Playback finished naturally
        }
      });

      currentProcess.on('error', (err) => {
        isPlaying = false;
        reject(err);
      });
    });
  } else {
    /**
     * LINUX / RASPBERRY PI PLAYBACK
     * Uses the 'play-sound' library which internally calls 'mpg123'.
     */
    return new Promise((resolve, reject) => {
      currentProcess = playerLibrary.play(filePath, (err) => {
        isPlaying = false;
        if (err && !err.killed) {
          console.error('Playback error:', err);
          reject(err);
        } else {
          resolve(); // Playback finished or was stopped
        }
      });
    });
  }
}

/**
 * stop()
 * Immediately halts the current playback process.
 */
function stop() {
  if (currentProcess) {
    if (isWindows) {
      /**
       * On Windows, we must kill the process tree (/t) to ensure the 
       * hidden PowerShell instance closes properly.
       */
      exec(`taskkill /pid ${currentProcess.pid} /f /t`, (err) => {
        if (err) console.error('Failed to kill playback process:', err.message);
      });
    } else {
      currentProcess.kill();
    }
    currentProcess = null;
  }
  isPlaying = false;
}

/**
 * setVolume(volume)
 * Adjusts the system-wide audio volume.
 * 
 * @param {number} volume Value from 0 to 100
 */
function setVolume(volume) {
  currentVolume = volume;
  
  if (isWindows) {
    /**
     * Current Windows implementation: Volume is applied per-song in the 
     * PowerShell script rather than globally.
     */
    console.log(`[PLAYER] Windows volume set to ${volume}% (Next track will apply)`);
  } else {
    /**
     * LINUX VOLUME CONTROL
     * Uses 'amixer' to adjust the 'Master' or 'PCM' mixer controls.
     */
    exec(`amixer sset 'Master' ${volume}%`, (err) => {
      if (err) {
        // Fallback to 'PCM' if 'Master' control doesn't exist (common on some RPi hats)
        exec(`amixer sset 'PCM' ${volume}%`, (err2) => {
          if (err2) console.error('Failed to set volume:', err2.message);
        });
      }
    });
  }
}

/**
 * getStatus()
 * Returns whether the player is currently active.
 */
function getStatus() {
  return isPlaying ? 'playing' : 'stopped';
}

module.exports = { play, stop, getStatus, setVolume };

