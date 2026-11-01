(() => {
    const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
    const hostname = window.location.hostname;
    const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    const productionApiBase = normalizeBaseUrl("https://food-delivery-tcwn.onrender.com/api");

    const servedByExpress = window.location.port === "5000";
    const resolvedBase = normalizeBaseUrl(
        window.FOOD_DELIVERY_API_BASE ||
            (isLocalDevelopment && !servedByExpress
                ? "http://localhost:5000/api"
                : productionApiBase)
    );

    window.FOOD_DELIVERY_API_BASE = resolvedBase;

    // Public branding is read from the saved platform settings so the
    // customer-facing pages, authentication screens and admin portals stay
    // consistent without requiring a signed-in session.
    const applyPlatformName = (value) => {
        const name = String(value || "").trim();
        if (!name) return;
        document.querySelectorAll(".logo, .admin-logo").forEach((element) => {
            element.textContent = name;
            element.setAttribute("aria-label", name);
        });
        if (document.title) {
            const parts = document.title.split("|");
            document.title = parts.length > 1
                ? `${parts[0].trim()} | ${name}`
                : name;
        }
        document.querySelectorAll(".footer p, footer p").forEach((element) => {
            element.textContent = element.textContent.replace(/Food\s*Delivery/gi, name);
        });
        document.documentElement.dataset.platformName = name;
    };

    window.applyFoodDeliveryPlatformName = applyPlatformName;
    window.addEventListener("platform-name-updated", (event) => {
        applyPlatformName(event.detail?.platformName);
    });

    fetch(`${resolvedBase}/public/settings`, { headers: { Accept: "application/json" } })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => applyPlatformName(result?.data?.platformName))
        .catch(() => {
            // Keep the built-in fallback branding if public settings are unavailable.
        });
})();

/*
 * Image fallback. The Content-Security-Policy blocks inline event
 * handlers, so <img data-fallback="/path/to/placeholder.jpg"> is handled
 * here instead of with an inline onerror attribute. 'error' does not
 * bubble, hence the capture phase. Each image falls back at most once.
 */
document.addEventListener(
    "error",
    (event) => {
        const element = event.target;

        if (!(element instanceof HTMLImageElement)) {
            return;
        }

        const fallback = element.getAttribute("data-fallback");

        if (!fallback || element.dataset.fallbackApplied === "true") {
            return;
        }

        element.dataset.fallbackApplied = "true";
        element.src = fallback;
    },
    true
);
