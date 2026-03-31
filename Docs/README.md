# Tartan Radio System v2.1

A robust, distributed audio system with a centralized Node.js server and multiple Raspberry Pi or Windows clients.

## Features
- **Centralized Management:** Control all Pi's from one modern dashboard.
- **Dynamic Grouping:** Assign Pi's to groups (e.g., "Showroom", "Workshop") for categorical control.
- **1:1 File Mirroring:** Automatic hourly synchronization of music and adverts from server to clients.
- **Smart Rotation:** Configurable "X songs before an ad" logic.
- **Real-time Control:** Play, stop, or sync individual or all Pi's instantly via Socket.io.
- **Monitoring:** Track online/offline status, playback status, volume, and **Offline Since** duration for all clients.
- **Global Volume Control:** Adjust system-wide volume levels from the central dashboard.
- **Faulty Song Reporting:** Reporting mechanism for skipping or inappropriate songs.
- **Full File Management:** Upload, delete, and organize playlists directly from the dashboard.
- **Rotating File Logging:** Automatic logging to `.log` files with 5MB rotation to prevent disk bloat.
- **Error Recovery:** Built-in workaround for "rapid playback" bugs (detects 5 songs in 5 seconds and resets).
- **Easy Configuration:** External `settings.json` files for non-technical setup.

---

## Setup & Running

### 1. Server Setup
```bash
cd server
npm install
# Configure server/settings.json if needed
node index.js
```
The dashboard will be available at `http://your-server-ip:80` (or your configured port).

### 2. Client Setup
Ensure the Pi has a media player installed (`mpg123` is recommended) or is running Windows.
```bash
# For Raspberry Pi:
sudo apt-get install mpg123
cd newclient
npm install
# Configure newclient/settings.json with your SERVER_URL
node index.js
```
The local control UI will be available at `http://client-ip:3001`.

---

## Configuration & Persistence
- **Settings:** Uses `settings.json` in each folder for environment-specific variables (IPs, Ports, URLs). See [**CONFIGURATION.md**](../CONFIGURATION.md) for details.
- **Database:** Server uses `radio.db` (SQLite) to store client info, groups, and reports.
- **Persistence:** Client uses `config.json` to persist local settings like volume, playlists, and playback state across restarts.
- **Logs:** Each component generates a `.log` file (e.g., `server.log`, `client.log`) that automatically rotates at 5MB.

## Folder Structure
- `/server/music/playlists`: Place mp3 folders here.
- `/server/music/adverts`: Place mp3 folders here.
- `/newclient/music`: (Managed automatically) Mirrors the server content.

## Support
For technical issues, contact **Oliver Nield** at [oliver.nield@dmkeith.com](mailto:oliver.nield@dmkeith.com).
