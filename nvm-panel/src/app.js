const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const fileUpload = require('express-fileupload');
const fs = require('fs');

const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Make io accessible to routes
app.set('io', io);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// File upload
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 },
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));

// Session
app.use(session({
  secret: 'nvm-panel-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Flash
app.use(flash());

// Global middleware: inject user + settings into all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.locals.settings = settings;
  } catch (e) {
    res.locals.settings = { panel_name: 'NVM Panel', panel_logo: '', panel_bg: '' };
  }
  next();
});

// Routes
const authRoutes = require('./routes/auth');
const dashRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const serverRoutes = require('./routes/servers');
const vmRoutes = require('./routes/vm');
const apiRoutes = require('./routes/api');

app.use('/', authRoutes);
app.use('/dashboard', dashRoutes);
app.use('/admin', adminRoutes);
app.use('/servers', serverRoutes);
app.use('/vm', vmRoutes);
app.use('/api', apiRoutes);

// WebSocket console handler
require('./utils/console')(io);

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: '404 Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Error', message: err.message });
});

const PORT = process.env.PORT || 6767;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║        NVM Panel is running!         ║`);
  console.log(`║   http://localhost:${PORT}             ║`);
  console.log(`║   Default: admin / admin123          ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

module.exports = { app, server };
