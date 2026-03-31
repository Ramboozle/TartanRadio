const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const SERVER_URL = 'http://music:80';
const LOCAL_MUSIC_PATH = path.join(__dirname, 'music');

let syncStatus = {
  active: false,
  totalFiles: 0,
  completedFiles: 0,
  totalBytes: 0,
  completedBytes: 0,
  currentFile: '',
  error: null
};

function getSyncStatus() {
  return syncStatus;
}

// Helper to recursively get all files in a directory (compatible with older Node versions)
async function getAllFiles(dirPath, arrayOfFiles) {
  const files = await fs.readdir(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if ((await fs.stat(fullPath)).isDirectory()) {
      arrayOfFiles = await getAllFiles(fullPath, arrayOfFiles);
      arrayOfFiles.push(fullPath); // Include directories too
    } else {
      arrayOfFiles.push(fullPath);
    }
  }

  return arrayOfFiles;
}

async function syncFiles() {
  if (syncStatus.active) return;
  
  console.log('[SYNC] Starting file sync process...');
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
    const response = await axios.get(`${SERVER_URL}/api/files`);
    const { playlists, adverts } = response.data;

    await ensureDirs();

    // Cleanup: Remove local files and directories not on server
    // We do this BEFORE downloading to free up space and ensure 1:1 mirror
    const cleanup = async (subDir, serverFiles) => {
        const localDir = path.join(LOCAL_MUSIC_PATH, subDir);
        if (!(await fs.pathExists(localDir))) return;
        
        console.log(`[SYNC] Checking for removed files in: ${subDir}`);
        
        const allLocalPaths = await getAllFiles(localDir);
        const serverFilePaths = serverFiles.map(f => f.path);

        // Sort by length descending to process files before their parent directories
        const sortedPaths = allLocalPaths.sort((a, b) => b.length - a.length);

        let removedCount = 0;
        for (const fullPath of sortedPaths) {
            const relativePath = path.relative(localDir, fullPath).replace(/\\/g, '/');
            const stats = await fs.stat(fullPath);

            if (stats.isFile()) {
                if (!serverFilePaths.includes(relativePath)) {
                    console.log(`[SYNC] Removing file (not on server): ${relativePath}`);
                    await fs.remove(fullPath);
                    removedCount++;
                }
            } else if (stats.isDirectory()) {
                const contents = await fs.readdir(fullPath);
                if (contents.length === 0) {
                    console.log(`[SYNC] Removing empty directory: ${relativePath}`);
                    await fs.remove(fullPath);
                }
            }
        }
        if (removedCount > 0) {
            console.log(`[SYNC] Cleaned up ${removedCount} files in ${subDir}`);
        } else {
            console.log(`[SYNC] No files to remove in ${subDir}`);
        }
    };

    await cleanup('playlists', playlists);
    await cleanup('adverts', adverts);

    // Calculate what needs downloading
    const toDownload = [];
    
    const checkDir = async (subDir, serverFiles) => {
      const localDir = path.join(LOCAL_MUSIC_PATH, subDir);
      for (const file of serverFiles) {
        const localFilePath = path.join(localDir, file.path);
        let shouldDownload = false;
        if (!(await fs.pathExists(localFilePath))) {
          shouldDownload = true;
        } else {
          const stats = await fs.stat(localFilePath);
          if (stats.size !== file.size) shouldDownload = true;
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

    if (toDownload.length === 0) {
      console.log('[SYNC] All files are already up to date.');
      syncStatus = {
        ...syncStatus,
        active: false,
        currentFile: 'Up to date'
      };
      return;
    }

    console.log(`[SYNC] Found ${toDownload.length} files to download.`);

    // Download files
    for (const item of toDownload) {
      const { subDir, file, localFilePath } = item;
      syncStatus.currentFile = file.path;
      
      const encodedPath = file.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
      const serverFileUrl = `${SERVER_URL}/music/${subDir}/${encodedPath}`;

      console.log(`[SYNC] Downloading: ${file.path}`);
      await fs.ensureDir(path.dirname(localFilePath));
      
      const writer = fs.createWriteStream(localFilePath);
      const response = await axios({
        url: serverFileUrl,
        method: 'GET',
        responseType: 'stream'
      });

      response.data.on('data', (chunk) => {
        syncStatus.completedBytes += chunk.length;
      });

      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      syncStatus.completedFiles++;
    }

    console.log('[SYNC] Sync process complete.');
    syncStatus = {
      ...syncStatus,
      active: false,
      currentFile: 'Sync Complete'
    };
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

async function ensureDirs() {
  await fs.ensureDir(path.join(LOCAL_MUSIC_PATH, 'playlists'));
  await fs.ensureDir(path.join(LOCAL_MUSIC_PATH, 'adverts'));
}

module.exports = { syncFiles, getSyncStatus };
