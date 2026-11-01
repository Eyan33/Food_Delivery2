"use strict";

const { recordAuditLog, updateAuditLogStatus } = require("../services/admin/adminOperationsService");

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|credential/i;
const MAX_DETAILS_LENGTH = 4000;
const MAX_DEPTH = 4;

/*
 * Copy of the request body that is safe to store: secrets are replaced by
 * "[redacted]" and large values are cut, so the audit trail shows WHAT was
 * changed (for example which setting) without recording credentials.
 */
function redact(value, depth = 0) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === "string") {
        return value.length > 300 ? `${value.slice(0, 300)}…` : value;
    }

    if (typeof value !== "object") {
        return value;
    }

    if (depth >= MAX_DEPTH) {
        return "[truncated]";
    }

    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => redact(item, depth + 1));
    }

    const output = {};

    for (const [key, item] of Object.entries(value)) {
        output[key] = SENSITIVE_KEY.test(key)
            ? "[redacted]"
            : redact(item, depth + 1);
    }

    return output;
}

function buildDetails(req) {
    const body = req.body;

    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
        return null;
    }

    const details = { body: redact(body) };

    return JSON.stringify(details).length > MAX_DETAILS_LENGTH
        ? { body: "[too large to store]" }
        : details;
}

async function auditAdminAction(req, res, next) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

    let auditId;
    try {
        // Record the intent before the route handler can mutate platform data.
        // If the audit store is unavailable, fail closed and do not run the action.
        auditId = await recordAuditLog({
            adminId: req.user?.id,
            adminRole: req.user?.role,
            method: req.method,
            resource: req.originalUrl.split("?")[0],
            statusCode: 0,
            details: buildDetails(req),
        });
    } catch (error) {
        console.error("Could not create required admin audit record:", error.message);
        return res.status(503).json({
            success: false,
            message: "This administrative action cannot proceed because audit logging is unavailable. Please try again.",
        });
    }

    const originalEnd = res.end;
    let endStarted = false;
    res.end = function (...args) {
        if (endStarted) return res;
        endStarted = true;

        const finishResponse = () => originalEnd.apply(res, args);
        let timeoutId;
        const statusUpdate = updateAuditLogStatus(auditId, res.statusCode).then(() => true);
        const timeout = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(false), 2000);
        });

        Promise.race([statusUpdate, timeout]).then((updated) => {
            clearTimeout(timeoutId);
            if (!updated) console.error("Admin audit status update exceeded the 2-second response budget:", req.originalUrl);
            finishResponse();
        }).catch((error) => {
            clearTimeout(timeoutId);
            console.error("Failed to update admin audit result:", error.message);
            finishResponse();
        });

        return res;
    };

    return next();
}

module.exports = auditAdminAction;
module.exports.redact = redact;
