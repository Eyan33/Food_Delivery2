"use strict";

/*
 * Security headers (a small, dependency-free subset of what `helmet`
 * sets, tuned for this app).
 *
 * The Content-Security-Policy is the important one. Pages only load
 * scripts from this origin, and inline event handlers / javascript:
 * URLs are blocked. That means that even if some user-supplied text
 * (restaurant name, address, ...) ever reaches innerHTML unescaped,
 * the browser refuses to run injected script.
 *
 * External hosts allowed: Google Fonts (CSS + font files), the production
 * API, and https images (restaurant/food photos are stored as URLs).
 */

const BASE_DIRECTIVES = [
    "default-src 'self'",
    // unpkg.com serves any npm package, so allowing the whole host would let an
    // attacker-published package pass the CSP. Only Leaflet (rider map) is used.
    "script-src 'self' https://unpkg.com/leaflet@1.9.4/ https://accounts.google.com/gsi/client https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com/leaflet@1.9.4/ https://fonts.googleapis.com https://accounts.google.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://router.project-osrm.org https://nominatim.openstreetmap.org https://accounts.google.com https://www.googleapis.com https://food-delivery-ljy7.onrender.com",
    "frame-src 'self' https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
];

function buildContentSecurityPolicy(isProduction) {
    // Only upgrade http -> https in production; plain-http localhost must keep working in development.
    return (isProduction
        ? [...BASE_DIRECTIVES, "upgrade-insecure-requests"]
        : BASE_DIRECTIVES
    ).join("; ");
}

function securityHeaders({ isProduction }) {
    const contentSecurityPolicy = buildContentSecurityPolicy(isProduction);

    return function securityHeadersMiddleware(req, res, next) {
        res.setHeader("Content-Security-Policy", contentSecurityPolicy);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        res.setHeader("X-DNS-Prefetch-Control", "off");
        res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
        // Google Identity Services popup flow needs a compatible opener policy.
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
        res.setHeader(
            "Permissions-Policy",
            "geolocation=(self), camera=(), microphone=(), payment=()",
        );

        if (isProduction) {
            // Render terminates TLS and always serves this app over HTTPS.
            res.setHeader(
                "Strict-Transport-Security",
                "max-age=15552000; includeSubDomains",
            );
        }

        // API responses can contain personal data: never cache them.
        if (req.path.startsWith("/api")) {
            res.setHeader("Cache-Control", "no-store");
        }

        next();
    };
}

module.exports = securityHeaders;
module.exports.buildContentSecurityPolicy = buildContentSecurityPolicy;
