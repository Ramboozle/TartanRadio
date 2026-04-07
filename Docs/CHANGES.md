# Tartan Radio System - Version History

## v2.1 (Current)
### Server
- **External Configuration:** Moved all server-specific variables to `server/settings.json` for easier deployment and environment management.
- **Improved Monitoring:** Added "Offline Since" tracking to the dashboard to better monitor client connectivity and downtime.
- **Rotating Logs:** Implemented automatic log rotation for `server.log`, rotating at 5MB to prevent disk space bloat.
- **Bug Fixes:** Resolved database locking issues (`SQLITE_BUSY`) during high-frequency client heartbeats.

### Audio Client
- **External Configuration:** Moved all client-specific variables (SERVER_URL, sync intervals, etc.) to `newclient/settings.json`.
- **Faulty Song Workaround:** Added "rapid playback" detection logic. If the client detects more than 5 songs skipping in 5 seconds, it automatically resets the player to prevent infinite loops.
- **Rotating Logs:** Implemented 5MB log rotation for `client.log`.
- **UI Enhancements:** Updated the local client dashboard to display real-time sync status and version information.

### Remote Listener
- **Initial Release:** Added the `listner` component to support low-latency audio streaming from a remote source via UDP.
- **SSH Integration:** Integrated SSH for secure remote status checks and command execution.

---

## v2.0
- **Distributed Architecture:** Transitioned from a standalone system to a distributed model with a central Node.js server and multiple Raspberry Pi/Windows clients.
- **Central Dashboard:** Introduced a unified web interface for managing all clients, groups, and playlists from a single location.
- **Dynamic Grouping:** Added support for grouping clients (e.g., "Showroom", "Workshop") for categorical commands and management.
- **SQLite Persistence:** Integrated a persistent SQLite database to store client registration, group assignments, and faulty song reports.
- **1:1 File Mirroring:** Implemented an automated hourly synchronization engine to mirror music and adverts from the server to all clients.
- **Smart Rotation:** Added configurable logic for "X songs before an advert" to ensure balanced playback.
- **Real-time Control:** Integrated Socket.io for instantaneous playback control (Play, Stop, Sync, Volume) across all connected clients.
- **Faulty Song Reporting:** Added a reporting mechanism for users to flag skipping or inappropriate songs directly from the client interface.
- **Full File Management:** Enabled direct uploading, deletion, and organization of playlists via the server dashboard.
