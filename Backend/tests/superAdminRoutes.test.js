"use strict";

/*
 * Route-level guards for /api/admins: which endpoints a regular admin may
 * call and which are reserved for the super admin. Runs the real router over
 * HTTP with an in-memory fake database (no PostgreSQL needed).
 *
 * Run with:  npm test
 */

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = "test-secret-".padEnd(48, "x");
process.env.DATABASE_URL = "postgresql://nobody:nopass@127.0.0.1:1/nodb";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

const users = new Map([
    [1, { id: 1, first_name: "Ada", last_name: "Admin", email: "admin@example.com", phone: null, role: "admin", is_active: true, must_change_password: false, tokens_valid_after: null }],
    [2, { id: 2, first_name: "Sam", last_name: "Super", email: "super@example.com", phone: null, role: "super_admin", is_active: true, must_change_password: false, tokens_valid_after: null }],
]);

const fakePool = {
    async query(sql, params = []) {
        const text = String(sql);
        if (/tokens_valid_after\s+FROM users\s+WHERE id = \$1/.test(text)) {
            const user = users.get(Number(params[0]));
            return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
        }
        // Harmless default: counters read as zero, lists as one empty-looking row.
        return { rows: [{ total: 0, unread: 0 }], rowCount: 1 };
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

const adminRoutes = require("../routes/admin/adminRoutes");

let server;
let base;

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/admins", adminRoutes);
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

const tokenFor = (id) =>
    jwt.sign({ id, role: users.get(id).role }, process.env.JWT_SECRET, { expiresIn: "1h" });

async function call(method, path, userId, body) {
    const headers = { "content-type": "application/json" };
    if (userId) headers.authorization = `Bearer ${tokenFor(userId)}`;
    return fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const ADMIN = 1;
const SUPER_ADMIN = 2;

test("every /api/admins route requires a signed-in admin", async () => {
    const res = await call("GET", "/api/admins/dashboard");
    assert.equal(res.status, 401);
});

test("regular admins cannot permanently delete accounts", async () => {
    const res = await call("DELETE", "/api/admins/deleted-accounts/customer/5", ADMIN, { reason: "cleanup" });
    assert.equal(res.status, 403);
});

test("regular admins cannot change platform settings or read the audit log", async () => {
    const save = await call("PUT", "/api/admins/settings", ADMIN, { general: { platformName: "Hijacked" } });
    assert.equal(save.status, 403);

    const audit = await call("GET", "/api/admins/audit-logs", ADMIN);
    assert.equal(audit.status, 403);
});

test("regular admins cannot manage other admins", async () => {
    assert.equal((await call("GET", "/api/admins", ADMIN)).status, 403);
    assert.equal((await call("POST", "/api/admins", ADMIN, {})).status, 403);
    assert.equal((await call("PUT", "/api/admins/5", ADMIN, { phone: "0700000000" })).status, 403);
    assert.equal((await call("DELETE", "/api/admins/5", ADMIN)).status, 403);
});

test("regular admins still reach the shared admin tools", async () => {
    assert.equal((await call("GET", "/api/admins/settings", ADMIN)).status, 200);
    assert.equal((await call("GET", "/api/admins/deleted-accounts", ADMIN)).status, 200);
});

test("the super admin passes authorization on the restricted routes", async () => {
    // A bad body proves the request got past the guard and reached validation.
    const deletion = await call("DELETE", "/api/admins/deleted-accounts/customer/5", SUPER_ADMIN, {});
    assert.equal(deletion.status, 400);
    assert.match((await deletion.json()).message, /reason/i);

    const settings = await call("PUT", "/api/admins/settings", SUPER_ADMIN, { bogus: {} });
    assert.equal(settings.status, 400);
    assert.match((await settings.json()).message, /Invalid settings section/);

    const audit = await call("GET", "/api/admins/audit-logs", SUPER_ADMIN);
    assert.notEqual(audit.status, 403);
    assert.notEqual(audit.status, 401);
});

test("the super admin's admin-management routes reject passwords shorter than 8 characters", async () => {
    const res = await call("PUT", "/api/admins/7", SUPER_ADMIN, { password: "pass123" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /at least 8 characters/);
});
