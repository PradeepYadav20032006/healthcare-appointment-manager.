const ApiError = require('../utils/apiError');

/**
 * Usage: router.get('/x', authenticate, requireRole('ADMIN'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, 'Not authenticated');
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new ApiError(403, `Requires one of roles: ${allowedRoles.join(', ')}`);
    }
    next();
  };
}

module.exports = requireRole;
