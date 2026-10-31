"use strict";

module.exports = function requireSuperAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    if (req.user.role !== "super_admin") {
        return res.status(403).json({
            success: false,
            message: "Only the super admin can manage administrator accounts."
        });
    }

    return next();
};
