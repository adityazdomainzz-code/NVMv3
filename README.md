# NVM Panel

A modern, dark VM management panel built with Node.js — runs on port 6767.

## Features
- **Dashboard** — overview, account info, server list
- **Servers** — LXC & KVM container management
- **Console** — real-time SSH terminal via xterm.js
- **File Manager** — browse/edit server files, including root `/`
- **Port Forwarding** — public URLs via Pinggy.io tunnels
- **Sub Users** — share server access with permissions
- **Admin Panel** (admin-only):
  - Panel Settings — name, logo, background
  - Nodes — local + remote SSH nodes
  - Servers — create/delete LXC/KVM containers
  - Users — create/delete/reset users (user & admin roles)

## Quick Install (Linux)

```bash
bash setup.sh
```

## Manual Install

```bash
cd nvm-panel
npm install
node src/app.js
```

Access at `http://your-server:6767`

**Default credentials:** `admin` / `admin123`

## Tech Stack
- Node.js + Express
- EJS templates
- Socket.IO + xterm.js (console)
- Pinggy.io (port forwarding)
- SQLite (better-sqlite3)
- Font Awesome 6
