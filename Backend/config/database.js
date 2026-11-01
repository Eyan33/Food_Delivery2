"use strict";

const { Pool } = require("pg");
require("dotenv").config();

/*
 * Connection settings.
 *
 * On Render the blueprint injects DATABASE_URL (the private-network
 * connection string). Locally you can keep using DB_HOST / DB_NAME / ...
 */

const sslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";

const connectionSettings = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT || 5432),
          database: process.env.DB_NAME,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
      };

const pool = new Pool({
    ...connectionSettings,
    ...(sslEnabled
        ? {
              ssl: {
                  rejectUnauthorized:
                      process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
              },
          }
        : {}),
    max: Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
});

/*
 * Keep database internals out of API responses.
 *
 * Many controllers return `error.message` to the client. For PostgreSQL
 * and connection errors that text can contain table names, column names,
 * constraint names or internal hostnames. We log the original server-side
 * and replace only the message: `error.code` (e.g. 23505) and
 * `error.constraint` are untouched, so existing code that branches on
 * them keeps working.
 */

const GENERIC_DB_MESSAGE =
    "A database error occurred. Please try again in a moment.";

const CONNECTION_ERROR_MESSAGE =
    /^(Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|Client was closed|Cannot use a pool after calling end)/i;

function isInternalDatabaseError(error) {
    if (!error || typeof error !== "object") {
        return false;
    }

    return (
        // pg DatabaseError (always carries a severity)
        typeof error.severity === "string" ||
        // socket-level failures (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ...)
        typeof error.syscall === "string" ||
        CONNECTION_ERROR_MESSAGE.test(String(error.message || ""))
    );
}

function sanitizeDatabaseError(error) {
    if (!isInternalDatabaseError(error) || error.databaseErrorSanitized) {
        return error;
    }

    console.error("[db] query failed:", {
        code: error.code,
        message: error.message,
        detail: error.detail,
        constraint: error.constraint,
        table: error.table,
    });

    Object.defineProperty(error, "internalMessage", {
        value: error.message,
        enumerable: false,
    });
    Object.defineProperty(error, "databaseErrorSanitized", {
        value: true,
        enumerable: false,
    });

    error.message = GENERIC_DB_MESSAGE;

    return error;
}

function wrapQuery(target) {
    const originalQuery = target.query.bind(target);

    target.query = function query(...args) {
        let result;

        try {
            result = originalQuery(...args);
        } catch (error) {
            throw sanitizeDatabaseError(error);
        }

        if (result && typeof result.then === "function") {
            return result.then(undefined, (error) => {
                throw sanitizeDatabaseError(error);
            });
        }

        return result;
    };
}

wrapQuery(pool);

// Sanitize failures while acquiring a client as well as failures from
// queries issued after acquisition. The "connect" event only fires after a
// successful connection, so it cannot catch ECONNREFUSED during pool.connect().
const originalConnect = pool.connect.bind(pool);
pool.connect = function connect(...args) {
    const callbackIndex = args.findIndex((argument) => typeof argument === "function");
    if (callbackIndex >= 0) {
        const originalCallback = args[callbackIndex];
        args[callbackIndex] = function (error, ...rest) {
            originalCallback(error ? sanitizeDatabaseError(error) : null, ...rest);
        };
    }

    let result;
    try {
        result = originalConnect(...args);
    } catch (error) {
        throw sanitizeDatabaseError(error);
    }

    if (result && typeof result.then === "function") {
        return result.catch((error) => {
            throw sanitizeDatabaseError(error);
        });
    }
    return result;
};

// Clients checked out with pool.connect() (used for transactions).
pool.on("connect", (client) => {
    wrapQuery(client);
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
});

module.exports = pool;
module.exports.sanitizeDatabaseError = sanitizeDatabaseError;
