"use strict";

/*
 * First-run database setup, safe to run on every start.
 *
 *  1. Waits for PostgreSQL to accept connections (Render may still be
 *     provisioning the database during the very first deploy).
 *  2. Applies food_delivery_schema.sql ONLY when the database is empty
 *     (no public.users table). Existing data is never touched.
 *  3. Optionally creates the first admin account from ADMIN_EMAIL and
 *     ADMIN_PASSWORD. An existing account is never modified.
 *
 * Set DB_AUTO_INIT=false to skip all of this.
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const pool = require("../config/database");
const { normalizeEmail, isValidEmail } = require("../utils/auth/validators");

// Arbitrary constant: serialises schema creation if two instances boot together.
const SCHEMA_LOCK_ID = 727274;

function log(message) {
    console.log(`[db-init] ${message}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSchemaPath() {
    if (process.env.SCHEMA_PATH) {
        return path.resolve(process.env.SCHEMA_PATH);
    }

    return [
        path.resolve(__dirname, "..", "..", "food_delivery_schema.sql"),
        path.resolve(__dirname, "schema.sql"),
    ].find((candidate) => fs.existsSync(candidate));
}

/*
 * The provided schema is a pg_dump file. Two things in it cannot be sent
 * through a normal driver connection:
 *   - psql meta-commands such as \restrict / \unrestrict
 *   - "SET transaction_timeout", which only exists on PostgreSQL 17+
 *     (it is set to 0, the default, so dropping it changes nothing)
 */
function prepareSchemaSql(rawSql) {
    return String(rawSql)
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("\\"))
        .filter((line) => !/^SET\s+transaction_timeout\b/i.test(line))
        .join("\n");
}

async function waitForDatabase({ attempts = 10, delayMs = 5000 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            return;
        } catch (error) {
            if (attempt === attempts) {
                throw error;
            }

            log(
                `database not ready (attempt ${attempt}/${attempts}), retrying in ${delayMs / 1000}s`,
            );
            await sleep(delayMs);
        }
    }
}

async function ensureSchema() {
    const client = await pool.connect();

    try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_ID]);

        const existing = await client.query(
            "SELECT to_regclass('public.users') AS users_table",
        );

        if (existing.rows[0].users_table) {
            log("schema already present, leaving existing data untouched");
            return false;
        }

        const schemaPath = resolveSchemaPath();

        if (!schemaPath) {
            throw new Error(
                "food_delivery_schema.sql was not found. Set SCHEMA_PATH or keep the file at the repository root.",
            );
        }

        log(`empty database detected, applying schema from ${schemaPath}`);

        // One multi-statement query runs as a single implicit transaction:
        // either the whole schema is created or nothing is.
        await client.query(prepareSchemaSql(fs.readFileSync(schemaPath, "utf8")));

        log("schema applied");
        return true;
    } finally {
        try {
            await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_ID]);
        } catch (error) {
            // The connection is destroyed below anyway, which also frees the lock.
        }

        // The dump changes this session's search_path, so never hand the
        // connection back to the pool.
        client.release(true);
    }
}

async function seedAdmin() {
    const email = normalizeEmail(process.env.ADMIN_EMAIL);
    const password = process.env.ADMIN_PASSWORD;

    if (!email && !password) {
        return;
    }

    if (!email || !password) {
        log("ADMIN_EMAIL and ADMIN_PASSWORD must both be set, skipping admin creation");
        return;
    }

    if (!isValidEmail(email)) {
        throw new Error("ADMIN_EMAIL is not a valid email address");
    }

    if (password.length < 8) {
        throw new Error("ADMIN_PASSWORD must be at least 8 characters");
    }

    const existing = await pool.query(
        "SELECT id, role FROM users WHERE email = $1 LIMIT 1",
        [email],
    );

    if (existing.rows.length > 0) {
        if (existing.rows[0].role !== "admin") {
            log(`account ${email} already exists and is not an admin, leaving it unchanged`);
        } else {
            log("admin account already exists, nothing to do");
        }

        return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
        `
        INSERT INTO users (first_name, last_name, email, phone, password_hash, role)
        VALUES ($1, $2, $3, $4, $5, 'admin')
        `,
        [
            (process.env.ADMIN_FIRST_NAME || "Platform").trim(),
            (process.env.ADMIN_LAST_NAME || "Admin").trim(),
            email,
            process.env.ADMIN_PHONE ? String(process.env.ADMIN_PHONE).trim() : null,
            passwordHash,
        ],
    );

    log(`admin account created for ${email}. Remove ADMIN_PASSWORD from the environment now.`);
}

