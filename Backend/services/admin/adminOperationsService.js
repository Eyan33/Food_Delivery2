"use strict";

const pool = require("../../config/database");

const SETTINGS_FIELDS = {
    general: ["platformName", "supportEmail", "supportPhone", "currency", "timezone", "platformDescription","dailyRevenueTarget"],
    payments: ["mpesaEnabled", "cardEnabled", "cashEnabled", "transactionFee"],
    platformFees: ["deliveryFeePerKm"],
    delivery: ["maxDistance", "minimumOrder", "deliveryTime"],
    notifications: ["newOrderAlerts", "paymentNotifications", "restaurantRegistration", "riderRegistration", "systemAlerts"],
    // twoFactorRequired and loginAlerts were removed: nothing enforced them,
    // so the settings page implied protection that did not exist.
    security: ["sessionTimeout"],
};
const BOOLEAN_SETTINGS = new Set([
    "mpesaEnabled", "cardEnabled", "cashEnabled", "newOrderAlerts",
    "paymentNotifications", "restaurantRegistration", "riderRegistration",
    "systemAlerts",
]);
const NUMBER_SETTINGS = new Set([
    "transactionFee", "deliveryFeePerKm",
    "maxDistance", "minimumOrder", "deliveryTime","dailyRevenueTarget",
]);

function apiError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function getSettings() {
    const result = await pool.query(
        "SELECT settings, updated_at FROM admin_settings WHERE id = 1",
    );
    return result.rows[0] || { settings: {}, updated_at: null };
}

async function updateSettings(input, adminId) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw apiError("Settings must be an object");
    }

    const sections = {};
    for (const [section, values] of Object.entries(input)) {
        const allowed = SETTINGS_FIELDS[section];
        if (!allowed || !values || typeof values !== "object" || Array.isArray(values)) {
            throw apiError(`Invalid settings section: ${section}`);
        }

        for (const key of Object.keys(values)) {
            if (!allowed.includes(key)) {
                throw apiError(`Setting is not allowed: ${key}`);
            }
            const value = values[key];
            if (BOOLEAN_SETTINGS.has(key) && typeof value !== "boolean") {
                throw apiError(`${key} must be a boolean`);
            }
            if (NUMBER_SETTINGS.has(key)) {
                const numericValue = Number(value);
                if (value === null || value === "" || typeof value === "boolean" ||
                    !Number.isFinite(numericValue) || numericValue < 0) {
                    throw apiError(`${key} must be a non-negative number`);
                }
                if (key === "transactionFee" && numericValue > 100) {
                    throw apiError("transactionFee must be between 0 and 100 percent");
                }
            }
            if (typeof value === "string" && value.length > 2000) {
                throw apiError(`${key} is too long`);
            }
        }

        sections[section] = values;
    }

    const result = await pool.query(
        `
        INSERT INTO admin_settings (id, settings, updated_by, updated_at)
        VALUES (1, $1::jsonb, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE
        SET settings = COALESCE(admin_settings.settings, '{}'::jsonb)
                       || jsonb_build_object(
                            'general', COALESCE(admin_settings.settings->'general', '{}'::jsonb) || COALESCE(EXCLUDED.settings->'general', '{}'::jsonb),
                            'payments', COALESCE(admin_settings.settings->'payments', '{}'::jsonb) || COALESCE(EXCLUDED.settings->'payments', '{}'::jsonb),
                            'platformFees', COALESCE(admin_settings.settings->'platformFees', '{}'::jsonb) || COALESCE(EXCLUDED.settings->'platformFees', '{}'::jsonb),
                            'delivery', COALESCE(admin_settings.settings->'delivery', '{}'::jsonb) || COALESCE(EXCLUDED.settings->'delivery', '{}'::jsonb),
                            'notifications', COALESCE(admin_settings.settings->'notifications', '{}'::jsonb) || COALESCE(EXCLUDED.settings->'notifications', '{}'::jsonb),
                            'security', COALESCE(admin_settings.settings->'security', '{}'::jsonb) || COALESCE(EXCLUDED.settings->'security', '{}'::jsonb)
                       ),
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
        RETURNING settings, updated_at
        `,
        [JSON.stringify(sections), adminId],
    );

    if (!result.rows[0]) {
        throw apiError("Settings could not be persisted", 500);
    }

    return result.rows[0];
}

