"use strict";

/*
 * Super admin / admin security checks. No real database: config/database is
 * replaced by an in-memory fake that answers the handful of queries these
 * modules run, and records every query so tests can inspect it.
 *
 * Run with:  npm test
 */

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = "test-secret-".padEnd(48, "x");
process.env.DATABASE_URL = "postgresql://nobody:nopass@127.0.0.1:1/nodb";
delete process.env.JWT_EXPIRES_IN;
delete process.env.JWT_ADMIN_EXPIRES_IN;

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

/* ---------- fake database ---------- */

const usersById = new Map();
const usersByEmail = new Map();
let calls = [];
let roleRows = [];
let superAdminCount = 0;
let superAdminRows = [];

function addUser(user) {
    const row = { tokens_valid_after: null, must_change_password: false, is_active: true, ...user };
    usersById.set(row.id, row);
    if (row.email) usersByEmail.set(row.email, row);
    return row;
}

const fakePool = {
    async query(sql, params = []) {
        const text = String(sql);
        calls.push({ sql: text, params });

        if (/tokens_valid_after\s+FROM users\s+WHERE id = \$1/.test(text)) {
            const user = usersById.get(Number(params[0]));
            return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
        }
        if (/SELECT id, role, password_hash FROM users/.test(text) ||
            /SELECT role, email, password_hash FROM users/.test(text)) {
            const user = usersById.get(Number(params[0]));
            return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
        }
        if (/FROM users\s+WHERE email = \$1\s+LIMIT 1/.test(text)) {
            const user = usersByEmail.get(params[0]);
            return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
        }
        if (/SELECT DISTINCT role FROM public\.users/.test(text)) {
            return { rows: roleRows, rowCount: roleRows.length };
        }
        if (/COUNT\(\*\)::int AS count FROM public\.users WHERE role IN \('super_admin', 'super_admin1'\)/.test(text)) {
            return { rows: [{ count: superAdminCount }], rowCount: 1 };
        }
        if (/COUNT\(\*\)::int AS count FROM public\.users WHERE role = 'super_admin'/.test(text)) {
            return { rows: [{ count: superAdminCount }], rowCount: 1 };
        }
        if (/FROM public\.users WHERE role = 'super_admin' LIMIT 1/.test(text)) {
            return { rows: superAdminRows, rowCount: superAdminRows.length };
        }
        if (/INSERT INTO admin_audit_logs/.test(text)) {
            return { rows: [{ id: 987 }], rowCount: 1 };
        }
        if (/UPDATE admin_audit_logs SET status_code/.test(text)) {
            return { rows: [], rowCount: 1 };
        }
        if (/^\s*UPDATE users/.test(text)) {
            return { rows: [{ id: 1, role: "admin" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    },
    async connect() {
        throw new Error("fake pool: connect() is not used by these tests");
    },
    async end() {},
};

const databasePath = require.resolve("../config/database");
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: fakePool,
};

const authenticateToken = require("../middleware/auth/authMiddleware");
const requireSuperAdmin = require("../middleware/auth/superAdminMiddleware");
const authorizeRoles = require("../middleware/auth/roleMiddleware");
const auditAdminAction = require("../middleware/adminAuditMiddleware");
const { redact } = auditAdminAction;
const generateToken = require("../utils/auth/generateToken");
const validators = require("../utils/auth/validators");
const authService = require("../services/auth/authService");
const adminService = require("../services/admin/adminService");
const adminOperationsService = require("../services/admin/adminOperationsService");
const { ensureSuperAdminRoleSchema, seedSuperAdmin } = require("../db/initDatabase");
const { buildContentSecurityPolicy } = require("../middleware/security/securityHeaders");

test.beforeEach(() => {
    calls = [];
    roleRows = [];
    superAdminCount = 0;
    superAdminRows = [];
});

/* ---------- helpers ---------- */

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        on() {},
    };
}

function tokenFor(id, role, issuedAtSecondsAgo = 0) {
    const iat = Math.floor(Date.now() / 1000) - issuedAtSecondsAgo;
    return jwt.sign({ id, role, iat }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function makeRequest({ method = "GET", baseUrl, path, query = "", token }) {
    return {
        method,
        baseUrl,
        path,
        originalUrl: `${baseUrl}${path}${query}`,
        url: `${path}${query}`,
        headers: { authorization: `Bearer ${token}` },
    };
}

async function authenticate(req) {
    const res = mockResponse();
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
}

async function quietly(fn) {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
}

/* ---------- forced password change gate ---------- */

test("a query string cannot bypass the forced password change", async () => {
    addUser({ id: 10, role: "admin", email: "temp@example.com", must_change_password: true });
    const token = tokenFor(10, "admin");

    for (const query of ["?x=/auth/me/password", "?next=/api/auth/me/password", "?%2Fauth%2Fme%2Fpassword"]) {
        const { res, nextCalled } = await authenticate(
            makeRequest({ baseUrl: "/api/admins", path: "/settings", query, token }),
        );
        assert.equal(nextCalled, false, query);
        assert.equal(res.statusCode, 403, query);
        assert.equal(res.body.code, "PASSWORD_CHANGE_REQUIRED", query);
    }
});

test("a path that merely ends in /auth/me/password is not the password route", async () => {
    addUser({ id: 10, role: "admin", email: "temp@example.com", must_change_password: true });
    const { res, nextCalled } = await authenticate(
        makeRequest({ method: "PATCH", baseUrl: "/api/admins", path: "/x/auth/me/password", token: tokenFor(10, "admin") }),
    );
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test("only PATCH /api/auth/me/password is allowed while a password change is required", async () => {
    addUser({ id: 10, role: "admin", email: "temp@example.com", must_change_password: true });
    const token = tokenFor(10, "admin");

    const allowed = await authenticate(makeRequest({ method: "PATCH", baseUrl: "/api/auth", path: "/me/password", token }));
    assert.equal(allowed.nextCalled, true);

    const withSlash = await authenticate(makeRequest({ method: "PATCH", baseUrl: "/api/auth", path: "/me/password/", token }));
    assert.equal(withSlash.nextCalled, true, "trailing slash routes to the same handler");

    const wrongMethod = await authenticate(makeRequest({ method: "GET", baseUrl: "/api/auth", path: "/me/password", token }));
    assert.equal(wrongMethod.nextCalled, false);
    assert.equal(wrongMethod.res.statusCode, 403);

    const profile = await authenticate(makeRequest({ method: "GET", baseUrl: "/api/auth", path: "/me", token }));
    assert.equal(profile.nextCalled, false);
});

test("a user who does not need to change a password is not affected by the gate", async () => {
    addUser({ id: 11, role: "admin", email: "ok@example.com" });
    const req = makeRequest({ baseUrl: "/api/admins", path: "/settings", token: tokenFor(11, "admin") });
    const { nextCalled } = await authenticate(req);
    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 11);
});

/* ---------- session invalidation ---------- */

test("tokens issued before tokens_valid_after are rejected; newer ones work", async () => {
    addUser({ id: 12, role: "admin", email: "rotated@example.com", tokens_valid_after: new Date() });

    const stale = await authenticate(
        makeRequest({ baseUrl: "/api/admins", path: "/me", token: tokenFor(12, "admin", 3600) }),
    );
    assert.equal(stale.nextCalled, false);
    assert.equal(stale.res.statusCode, 401);

    const req = makeRequest({ baseUrl: "/api/admins", path: "/me", token: tokenFor(12, "admin", 0) });
    const fresh = await authenticate(req);
    assert.equal(fresh.nextCalled, true);
    assert.equal("tokens_valid_after" in req.user, false, "internal column is not exposed on req.user");
});

/* ---------- role middleware ---------- */

test("requireSuperAdmin: 401 without a user, 403 for admins, passes for the super admin", () => {
    const run = (user) => {
        const res = mockResponse();
        let nextCalled = false;
        requireSuperAdmin({ user }, res, () => { nextCalled = true; });
        return { res, nextCalled };
    };

    assert.equal(run(undefined).res.statusCode, 401);
    assert.equal(run({ role: "admin" }).res.statusCode, 403);
    assert.equal(run({ role: "customer" }).res.statusCode, 403);
    assert.equal(run({ role: "super_admin" }).nextCalled, true);
    assert.equal(run({ role: "super_admin2" }).nextCalled, true);
});

test("authorizeRoles: super admin inherits admin routes only", () => {
    const run = (allowed, role) => {
        const res = mockResponse();
        let nextCalled = false;
        authorizeRoles(...allowed)({ user: { role }, method: "GET" }, res, () => { nextCalled = true; });
        return { res, nextCalled };
    };

    assert.equal(run(["admin"], "super_admin").nextCalled, true);
    assert.equal(run(["admin"], "super_admin2").nextCalled, true);
    assert.equal(run(["customer"], "super_admin").res.statusCode, 403);
    assert.equal(run(["restaurant"], "super_admin").res.statusCode, 403);
    assert.equal(run(["admin"], "customer").res.statusCode, 403);
    assert.equal(run(["admin"], "admin").nextCalled, true);
});

/* ---------- tokens and password policy ---------- */

test("admin and super-admin tokens expire sooner than other roles", () => {
    const lifetime = (role) => {
        const decoded = jwt.decode(generateToken({ id: 1, role }));
        return decoded.exp - decoded.iat;
    };

    assert.equal(lifetime("admin"), 12 * 3600);
    assert.equal(lifetime("super_admin"), 12 * 3600);
    assert.equal(lifetime("super_admin2"), 12 * 3600);
    assert.equal(lifetime("customer"), 7 * 24 * 3600);
    assert.equal(lifetime("restaurant"), 7 * 24 * 3600);
});

test("password length requirements depend on the role", () => {
    assert.equal(validators.minPasswordLengthForRole("customer"), 8);
    assert.equal(validators.minPasswordLengthForRole("rider"), 8);
    assert.equal(validators.minPasswordLengthForRole("admin"), 8);
    assert.equal(validators.minPasswordLengthForRole("super_admin"), 16);
    assert.equal(validators.minPasswordLengthForRole("super_admin2"), 16);

    assert.equal(validators.isValidPasswordForRole("12345678", "customer"), true);
    assert.equal(validators.isValidPasswordForRole("12345678", "admin"), true);
    assert.equal(validators.isValidPasswordForRole("123456789", "admin"), true);
    assert.equal(validators.isValidPasswordForRole("123456789012", "super_admin"), false);
    assert.equal(validators.isValidPasswordForRole("1234567890123456", "super_admin"), true);
    assert.equal(validators.isValidPasswordForRole("1234567890123456", "super_admin2"), true);
    assert.equal(validators.isValidPasswordForRole(undefined, "customer"), false);
});

test("admins created by the super admin reject passwords shorter than 8 characters", async () => {
    await assert.rejects(
        adminService.createAdmin({
            first_name: "Jane", last_name: "Doe", email: "jane@example.com", password: "pass123",
        }),
        /at least 8 characters/,
    );
    assert.equal(calls.length, 0, "rejected before touching the database");
});

test("changing an admin password: role-based length, fresh token, sessions invalidated", async () => {
    const oldHash = await bcrypt.hash("old-password-123456", 4);
    addUser({ id: 20, role: "admin", email: "a20@example.com", password_hash: oldHash });
    addUser({ id: 21, role: "super_admin", email: "s21@example.com", password_hash: oldHash });
    addUser({ id: 22, role: "customer", email: "c22@example.com", password_hash: oldHash });

    await assert.rejects(authService.changeCurrentUserPassword(20, "old-password-123456", "pass123"), /at least 8/);
    await assert.rejects(authService.changeCurrentUserPassword(21, "old-password-123456", "short-pass-1"), /at least 16/);

    calls = [];
    const adminResult = await authService.changeCurrentUserPassword(20, "old-password-123456", "short-pass-1");
    assert.ok(adminResult.token, "admin gets a fresh token");
    assert.equal(jwt.verify(adminResult.token, process.env.JWT_SECRET).role, "admin");
    const adminUpdate = calls.find((call) => /UPDATE users/.test(call.sql));
    assert.equal(adminUpdate.params[2], true, "privileged account invalidates older sessions");
    assert.ok(adminUpdate.params[3] instanceof Date);

    calls = [];
    const customerResult = await authService.changeCurrentUserPassword(22, "old-password-123456", "newpass12");
    assert.deepEqual(customerResult, {}, "customers keep the previous behaviour");
    assert.equal(calls.find((call) => /UPDATE users/.test(call.sql)).params[2], false);
});

/* ---------- email change needs the password (admin accounts) ---------- */

test("admin email change requires the current password; customers are unaffected", async () => {
    const hash = await bcrypt.hash("current-password-1234", 4);
    addUser({ id: 30, role: "super_admin", email: "owner@example.com", password_hash: hash });
    addUser({ id: 31, role: "customer", email: "cust@example.com", password_hash: hash });

    await assert.rejects(authService.updateCurrentUser(30, { email: "new@example.com" }), /current password/i);
    await assert.rejects(
        authService.updateCurrentUser(30, { email: "new@example.com", current_password: "wrong" }),
        /incorrect/i,
    );
    const updated = await authService.updateCurrentUser(30, {
        email: "new@example.com", current_password: "current-password-1234",
    });
    assert.ok(updated);

    // Same email (or other fields) needs no password.
    await authService.updateCurrentUser(30, { first_name: "Owner", email: "OWNER@example.com" });

    // Customers can still change their email as before.
    await authService.updateCurrentUser(31, { email: "other@example.com" });
});

/* ---------- login does not reveal which emails exist ---------- */

test("login: unknown email and wrong password are indistinguishable and both compare a hash", async () => {
    const hash = await bcrypt.hash("correct-password-123", 4);
    addUser({ id: 40, role: "admin", email: "inactive@example.com", password_hash: hash, is_active: false });
    addUser({ id: 41, role: "admin", email: "active@example.com", password_hash: hash });

    const originalCompare = bcrypt.compare;
    let compareCalls = 0;
    bcrypt.compare = (...args) => { compareCalls += 1; return originalCompare(...args); };

    try {
        await assert.rejects(authService.loginUser({ email: "nobody@example.com", password: "whatever-123" }), /Invalid email or password/);
        assert.equal(compareCalls, 1, "a hash is compared even when the email is unknown");

        await assert.rejects(authService.loginUser({ email: "inactive@example.com", password: "wrong-password" }), /Invalid email or password/);
        await assert.rejects(authService.loginUser({ email: "active@example.com", password: "wrong-password" }), /Invalid email or password/);

        await assert.rejects(authService.loginUser({ email: "inactive@example.com", password: "correct-password-123" }), /deactivated/);

        const ok = await authService.loginUser({ email: "active@example.com", password: "correct-password-123" });
        assert.equal(ok.user.id, 41);
        assert.equal("password_hash" in ok.user, false);
    } finally {
        bcrypt.compare = originalCompare;
    }
});

/* ---------- admin service ---------- */

test("updateAdmin only edits regular admins and ends their sessions on credential changes", async () => {
    await adminService.updateAdmin(7, { password: "a-brand-new-password" });
    const withPassword = calls.find((call) => /UPDATE users/.test(call.sql));
    assert.match(withPassword.sql, /role = 'admin'/);
    assert.doesNotMatch(withPassword.sql, /super_admin/);
    assert.match(withPassword.sql, /tokens_valid_after/);

    calls = [];
    await adminService.updateAdmin(7, { phone: "0700000000" });
    const phoneOnly = calls.find((call) => /UPDATE users/.test(call.sql));
    assert.doesNotMatch(phoneOnly.sql, /tokens_valid_after/, "non-credential edits keep sessions");

    await assert.rejects(adminService.updateAdmin(7, { password: "pass123" }), /at least 8/);
});

/* ---------- database init ---------- */

test("startup does not crash when the super admin's email no longer matches the environment", async () => {
    superAdminRows = [{ id: 1, email: "renamed-owner@example.com" }];
    process.env.SUPER_ADMIN_EMAIL = "original-owner@example.com";
    process.env.SUPER_ADMIN_PASSWORD = "a-long-enough-password-1";

    try {
        await quietly(() => seedSuperAdmin());
    } finally {
        delete process.env.SUPER_ADMIN_EMAIL;
        delete process.env.SUPER_ADMIN_PASSWORD;
    }

    assert.equal(
        calls.some((call) => /INSERT INTO public\.users|UPDATE public\.users/.test(call.sql)),
        false,
        "the existing super admin is left untouched",
    );
});

test("startup migrates the known super_admin1 typo to the canonical single super_admin role", async () => {
    await quietly(() => ensureSuperAdminRoleSchema());

    const count = calls.find((call) => /role IN \('super_admin', 'super_admin1'\)/.test(call.sql));
    assert.ok(count, "both canonical and legacy super-admin rows are counted before migration");
    const migration = calls.find((call) => /UPDATE public\.users SET role = 'super_admin' WHERE role = 'super_admin1'/.test(call.sql));
    assert.ok(migration, "the known legacy role is normalized in the database");
    assert.ok(calls.indexOf(count) < calls.indexOf(migration), "duplicate check happens before role migration");
});

test("role constraint allows canonical roles and existing legacy roles, nothing speculative", async () => {
    roleRows = [{ role: "customer" }, { role: "legacy_manager" }];
    await quietly(() => ensureSuperAdminRoleSchema());

    const alter = calls.find((call) => /ADD CONSTRAINT users_role_check/.test(call.sql));
    assert.ok(alter, "constraint is rebuilt");
    for (const role of ["customer", "restaurant", "rider", "admin", "super_admin", "legacy_manager"]) {
        assert.match(alter.sql, new RegExp(`'${role}'`), role);
    }
    for (const role of ["super_admin1", "super_admin2", "admin1", "admin2", "market_owner2"]) {
        assert.doesNotMatch(alter.sql, new RegExp(`'${role}'`), role);
    }
});

/* ---------- audit trail and CSP ---------- */

test("audit details redact secrets and keep what changed", () => {
    const result = redact({
        general: { platformName: "Food Co" },
        password: "hunter2",
        currentPassword: "hunter3",
        nested: { api_token: "abc", keep: 1 },
    });

    assert.equal(result.general.platformName, "Food Co");
    assert.equal(result.password, "[redacted]");
    assert.equal(result.currentPassword, "[redacted]");
    assert.equal(result.nested.api_token, "[redacted]");
    assert.equal(result.nested.keep, 1);
    assert.doesNotMatch(JSON.stringify(result), /hunter/);
});

test("CSP only allows the Leaflet path on unpkg.com, not the whole host", () => {
    const policy = buildContentSecurityPolicy(true);
    assert.match(policy, /https:\/\/unpkg\.com\/leaflet@1\.9\.4\//);
    assert.doesNotMatch(policy, /https:\/\/unpkg\.com(?=[\s;])/);
});


/* ---------- admin operations validation and audit durability ---------- */

test("platform transaction fee cannot exceed 100 percent", async () => {
    await assert.rejects(
        adminOperationsService.updateSettings({ payments: { transactionFee: 100.01 } }, 1),
        /between 0 and 100 percent/,
    );
});

test("numeric platform settings reject null and empty values", async () => {
    await assert.rejects(
        adminOperationsService.updateSettings({ platformFees: { deliveryFeePerKm: null } }, 1),
        /non-negative number/,
    );
    await assert.rejects(
        adminOperationsService.updateSettings({ payments: { transactionFee: "" } }, 1),
        /non-negative number/,
    );
});

test("admin audit write completes before the HTTP response ends", async () => {
    let responseEnded = false;
    const req = {
        method: "PATCH",
        originalUrl: "/api/admins/settings?source=test",
        user: { id: 44, role: "super_admin" },
        body: { payments: { transactionFee: 4.5 }, password: "must-not-be-stored" },
    };
    const res = {
        statusCode: 200,
        end() {
            responseEnded = true;
            return this;
        },
    };

    let nextCalled = false;
    await auditAdminAction(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, "route handler should run after the audit intent is stored");
    const auditIntent = calls.find((call) => /INSERT INTO admin_audit_logs/.test(call.sql));
    assert.ok(auditIntent, "audit intent should exist before route execution");
    assert.equal(auditIntent.params[4], 0, "audit status starts as pending");

    res.end();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(responseEnded, true);
    assert.ok(calls.some((call) => /UPDATE admin_audit_logs SET status_code/.test(call.sql)));
    const auditInsert = calls.find((call) =>
        /INSERT INTO admin_audit_logs/.test(call.sql),
    );
    assert.ok(auditInsert, "audit insert should be awaited before response completion");
    assert.equal(auditInsert.params[1], "super_admin");
    assert.match(JSON.stringify(auditInsert.params[5]), /redacted/);
});
