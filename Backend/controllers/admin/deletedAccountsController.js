"use strict";

const pool = require("../../config/database");

async function listDeletedAccounts(req, res) {
    try {
        const requestedPage = Number.parseInt(req.query.page, 10);
        const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
        const requestedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isSafeInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 25;
        const offset = (page - 1) * limit;
        const type = String(req.query.type || "").trim().toLowerCase();
        const search = String(req.query.search || "").trim().slice(0, 200);
        const values = [];
        const where = [];

        if (["customer", "restaurant", "rider"].includes(type)) {
            values.push(type);
            where.push("da.account_type = $" + values.length);
        }

        // Search only audit metadata. Never search or return archived account payloads.
        if (search) {
            values.push("%" + search + "%");
            const placeholder = "$" + values.length;
            where.push("(da.account_label ILIKE " + placeholder + " OR " +
                "da.deletion_reason ILIKE " + placeholder + " OR " +
                "da.account_type ILIKE " + placeholder + " OR " +
                "da.original_account_id::text ILIKE " + placeholder + ")");
        }

        const clause = where.length ? " WHERE " + where.join(" AND ") : "";
        const count = await pool.query(
            "SELECT COUNT(*)::int AS total FROM public.deleted_accounts da" + clause,
            values
        );
        const total = Number(count.rows[0]?.total || 0);
        const pages = Math.ceil(total / limit);
        const safePage = Math.min(page, Math.max(1, pages));
        const safeOffset = (safePage - 1) * limit;
        const rows = await pool.query(
            "SELECT da.id, da.original_account_id, da.account_type, da.account_label, " +
            "da.deleted_by, COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', du.first_name, du.last_name)), ''), " +
            "NULLIF(du.email, ''), CASE WHEN da.deleted_by IS NOT NULL THEN 'Admin #' || da.deleted_by::text ELSE 'Unknown admin' END) AS deleted_by_label, " +
            "da.deletion_reason, da.deleted_at " +
            "FROM public.deleted_accounts da LEFT JOIN public.users du ON du.id = da.deleted_by" +
            clause + " ORDER BY da.deleted_at DESC NULLS LAST, da.id DESC LIMIT $" +
            (values.length + 1) + " OFFSET $" + (values.length + 2),
            [...values, limit, safeOffset]
        );

        return res.json({
            success: true,
            data: {
                accounts: rows.rows,
                pagination: { page: safePage, limit, total, pages }
            }
        });
    } catch (error) {
        console.error("List deleted accounts failed:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve deleted-account audit records."
        });
    }
}

module.exports = { listDeletedAccounts };
