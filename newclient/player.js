const { spawn, exec } = require('child_process');
const os = require('os');
const path = require('path');

const isWindows = os.platform() === 'win32';
const playerLibrary = !isWindows ? require('play-sound')(opts = {}) : null;

let currentProcess = null;
let isPlaying = false;
let currentVolume = 50;

async function play(filePath) {
  stop(); // Ensure previous is stopped
  isPlaying = true;

  if (isWindows) {
    // Native PowerShell playback for Windows (no external player needed)
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
      currentProcess = spawn('powershell', ['-Command', psCommand]);
      
      currentProcess.on('exit', (code) => {
        isPlaying = false;
        currentProcess = null;
        if (code !== 0 && code !== null) {
          reject(new Error(`PowerShell exited with code ${code}`));
        } else {
          resolve();
        }
      });

      currentProcess.on('error', (err) => {
        isPlaying = false;
        reject(err);
      });
    });
  } else {
    // Standard playback for Linux/Pi (requires mpg123, mplayer, etc.)
    return new Promise((resolve, reject) => {
      currentProcess = playerLibrary.play(filePath, (err) => {
        isPlaying = false;
        if (err && !err.killed) {
          console.error('Playback error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

function stop() {
  if (currentProcess) {
    if (isWindows) {
      // Kill the powershell process
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

function setVolume(volume) {
  currentVolume = volume;
  // volume is 0-100
  if (isWindows) {
    console.log(`[PLAYER] Windows volume set to ${volume}% (Simulated)`);
  } else {
    // Raspberry Pi / Linux volume control via amixer
    // 'PCM' or 'Master' are common control names
    exec(`amixer sset 'Master' ${volume}%`, (err) => {
      if (err) {
        // Fallback to PCM if Master fails
        exec(`amixer sset 'PCM' ${volume}%`, (err2) => {
          if (err2) console.error('Failed to set volume:', err2.message);
        });
      }
    });
  }
}

function getStatus() {
  return isPlaying ? 'playing' : 'stopped';
}

module.exports = { play, stop, getStatus, setVolume };
