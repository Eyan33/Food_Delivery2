const jwt = require("jsonwebtoken");
const pool = require("../../config/database");


async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Authorization token is required"
            });
        }

        const parts = authHeader.split(" ");

        if (
            parts.length !== 2 ||
            parts[0] !== "Bearer" ||
            !parts[1]
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid authorization format"
            });
        }

        const token = parts[1];

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not configured");

            return res.status(500).json({
                success: false,
                message: "Authentication configuration error"
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const result = await pool.query(
            `
            SELECT
                id,
                first_name,
                last_name,
                email,
                phone,
                role,
                is_active,
                must_change_password
            FROM users
            WHERE id = $1
            LIMIT 1
            `,
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "User account not found"
            });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(401).json({
                success: false,
                message: "This account has been deactivated"
            });
        }

        if (user.must_change_password && !/\/auth\/me\/password(?:\?|$)/.test(req.originalUrl || req.url || "")) {
            return res.status(403).json({
                success: false,
                code: "PASSWORD_CHANGE_REQUIRED",
                message: "Change your temporary password before using the portal."
            });
        }

        req.user = user;

        next();

    } catch (error) {
        console.error(
            "Authentication error:",
            error.message
        );

        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Authentication token has expired"
            });
        }

        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Invalid authentication token"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Authentication failed"
        });
    }
}


module.exports = authenticateToken;