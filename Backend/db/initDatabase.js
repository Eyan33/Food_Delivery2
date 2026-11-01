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
    const system = String(process.env.PLATFORM_SYSTEM || "").trim().toLowerCase();
    const adminRole = system === "market" ? "admin2" : system === "food" ? "admin1" : "admin";
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

    if (password.length < 12) {
        throw new Error("ADMIN_PASSWORD must be at least 12 characters");
    }

    const existing = await pool.query(
        "SELECT id, role FROM users WHERE email = $1 LIMIT 1",
        [email],
    );

    if (existing.rows.length > 0) {
        if (existing.rows[0].role !== adminRole) {
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
        VALUES ($1, $2, $3, $4, $5, '${adminRole}')
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
            created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

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
    // Keep canonical roles and any legacy role values already present in the
    // database. This avoids making startup fail when older deployments used
    // a role value that is not in the current canonical list. Existing rows
    // are not rewritten; new unknown role values remain restricted.
    const canonicalRoles = [
        "customer", "restaurant", "rider", "admin", "super_admin",
        "customer1", "restaurant1", "rider1", "admin1", "super_admin1",
        "customer2", "market_owner2", "rider2", "admin2", "super_admin2",
    ];
    const existingRoles = await pool.query(
        "SELECT DISTINCT role FROM public.users WHERE role IS NOT NULL",
    );
    const allowedRoles = [...new Set([
        ...canonicalRoles,
        ...existingRoles.rows.map((row) => String(row.role)),
    ])];
    const roleList = allowedRoles
        .map((role) => "'" + role.replace(/'/g, "''") + "'")
        .join(", ");

    await pool.query(`
        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE public.users
            ADD CONSTRAINT users_role_check
            CHECK (role IN (${roleList}));
    `);
}

async function seedSuperAdmin() {
    // The legacy global seed account must not be created in either isolated
    // deployment. Project-specific Super Admins are provisioned separately.
    if (["food", "market"].includes(String(process.env.PLATFORM_SYSTEM || "").trim().toLowerCase())) {
        log("project-specific Super Admin provisioning is managed separately; skipping legacy global seed.");
        return;
    }

    const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!email && !password) return;
    if (!email || !password) {
        throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must both be set to create the super admin.");
    }
    if (!isValidEmail(email)) throw new Error("SUPER_ADMIN_EMAIL is not a valid email address.");
    if (password.length < 16) throw new Error("SUPER_ADMIN_PASSWORD must be at least 16 characters.");

    const existing = await pool.query(
        "SELECT id, role FROM public.users WHERE email = $1 LIMIT 1",
        [email]
    );

    if (existing.rows.length) {
        if (existing.rows[0].role !== "super_admin") {
            throw new Error("SUPER_ADMIN_EMAIL already belongs to a non-super-admin account. No role was changed.");
        }

        const otherSuperAdmin = await pool.query(
            "SELECT id FROM public.users WHERE role = 'super_admin' AND id <> $1 LIMIT 1",
            [existing.rows[0].id]
        );
        if (otherSuperAdmin.rows.length) {
            throw new Error("More than one super_admin account exists. Resolve the duplicate accounts before starting the service.");
        }

        log("super admin account already exists; leaving it unchanged.");
        return;
    }

    // The platform must have exactly one super admin. Never silently promote
    // an existing account or create a second super-admin identity.
    const existingSuperAdmin = await pool.query(
        "SELECT id FROM public.users WHERE role = 'super_admin' LIMIT 1"
    );
    if (existingSuperAdmin.rows.length) {
        throw new Error("A super_admin account already exists with a different email. No second super admin was created.");
    }

    // Repair a potentially stale users.id sequence before inserting, so the
    // initial super-admin ID is higher than every existing account ID.
    await pool.query(
        `SELECT setval(
            pg_get_serial_sequence('public.users', 'id'),
            GREATEST(COALESCE((SELECT MAX(id) FROM public.users), 1), 1),
            TRUE
        )`
    );

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
        `INSERT INTO public.users (first_name, last_name, email, phone, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, $5, 'super_admin', TRUE)
         RETURNING id`,
        [
            String(process.env.SUPER_ADMIN_FIRST_NAME || "Platform").trim().slice(0, 100),
            String(process.env.SUPER_ADMIN_LAST_NAME || "Super Admin").trim().slice(0, 100),
            email,
            process.env.SUPER_ADMIN_PHONE ? String(process.env.SUPER_ADMIN_PHONE).trim().slice(0, 30) : null,
            passwordHash
        ]
    );
    log(`super admin account created (user ID ${result.rows[0].id}). Remove SUPER_ADMIN_PASSWORD from the environment after successful creation.`);
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
};
