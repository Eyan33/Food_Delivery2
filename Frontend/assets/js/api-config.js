(() => {
    const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
    const hostname = window.location.hostname;
    const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    // This frontend belongs to Food_Delivery2, so production requests must go
    // to its own backend rather than the original Food_Delivery deployment.
    const productionApiBase = normalizeBaseUrl("https://food-delivery2-c8m3.onrender.com/api");

    const servedByExpress = window.location.port === "5000";
    const resolvedBase = normalizeBaseUrl(
        window.FOOD_DELIVERY_API_BASE ||
            (isLocalDevelopment && !servedByExpress
                ? "http://localhost:5000/api"
                : productionApiBase)
    );

    window.FOOD_DELIVERY_API_BASE = resolvedBase;
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
