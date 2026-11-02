const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'nvm.db');

// ensure data dir
const fs = require('fs');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      ssh_user TEXT DEFAULT 'root',
      ssh_key TEXT,
      ssh_password TEXT,
      is_local INTEGER DEFAULT 0,
      status TEXT DEFAULT 'unknown',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER REFERENCES nodes(id),
      name TEXT NOT NULL,
      vmid INTEGER,
      type TEXT NOT NULL DEFAULT 'lxc',
      status TEXT DEFAULT 'stopped',
      ip TEXT,
      memory INTEGER DEFAULT 512,
      cpus INTEGER DEFAULT 1,
      disk INTEGER DEFAULT 8,
      owner_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subusers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      user_id INTEGER REFERENCES users(id),
      permissions TEXT DEFAULT 'console,files',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS port_forwards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      local_port INTEGER NOT NULL,
      public_url TEXT,
      pinggy_pid INTEGER,
      active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // insert default settings
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  insertSetting.run('panel_name', 'NVM Panel');
  insertSetting.run('panel_logo', '');
  insertSetting.run('panel_bg', '');

  // insert default local node
  const existingNode = db.prepare('SELECT id FROM nodes WHERE is_local = 1').get();
  if (!existingNode) {
    db.prepare(`INSERT INTO nodes (name, host, port, ssh_user, is_local, status)
                VALUES (?, ?, ?, ?, ?, ?)`).run('Local Node', 'localhost', 22, 'root', 1, 'online');
  }

  // insert default admin
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)`).run('admin', hash, 'admin', 'admin@nvm.local');
    console.log('[DB] Default admin created: admin / admin123');
  }
}

initDB();

module.exports = db;
