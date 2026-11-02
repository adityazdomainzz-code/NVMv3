const express = require('express');
const router = express.Router();
const { requireLogin, requireAdmin } = require('../middleware/auth');
const db = require('../database');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// All admin routes require login + admin role
router.use(requireLogin, requireAdmin);

// GET /admin - Admin overview
router.get('/', (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    servers: db.prepare('SELECT COUNT(*) as c FROM servers').get().c,
    nodes: db.prepare('SELECT COUNT(*) as c FROM nodes').get().c,
    running: db.prepare("SELECT COUNT(*) as c FROM servers WHERE status='running'").get().c,
  };
  res.render('admin/index', { title: 'Admin Panel', stats, active: 'admin' });
});

// ─── PANEL SETTINGS ───────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Panel Settings', active: 'admin-settings' });
});

router.post('/settings', (req, res) => {
  const { panel_name } = req.body;
  if (panel_name) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('panel_name', panel_name);
  }

  // Handle logo upload
  if (req.files && req.files.panel_logo) {
    const logo = req.files.panel_logo;
    const ext = path.extname(logo.name);
    const dest = path.join(__dirname, '../../public/uploads/logo' + ext);
    logo.mv(dest, (err) => {
      if (!err) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('panel_logo', '/uploads/logo' + ext);
      }
    });
  }

  // Handle background upload
  if (req.files && req.files.panel_bg) {
    const bg = req.files.panel_bg;
    const ext = path.extname(bg.name);
    const dest = path.join(__dirname, '../../public/uploads/bg' + ext);
    bg.mv(dest, (err) => {
      if (!err) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('panel_bg', '/uploads/bg' + ext);
      }
    });
  }

  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
});

// ─── NODES ────────────────────────────────────────────────────────────────────
router.get('/nodes', (req, res) => {
  const nodes = db.prepare('SELECT * FROM nodes').all();
  res.render('admin/nodes', { title: 'Nodes', nodes, active: 'admin-nodes' });
});

router.post('/nodes/add', (req, res) => {
  const { name, host, port, ssh_user, ssh_password, ssh_key } = req.body;
  db.prepare(`INSERT INTO nodes (name, host, port, ssh_user, ssh_password, ssh_key, is_local, status)
              VALUES (?, ?, ?, ?, ?, ?, 0, 'unknown')`).run(name, host, port || 22, ssh_user || 'root', ssh_password || '', ssh_key || '');
  req.flash('success', 'Node added.');
  res.redirect('/admin/nodes');
});

router.post('/nodes/delete/:id', (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (node && node.is_local) {
    req.flash('error', 'Cannot delete the local node.');
    return res.redirect('/admin/nodes');
  }
  db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params.id);
  req.flash('success', 'Node removed.');
  res.redirect('/admin/nodes');
});

// ─── USERS ────────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, created_at FROM users').all();
  res.render('admin/users', { title: 'Users', users, active: 'admin-users' });
});

router.post('/users/create', (req, res) => {
  const { username, password, email, role } = req.body;
  if (!username || !password) {
    req.flash('error', 'Username and password are required.');
    return res.redirect('/admin/users');
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    req.flash('error', 'Username already exists.');
    return res.redirect('/admin/users');
  }
  const hash = bcrypt.hashSync(password, 10);
  const allowedRole = (role === 'admin') ? 'admin' : 'user';
  db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run(username, hash, email || '', allowedRole);
  req.flash('success', 'User created.');
  res.redirect('/admin/users');
});

router.post('/users/delete/:id', (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'Cannot delete yourself.');
    return res.redirect('/admin/users');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  req.flash('success', 'User deleted.');
  res.redirect('/admin/users');
});

router.post('/users/reset-password/:id', (req, res) => {
  const { new_password } = req.body;
  if (!new_password) {
    req.flash('error', 'Password cannot be empty.');
    return res.redirect('/admin/users');
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  req.flash('success', 'Password reset.');
  res.redirect('/admin/users');
});

// ─── SERVERS (admin view) ─────────────────────────────────────────────────────
router.get('/servers', (req, res) => {
  const servers = db.prepare(`SELECT s.*, n.name as node_name, u.username as owner 
                               FROM servers s 
                               LEFT JOIN nodes n ON s.node_id = n.id 
                               LEFT JOIN users u ON s.owner_id = u.id`).all();
  const nodes = db.prepare('SELECT * FROM nodes').all();
  const users = db.prepare('SELECT id, username FROM users').all();
  res.render('admin/servers', { title: 'Servers', servers, nodes, users, active: 'admin-servers' });
});

router.post('/servers/create', (req, res) => {
  const { name, node_id, type, owner_id, memory, cpus, disk, vmid } = req.body;
  if (!name || !node_id || !type) {
    req.flash('error', 'Name, node and type are required.');
    return res.redirect('/admin/servers');
  }
  db.prepare(`INSERT INTO servers (name, node_id, type, owner_id, memory, cpus, disk, vmid, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stopped')`).run(name, node_id, type, owner_id || req.session.user.id, memory || 512, cpus || 1, disk || 8, vmid || null);
  req.flash('success', 'Server created.');
  res.redirect('/admin/servers');
});

router.post('/servers/delete/:id', (req, res) => {
  db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  req.flash('success', 'Server deleted.');
  res.redirect('/admin/servers');
});

module.exports = router;
