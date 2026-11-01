"use strict";

module.exports = function requireSuperAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    if (!["super_admin", "super_admin2"].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: "This action is restricted to the super admin."
        });
    }

    return next();
};