async function ensureFoodImageSchema() {
    // Store validated image bytes in PostgreSQL so images survive app redeploys.
    // Existing food rows are intentionally retained; new admin-created foods
    // are required to include an image by the create endpoint.
    await pool.query(`
        ALTER TABLE public.foods
            ADD COLUMN IF NOT EXISTS image_data bytea,
            ADD COLUMN IF NOT EXISTS image_mime_type varchar(40);

        CREATE INDEX IF NOT EXISTS idx_foods_image_presence
            ON public.foods (id)
            WHERE image_data IS NOT NULL;
    `);
}

async function ensureAdminSupportSchema() {
    await pool.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
        -- Tokens issued before this moment are rejected (admin credential changes).
        ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after timestamptz;

        CREATE TABLE IF NOT EXISTS admin_settings (
            id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            settings jsonb NOT NULL DEFAULT '{}'::jsonb,
            updated_by bigint REFERENCES users(id) ON DELETE SET NULL,
            updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO admin_settings (id)
        VALUES (1)
        ON CONFLICT (id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS admin_notifications (
            id bigserial PRIMARY KEY,
            source_type varchar(40) NOT NULL,
            source_id varchar(80) NOT NULL,
            title varchar(180) NOT NULL,
            message text NOT NULL,
            target_url text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            read_at timestamptz,
            UNIQUE (source_type, source_id)
        );

        CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
            ON admin_notifications (created_at DESC)
            WHERE read_at IS NULL;

        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id bigserial PRIMARY KEY,
            admin_id bigint REFERENCES users(id) ON DELETE SET NULL,
            action varchar(12) NOT NULL,
            resource text NOT NULL,
            status_code integer NOT NULL,
            admin_role varchar(30),
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE admin_audit_logs
            ADD COLUMN IF NOT EXISTS admin_role varchar(30);

        -- What the request changed (secrets redacted); see adminAuditMiddleware.
        ALTER TABLE admin_audit_logs
            ADD COLUMN IF NOT EXISTS details jsonb;

        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created
            ON admin_audit_logs (created_at DESC);
    `);
}

async function ensureRiderProfileSchema() {
    // Keep existing production databases in sync with additive rider-profile fields.
    // Every statement is idempotent, so this is safe on each backend startup.
    await pool.query(`
        ALTER TABLE public.rider_profiles
            ADD COLUMN IF NOT EXISTS address varchar(250),
            ADD COLUMN IF NOT EXISTS city varchar(120),
            ADD COLUMN IF NOT EXISTS postal_code varchar(20),
            ADD COLUMN IF NOT EXISTS emergency_contact_name varchar(120),
            ADD COLUMN IF NOT EXISTS emergency_contact_phone varchar(40),
            ADD COLUMN IF NOT EXISTS emergency_contact_relationship varchar(30),
            ADD COLUMN IF NOT EXISTS current_latitude numeric(10,8),
            ADD COLUMN IF NOT EXISTS current_longitude numeric(11,8),
            ADD COLUMN IF NOT EXISTS location_accuracy_m numeric(10,2),
            ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;

        ALTER TABLE public.users
            ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
    `);
}

async function ensureGooglePasswordSetupSchema() {
    await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_password_setup_pending boolean NOT NULL DEFAULT false;`);
}

async function ensurePasswordResetSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            token_hash char(64) NOT NULL UNIQUE,
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
            ON public.password_reset_tokens (user_id);

        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
            ON public.password_reset_tokens (expires_at);
    `);
}


async function ensureRestaurantNotificationSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.restaurant_notifications (
            id bigserial PRIMARY KEY,
            restaurant_id bigint NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
            type varchar(50) NOT NULL DEFAULT 'order_update',
            title varchar(180) NOT NULL,
            message text NOT NULL,
            order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
            target_url text,
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            read_at timestamptz,
            dedupe_key varchar(180) UNIQUE
        );

        CREATE INDEX IF NOT EXISTS idx_restaurant_notifications_recent
            ON public.restaurant_notifications (restaurant_id, created_at DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_restaurant_notifications_unread
            ON public.restaurant_notifications (restaurant_id, created_at DESC)
            WHERE read_at IS NULL;

        CREATE TABLE IF NOT EXISTS public.restaurant_notification_preferences (
            restaurant_id bigint PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
            new_orders boolean NOT NULL DEFAULT TRUE,
            order_updates boolean NOT NULL DEFAULT TRUE,
            promotions boolean NOT NULL DEFAULT FALSE,
            email boolean NOT NULL DEFAULT FALSE,
            updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

async function ensureRiderNotificationSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.rider_notifications (
            id bigserial PRIMARY KEY,
            rider_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            type varchar(50) NOT NULL DEFAULT 'order_update',
            title varchar(180) NOT NULL,
            message text NOT NULL,
            order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
            target_url text NOT NULL DEFAULT 'orders.html',
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            read_at timestamptz,
            dedupe_key varchar(180) UNIQUE
        );
        CREATE INDEX IF NOT EXISTS idx_rider_notifications_recent
            ON public.rider_notifications (rider_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_rider_notifications_unread
            ON public.rider_notifications (rider_id, created_at DESC)
            WHERE read_at IS NULL;

        CREATE OR REPLACE FUNCTION public.create_rider_order_notifications()
        RETURNS trigger AS $rider_fn$
        BEGIN
            IF NEW.rider_id IS NOT NULL AND
               (TG_OP = 'INSERT' OR OLD.rider_id IS DISTINCT FROM NEW.rider_id) THEN
                INSERT INTO public.rider_notifications
                    (rider_id, type, title, message, order_id, target_url, dedupe_key)
                VALUES
                    (NEW.rider_id, 'order_assigned', 'New delivery assigned',
                     'Order #' || COALESCE(NEW.order_number, NEW.id::text) || ' has been assigned to you.',
                     NEW.id, 'orders.html', 'assigned:' || NEW.id::text || ':' || NEW.rider_id::text)
                ON CONFLICT (dedupe_key) DO NOTHING;
            ELSIF NEW.rider_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status THEN
                INSERT INTO public.rider_notifications
                    (rider_id, type, title, message, order_id, target_url, dedupe_key)
                VALUES
                    (NEW.rider_id, 'order_update', 'Delivery order updated',
                     'Order #' || COALESCE(NEW.order_number, NEW.id::text) || ' is now ' || replace(NEW.status, '_', ' ') || '.',
                     NEW.id, 'deliveries.html',
                     'status:' || NEW.id::text || ':' || NEW.rider_id::text || ':' || NEW.status)
                ON CONFLICT (dedupe_key) DO NOTHING;
            END IF;
            RETURN NEW;
        END;
        $rider_fn$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_rider_order_notifications ON public.orders;
        CREATE TRIGGER trg_rider_order_notifications
        AFTER INSERT OR UPDATE ON public.orders
        FOR EACH ROW EXECUTE FUNCTION public.create_rider_order_notifications();
    `);
}

