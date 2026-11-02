const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const db = require('../database');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

router.use(requireLogin);

// API: list files on a server
router.get('/vm/:id/files', (req, res) => {
  const user = req.session.user;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!server) return res.json({ success: false, message: 'Not found' });

  const hasAccess = user.role === 'admin' || server.owner_id === user.id ||
    db.prepare('SELECT id FROM subusers WHERE server_id=? AND user_id=?').get(server.id, user.id);
  if (!hasAccess) return res.json({ success: false, message: 'Access denied' });

  const dirPath = req.query.path || '/';
  const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(server.node_id);

  const listCmd = `ls -la "${dirPath}" 2>&1`;

  if (node && node.is_local) {
    // Local container: enter namespace
    let cmd;
    if (server.type === 'lxc') {
      cmd = `lxc-attach -n ${server.name} -- ls -la "${dirPath}"`;
    } else {
      cmd = `ls -la "${dirPath}"`;
    }
    exec(cmd, (err, stdout, stderr) => {
      if (err) return res.json({ success: false, message: stderr || err.message, files: [] });
      const files = parseLS(stdout, dirPath);
      res.json({ success: true, files, path: dirPath });
    });
  } else {
    const { NodeSSH } = require('node-ssh');
    const ssh = new NodeSSH();
    const connOpts = { host: node.host, port: node.port, username: node.ssh_user };
    if (node.ssh_key) connOpts.privateKeyPath = node.ssh_key;
    else connOpts.password = node.ssh_password;
    ssh.connect(connOpts).then(() => {
      let cmd = server.type === 'lxc' ? `lxc-attach -n ${server.name} -- ls -la "${dirPath}"` : `ls -la "${dirPath}"`;
      return ssh.execCommand(cmd);
    }).then(result => {
      ssh.dispose();
      if (result.stderr && !result.stdout) return res.json({ success: false, message: result.stderr, files: [] });
      res.json({ success: true, files: parseLS(result.stdout, dirPath), path: dirPath });
    }).catch(err => res.json({ success: false, message: err.message, files: [] }));
  }
});

// API: read file content
router.get('/vm/:id/file-content', (req, res) => {
  const user = req.session.user;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!server) return res.json({ success: false, message: 'Not found' });
  const hasAccess = user.role === 'admin' || server.owner_id === user.id ||
    db.prepare('SELECT id FROM subusers WHERE server_id=? AND user_id=?').get(server.id, user.id);
  if (!hasAccess) return res.json({ success: false, message: 'Access denied' });

  const filePath = req.query.path;
  if (!filePath) return res.json({ success: false, message: 'Path required' });

  const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(server.node_id);

  let cmd;
  if (server.type === 'lxc') {
    cmd = `lxc-attach -n ${server.name} -- cat "${filePath}"`;
  } else {
    cmd = `cat "${filePath}"`;
  }

  if (node && node.is_local) {
    exec(cmd, { maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err) return res.json({ success: false, message: stderr || err.message });
      res.json({ success: true, content: stdout });
    });
  } else {
    const { NodeSSH } = require('node-ssh');
    const ssh = new NodeSSH();
    const connOpts = { host: node.host, port: node.port, username: node.ssh_user };
    if (node.ssh_key) connOpts.privateKeyPath = node.ssh_key;
    else connOpts.password = node.ssh_password;
    ssh.connect(connOpts).then(() => ssh.execCommand(cmd)).then(result => {
      ssh.dispose();
      res.json({ success: true, content: result.stdout });
    }).catch(err => res.json({ success: false, message: err.message }));
  }
});

// API: write file content
router.post('/vm/:id/file-content', (req, res) => {
  const user = req.session.user;
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!server) return res.json({ success: false, message: 'Not found' });
  const hasAccess = user.role === 'admin' || server.owner_id === user.id ||
    db.prepare('SELECT id FROM subusers WHERE server_id=? AND user_id=?').get(server.id, user.id);
  if (!hasAccess) return res.json({ success: false, message: 'Access denied' });

  const { path: filePath, content } = req.body;
  if (!filePath) return res.json({ success: false, message: 'Path required' });

  const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(server.node_id);
  const escaped = content.replace(/'/g, "'\\''");

  let cmd;
  if (server.type === 'lxc') {
    cmd = `lxc-attach -n ${server.name} -- bash -c 'cat > "${filePath}"' << 'NVMEOF'\n${content}\nNVMEOF`;
  } else {
    cmd = `bash -c 'cat > "${filePath}"' << 'NVMEOF'\n${content}\nNVMEOF`;
  }

  if (node && node.is_local) {
    exec(cmd, (err) => {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true });
    });
  } else {
    const { NodeSSH } = require('node-ssh');
    const ssh = new NodeSSH();
    const connOpts = { host: node.host, port: node.port, username: node.ssh_user };
    if (node.ssh_key) connOpts.privateKeyPath = node.ssh_key;
    else connOpts.password = node.ssh_password;
    ssh.connect(connOpts).then(() => ssh.execCommand(cmd)).then(result => {
      ssh.dispose();
      res.json({ success: true });
    }).catch(err => res.json({ success: false, message: err.message }));
  }
});

// API: port forward status
router.get('/vm/:id/ports', (req, res) => {
  const forwards = db.prepare('SELECT * FROM port_forwards WHERE server_id=?').all(req.params.id);
  res.json({ success: true, forwards });
});

// API: server status
router.get('/vm/:id/status', (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!server) return res.json({ success: false });
  res.json({ success: true, status: server.status });
});

function parseLS(output, basePath) {
  const lines = output.split('\n').filter(l => l.trim());
  const files = [];
  lines.forEach(line => {
    if (line.startsWith('total')) return;
    const parts = line.split(/\s+/);
    if (parts.length < 9) return;
    const perms = parts[0];
    const size = parts[4];
    const name = parts.slice(8).join(' ');
    if (name === '.' || name === '..') return;
    files.push({
      name,
      perms,
      size,
      isDir: perms.startsWith('d'),
      isLink: perms.startsWith('l'),
      path: (basePath === '/' ? '' : basePath) + '/' + name
    });
  });
  return files;
}

module.exports = router;
