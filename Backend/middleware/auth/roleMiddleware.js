const auditAdminAction = require("../adminAuditMiddleware");

function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        // Super Admin inherits regular Admin permissions, but not restaurant,
        // rider, or customer permissions. This keeps existing admin APIs
        // available to the Super Admin account.
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
            auditAdminAction(req, res, () => {});
        }

        return next();
    };
}

module.exports = authorizeRoles;
