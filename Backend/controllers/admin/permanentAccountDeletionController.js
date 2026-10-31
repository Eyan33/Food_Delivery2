"use strict";

const pool = require("../../config/database");

const ACCOUNT_CONFIG = {
    customer: {
        select: `SELECT
                    u.id AS account_id,
                    concat_ws(' ', u.first_name, u.last_name) AS account_label
                 FROM public.users u
                 WHERE u.id = $1 AND u.role = 'customer'
                 FOR UPDATE OF u`,
        delete: `DELETE FROM public.users WHERE id = $1 AND role = 'customer'`
    },
    rider: {
        select: `SELECT
                    u.id AS account_id,
                    concat_ws(' ', u.first_name, u.last_name) AS account_label
                 FROM public.users u
                 WHERE u.id = $1 AND u.role = 'rider'
                 FOR UPDATE OF u`,
        delete: `DELETE FROM public.users WHERE id = $1 AND role = 'rider'`
    },
    restaurant: {
        select: `SELECT
                    r.id AS account_id,
                    r.name AS account_label,
                    r.owner_id
                 FROM public.restaurants r
                 JOIN public.users u ON u.id = r.owner_id
                 WHERE r.id = $1
                 FOR UPDATE OF r, u`,
        delete: `DELETE FROM public.restaurants WHERE id = $1`
    }
};

async function permanentlyDeleteAccount(req, res) {
    const type = String(req.params.type || "").trim().toLowerCase();
    const id = String(req.params.id || "").trim();
    const reason = String(req.body?.reason || "").trim();

    if (!Object.prototype.hasOwnProperty.call(ACCOUNT_CONFIG, type)) {
        return res.status(400).json({ success: false, message: "Account type must be customer, restaurant, or rider." });
    }
    if (!/^[1-9][0-9]*$/.test(id)) {
        return res.status(400).json({ success: false, message: "Account ID must be a positive integer." });
    }
    if (reason.length < 3) {
        return res.status(400).json({ success: false, message: "A deletion reason of at least 3 characters is required." });
    }
    if (reason.length > 1000) {
        return res.status(400).json({ success: false, message: "Deletion reason must be 1,000 characters or fewer." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const config = ACCOUNT_CONFIG[type];
        const found = await client.query(config.select, [id]);
        if (!found.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "No " + type + " account was found for ID " + id + "." });
        }
        const account = found.rows[0];

        // Preserve live relational order/payment history. Until historical account
        // references can be anonymized safely, block customer/restaurant deletion
        // when orders exist; administrators should deactivate those accounts instead.
        if (type === "customer" || type === "restaurant") {
            const history = await client.query(
                type === "customer"
                    ? "SELECT COUNT(*)::int AS total FROM public.orders WHERE customer_id = $1"
                    : "SELECT COUNT(*)::int AS total FROM public.orders WHERE restaurant_id = $1",
                [id]
            );
            if (Number(history.rows[0]?.total || 0) > 0) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    success: false,
                    message: "This account has order history. To preserve order, payment, and financial records, deactivate it instead of permanently deleting it."
                });
            }
        }

        const label = account.account_label || type + " #" + id;

        // Store audit metadata only; account snapshots and personal-data payloads are disabled.
        await client.query(
            `INSERT INTO public.deleted_accounts
                (original_account_id, account_type, account_label, account_data, deleted_by, deletion_reason)
             VALUES ($1, $2, $3, '{}'::jsonb, $4, $5)`,
            [account.account_id, type, label, req.user?.id || null, reason || null]
        );

        // Customer/restaurant accounts with order history are blocked above, so this
        // path never deletes orders or their related order items/payment records.
        // Rider deletion preserves orders; its rider foreign key is expected to SET NULL.
        await client.query(config.delete, [id]);

        // Remove the restaurant owner's login only when no other restaurant remains.
        if (type === "restaurant" && account.owner_id) {
            const remainingRestaurants = await client.query(
                "SELECT 1 FROM public.restaurants WHERE owner_id = $1 LIMIT 1",
                [account.owner_id]
            );
            if (remainingRestaurants.rowCount === 0) {
                await client.query(
                    "DELETE FROM public.users WHERE id = $1 AND role = 'restaurant'",
                    [account.owner_id]
                );
            }
        }

        await client.query("COMMIT");
        return res.status(200).json({
            success: true,
            message: type.charAt(0).toUpperCase() + type.slice(1) + " permanently deleted; audit metadata recorded.",
            data: { account_type: type, original_account_id: Number(id), account_label: label }
        });
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        console.error("Permanent account deletion failed:", error);
        if (error.code === "23503") {
            return res.status(409).json({
                success: false,
                message: "Deletion was blocked by a related database record. No changes were committed; the account and archive transaction were rolled back."
            });
        }
        return res.status(500).json({
            success: false,
            message: "Permanent deletion failed. No changes were committed. Check the server logs for details."
        });
    } finally {
        client.release();
    }
}

module.exports = { permanentlyDeleteAccount };
