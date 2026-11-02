const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const db = require('../database');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

router.use(requireLogin);

// Middleware: check user owns/has access to server
function canAccessVM(req, res, next) {
  const user = req.session.user;
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) {
    req.flash('error', 'Server not found.');
    return res.redirect('/servers');
  }
  if (user.role === 'admin' || server.owner_id === user.id) {
    req.server = server;
    return next();
  }
  const sub = db.prepare('SELECT * FROM subusers WHERE server_id = ? AND user_id = ?').get(server.id, user.id);
  if (sub) {
    req.server = server;
    req.subPerms = sub.permissions ? sub.permissions.split(',') : [];
    return next();
  }
  req.flash('error', 'Access denied.');
  res.redirect('/servers');
}

// GET /vm/:id - Console page
router.get('/:id', canAccessVM, (req, res) => {
  const server = req.server;
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(server.node_id);
  res.render('vm/console', { title: server.name + ' - Console', server, node, active: 'vm-console' });
});

// GET /vm/:id/console
router.get('/:id/console', canAccessVM, (req, res) => {
  const server = req.server;
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(server.node_id);
  res.render('vm/console', { title: server.name + ' - Console', server, node, active: 'vm-console' });
});

// GET /vm/:id/files
router.get('/:id/files', canAccessVM, (req, res) => {
  const server = req.server;
  const reqPath = req.query.path || '/';
  res.render('vm/files', { title: server.name + ' - File Manager', server, reqPath, active: 'vm-files' });
});

// GET /vm/:id/ports
router.get('/:id/ports', canAccessVM, (req, res) => {
  const server = req.server;
  const forwards = db.prepare('SELECT * FROM port_forwards WHERE server_id = ?').all(server.id);
  res.render('vm/ports', { title: server.name + ' - Port Forwards', server, forwards, active: 'vm-ports' });
});

// POST /vm/:id/ports/add
router.post('/:id/ports/add', canAccessVM, (req, res) => {
  const server = req.server;
  const { local_port } = req.body;
  if (!local_port) {
    req.flash('error', 'Local port required.');
    return res.redirect('/vm/' + server.id + '/ports');
  }

  // Create pinggy tunnel via SSH
  const sshCmd = `ssh -p 443 -R0:localhost:${local_port} -o StrictHostKeyChecking=no -o ServerAliveInterval=30 free.pinggy.io`;

  const existing = db.prepare('SELECT * FROM port_forwards WHERE server_id = ? AND local_port = ? AND active = 1').get(server.id, local_port);
  if (existing) {
    req.flash('error', 'A forward for this port is already active.');
    return res.redirect('/vm/' + server.id + '/ports');
  }

  const fwd = db.prepare(`INSERT INTO port_forwards (server_id, local_port, public_url, active) VALUES (?, ?, ?, 0)`).run(server.id, local_port, 'Starting...');
  const fwdId = fwd.lastInsertRowid;

  // Spawn pinggy tunnel
  const child = spawn('ssh', ['-p', '443', '-R', `0:localhost:${local_port}`,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ExitOnForwardFailure=yes',
    'free.pinggy.io'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

  let urlCaptured = false;
  child.stdout.on('data', (data) => {
    const text = data.toString();
    // capture the public URL from pinggy output
    const match = text.match(/https?:\/\/[a-z0-9\-]+\.(?:run\.pinggy-free\.link|a\.pinggy\.io)[^\s]*/i);
    if (match && !urlCaptured) {
      urlCaptured = true;
      db.prepare('UPDATE port_forwards SET public_url = ?, active = 1, pinggy_pid = ? WHERE id = ?').run(match[0], child.pid, fwdId);
    }
  });
  child.stderr.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https?:\/\/[a-z0-9\-]+\.(?:run\.pinggy-free\.link|a\.pinggy\.io)[^\s]*/i);
    if (match && !urlCaptured) {
      urlCaptured = true;
      db.prepare('UPDATE port_forwards SET public_url = ?, active = 1, pinggy_pid = ? WHERE id = ?').run(match[0], child.pid, fwdId);
    }
    // Also catch the URL from the typical pinggy banner
    const urlLine = text.match(/http[s]?:\/\/\S+pinggy\S+/i);
    if (urlLine && !urlCaptured) {
      urlCaptured = true;
      db.prepare('UPDATE port_forwards SET public_url = ?, active = 1, pinggy_pid = ? WHERE id = ?').run(urlLine[0], child.pid, fwdId);
    }
  });

  child.on('exit', () => {
    db.prepare('UPDATE port_forwards SET active = 0 WHERE id = ?').run(fwdId);
  });

  child.unref();

  // Poll for URL for 10 seconds
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    const row = db.prepare('SELECT * FROM port_forwards WHERE id = ?').get(fwdId);
    if (row && row.active === 1 && row.public_url !== 'Starting...') {
      clearInterval(poll);
    }
    if (attempts > 20) {
      clearInterval(poll);
      db.prepare('UPDATE port_forwards SET public_url = ?, pinggy_pid = ? WHERE id = ?').run('Check manually - PID: ' + child.pid, child.pid, fwdId);
    }
  }, 500);

  req.flash('success', 'Pinggy tunnel starting for port ' + local_port + '. Refresh in a few seconds.');
  res.redirect('/vm/' + server.id + '/ports');
});

