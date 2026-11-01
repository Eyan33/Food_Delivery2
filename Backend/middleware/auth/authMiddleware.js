const jwt = require("jsonwebtoken");
const pool = require("../../config/database");

/*
 * The only request a user who must change a temporary password may make.
 *
 * This compares the route path exactly. It must never be a regex over the
 * whole URL: a query string such as "?x=/auth/me/password" would then pass
 * the check on every endpoint. Express routing is case-insensitive and
 * ignores a trailing slash, so both are normalized here; anything that does
 * not match exactly is treated as "not the password route" and blocked.
 */
const PASSWORD_CHANGE_PATH = "/api/auth/me/password";

function isPasswordChangeRequest(req) {
    if (req.method !== "PATCH") {
        return false;
    }

    const fullPath = `${req.baseUrl || ""}${req.path || ""}`
        .toLowerCase()
        .replace(/\/+$/, "");

    return fullPath === PASSWORD_CHANGE_PATH;
}


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
                must_change_password,
                tokens_valid_after
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

        /*
         * Tokens issued before the account's last credential change (admin
         * password reset, password change, ...) are no longer accepted.
         * Both sides of the comparison use the application clock.
         */
        if (user.tokens_valid_after) {
            const validAfterSeconds = Math.floor(
                new Date(user.tokens_valid_after).getTime() / 1000
            );

            if (
                !Number.isFinite(decoded.iat) ||
                decoded.iat < validAfterSeconds
            ) {
                return res.status(401).json({
                    success: false,
                    message: "Your session is no longer valid. Please sign in again."
                });
            }
        }

        delete user.tokens_valid_after;

        if (user.must_change_password && !isPasswordChangeRequest(req)) {
            return res.status(403).json({ success: false, code: "PASSWORD_CHANGE_REQUIRED", message: "Change your temporary password before using the portal." });
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
module.exports.isPasswordChangeRequest = isPasswordChangeRequest;