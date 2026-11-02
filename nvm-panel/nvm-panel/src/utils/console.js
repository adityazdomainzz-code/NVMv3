const db = require('../database');
const { NodeSSH } = require('node-ssh');

module.exports = function (io) {
  io.on('connection', (socket) => {
    let sshStream = null;
    let ssh = null;

    socket.on('start-console', async (data) => {
      const { serverId, sessionData } = data;
      if (!sessionData || !sessionData.user) {
        socket.emit('console-error', 'Not authenticated');
        return;
      }

      const user = sessionData.user;
      const server = db.prepare('SELECT * FROM servers WHERE id=?').get(serverId);
      if (!server) {
        socket.emit('console-error', 'Server not found');
        return;
      }

      // Auth check
      const hasAccess = user.role === 'admin' || server.owner_id === user.id ||
        db.prepare('SELECT id FROM subusers WHERE server_id=? AND user_id=?').get(server.id, user.id);
      if (!hasAccess) {
        socket.emit('console-error', 'Access denied');
        return;
      }

      const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(server.node_id);
      if (!node) {
        socket.emit('console-error', 'Node not found');
        return;
      }

      try {
        ssh = new NodeSSH();
        const connOpts = {
          host: node.is_local ? '127.0.0.1' : node.host,
          port: node.port || 22,
          username: node.ssh_user || 'root',
        };
        if (node.ssh_key) connOpts.privateKeyPath = node.ssh_key;
        else if (node.ssh_password) connOpts.password = node.ssh_password;
        else {
          socket.emit('console-data', '\r\n[NVM] No SSH credentials configured for this node.\r\n');
          return;
        }

        await ssh.connect(connOpts);

        const attachCmd = server.type === 'lxc'
          ? `lxc-attach -n ${server.name}`
          : `virsh console ${server.name}`;

        ssh.connection.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
          if (err) {
            socket.emit('console-error', err.message);
            return;
          }
          sshStream = stream;
          stream.write(attachCmd + '\n');

          stream.on('data', (data) => {
            socket.emit('console-data', data.toString('utf8'));
          });

          stream.stderr.on('data', (data) => {
            socket.emit('console-data', data.toString('utf8'));
          });

          stream.on('close', () => {
            socket.emit('console-data', '\r\n[NVM] Connection closed.\r\n');
            if (ssh) ssh.dispose();
          });

          socket.emit('console-connected', true);
        });

      } catch (err) {
        socket.emit('console-error', 'SSH Error: ' + err.message);
      }
    });

    socket.on('console-input', (data) => {
      if (sshStream) sshStream.write(data);
    });

    socket.on('console-resize', ({ rows, cols }) => {
      if (sshStream) sshStream.setWindow(rows, cols, 0, 0);
    });

    socket.on('disconnect', () => {
      if (sshStream) sshStream.close();
      if (ssh) ssh.dispose();
    });
  });
};
