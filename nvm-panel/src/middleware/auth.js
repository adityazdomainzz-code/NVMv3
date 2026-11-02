function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please login to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.flash('error', 'Admin access required.');
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
