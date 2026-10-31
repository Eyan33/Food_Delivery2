"use strict";

const pool = require("../../config/database");

const ACCOUNT_CONFIG = {
    customer: {
        select: `SELECT to_jsonb(u) AS account_data, u.id AS account_id,
                        concat_ws(' ', u.first_name, u.last_name) AS account_label
                 FROM public.users u WHERE u.id = $1 AND u.role = 'customer' FOR UPDATE`,
        delete: `DELETE FROM public.users WHERE id = $1 AND role = 'customer'`
    },
    rider: {
        select: `SELECT jsonb_build_object(
                            'user', to_jsonb(u),
                            'rider_profile', to_jsonb(rp)
                        ) AS account_data,
                        u.id AS account_id,
                        concat_ws(' ', u.first_name, u.last_name) AS account_label
                 FROM public.users u
                 LEFT JOIN public.rider_profiles rp ON rp.user_id = u.id
                 WHERE u.id = $1 AND u.role = 'rider'
                 FOR UPDATE OF u`,
        delete: `DELETE FROM public.users WHERE id = $1 AND role = 'rider'`
    },
    restaurant: {
        select: `SELECT jsonb_build_object(
                            'restaurant', to_jsonb(r),
                            'owner_account', to_jsonb(u)
                        ) AS account_data,
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

function apiError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

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
            return res.status(404).json({ success: false, message: "Account not found." });
        }
        const account = found.rows[0];
        const snapshot = account.account_data;
        const label = account.account_label || type + " #" + id;

        await client.query(
            `INSERT INTO public.deleted_accounts
                (original_account_id, account_type, account_label, account_data, deleted_by, deletion_reason)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
            [account.account_id, type, label, JSON.stringify(snapshot), req.user?.id || null, reason || null]
        );

        await client.query(config.delete, [id]);

        // A restaurant owner account belongs to the restaurant being removed.
        // Delete it in the same transaction; dependent order/payment history
        // causes PostgreSQL to reject the operation and the archive insert rolls back.
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
            message: type.charAt(0).toUpperCase() + type.slice(1) + " permanently deleted and archived.",
            data: { account_type: type, original_account_id: Number(id), account_label: label }
        });
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        console.error("Permanent account deletion failed:", error);
        if (error.code === "23503") {
            return res.status(409).json({
                success: false,
                message: "This account has related records (such as orders, payments, or delivery history) that prevent permanent deletion. No changes were made; the account and archive transaction were rolled back."
            });
        }
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Permanent deletion failed. No changes were committed." });
    } finally {
        client.release();
    }
}

module.exports = { permanentlyDeleteAccount };
