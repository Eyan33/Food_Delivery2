"use strict";

/*
 * Environment loading and validation.
 *
 * validateEnvironment() is called once at startup. In production any
 * problem is fatal (the process exits and Render marks the deploy as
 * failed instead of serving a broken API). In development problems are
 * only logged.
 */

require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

const WEAK_SECRET_PATTERNS = [
    /replace[_-]?with/i,
    /change[_-]?me/i,
    /^secret$/i,
    /^password$/i,
    /^jwt[_-]?secret$/i,
    /^your[_-]/i,
];

function hasDatabaseConfig() {
    if (process.env.DATABASE_URL) {
        return true;
    }

    return ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].every(
        (key) => Boolean(process.env[key]),
    );
}

function validateEnvironment() {
    const errors = [];
    const warnings = [];

    if (!hasDatabaseConfig()) {
        errors.push(
            "Database is not configured. Set DATABASE_URL, or DB_HOST, DB_NAME, DB_USER and DB_PASSWORD.",
        );
    }

    const jwtSecret = process.env.JWT_SECRET || "";

    if (!jwtSecret) {
        errors.push("JWT_SECRET is not set.");
    } else if (isProduction) {
        if (jwtSecret.length < 32) {
            errors.push("JWT_SECRET must be at least 32 characters in production.");
        }

        if (WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(jwtSecret))) {
            errors.push("JWT_SECRET looks like a placeholder. Use a long random value.");
        }
    } else if (jwtSecret.length < 16) {
        warnings.push("JWT_SECRET is short. Use a long random value outside local development.");
    }

    if (
        isProduction &&
        !process.env.CORS_ORIGINS &&
        !process.env.RENDER_EXTERNAL_URL
    ) {
        warnings.push(
            "CORS_ORIGINS is not set: only same-origin browser requests will be accepted.",
        );
    }

    if (process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).length < 8) {
        errors.push("ADMIN_PASSWORD must be at least 8 characters.");
    }

    return { errors, warnings };
}

/*
 * TRUST_PROXY accepts a hop count ("1"), "true"/"false", or any value
 * Express understands ("loopback", a CIDR list, ...). Default: one proxy
 * hop in production (Render's load balancer), none locally.
 */
function resolveTrustProxy() {
    const raw = process.env.TRUST_PROXY;

    if (raw === undefined || raw === "") {
        return isProduction ? 1 : false;
    }

    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }

    if (raw === "true") return true;
    if (raw === "false") return false;

    return raw;
}

function parseList(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

module.exports = {
    isProduction,
    validateEnvironment,
    resolveTrustProxy,
    parseList,
};
