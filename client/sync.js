/**
 * Tartan Radio - File Synchronization Engine
 * 
 * This module ensures the local Raspberry Pi or Windows client has a 1:1 mirror
 * of the music and adverts stored on the central server.
 * 
 * Logic flow:
 * 1. Fetch the file manifest from the server.
 * 2. Cleanup: Delete any local files or directories NOT present on the server.
 * 3. Comparison: Compare local files with server files (by existence and size).
 * 4. Download: Stream any missing or modified files from the server.
 * 5. Tracking: Update a global 'syncStatus' object for the local UI to display.
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Target server and local storage root
const SERVER_URL = 'http://music:80';
const LOCAL_MUSIC_PATH = path.join(__dirname, 'music');

/**
 * Global sync state
 * Read by the local Express server to show progress on the device dashboard.
 */
let syncStatus = {
  active: false,
  totalFiles: 0,
  completedFiles: 0,
  totalBytes: 0,
  completedBytes: 0,
  currentFile: '',
  error: null
};

/**
 * getSyncStatus()
 * Returns the current state of the sync engine.
 */
function getSyncStatus() {
  return syncStatus;
}

/**
 * getAllFiles(dirPath, arrayOfFiles)
 * Recursively scans a local directory to build a list of all files and folders.
 * Used for the cleanup phase to identify redundant local files.
 */
async function getAllFiles(dirPath, arrayOfFiles) {
  const files = await fs.readdir(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stats = await fs.stat(fullPath);
    
    if (stats.isDirectory()) {
      arrayOfFiles = await getAllFiles(fullPath, arrayOfFiles);
      arrayOfFiles.push(fullPath); // Include the directory itself for potential cleanup
    } else {
      arrayOfFiles.push(fullPath);
    }
  }

  return arrayOfFiles;
}

/**
 * syncFiles()
 * The main entry point for the synchronization process.
 */
async function syncFiles() {
  // Prevent concurrent sync processes
  if (syncStatus.active) return;
  
  console.log('[SYNC] Starting file sync process...');
  
  // Reset status
  syncStatus = {
    active: true,
    totalFiles: 0,
    completedFiles: 0,
    totalBytes: 0,
    completedBytes: 0,
    currentFile: 'Checking server...',
    error: null
  };

  try {
    /**
     * PHASE 1: FETCH MANIFEST
     * Get a JSON list of all files in /playlists and /adverts from the server.
     */
    const response = await axios.get(`${SERVER_URL}/api/files`);
    const { playlists, adverts } = response.data;

    // Ensure local root directories exist
    await ensureDirs();

    /**
     * PHASE 2: CLEANUP (THE "1:1 MIRROR" LOGIC)
     * We scan the local disk and delete anything that the server didn't list.
     * This ensures if a user deletes a playlist on the server, it is also
     * removed from the clients.
     */
    const cleanup = async (subDir, serverFiles) => {
        const localDir = path.join(LOCAL_MUSIC_PATH, subDir);
        if (!(await fs.pathExists(localDir))) return;
        
        console.log(`[SYNC] Checking for removed files in: ${subDir}`);
        
        const allLocalPaths = await getAllFiles(localDir);
        const serverFilePaths = serverFiles.map(f => f.path);

        // Sort by length descending so we delete files inside folders before 
        // attempting to delete the folders themselves.
        const sortedPaths = allLocalPaths.sort((a, b) => b.length - a.length);

        let removedCount = 0;
        for (const fullPath of sortedPaths) {
            const relativePath = path.relative(localDir, fullPath).replace(/\\/g, '/');
            const stats = await fs.stat(fullPath);

            if (stats.isFile()) {
                // If local file is NOT in the server manifest, delete it
                if (!serverFilePaths.includes(relativePath)) {
                    console.log(`[SYNC] Removing file (not on server): ${relativePath}`);
                    await fs.remove(fullPath);
                    removedCount++;
                }
            } else if (stats.isDirectory()) {
                // Remove directories if they are empty after file deletion
                const contents = await fs.readdir(fullPath);
                if (contents.length === 0) {
                    console.log(`[SYNC] Removing empty directory: ${relativePath}`);
                    await fs.remove(fullPath);
                }
            }
        }
        if (removedCount > 0) console.log(`[SYNC] Cleaned up ${removedCount} redundant files.`);
    };

    await cleanup('playlists', playlists);
    await cleanup('adverts', adverts);

    /**
     * PHASE 3: COMPARISON
     * Identify which files are missing or have changed size.
     */
    const toDownload = [];
    const checkDir = async (subDir, serverFiles) => {
      const localDir = path.join(LOCAL_MUSIC_PATH, subDir);
      for (const file of serverFiles) {
        const localFilePath = path.join(localDir, file.path);
        let shouldDownload = false;

        if (!(await fs.pathExists(localFilePath))) {
          shouldDownload = true; // Missing locally
        } else {
          const stats = await fs.stat(localFilePath);
          if (stats.size !== file.size) shouldDownload = true; // Size mismatch (corrupted or updated)
        }

        if (shouldDownload) {
          toDownload.push({ subDir, file, localFilePath });
          syncStatus.totalFiles++;
          syncStatus.totalBytes += file.size;
        }
      }
    };

    await checkDir('playlists', playlists);
    await checkDir('adverts', adverts);

    // If everything matches, stop here
    if (toDownload.length === 0) {
      console.log('[SYNC] All files are already up to date.');
      syncStatus = { ...syncStatus, active: false, currentFile: 'Up to date' };
      return;
    }

    console.log(`[SYNC] Found ${toDownload.length} files to download.`);

    /**
     * PHASE 4: DOWNLOAD
     * Download files one by one using streams to conserve memory.
     */
    for (const item of toDownload) {
      const { subDir, file, localFilePath } = item;
      syncStatus.currentFile = file.path;
      
      // Ensure the URL is properly encoded for special characters in filenames
      const encodedPath = file.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
      const serverFileUrl = `${SERVER_URL}/music/${subDir}/${encodedPath}`;

      console.log(`[SYNC] Downloading: ${file.path}`);
      
      // Create parent directories if missing
      await fs.ensureDir(path.dirname(localFilePath));
      
      const writer = fs.createWriteStream(localFilePath);
      const response = await axios({
        url: serverFileUrl,
        method: 'GET',
        responseType: 'stream'
      });

      // Track download progress for the UI
      response.data.on('data', (chunk) => {
        syncStatus.completedBytes += chunk.length;
      });

      // Pipe server response directly to file
      response.data.pipe(writer);

      // Wait for the file to finish writing
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      syncStatus.completedFiles++;
    }

    console.log('[SYNC] Sync process complete.');
    syncStatus = { ...syncStatus, active: false, currentFile: 'Sync Complete' };

  } catch (error) {
    console.error('[SYNC] Sync failed:', error.message);
    syncStatus = {
      ...syncStatus,
      active: false,
      error: error.message,
      currentFile: 'Sync Failed'
    };
  }
}

/**
 * ensureDirs()
 * Creates the required 'music/playlists' and 'music/adverts' folders.
 */
async function ensureDirs() {
  await fs.ensureDir(path.join(LOCAL_MUSIC_PATH, 'playlists'));
  await fs.ensureDir(path.join(LOCAL_MUSIC_PATH, 'adverts'));
}

module.exports = { syncFiles, getSyncStatus };

