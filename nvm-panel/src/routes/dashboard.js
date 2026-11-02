const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const db = require('../database');

router.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  let servers;
  if (user.role === 'admin') {
    servers = db.prepare(`SELECT s.*, n.name as node_name, u.username as owner 
                          FROM servers s 
                          LEFT JOIN nodes n ON s.node_id = n.id 
                          LEFT JOIN users u ON s.owner_id = u.id`).all();
  } else {
    servers = db.prepare(`SELECT s.*, n.name as node_name 
                          FROM servers s 
                          LEFT JOIN nodes n ON s.node_id = n.id 
                          WHERE s.owner_id = ?`).all(user.id);
    // also subuser servers
    const subServers = db.prepare(`SELECT s.*, n.name as node_name 
                          FROM servers s 
                          LEFT JOIN nodes n ON s.node_id = n.id 
                          LEFT JOIN subusers su ON s.id = su.server_id 
                          WHERE su.user_id = ?`).all(user.id);
    servers = [...servers, ...subServers];
  }

  const userInfo = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const nodes = db.prepare('SELECT * FROM nodes').all();
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

  res.render('dashboard', {
    title: 'Dashboard',
    servers,
    nodes,
    totalUsers,
    userInfo,
    active: 'dashboard'
  });
});

module.exports = router;