async function ensureOrderLocationSchema() {
    await pool.query(`
        ALTER TABLE public.orders
            ADD COLUMN IF NOT EXISTS delivery_latitude numeric(10,8),
            ADD COLUMN IF NOT EXISTS delivery_longitude numeric(11,8);

        ALTER TABLE public.restaurants
            ADD COLUMN IF NOT EXISTS location_name varchar(130);

        UPDATE public.restaurants
        SET location_name = split_part(trim(name), ' ', 1) || ' Location'
        WHERE location_name IS NULL OR trim(location_name) = '';
    `);
}

async function ensureMpesaPaymentSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mpesa_checkout_sessions (
            id bigserial PRIMARY KEY,
            customer_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            checkout_request_id text UNIQUE,
            merchant_request_id text,
            payload jsonb NOT NULL,
            amount numeric(10,2) NOT NULL CHECK (amount > 0),
            phone_number varchar(30) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'initiating'
                CHECK (status IN ('initiating', 'processing', 'completed', 'failed')),
            order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
            provider_response text,
            receipt_number varchar(100),
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_mpesa_checkout_sessions_customer
            ON public.mpesa_checkout_sessions (customer_id, created_at DESC);

        -- Keep this as a correlation key rather than an FK: callback processing
        -- holds the session row lock while order creation runs on another pooled connection.
        ALTER TABLE public.orders
            ADD COLUMN IF NOT EXISTS mpesa_checkout_session_id bigint;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_mpesa_checkout_session
            ON public.orders (mpesa_checkout_session_id)
            WHERE mpesa_checkout_session_id IS NOT NULL;

        ALTER TABLE public.payments
            ADD COLUMN IF NOT EXISTS mpesa_checkout_request_id text,
            ADD COLUMN IF NOT EXISTS mpesa_merchant_request_id text;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_mpesa_checkout_request_id
            ON public.payments (mpesa_checkout_request_id)
            WHERE mpesa_checkout_request_id IS NOT NULL;
    `);
}

async function ensureDeletedAccountsSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.deleted_accounts (
            id bigserial PRIMARY KEY,
            original_account_id bigint NOT NULL,
            account_type varchar(20) NOT NULL CHECK (account_type IN ('customer', 'restaurant', 'rider')),
            account_label text NOT NULL DEFAULT '',
            account_data jsonb NOT NULL,
            deleted_by bigint,
            deletion_reason text,
            deleted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_deleted_accounts_type_deleted_at
            ON public.deleted_accounts (account_type, deleted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_deleted_accounts_label
            ON public.deleted_accounts (account_label);
    `);
}

