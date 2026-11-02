const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// GET /
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Login' });
});

// POST /login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Please fill all fields.');
    return res.redirect('/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    req.flash('error', 'Invalid credentials.');
    return res.redirect('/login');
  }
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    req.flash('error', 'Invalid credentials.');
    return res.redirect('/login');
  }
  req.session.user = { id: user.id, username: user.username, role: user.role, email: user.email };
  req.flash('success', `Welcome back, ${user.username}!`);
  res.redirect('/dashboard');
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