// POST /vm/:id/ports/delete/:fwdId
router.post('/:id/ports/delete/:fwdId', canAccessVM, (req, res) => {
  const fwd = db.prepare('SELECT * FROM port_forwards WHERE id = ?').get(req.params.fwdId);
  if (fwd && fwd.pinggy_pid) {
    try { process.kill(fwd.pinggy_pid); } catch (e) { /* already gone */ }
  }
  db.prepare('DELETE FROM port_forwards WHERE id = ?').run(req.params.fwdId);
  req.flash('success', 'Port forward removed.');
  res.redirect('/vm/' + req.params.id + '/ports');
});

// GET /vm/:id/subusers
router.get('/:id/subusers', canAccessVM, (req, res) => {
  const server = req.server;
  const subusers = db.prepare(`SELECT su.*, u.username FROM subusers su JOIN users u ON su.user_id=u.id WHERE su.server_id=?`).all(server.id);
  const allUsers = db.prepare('SELECT id, username FROM users WHERE id != ?').all(server.owner_id);
  res.render('vm/subusers', { title: server.name + ' - Sub Users', server, subusers, allUsers, active: 'vm-subusers' });
});

router.post('/:id/subusers/add', canAccessVM, (req, res) => {
  const server = req.server;
  const { user_id, permissions } = req.body;
  const perms = Array.isArray(permissions) ? permissions.join(',') : (permissions || 'console');
  const exists = db.prepare('SELECT * FROM subusers WHERE server_id=? AND user_id=?').get(server.id, user_id);
  if (exists) {
    db.prepare('UPDATE subusers SET permissions=? WHERE server_id=? AND user_id=?').run(perms, server.id, user_id);
  } else {
    db.prepare('INSERT INTO subusers (server_id, user_id, permissions) VALUES (?,?,?)').run(server.id, user_id, perms);
  }
  req.flash('success', 'Sub-user added/updated.');
  res.redirect('/vm/' + server.id + '/subusers');
});

router.post('/:id/subusers/remove/:subId', canAccessVM, (req, res) => {
  db.prepare('DELETE FROM subusers WHERE id=?').run(req.params.subId);
  req.flash('success', 'Sub-user removed.');
  res.redirect('/vm/' + req.params.id + '/subusers');
});

// POST /vm/:id/control (start/stop/restart/reboot)
router.post('/:id/control', canAccessVM, (req, res) => {
  const server = req.server;
  const { action } = req.body;
  const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(server.node_id);
  const allowed = ['start', 'stop', 'restart'];
  if (server.type === 'kvm') allowed.push('reboot');
  if (!allowed.includes(action)) {
    return res.json({ success: false, message: 'Invalid action' });
  }

  // Build command based on container type
  let cmd = '';
  if (server.type === 'lxc') {
    if (action === 'start') cmd = `lxc-start -n ${server.name}`;
    else if (action === 'stop') cmd = `lxc-stop -n ${server.name}`;
    else if (action === 'restart') cmd = `lxc-stop -n ${server.name} && lxc-start -n ${server.name}`;
  } else if (server.type === 'kvm') {
    if (action === 'start') cmd = `virsh start ${server.name}`;
    else if (action === 'stop') cmd = `virsh destroy ${server.name}`;
    else if (action === 'restart') cmd = `virsh reboot ${server.name}`;
    else if (action === 'reboot') cmd = `virsh reset ${server.name}`;
  }

  if (node && node.is_local) {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }
      // update status
      const newStatus = (action === 'start') ? 'running' : (action === 'stop' ? 'stopped' : 'running');
      db.prepare('UPDATE servers SET status=? WHERE id=?').run(newStatus, server.id);
      res.json({ success: true, message: `${action} executed`, status: newStatus });
    });
  } else {
    // Remote node via SSH
    const { NodeSSH } = require('node-ssh');
    const ssh = new NodeSSH();
    const connOpts = { host: node.host, port: node.port, username: node.ssh_user };
    if (node.ssh_key) connOpts.privateKeyPath = node.ssh_key;
    else connOpts.password = node.ssh_password;

    ssh.connect(connOpts).then(() => ssh.execCommand(cmd)).then(result => {
      ssh.dispose();
      const newStatus = (action === 'start') ? 'running' : (action === 'stop' ? 'stopped' : 'running');
      db.prepare('UPDATE servers SET status=? WHERE id=?').run(newStatus, server.id);
      res.json({ success: true, message: result.stdout || 'Done', status: newStatus });
    }).catch(err => res.json({ success: false, message: err.message }));
  }
});

module.exports = router;
