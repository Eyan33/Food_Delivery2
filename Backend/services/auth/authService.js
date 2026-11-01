const bcrypt = require("bcrypt");
const crypto = require("crypto");

const pool = require('../../config/database');
const generateToken = require("../../utils/auth/generateToken");

const {
    normalizeEmail,
    isValidEmail,
    isValidPassword,
    isPrivilegedRole,
    isValidPasswordForRole,
    passwordRequirementMessage,
    isValidName,
    isValidPhone
} = require("../../utils/auth/validators");


/*
 * A real bcrypt hash to compare against when no account matches the email,
 * so unknown and known emails take about the same time to reject.
 */
let dummyHashPromise = null;

function getDummyPasswordHash() {
    if (!dummyHashPromise) {
        dummyHashPromise = bcrypt.hash(
            crypto.randomBytes(24).toString("hex"),
            12
        );
    }

    return dummyHashPromise;
}


async function registerUser({
    first_name,
    last_name,
    email,
    phone,
    password
}) {
    const firstName = String(first_name || "").trim();
    const lastName = String(last_name || "").trim();
    const normalizedEmail = normalizeEmail(email);

    const normalizedPhone = phone
        ? String(phone).trim()
        : null;


    // Validate first name
    if (!isValidName(firstName)) {
        throw new Error(
            "First name must contain at least 2 characters"
        );
    }


    // Validate last name
    if (!isValidName(lastName)) {
        throw new Error(
            "Last name must contain at least 2 characters"
        );
    }


    // Validate email
    if (!isValidEmail(normalizedEmail)) {
        throw new Error(
            "Please provide a valid email address"
        );
    }


    // Validate phone
    if (!isValidPhone(normalizedPhone)) {
        throw new Error(
            "Please provide a valid phone number"
        );
    }


    // Validate password
    if (!isValidPassword(password)) {
        throw new Error(
            "Password must contain at least 8 characters"
        );
    }


    /*
     * Public registration always creates a customer.
     *
     * Admin and restaurant accounts should not be created
     * by simply sending a different role in the request.
     */
    const role = "customer";


    /*
     * Check whether email or phone already exists.
     *
     * Explicit VARCHAR casting on $2 prevents PostgreSQL
     * from being unable to determine the parameter type when
     * phone is null.
     */
    const existingUser = await pool.query(
        `
        SELECT id
        FROM users
        WHERE email = $1
           OR ($2::VARCHAR IS NOT NULL AND phone = $2::VARCHAR)
        LIMIT 1
        `,
        [
            normalizedEmail,
            normalizedPhone
        ]
    );


    if (existingUser.rows.length > 0) {
        throw new Error(
            "An account with this email or phone already exists"
        );
    }


    /*
     * Hash the password before storing it.
     */
    const passwordHash = await bcrypt.hash(
        password,
        12
    );


    /*
     * Create the user.
     */
    const result = await pool.query(
        `
        INSERT INTO users (
            first_name,
            last_name,
            email,
            phone,
            password_hash,
            role
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
            id,
            first_name,
            last_name,
            email,
            phone,
            role,
            is_active,
            must_change_password,
            created_at,
            updated_at
        `,
        [
            firstName,
            lastName,
            normalizedEmail,
            normalizedPhone,
            passwordHash,
            role
        ]
    );


    const user = result.rows[0];


    /*
     * Generate JWT.
     */
    const token = generateToken(user);


    return {
        user,
        token
    };
}