async function ensureSuperAdminRoleSchema() {
    // Older production data may contain the historical typo "super_admin1".
    // Normalize that one known alias before role validation so login, route
    // authorization, audit checks, and the single-super-admin index all use
    // the canonical role. Refuse to merge two privileged accounts.
    const privilegedCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM public.users WHERE role IN ('super_admin', 'super_admin1')",
    );
    if (privilegedCount.rows[0].count > 1) {
        throw new Error("Multiple super-admin accounts were found across canonical and legacy roles. Resolve duplicates before startup.");
    }
    await pool.query(
        "UPDATE public.users SET role = 'super_admin' WHERE role = 'super_admin1'",
    );

    // Only canonical roles plus unrelated legacy values already in the
    // database are retained in the role constraint.
    const canonicalRoles = ["customer", "restaurant", "rider", "admin", "super_admin", "super_admin2"];
    const existingRoles = await pool.query(
        "SELECT DISTINCT role FROM public.users WHERE role IS NOT NULL",
    );
    const legacyRoles = existingRoles.rows
        .map((row) => String(row.role))
        .filter((role) => !canonicalRoles.includes(role));
    if (legacyRoles.length) {
        log(`non-standard user roles found and kept so startup succeeds: ${legacyRoles.join(", ")}. Migrate these accounts to a standard role.`);
    }
    const allowedRoles = [...new Set([...canonicalRoles, ...legacyRoles])];
    const roleList = allowedRoles
        .map((role) => "'" + role.replace(/'/g, "''") + "'")
        .join(", ");

    const superAdminCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM public.users WHERE role = 'super_admin'",
    );
    if (superAdminCount.rows[0].count > 1) {
        throw new Error("Only one super_admin account is supported. Remove duplicate super-admin rows before startup.");
    }
    const superAdmin2Count = await pool.query(
        "SELECT COUNT(*)::int AS count FROM public.users WHERE role = 'super_admin2'",
    );
    if (superAdmin2Count.rows[0].count > 1) {
        throw new Error("Only one super_admin2 account is supported for Market Delivery. Resolve duplicate accounts before startup.");
    }

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_super_admin
            ON public.users (role)
            WHERE role = 'super_admin';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_super_admin2
            ON public.users (role)
            WHERE role = 'super_admin2';

        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE public.users
            ADD CONSTRAINT users_role_check
            CHECK (role IN (${roleList}));
    `);
}

async function seedSuperAdmin() {
    // This repository is Market Delivery. Its privileged account has a
    // separate role and environment namespace from Food Delivery's super_admin.
    const email = normalizeEmail(process.env.MARKET_SUPER_ADMIN_EMAIL);
    const password = process.env.MARKET_SUPER_ADMIN_PASSWORD;
    if (!email && !password) return;
    if (!email || !password) throw new Error("MARKET_SUPER_ADMIN_EMAIL and MARKET_SUPER_ADMIN_PASSWORD must both be set to create the Market Delivery super admin.");
    if (!isValidEmail(email)) throw new Error("MARKET_SUPER_ADMIN_EMAIL is not a valid email address.");
    if (password.length < 16) throw new Error("MARKET_SUPER_ADMIN_PASSWORD must be at least 16 characters.");
    const forcePasswordReset = String(process.env.MARKET_SUPER_ADMIN_FORCE_PASSWORD_RESET || "").toLowerCase() === "true";

    const currentMarketSuperAdmin = await pool.query(
        "SELECT id, email FROM public.users WHERE role = 'super_admin2' LIMIT 1",
    );
    if (currentMarketSuperAdmin.rows.length && normalizeEmail(currentMarketSuperAdmin.rows[0].email) !== email) {
        log("a Market Delivery super_admin2 account already exists with a different email than MARKET_SUPER_ADMIN_EMAIL; leaving it unchanged.");
        return;
    }

    const existing = await pool.query(
        "SELECT id, role FROM public.users WHERE email = $1 LIMIT 1",
        [email],
    );
    if (existing.rows.length) {
        if (existing.rows[0].role !== "super_admin2") {
            throw new Error("MARKET_SUPER_ADMIN_EMAIL already belongs to a different role. No role was changed.");
        }
        if (forcePasswordReset) {
            const hash = await bcrypt.hash(password, 12);
            await pool.query(
                `UPDATE public.users
                 SET password_hash = $1, must_change_password = TRUE,
                     password_changed_at = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND role = 'super_admin2'`,
                [hash, existing.rows[0].id],
            );
            log("Market Delivery super admin password rotated and marked for mandatory change. Remove MARKET_SUPER_ADMIN_FORCE_PASSWORD_RESET now.");
        } else {
            log("Market Delivery super_admin2 already exists; leaving its credentials unchanged.");
        }
        return;
    }

    await pool.query("SELECT setval(pg_get_serial_sequence('public.users', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM public.users), 1), 1), TRUE)");
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
        `INSERT INTO public.users (first_name,last_name,email,phone,password_hash,role,is_active,must_change_password)
         VALUES ($1,$2,$3,$4,$5,'super_admin2',TRUE,TRUE) RETURNING id`,
        [
            String(process.env.MARKET_SUPER_ADMIN_FIRST_NAME || "Market").trim().slice(0, 100),
            String(process.env.MARKET_SUPER_ADMIN_LAST_NAME || "Super Admin 2").trim().slice(0, 100),
            email,
            process.env.MARKET_SUPER_ADMIN_PHONE ? String(process.env.MARKET_SUPER_ADMIN_PHONE).trim().slice(0, 30) : null,
            hash,
        ],
    );
    log(`Market Delivery super_admin2 account created (user ID ${result.rows[0].id}). Remove MARKET_SUPER_ADMIN_PASSWORD after successful creation.`);
}

async function initializeDatabase() {
    await waitForDatabase();
    await ensureSchema();
    await ensureFoodImageSchema();
    await ensureAdminSupportSchema();
    await ensureRiderProfileSchema();
    await ensurePasswordResetSchema();
    await ensureGooglePasswordSetupSchema();
    await ensureOrderLocationSchema();
    await ensureMpesaPaymentSchema();
    await ensureRestaurantNotificationSchema();
    await ensureRiderNotificationSchema();
    await ensureDeletedAccountsSchema();
    await ensureSuperAdminRoleSchema();
    await seedAdmin();
    await seedSuperAdmin();
}

module.exports = {
    initializeDatabase,
    prepareSchemaSql,
    resolveSchemaPath,
    ensureSuperAdminRoleSchema,
    seedSuperAdmin,
};
