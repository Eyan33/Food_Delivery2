"use strict";

const auditAdminAction = require("../adminAuditMiddleware");

function getSystemRoles() {
    const system = String(process.env.PLATFORM_SYSTEM || "").trim().toLowerCase();

    if (system === "market") {
        return { admin: "admin2", superAdmin: "super_admin2" };
    }

    if (system === "food") {
        return { admin: "admin1", superAdmin: "super_admin1" };
    }

    // Backward compatibility for deployments that have not yet migrated
    // to the independent role scheme. Suffixed roles fail closed without
    // an explicit PLATFORM_SYSTEM setting.
    return { admin: "admin", superAdmin: "super_admin" };
}

function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const { admin, superAdmin } = getSystemRoles();
        const roleIsAllowed =
            allowedRoles.includes(req.user.role) ||
            (allowedRoles.includes("admin") && req.user.role === admin) ||
            (allowedRoles.includes("super_admin") && req.user.role === superAdmin);

        if (!roleIsAllowed) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to access this resource"
            });
        }

        if (req.user.role === admin || req.user.role === superAdmin) {
            auditAdminAction(req, res, () => {});
        }

        return next();
    };
}

module.exports = authorizeRoles;