async function loginUser({
    email,
    password
}) {
    const normalizedEmail = normalizeEmail(email);


    if (!isValidEmail(normalizedEmail)) {
        throw new Error(
            "Please provide a valid email address"
        );
    }


    if (!password) {
        throw new Error(
            "Password is required"
        );
    }

    if (typeof password !== "string") {
        throw new Error(
            "Invalid email or password"
        );
    }


    /*
     * Find user by email.
     */
    const result = await pool.query(
        `
        SELECT
            id,
            first_name,
            last_name,
            email,
            phone,
            password_hash,
            role,
            is_active,
            must_change_password,
            created_at,
            updated_at
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [normalizedEmail]
    );


    const user = result.rows[0] || null;


    /*
     * Always run one bcrypt comparison, even when the email is unknown, so
     * response time does not reveal which emails have accounts.
     */
    const passwordMatches = await bcrypt.compare(
        password,
        user ? user.password_hash : await getDummyPasswordHash()
    );


    if (!user || !passwordMatches) {
        throw new Error(
            "Invalid email or password"
        );
    }


    /*
     * Only someone who proved they know the password learns the account is
     * deactivated; otherwise this would reveal which emails exist.
     */
    if (!user.is_active) {
        throw new Error(
            "This account has been deactivated"
        );
    }


    /*
     * Never return the password hash.
     */
    delete user.password_hash;


    /*
     * Generate JWT.
     */
    const token = generateToken(user);


    return {
        user,
        token
    };
}


async function getCurrentUser(userId) {
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
            created_at,
            updated_at
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [userId]
    );


    if (result.rows.length === 0) {
        throw new Error(
            "User not found"
        );
    }


    const user = result.rows[0];


    if (!user.is_active) {
        throw new Error(
            "This account has been deactivated"
        );
    }


    return user;
}


async function updateCurrentUser(userId, input = {}) {
    const allowedFields = ["first_name", "last_name", "email", "phone", "current_password"];

    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Request body must be a JSON object");
    }

    for (const field of Object.keys(input)) {
        if (!allowedFields.includes(field)) {
            throw new Error(`Field "${field}" is not allowed`);
        }
    }

    /*
     * Admin and super-admin email addresses are the target of password
     * resets, so changing one requires the current password. Otherwise a
     * briefly stolen session could be turned into permanent account takeover.
     */
    if (Object.prototype.hasOwnProperty.call(input, "email")) {
        const current = await pool.query(
            "SELECT role, email, password_hash FROM users WHERE id = $1 LIMIT 1",
            [userId]
        );

        if (!current.rows.length) {
            throw new Error("User not found");
        }

        const { role, email: currentEmail, password_hash: currentHash } = current.rows[0];

        if (
            isPrivilegedRole(role) &&
            normalizeEmail(input.email) !== normalizeEmail(currentEmail)
        ) {
            if (typeof input.current_password !== "string" || !input.current_password) {
                throw new Error("Enter your current password to change your email address");
            }

            const matches = await bcrypt.compare(input.current_password, currentHash);

            if (!matches) {
                throw new Error("Your current password is incorrect");
            }
        }
    }

    const assignments = [];
    const values = [];

    const addField = (column, value) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
    };

    if (Object.prototype.hasOwnProperty.call(input, "first_name")) {
        const value = String(input.first_name || "").trim();
        if (!isValidName(value)) {
            throw new Error("First name must contain at least 2 characters");
        }
        addField("first_name", value);
    }

    if (Object.prototype.hasOwnProperty.call(input, "last_name")) {
        const value = String(input.last_name || "").trim();
        if (!isValidName(value)) {
            throw new Error("Last name must contain at least 2 characters");
        }
        addField("last_name", value);
    }

    if (Object.prototype.hasOwnProperty.call(input, "email")) {
        const value = normalizeEmail(input.email);
        if (!isValidEmail(value)) {
            throw new Error("Please provide a valid email address");
        }
        addField("email", value);
    }

    if (Object.prototype.hasOwnProperty.call(input, "phone")) {
        const value = input.phone == null ? "" : String(input.phone).trim();

        if (value && !isValidPhone(value)) {
            throw new Error("Please provide a valid phone number");
        }

        addField("phone", value || null);
    }

    if (assignments.length === 0) {
        throw new Error("Provide at least one profile field to update");
    }

    values.push(userId);

    const result = await pool.query(
        `UPDATE users
         SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${values.length}
         RETURNING id, first_name, last_name, email, phone, role,
                   is_active, created_at, updated_at`,
        values
    );

    if (!result.rows.length) {
        throw new Error("User not found");
    }

    return result.rows[0];
}

async function setGoogleAccountPassword(userId, newPassword) {
    if (!isValidPassword(newPassword)) throw new Error("Password must contain at least 8 characters");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(`UPDATE users SET password_hash = $1, google_password_setup_pending = FALSE, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND google_password_setup_pending = TRUE RETURNING id`, [passwordHash, userId]);
    if (!result.rows.length) throw new Error("Password setup is not pending for this account");
    return true;
}

async function finishGoogleFirstSession(userId) {
    await pool.query("UPDATE users SET google_password_setup_pending = FALSE WHERE id = $1 AND google_password_setup_pending = TRUE", [userId]);
}

async function changeCurrentUserPassword(userId, currentPassword, newPassword) {
    if (typeof currentPassword !== "string" || !currentPassword) {
        throw new Error("Current password is required");
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
        throw new Error("New password must contain at least 8 characters");
    }

    if (currentPassword === newPassword) {
        throw new Error("Your new password must be different from your current password");
    }

    const result = await pool.query(
        `SELECT id, role, password_hash FROM users WHERE id = $1 LIMIT 1`,
        [userId]
    );

    if (!result.rows.length) {
        throw new Error("User not found");
    }

    const { role } = result.rows[0];

    if (!isValidPasswordForRole(newPassword, role)) {
        throw new Error(passwordRequirementMessage(role));
    }

    const matches = await bcrypt.compare(
        currentPassword,
        result.rows[0].password_hash
    );

    if (!matches) {
        throw new Error("Your current password is incorrect");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const privileged = isPrivilegedRole(role);

    /*
     * For admin and super-admin accounts every session issued before this
     * moment stops working, so changing a password also logs out a thief.
     * The caller gets a fresh token below so their own session continues.
     */
    await pool.query(
        `UPDATE users
         SET password_hash = $1, password_changed_at = CURRENT_TIMESTAMP, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP,
             tokens_valid_after = CASE WHEN $3::boolean THEN $4::timestamptz ELSE tokens_valid_after END
         WHERE id = $2`,
        [passwordHash, userId, privileged, new Date()]
    );
    await pool.query(
        `INSERT INTO admin_audit_logs (admin_id, admin_role, action, resource, status_code)
         SELECT id, role, 'PASSWORD', '/auth/me/password', 200
         FROM users WHERE id = $1 AND role IN ('admin', 'super_admin2')`,
        [userId]
    );

    return privileged
        ? { token: generateToken({ id: result.rows[0].id, role }) }
        : {};
}


function hashResetToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function createPasswordResetToken(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
        throw new Error("Please provide a valid email address");
    }

    const result = await pool.query(
        "SELECT id, email FROM users WHERE email = $1 AND is_active = TRUE LIMIT 1",
        [normalizedEmail]
    );
    if (!result.rows.length) {
        return null;
    }

    const user = result.rows[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(rawToken);

    await pool.query(
        `DELETE FROM password_reset_tokens
         WHERE user_id = $1 OR expires_at <= CURRENT_TIMESTAMP`,
        [user.id]
    );
    await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [user.id, tokenHash]
    );

    return { token: rawToken, email: user.email };
}

async function resetPasswordWithToken(token, newPassword) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
        throw new Error("This password-reset link is invalid or has expired");
    }
    if (!isValidPassword(newPassword)) {
        throw new Error("Password must contain at least 8 characters");
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const tokenHash = hashResetToken(token);
        const found = await client.query(
            `SELECT prt.user_id, u.role
             FROM password_reset_tokens prt
             JOIN users u ON u.id = prt.user_id
             WHERE prt.token_hash = $1
               AND prt.expires_at > CURRENT_TIMESTAMP
               AND u.is_active = TRUE
             FOR UPDATE OF prt`,
            [tokenHash]
        );

        if (!found.rows.length) {
            throw new Error("This password-reset link is invalid or has expired");
        }

        const userId = found.rows[0].user_id;

        if (!isValidPasswordForRole(newPassword, found.rows[0].role)) {
            throw new Error(passwordRequirementMessage(found.rows[0].role));
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        // A reset ends every existing session for the account.
        await client.query(
            `UPDATE users
             SET password_hash = $1, password_changed_at = CURRENT_TIMESTAMP,
                 must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP,
                 tokens_valid_after = $3::timestamptz
             WHERE id = $2`,
            [passwordHash, userId, new Date()]
        );
        await client.query(
            `INSERT INTO admin_audit_logs (admin_id, admin_role, action, resource, status_code)
             SELECT id, role, 'RESET', '/auth/password-reset', 200
             FROM users WHERE id = $1 AND role IN ('admin', 'super_admin2')`,
            [userId]
        );
        await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function deletePasswordResetToken(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
        return;
    }
    await pool.query(
        "DELETE FROM password_reset_tokens WHERE token_hash = $1",
        [hashResetToken(token)]
    );
}



async function loginWithGoogleCredential(credential) {
    if (typeof credential !== "string" || credential.length < 20 || credential.length > 10000) throw new Error("A valid Google credential is required");
    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) throw new Error("Google sign-in is not configured on the server");
    const response = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Google could not verify your account. Please try again.");
    const claims = await response.json();
    if (claims.aud !== clientId || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || !claims.sub ||
        !(claims.email_verified === true || claims.email_verified === "true") || !claims.email) throw new Error("Google returned an invalid or unverified identity");
    const email = normalizeEmail(claims.email);
    if (!isValidEmail(email)) throw new Error("Google did not provide a valid email address");
    const selectByEmail = () => pool.query(`SELECT id, first_name, last_name, email, phone, role, is_active, must_change_password, google_password_setup_pending, created_at, updated_at FROM users WHERE email = $1 LIMIT 1`, [email]);
    const existing = await selectByEmail();
    let user;
    let newGoogleAccount = false;
    if (existing.rows.length) {
        user = existing.rows[0];
        if (user.role === "super_admin2") {
            throw new Error("Super-admin accounts must sign in with their email and password.");
        }
        if (!user.is_active) throw new Error("This account has been deactivated");
        newGoogleAccount = user.google_password_setup_pending === true;
    } else {
        const fullName = String(claims.name || "").trim();
        const parts = fullName.split(/\s+/).filter(Boolean);
        const firstName = String(claims.given_name || parts[0] || "Google").trim().slice(0, 100) || "Google";
        const lastName = String(claims.family_name || parts.slice(1).join(" ") || "User").trim().slice(0, 100) || "User";
        const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(48).toString("hex"), 12);
        try {
            const created = await pool.query(`INSERT INTO users (first_name, last_name, email, phone, password_hash, role, google_password_setup_pending)
                VALUES ($1, $2, $3, NULL, $4, 'customer', TRUE)
                RETURNING id, first_name, last_name, email, phone, role, is_active, must_change_password, created_at, updated_at`, [firstName, lastName, email, unusablePasswordHash]);
            user = created.rows[0];
            newGoogleAccount = true;
        } catch (error) {
            if (error.code !== "23505") throw error;
            const retry = await selectByEmail();
            if (!retry.rows.length) throw error;
            user = retry.rows[0];
            if (!user.is_active) throw new Error("This account has been deactivated");
        }
    }
    return { user, token: generateToken(user), newGoogleAccount };
}

module.exports = {
    loginWithGoogleCredential,
    setGoogleAccountPassword,
    finishGoogleFirstSession,
    registerUser,
    loginUser,
    getCurrentUser,
    updateCurrentUser,
    changeCurrentUserPassword,
    createPasswordResetToken,
    resetPasswordWithToken,
    deletePasswordResetToken
};