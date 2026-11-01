const auditAdminAction = require("../adminAuditMiddleware");

function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        // Super Admin inherits regular Admin permissions on routes that
        // explicitly allow "admin", without inheriting other portal roles.
        const roleIsAllowed =
            allowedRoles.includes(req.user.role) ||
            (req.user.role === "super_admin" && allowedRoles.includes("admin"));

        if (!roleIsAllowed) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to access this resource"
            });
        }

        if (req.user.role === "admin" || req.user.role === "super_admin") {
            return auditAdminAction(req, res, next);
        }

        return next();
    };
}

module.exports = authorizeRoles;
