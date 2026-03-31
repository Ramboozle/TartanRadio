# Tartan Radio Usage Guide v2.1

Tartan Radio is a multi-client audio broadcasting system designed for Raspberry Pi or Windows clients managed by a central Node.js server.

## System Overview

- **Server:** Manages playlists, adverts, client grouping, and global commands. Hosts the files for all clients.
- **Client:** Connects to the server, mirrors its music library, and plays audio. Supports Raspberry Pi (Linux) and Windows.

## Server Dashboard

Access the main dashboard at `http://<server-ip>:80` (Default).

### 1. Active Pi's / Clients (Main Dashboard)
- View all connected clients, their IP addresses, software version, and real-time status.
- **Offline Since:** Shows exactly how long a client has been disconnected.
- **Controls:**
    - **Connect:** Opens the specific client's local management page (port 3001).
- **Status:** online status is calculated based on heartbeats received within the last 15 seconds.

### 2. Admin Controls (Broadcast Control)
- **Target Selection:** Broadcast commands to **All** clients or a specific **Group**.
- **Music/Advert Playlists:** Change the active playlist for the selected target.
- **Ad Frequency:** Define how many music tracks play between advertisements.
- **Action Buttons:**
    - **Play/Stop:** Immediate global/group-wide playback control.
    - **Sync:** Triggers all targeted clients to immediately check for and download new files.

### 3. Groups Tab
- Create and manage custom groups (e.g., "Škoda Showrooms", "Workshop Areas").
- Assign clients to groups to allow for targeted broadcasting and organization.

### 4. Playlists Tab
- **Music & Adverts:** Toggle between music and advertisement folders.
- **New Folder:** Create subdirectories to organize music into categories.
- **Upload:** Add `.mp3` files to a selected folder.
- **Delete:** Permanently remove files or entire folders from the server.

### 5. Song Reports Tab
- Review songs reported by clients as "Bad" (content issues) or "Faulty" (playback issues).
- **Ignore:** Dismisses the report.
- **Delete File:** Permanently deletes the faulty file from the server and dismisses all its reports.

---

## Client (Local Control UI)

Access a client's local control page at `http://<client-ip>:3001` (Default).

### Local Controls
- **System Volume:** Adjust the client's audio output level.
- **Local Overrides:** Manually set the music/advert playlist and ad frequency for *just this client*.
- **Sync Status:** A real-time progress bar appears when the client is downloading files from the server.
- **Report Song:** Directly report the current track if it is skipping or inappropriate.

---

## Maintenance & Troubleshooting

### Log Files
Each component (Server, Client, Listener) generates a `.log` file in its directory. These files automatically rotate when they reach 5MB, keeping a `.old` backup and preventing disk space issues.

### Rapid Playback Workaround
If a client detects it has played 5 songs in less than 5 seconds (indicating a driver error or file corruption), it will automatically stop playback, wait 10 seconds, and attempt to resume. This is logged in the `client.log`.

### Configuration
All key variables (IPs, Ports, URLs) can be edited in the `settings.json` file in each folder without needing to modify code. See [**CONFIGURATION.md**](../CONFIGURATION.md) for details.
