# Tartan Radio Configuration Guide

This guide explains how to configure the Tartan Radio system for your environment. Most settings are stored in `settings.json` files within each component folder.

---

## 1. Central Server (`/server/settings.json`)
The server manages the music database, client registration, and the dashboard.

- **`PORT`**: (Default: `80`) The network port the server will run on. If changed, clients must update their `SERVER_URL`.
- **`MUSIC_DIRECTORY`**: (Default: `"music"`) The folder name where audio files are stored on the server.

---

## 2. Audio Client (`/newclient/settings.json`)
The client runs on a Raspberry Pi or Windows machine to play music.

- **`SERVER_URL`**: The full address of your Tartan Radio Server (e.g., `http://192.168.1.50:80`).
- **`PORT`**: (Default: `3001`) The port for the client's local web interface.
- **`SYNC_INTERVAL_MS`**: (Default: `3600000`) How often (in milliseconds) the client checks the server for new music. 1 hour = 3,600,000ms.
- **`HEARTBEAT_INTERVAL_MS`**: (Default: `5000`) How often the client tells the server it is still online.
- **`VERSION`**: (Default: `"2.1"`) The software version number.

---

## 3. Remote Listener (`/listner/settings.json`)
The listener is used for low-latency streaming from a remote source.

- **`REMOTE_PI_IP`**: The IP address of the Pi you want to stream audio *from*.
- **`SSH_USERNAME`**: The username for the remote Pi (usually `pi`).
- **`SSH_PASSWORD`**: The password for the remote Pi.
- **`UDP_PORT`**: (Default: `1234`) The port used for the raw audio stream.

---

## Note for Non-Technical Users
- **JSON Format**: When editing `settings.json` files, ensure you keep the quotes and commas exactly as they are. If the file is broken, the software will revert to internal defaults.
- **Restarts**: You must restart the software (Node.js process) for any changes in `settings.json` to take effect.
