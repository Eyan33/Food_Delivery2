const jwt = require("jsonwebtoken");

const PRIVILEGED_ROLES = new Set(["admin", "super_admin", "super_admin2"]);

/*
 * Admin and super-admin sessions are short lived: a stolen privileged token
 * is far more damaging than a stolen customer token, so it should expire
 * sooner. Override with JWT_ADMIN_EXPIRES_IN; other roles keep
 * JWT_EXPIRES_IN.
 */
function expiryForRole(role) {
  if (PRIVILEGED_ROLES.has(role)) {
    return process.env.JWT_ADMIN_EXPIRES_IN || "12h";
  }

  return process.env.JWT_EXPIRES_IN || "7d";
}

function generateToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      id: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: expiryForRole(user.role),
    },
  );
}

module.exports = generateToken;
module.exports.expiryForRole = expiryForRole;
