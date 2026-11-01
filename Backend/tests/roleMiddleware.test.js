"use strict";

process.env.NODE_ENV = "production";
// Deterministic "database is down": nothing listens on port 1.
process.env.DATABASE_URL = "postgresql://nobody:nopass@127.0.0.1:1/nodb";
process.env.DB_CONNECTION_TIMEOUT_MS = "2000";

const test = require("node:test");
const assert = require("node:assert/strict");

const authorizeRoles = require("../middleware/auth/roleMiddleware");
const requireSuperAdmin = require("../middleware/auth/superAdminMiddleware");
const pool = require("../config/database");

test.after(async () => {
    delete process.env.PLATFORM_SYSTEM;
    await pool.end();
});

function run(middleware, user) {
    const req = { user, method: "GET", originalUrl: "/api/test" };
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        on() {}
    };
    let nextCalled = false;
    middleware(req, res, () => {
        nextCalled = true;
    });
    return { res, nextCalled };
}

test("market system: super_admin2 can use routes open to admin", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { res, nextCalled } = run(authorizeRoles("admin"), { id: 1, role: "super_admin2" });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
});

test("market system: admin2 can use routes open to admin", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { nextCalled } = run(authorizeRoles("admin"), { id: 2, role: "admin2" });
    assert.equal(nextCalled, true);
});

test("market system: admin2 cannot manage administrator accounts", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { res, nextCalled } = run(requireSuperAdmin, { id: 2, role: "admin2" });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test("market system: super_admin2 can manage administrator accounts", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { nextCalled } = run(requireSuperAdmin, { id: 1, role: "super_admin2" });
    assert.equal(nextCalled, true);
});

test("market system: a customer is still refused on admin routes", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { res, nextCalled } = run(authorizeRoles("admin"), { id: 3, role: "customer" });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test("market system: super_admin2 is not let through on customer-only routes", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { res, nextCalled } = run(authorizeRoles("customer"), { id: 1, role: "super_admin2" });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test("an unauthenticated request gets 401", () => {
    process.env.PLATFORM_SYSTEM = "market";
    const { res, nextCalled } = run(authorizeRoles("admin"), undefined);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test("legacy roles: super_admin can use routes open to admin", () => {
    delete process.env.PLATFORM_SYSTEM;
    const { nextCalled } = run(authorizeRoles("admin"), { id: 1, role: "super_admin" });
    assert.equal(nextCalled, true);
});
