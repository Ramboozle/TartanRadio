# Tartan Radio API Documentation v2.1

This document lists all the API endpoints and Socket.io events used in the Tartan Radio system.

## Server API

The default port is **80**, but it can be changed in `server/settings.json`.

### 1. File & Directory Management
*   **GET `/api/files`**
    *   **Description:** Returns a list of all `.mp3` files in the `playlists` and `adverts` directories for client syncing.
*   **GET `/api/directories`**
    *   **Description:** Returns the names of all directories within the `playlists` and `adverts` folders.
*   **POST `/api/playlists/create`**
    *   **Description:** Creates a new directory.
    *   **Body:** `{ "name": "string", "type": "playlists | adverts" }`
*   **DELETE `/api/playlists/delete`**
    *   **Description:** Deletes an entire directory and all its contents.
    *   **Query Params:** `name` (directory name), `type` (playlists | adverts)
*   **DELETE `/api/files/delete`**
    *   **Description:** Deletes a specific file.
    *   **Query Params:** `filePath` (e.g., `playlists/Pop/song.mp3`)
*   **POST `/api/upload`**
    *   **Description:** Uploads a file using raw body.
    *   **Query Params:** `name` (filename), `dir` (target subdirectory)

### 2. Client Management
*   **POST `/api/heartbeat`**
    *   **Description:** Clients call this every 5 seconds to update their status. Updates `last_ping`.
    *   **Body:** `{ "hostname": "string", "ip": "string", "current_song": "string", "volume": number, "status": "string", "version": "string" }`
*   **GET `/api/clients`**
    *   **Description:** Returns all known clients, their latest info, calculated `is_online` status, and `last_ping` timestamp.
*   **POST `/api/clients/settings`**
    *   **Description:** Updates specific client settings.
    *   **Body:** `{ "hostname": "string", "songs_per_ad": number }`
*   **DELETE `/api/clients/:hostname`**
    *   **Description:** Removes a client from the server database.
*   **POST `/api/clients/assign-group`**
    *   **Description:** Assigns a client to a group.
    *   **Body:** `{ "hostname": "string", "group_id": number | null }`

### 3. Command & Control
*   **POST `/api/command`**
    *   **Description:** Sends a command to one or all Pi's via Socket.io.
    *   **Body:** `{ "target": "hostname | all | group:ID", "type": "play | stop | sync | volume | set_playlists", "value": any }`

### 4. Group Management
*   **GET `/api/groups`**
    *   **Description:** Returns all groups with their member hostnames.
*   **POST `/api/groups`**
    *   **Description:** Creates a new group.
    *   **Body:** `{ "name": "string", "description": "string" }`
*   **DELETE `/api/groups/:id`**
    *   **Description:** Deletes a group and unassigns its members.

### 5. Error & Faulty Reports
*   **POST `/api/report-faulty`**
    *   **Description:** Reports a problematic song.
    *   **Body:** `{ "hostname": "string", "song": "string", "reason": "bad | faulty" }`
*   **GET `/api/reports`**
    *   **Description:** Fetches all reported faulty songs.
*   **DELETE `/api/reports/:id`**
    *   **Description:** Dismisses a specific report.
*   **POST `/api/reports/remove-file`**
    *   **Description:** Deletes the file from the server and dismisses all related reports.
    *   **Body:** `{ "song_name": "string" }`

---

## Client Local API (Port 3001)

Each Raspberry Pi runs a local server for direct control.

*   **GET `/`**: Serves the local dashboard.
*   **GET `/play`**: Starts playback.
*   **GET `/stop`**: Stops playback.
*   **GET `/sync`**: Triggers immediate sync with the server.
*   **GET `/set-volume?v=X`**: Sets system volume (0-100).
*   **GET `/set-playlists?music=X&ads=Y&frequency=Z`**: Updates local playlist and rotation settings.
*   **GET `/report-song?reason=X`**: Reports the currently playing song to the server.
*   **GET `/api/status`**: Returns current playback info (song, status, volume).
*   **GET `/api/sync-status`**: Returns the current status of the file sync process.

---

## Socket.io Events

### Server -> Client (`command`)
*   **Data:** `{ "type": string, "value": any }`
*   **Types:** `play`, `stop`, `sync`, `volume`, `set_playlists`.

### Client -> Server (`register`)
*   **Data:** `hostname` (string)