async function syncNotifications() {
    await pool.query(`
        INSERT INTO admin_notifications
            (source_type, source_id, title, message, target_url, created_at)
        SELECT
            'order', o.id::text, 'Order needs attention',
            'Order #' || o.order_number || ' is ' || replace(o.status, '_', ' ') || '.',
            '/pages/admin/orders.html', o.placed_at
        FROM orders o
        WHERE o.status IN ('pending', 'ready')
          AND o.placed_at >= CURRENT_TIMESTAMP - INTERVAL '14 days'
                    AND COALESCE((SELECT (settings #>> '{notifications,newOrderAlerts}')::boolean FROM admin_settings WHERE id = 1), TRUE)
                    AND COALESCE((SELECT (settings #>> '{notifications,systemAlerts}')::boolean FROM admin_settings WHERE id = 1), TRUE)
        ON CONFLICT (source_type, source_id) DO NOTHING;

        INSERT INTO admin_notifications
            (source_type, source_id, title, message, target_url, created_at)
        SELECT
            'restaurant', r.id::text, 'Restaurant approval required',
            r.name || ' is waiting for approval.',
            '/pages/admin/restaurants.html', r.created_at
        FROM restaurants r
        WHERE r.approval_status = 'pending'
                    AND COALESCE((SELECT (settings #>> '{notifications,restaurantRegistration}')::boolean FROM admin_settings WHERE id = 1), TRUE)
                    AND COALESCE((SELECT (settings #>> '{notifications,systemAlerts}')::boolean FROM admin_settings WHERE id = 1), TRUE)
        ON CONFLICT (source_type, source_id) DO NOTHING;

        INSERT INTO admin_notifications
            (source_type, source_id, title, message, target_url, created_at)
        SELECT
            'rider', rp.user_id::text, 'Rider approval required',
            CONCAT(u.first_name, ' ', u.last_name) || ' is waiting for approval.',
            '/pages/admin/riders.html', rp.created_at
        FROM rider_profiles rp
        JOIN users u ON u.id = rp.user_id
        WHERE rp.approval_status = 'pending'
                    AND COALESCE((SELECT (settings #>> '{notifications,riderRegistration}')::boolean FROM admin_settings WHERE id = 1), TRUE)
                    AND COALESCE((SELECT (settings #>> '{notifications,systemAlerts}')::boolean FROM admin_settings WHERE id = 1), TRUE)
        ON CONFLICT (source_type, source_id) DO NOTHING;

        INSERT INTO admin_notifications
            (source_type, source_id, title, message, target_url, created_at)
        SELECT
            'payment', p.id::text, 'Payment failed',
            'Payment for order #' || COALESCE(o.order_number, p.order_id::text) || ' failed.',
            '/pages/admin/payments.html', p.created_at
        FROM payments p
        LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.payment_status = 'failed'
          AND p.created_at >= CURRENT_TIMESTAMP - INTERVAL '14 days'
                    AND COALESCE((SELECT (settings #>> '{notifications,paymentNotifications}')::boolean FROM admin_settings WHERE id = 1), TRUE)
                    AND COALESCE((SELECT (settings #>> '{notifications,systemAlerts}')::boolean FROM admin_settings WHERE id = 1), TRUE)
        ON CONFLICT (source_type, source_id) DO NOTHING;
    `);
}

