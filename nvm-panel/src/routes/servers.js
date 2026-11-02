const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const db = require('../database');

router.use(requireLogin);

// GET /servers - list user's servers
router.get('/', (req, res) => {
  const user = req.session.user;
  let servers;
  if (user.role === 'admin') {
    servers = db.prepare(`SELECT s.*, n.name as node_name, u.username as owner 
                          FROM servers s 
                          LEFT JOIN nodes n ON s.node_id = n.id 
                          LEFT JOIN users u ON s.owner_id = u.id`).all();
  } else {
    const owned = db.prepare(`SELECT s.*, n.name as node_name 
                              FROM servers s LEFT JOIN nodes n ON s.node_id=n.id 
                              WHERE s.owner_id=?`).all(user.id);
    const shared = db.prepare(`SELECT s.*, n.name as node_name 
                               FROM servers s LEFT JOIN nodes n ON s.node_id=n.id 
                               INNER JOIN subusers su ON su.server_id=s.id 
                               WHERE su.user_id=?`).all(user.id);
    servers = [...owned, ...shared];
  }
  res.render('servers/list', { title: 'My Servers', servers, active: 'servers' });
});

module.exports = router;
