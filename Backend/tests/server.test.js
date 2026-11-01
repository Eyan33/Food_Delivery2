"use strict";

/*
 * HTTP-level checks for server.js. No database is needed: DATABASE_URL
 * points at a closed port, so anything that reaches PostgreSQL fails fast
 * and the tests can assert that the failure never leaks to the client.
 *
 * Run with:  npm test
 */

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = "test-secret-".padEnd(48, "x");
process.env.DATABASE_URL = "postgresql://nobody:nopass@127.0.0.1:1/nodb";
process.env.DB_CONNECTION_TIMEOUT_MS = "2000";
process.env.DB_AUTO_INIT = "false";
process.env.LOGIN_ACCOUNT_MAX = "3";
process.env.JSON_BODY_LIMIT = "256kb";

const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const pool = require("../config/database");

let server;
let base;

test.before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
});

function silenceErrors(fn) {
    return async (...args) => {
        const original = console.error;
        console.error = () => {};
        try {
            return await fn(...args);
        } finally {
            console.error = original;
        }
    };
}

test("GET /healthz is up without touching the database", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
});

test("GET / serves the frontend with security headers", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /Food<span>Delivery<\/span>/);

    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(
        res.headers.get("content-security-policy"),
        /connect-src[^;]*https:\/\/food-delivery-ljy7\.onrender\.com/,
    );
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("strict-transport-security"), /max-age=/);
    assert.equal(res.headers.get("x-powered-by"), null);
});

test("frontend pages and assets are served", async () => {
    for (const path of [
        "/pages/auth/login.html",
        "/assets/js/api-config.js",
        "/assets/css/style.css",
    ]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.status, 200, path);
    }
});

test("backend source, dotfiles and traversal are not served", async () => {
    for (const path of [
        "/Backend/server.js",
        "/.git/config",
        "/..%2fBackend%2f.env",
        "/%2e%2e/Backend/server.js",
    ]) {
        const res = await fetch(`${base}${path}`);
        assert.notEqual(res.status, 200, path);
        assert.doesNotMatch(await res.text(), /require\(|JWT_SECRET/, path);
    }
});

test("API responses are JSON, uncached, and 404s are handled", async () => {
    const root = await fetch(`${base}/api`);
    assert.equal(root.status, 200);
    assert.equal((await root.json()).success, true);
    assert.equal(root.headers.get("cache-control"), "no-store");

    const missing = await fetch(`${base}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { success: false, message: "Route not found" });

    const page = await fetch(`${base}/no-such-page`, { headers: { accept: "text/html" } });
    assert.equal(page.status, 404);
    assert.match(page.headers.get("content-type"), /text\/html/);
});

test("protected routes require a token", async () => {
    for (const [method, path] of [
        ["GET", "/api/orders/my-orders"],
        ["GET", "/api/admins/dashboard"],
        ["GET", "/api/payments/admin"],
        ["POST", "/api/reviews"],
    ]) {
        const res = await fetch(`${base}${path}`, { method });
        assert.equal(res.status, 401, `${method} ${path}`);
    }
});

test("CORS: same origin allowed, foreign origin gets no CORS headers (and no 500)", async () => {
    const own = await fetch(`${base}/api`, { headers: { origin: base } });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("access-control-allow-origin"), base);

    const foreign = await fetch(`${base}/api`, { headers: { origin: "https://evil.example" } });
    assert.equal(foreign.status, 200);
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(`${base}/api/orders`, {
        method: "OPTIONS",
        headers: {
            origin: "https://evil.example",
            "access-control-request-method": "POST",
        },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
});

test("malformed and oversized JSON bodies get clean errors", async () => {
    const bad = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).message, /not valid JSON/);

    const huge = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "x".repeat(300000) }),
    });
    assert.equal(huge.status, 413);
});

test(
    "login failures never leak database details, and repeated failures are throttled per account",
    silenceErrors(async () => {
        async function login(email) {
            return fetch(`${base}/api/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email, password: "wrong-password-123" }),
            });
        }

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const res = await login("victim@example.com");
            const text = await res.text();
            assert.equal(res.status, 401, `attempt ${attempt}`);
            assert.doesNotMatch(text, /ECONNREFUSED|127\.0\.0\.1|nodb|nobody|relation|column/i);
        }

        const blocked = await login("victim@example.com");
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

        const other = await login("someone.else@example.com");
        assert.equal(other.status, 401, "other accounts are not affected");
    }),
);

test(
    "/api/health reports a database outage without details",
    silenceErrors(async () => {
        const res = await fetch(`${base}/api/health`);
        const text = await res.text();
        assert.equal(res.status, 503);
        assert.doesNotMatch(text, /ECONNREFUSED|127\.0\.0\.1|nodb|nobody/i);
    }),
);
