"use strict";

const path = require("path");
const express = require("express");
const cors = require("cors");

const {
    isProduction,
    validateEnvironment,
    resolveTrustProxy,
    parseList,
} = require("./config/env");
const pool = require("./config/database");
const securityHeaders = require("./middleware/security/securityHeaders");
const { createRateLimiter } = require("./middleware/security/rateLimit");
const { initializeDatabase } = require("./db/initDatabase");
const { normalizeEmail } = require("./utils/auth/validators");

const authRoutes = require("./routes/auth/authRoutes");
const restaurantRoutes = require("./routes/restaurant/restaurantRoutes");
const restaurantNotificationRoutes = require("./routes/restaurant/notificationRoutes");
const foodRoutes = require("./routes/food/foodRoutes");
const categoryRoutes = require("./routes/category/categoryRoutes");
const orderRoutes = require("./routes/order/orderRoutes");
const paymentRoutes = require("./routes/payments/paymentRoutes");
const cartRoutes = require("./routes/cart/cartRoutes");
const addressRoutes = require("./routes/address/addressRoutes");
const customerRoutes = require("./routes/customer/customerRoutes");
const adminRoutes = require("./routes/admin/adminRoutes");
const riderRoutes = require("./routes/rider/riderRoutes");
const riderNotificationRoutes = require("./routes/rider/notificationRoutes");
const reviewRoutes = require("./routes/review/reviewRoutes");

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_DIR = path.resolve(__dirname, "..", "Frontend");
const UPLOADS_DIR = path.resolve(__dirname, "uploads");

const DEFAULT_PLATFORM_NAME = "Market Delivery";

app.disable("x-powered-by");
app.set("trust proxy", resolveTrustProxy());

/*
 * Health checks.
 *
 * /healthz does not touch the database: Render uses it to decide whether
 * the process is alive, so a short database hiccup does not restart the
 * service. /api/health also checks PostgreSQL.
 */
app.get("/healthz", (req, res) => {
    res.status(200).json({ status: "ok" });
});

app.use(securityHeaders({ isProduction }));

/*
 * Minimal request log for API calls (method, path, status, duration).
 * Query strings, headers and bodies are never logged.
 */
app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
        return next();
    }

    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(
            `${req.method} ${req.path} ${res.statusCode} ${durationMs.toFixed(0)}ms`,
        );
    });

    return next();
});

/*
 * Frontend (static). Served from the same origin as the API, so the
 * default API base of "/api" works and CORS is not needed in production.
 * HTML/JS/CSS are revalidated on every load (file names are not hashed);
 * images and fonts may be cached for a day.
 */
app.use(
    express.static(FRONTEND_DIR, {
        dotfiles: "ignore",
        index: "index.html",
        etag: true,
        setHeaders(res, filePath) {
            res.setHeader(
                "Cache-Control",
                /\.(html|js|css)$/i.test(filePath)
                    ? "no-cache"
                    : "public, max-age=86400",
            );
        },
    }),
);

app.use(
    "/uploads",
    express.static(UPLOADS_DIR, {
        dotfiles: "deny",
        index: false,
        maxAge: "1d",
    }),
);

/*
 * CORS.
 *
 * Same-origin requests (the normal production setup) are always allowed.
 * Extra origins come from CORS_ORIGINS (comma-separated, exact origins).
 * Disallowed origins simply receive no CORS headers, so the browser
 * blocks them. Nothing throws, so a blocked origin never turns into a 500.
 */
const developmentOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
];

const allowedOrigins = new Set(parseList(process.env.CORS_ORIGINS));

if (process.env.RENDER_EXTERNAL_URL) {
    allowedOrigins.add(process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, ""));
}

if (!isProduction) {
    developmentOrigins.forEach((origin) => allowedOrigins.add(origin));
}

function isSameOrigin(origin, req) {
    try {
        return new URL(origin).host === req.headers.host;
    } catch (error) {
        return false;
    }
}

app.use(
    cors((req, callback) => {
        const origin = req.header("Origin");

        callback(null, {
            origin:
                Boolean(origin) &&
                (allowedOrigins.has(origin) || isSameOrigin(origin, req)),
            credentials: true,
            allowedHeaders: ["Content-Type", "Authorization"],
            maxAge: 600,
        });
    }),
);

/*
 * Body parsing. Orders, profiles and menus are small JSON documents; a
 * low limit stops oversized request bodies early.
 */
const bodyLimit = process.env.JSON_BODY_LIMIT || "8mb";

app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

/*
 * Rate limiting (per client IP; see TRUST_PROXY in .env.example).
 *
 * Login attempts are limited per IP+email as well as per IP, and only
 * failed attempts count, so one user mistyping a password cannot lock
 * out everyone behind the same address.
 */
const FIFTEEN_MINUTES = 15 * 60 * 1000;

const apiLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: Number(process.env.RATE_LIMIT_MAX || 1000),
});

const loginIpLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: Number(process.env.LOGIN_IP_MAX || 100),
    skipSuccessfulRequests: true,
    message: "Too many failed login attempts. Please try again later.",
});

const loginAccountLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: Number(process.env.LOGIN_ACCOUNT_MAX || 10),
    skipSuccessfulRequests: true,
    keyGenerator: (req) =>
        `${req.ip}|${normalizeEmail(req.body && req.body.email).slice(0, 254)}`,
    message: "Too many failed login attempts for this account. Please try again later.",
});

const registerLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: Number(process.env.REGISTER_MAX || 20),
    message: "Too many accounts created from this address. Please try again later.",
});

const passwordResetRequestLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: Number(process.env.PASSWORD_RESET_REQUEST_MAX || 5),
    message: "Too many password-reset requests. Please try again later.",
});

const passwordChangeLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: Number(process.env.PASSWORD_CHANGE_MAX || 10),
    message: "Too many password change attempts. Please try again later.",
});

app.use("/api", apiLimiter);
app.post("/api/auth/login", loginIpLimiter, loginAccountLimiter);
app.post("/api/auth/register", registerLimiter);
app.post("/api/auth/forgot-password", passwordResetRequestLimiter);
app.patch("/api/auth/me/password", passwordChangeLimiter);

/*
 * API routes
 */
app.get("/api", (req, res) => {
    res.json({
        success: true,
        message: "FoodDelivery API is running",
    });
});

app.get("/api/health", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW() AS current_time");

        res.json({
            success: true,
            message: "API and PostgreSQL are connected",
            database_time: result.rows[0].current_time,
        });
    } catch (error) {
        console.error("Database health check failed:", error.internalMessage || error.message);

        res.status(503).json({
            success: false,
            message: "Database connection failed",
        });
    }
});

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/foods", foodRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/restaurants/notifications", restaurantNotificationRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/riders/notifications", riderNotificationRoutes);
app.use("/api/riders", riderRoutes);

/*
 * Public platform branding + support contacts.
 * Used by the frontend to render the platform name everywhere without
 * requiring authentication. Falls back to "Market Delivery" when unset.
 */
app.get("/api/public/support", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                settings #>> '{general,platformName}' AS "platformName",
                settings #>> '{general,supportEmail}' AS "supportEmail",
                settings #>> '{general,supportPhone}' AS "supportPhone"
             FROM admin_settings
             WHERE id = 1
             LIMIT 1`,
        );
        const settings = result.rows[0] || {};
        const platformName =
            String(settings.platformName || "").trim() || DEFAULT_PLATFORM_NAME;

        res.set("Cache-Control", "public, max-age=300");
        return res.status(200).json({
            success: true,
            data: {
                platformName,
                supportEmail: settings.supportEmail || "",
                supportPhone: settings.supportPhone || "",
            },
        });
    } catch (error) {
        console.error("Could not load public support contacts:", error.message);
        return res.status(500).json({
            success: false,
            message: "Support contacts are temporarily unavailable.",
            data: {
                platformName: DEFAULT_PLATFORM_NAME,
                supportEmail: "",
                supportPhone: "",
            },
        });
    }
});

app.use("/api/reviews", reviewRoutes);

/*
 * 404 handlers
 */
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found",
    });
});

app.use((req, res) => {
    if (req.accepts(["html", "json"]) === "html") {
        return res
            .status(404)
            .type("html")
            .send(
                '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not found</title>' +
                    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
                    '<body style="font-family:sans-serif;text-align:center;padding:4rem 1rem">' +
                    '<h1>Page not found</h1><p><a href="/">Back to Market Delivery</a></p></body></html>',
            );
    }

    return res.status(404).json({
        success: false,
        message: "Route not found",
    });
});

/*
 * Central error handler: malformed JSON, oversized bodies and anything
 * unexpected end up here. Internals are logged, never returned.
 */
app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error && error.type === "entity.parse.failed") {
        return res.status(400).json({
            success: false,
            message: "Request body is not valid JSON",
        });
    }

    if (error && error.type === "entity.too.large") {
        return res.status(413).json({
            success: false,
            message: "Request body is too large",
        });
    }

    console.error(
        `Unhandled error on ${req.method} ${req.path}:`,
        (error && (error.internalMessage || error.stack)) || error,
    );

    return res.status(500).json({
        success: false,
        message: "Internal server error",
    });
});

/*
 * Startup and graceful shutdown
 */
function registerShutdown(server) {
    let shuttingDown = false;

    function shutdown(signal) {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.log(`[server] ${signal} received, shutting down gracefully`);

        // Render allows 30s by default between SIGTERM and SIGKILL.
        const forceExit = setTimeout(() => {
            console.error("[server] graceful shutdown timed out, exiting");
            process.exit(1);
        }, 25000);

        forceExit.unref();

        server.close(async () => {
            try {
                await pool.end();
            } catch (error) {
                console.error("[server] error closing database pool:", error.message);
            }

            process.exit(0);
        });

        server.closeIdleConnections();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

async function start() {
    const { errors, warnings } = validateEnvironment();

    warnings.forEach((message) => console.warn(`[config] ${message}`));
    errors.forEach((message) => console.error(`[config] ${message}`));

    if (errors.length > 0 && isProduction) {
        console.error("[config] refusing to start in production with the problems above");
        process.exit(1);
    }

    if (String(process.env.DB_AUTO_INIT || "true").toLowerCase() !== "false") {
        try {
            await initializeDatabase();
        } catch (error) {
            console.error("[db-init] failed:", error.internalMessage || error.message);

            if (isProduction) {
                process.exit(1);
            }
        }
    }

    const server = app.listen(PORT, () => {
        console.log(`Market Delivery listening on port ${PORT} (${isProduction ? "production" : "development"})`);
    });

    // Longer than the platform proxy's idle timeout, which avoids sporadic 502s.
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 121000;

    registerShutdown(server);
}

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    process.exit(1);
});

if (require.main === module) {
    start().catch((error) => {
        console.error("Failed to start server:", error);
        process.exit(1);
    });
}

module.exports = app;
