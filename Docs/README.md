# Tartan Radio System

A robust, distributed audio system with a centralized Node.js server and multiple Raspberry Pi or Windows clients.

## Features
- **Centralized Management:** Control all Pi's from one modern dashboard.
- **Dynamic Grouping:** Assign Pi's to groups (e.g., "Showroom", "Workshop") for categorical control.
- **1:1 File Mirroring:** Automatic hourly synchronization of music and adverts from server to clients.
- **Smart Rotation:** Configurable "X songs before an ad" logic.
- **Real-time Control:** Play, stop, or sync individual or all Pi's instantly via Socket.io.
- **Monitoring:** Track online/offline status, playback status, and volume for all clients.
- **Global Volume Control:** Adjust system-wide volume levels from the central dashboard.
- **Faulty Song Reporting:** Reporting mechanism for skipping or inappropriate songs.
- **Full File Management:** Upload, delete, and organize playlists directly from the dashboard.
- **Multi-Platform:** Native support for Raspberry Pi (Linux) and Windows (via PowerShell).

---

## Setup & Running

### 1. Server Setup
```bash
cd server
npm install
# Place your music in server/music/playlists
# Place your adverts in server/music/adverts
node index.js
```
The dashboard will be available at `http://your-server-ip:80`.

### 2. Client Setup
Ensure the Pi has a media player installed (`mpg123` is recommended) or is running Windows.
```bash
# For Raspberry Pi:
sudo apt-get install mpg123
cd newclient
npm install
node index.js
```
The local control UI will be available at `http://client-ip:3001`.

*Note: The client is currently configured to connect to the server at `http://music:80`. Ensure your network can resolve 'music' to your server's IP.*

---

## Configuration & Persistence
- **Server:** Uses `radio.db` (SQLite) to store client info, groups, and reports.
- **Client:** Uses `config.json` to persist local settings like volume, playlists, and playback state across restarts.

## Folder Structure
- `/server/music/playlists`: Place mp3 folders here.
- `/server/music/adverts`: Place mp3 folders here.
- `/newclient/music`: (Managed automatically) Mirrors the server content.

## Upcoming Features
- **Scheduling:** Automated playback scheduling for specific times or events (e.g., automatically removing Christmas adverts after December 25th). *Note: Database schema and UI are implemented; execution logic is in development.*

## Support
For technical issues, contact **Oliver Nield** at [oliver.nield@dmkeith.com](mailto:oliver.nield@dmkeith.com).
