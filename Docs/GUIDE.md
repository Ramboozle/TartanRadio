# Tartan Radio Usage Guide

Tartan Radio is a multi-client audio broadcasting system designed for Raspberry Pi or Windows clients managed by a central Node.js server.

## System Overview

- **Server:** Manages playlists, adverts, client grouping, and global commands. Hosts the files for all clients.
- **Client:** Connects to the server, mirrors its music library, and plays audio. Supports Raspberry Pi (Linux) and Windows.

## Server Dashboard

Access the main dashboard at `http://<server-ip>:80`.

### 1. Active Pi's / Clients (Main Dashboard)
- View all connected clients, their IP addresses, software version, and real-time status.
- **Controls:**
    - **Connect to Local UI:** Opens the specific client's management page (port 3001).
    - **Remove Client:** Deletes a persistent client record from the server.
- **Is Online:** Status is determined by the last heartbeat received within 15 seconds.

### 2. Admin Controls (Broadcast Control)
- **Target Selection:** Broadcast commands to **All** clients, a specific **Group**, or an individual client.
- **Music/Advert Playlists:** Change the active playlist for the selected target.
- **Ad Frequency:** Define how many music tracks play between advertisements.
- **Action Buttons:**
    - **Play/Stop:** Immediate global/group-wide playback control.
    - **Sync:** Triggers all targeted clients to immediately check for and download new files.

### 3. Groups Management
- Create custom groups (e.g., "Škoda Showrooms", "Workshop Areas") to manage multiple clients at once.
- Assign clients to these groups via the group management interface or individual client settings.

### 4. File Management
- **Playlists & Adverts Tabs:** Toggle between music and advertisement folders.
- **New Directory:** Create subdirectories to organize music into categories/playlists.
- **Delete Folder:** Permanently remove an entire playlist/directory from the server.
- **Upload:** Add `.mp3` files to a selected playlist folder.
- **Delete:** Permanently remove files from the server.

### 5. Song Reports
- Review songs reported by clients as "Bad" (content issues) or "Faulty" (playback issues).
- **Dismiss:** Ignores the report.
- **Remove File:** Permanently deletes the faulty file from the server and dismisses all its reports automatically.

---

## Client (Local Control UI)

Access a client's local control page at `http://<client-ip>:3001`.

### Local Controls
- **System Volume:** Use the large slider to adjust the client's audio output level.
- **Local Overrides:** Manually set the music/advert playlist and ad frequency for *just this client*.
- **Apply & Play:** Saves settings to `config.json` and starts playback immediately.
- **Sync Status:** A real-time progress bar appears when the client is downloading files from the server.
- **Report Song:** Directly report the current track if it is skipping or inappropriate.

---

## Maintenance & Troubleshooting

### Forced File Sync
If you've just uploaded music and need it playing everywhere immediately, use the **Sync** button in the **Admin Controls**. Clients will start downloading missing files within seconds.

### Cleanup
The system performs a "1:1 Mirror". If a file is deleted on the server, the client will automatically delete its local copy during the next sync to save space.

### Volume Issues
- **Raspberry Pi:** Ensure the `amixer` utility is installed and that the Pi's default audio output (HDMI vs. Jack) is correctly set in the OS.
- **Windows:** Volume control is handled natively via PowerShell.

### Connectivity
- **Server Not Found:** Ensure the client can resolve the hostname 'music' or update the server URL in the code.
- **Client Not Appearing:** Ensure the client can reach the server over the network on port 80 (check firewall/ports).
- **Socket Disconnects:** Look for `[SOCKET] Connected` messages in the client console for troubleshooting.
