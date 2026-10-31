"use strict";

function getSuperAdminRole() {
    const system = String(process.env.PLATFORM_SYSTEM || "").trim().toLowerCase();
    if (system === "market") return "super_admin2";
    if (system === "food") return "super_admin1";
    return "super_admin";
}

module.exports = function requireSuperAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    if (req.user.role !== getSuperAdminRole()) {
        return res.status(403).json({
            success: false,
            message: "Only this system's Super Admin can manage administrator accounts."
        });
    }

    return next();
};