async function getNotifications({ page = 1, limit = 20 } = {}) {
    await syncNotifications();
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT id, source_type, title, message, target_url, created_at, read_at
             FROM admin_notifications
             WHERE read_at IS NULL
             ORDER BY created_at DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [safeLimit, offset],
        ),
        pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread
             FROM admin_notifications
             WHERE read_at IS NULL`,
        ),
    ]);

    return {
        notifications: rows.rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalItems: count.rows[0].total,
            totalPages: Math.max(1, Math.ceil(count.rows[0].total / safeLimit)),
        },
        unreadCount: count.rows[0].unread,
    };
}

async function markNotificationRead(id) {
    const result = await pool.query(
        `UPDATE admin_notifications
         SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE id = $1
         RETURNING id, read_at`,
        [id],
    );
    return result.rows[0] || null;
}

async function markAllNotificationsRead() {
    const result = await pool.query(
        `UPDATE admin_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE read_at IS NULL`,
    );
    return result.rowCount;
}

async function recordAuditLog({ adminId, adminRole, method, resource, statusCode, details = null }) {
    const result = await pool.query(
        `INSERT INTO admin_audit_logs (admin_id, admin_role, action, resource, status_code, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id`,
        [
            adminId || null,
            adminRole || null,
            method,
            resource,
            statusCode,
            details ? JSON.stringify(details) : null,
        ],
    );
    if (!result.rows[0]) throw new Error("Admin audit record was not created");
    return result.rows[0].id;
}

async function updateAuditLogStatus(id, statusCode) {
    await pool.query(
        "UPDATE admin_audit_logs SET status_code = $2 WHERE id = $1",
        [id, statusCode],
    );
}

async function getAuditLogs({ page = 1, limit = 25 } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
    const offset = (safePage - 1) * safeLimit;

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT l.id, l.admin_role, l.action, l.resource, l.status_code, l.details, l.created_at,
                    CONCAT(u.first_name, ' ', u.last_name) AS admin_name, u.email AS admin_email
             FROM admin_audit_logs l
             LEFT JOIN users u ON u.id = l.admin_id
             ORDER BY l.created_at DESC, l.id DESC
             LIMIT $1 OFFSET $2`,
            [safeLimit, offset],
        ),
        pool.query("SELECT COUNT(*)::int AS total FROM admin_audit_logs"),
    ]);

    return {
        logs: rows.rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalItems: count.rows[0].total,
            totalPages: Math.max(1, Math.ceil(count.rows[0].total / safeLimit)),
        },
    };
}

async function getReviews({ page = 1, limit = 20, visibility = "all", search = "" } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;
    const values = [];
    const conditions = [];

    if (visibility === "visible") conditions.push("r.is_visible = TRUE");
    if (visibility === "hidden") conditions.push("r.is_visible = FALSE");
    if (search.trim()) {
        values.push(`%${search.trim().replace(/[\\%_]/g, "\\$&")}%`);
        conditions.push(`(r.comment ILIKE $${values.length} ESCAPE '\\' OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $${values.length} ESCAPE '\\' OR res.name ILIKE $${values.length} ESCAPE '\\')`);
    }
    const where = conditions.length ? conditions.join(" AND ") : "TRUE";

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT r.id, r.rating, r.comment, r.is_visible, r.created_at,
                    CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
                    res.name AS restaurant_name, r.restaurant_id
             FROM reviews r
             JOIN users u ON u.id = r.customer_id
             JOIN restaurants res ON res.id = r.restaurant_id
             WHERE ${where}
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            [...values, safeLimit, offset],
        ),
        pool.query(
            `SELECT COUNT(*)::int AS total FROM reviews r
             JOIN users u ON u.id = r.customer_id
             JOIN restaurants res ON res.id = r.restaurant_id
             WHERE ${where}`,
            values,
        ),
    ]);

    return {
        reviews: rows.rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalItems: count.rows[0].total,
            totalPages: Math.max(1, Math.ceil(count.rows[0].total / safeLimit)),
        },
    };
}

async function setReviewVisibility(id, isVisible) {
    const result = await pool.query(
        `UPDATE reviews SET is_visible = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING id, is_visible`,
        [id, isVisible],
    );
    return result.rows[0] || null;
}

module.exports = {
    getSettings,
    updateSettings,
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    recordAuditLog,
    updateAuditLogStatus,
    getAuditLogs,
    getReviews,
    setReviewVisibility,
};
