/* Customer market discovery: API-backed search, filters, sorting and recovery. */
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const API_BASE = (window.FOOD_DELIVERY_API_BASE ||
        document.querySelector('meta[name="api-base-url"]')?.content?.trim() ||
        "http://localhost:5000/api").replace(/\/+$/, "");
    const PLACEHOLDER = "../../assets/images/markets/market-placeholder.jpg";

    const searchForm = document.getElementById("marketSearchForm");
    const searchInput = document.getElementById("marketSearch");
    const clearSearchButton = document.getElementById("clearMarketSearch");
    const grid = document.getElementById("marketGrid");
    const resultsCount = document.getElementById("marketResultsCount");
    const noResults = document.getElementById("noMarketsMessage");
    const availabilityFilter = document.getElementById("marketAvailability");
    const categoryFilter = document.getElementById("marketCategory");
    const sortSelect = document.getElementById("marketSort");
    const resetFiltersButton = document.getElementById("resetMarketFilters");
    const clearAllButton = document.getElementById("clearMarketFilters");
    const cartCount = document.getElementById("cartCount");

    let markets = [];
    let loadingFailed = false;

    const text = (value) => String(value ?? "").trim();
    const normalize = (value) => text(value).toLowerCase();
    const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);

    function asBoolean(value, defaultValue = false) {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        if (typeof value === "string") {
            if (["true", "1", "yes", "open", "active"].includes(value.trim().toLowerCase())) return true;
            if (["false", "0", "no", "closed", "inactive", ""].includes(value.trim().toLowerCase())) return false;
        }
        return defaultValue;
    }

    function isOpen(market) {
        return asBoolean(market.is_open ?? market.isOpen ?? market.open_now, false);
    }

    function getCategorys(market) {
        const raw = market.categories ?? market.category ?? market.categories ??
            market.category ?? market.products_types ?? [];
        const values = Array.isArray(raw) ? raw : String(raw).split(/[,|]/);
        return values.map((item) => typeof item === "object" && item !== null
            ? text(item.name ?? item.title ?? item.label)
            : text(item)).filter(Boolean);
    }

    function getSearchText(market) {
        return [
            market.name, market.description, market.location_name,
            market.location, market.category, market.category, market.products_type,
            ...getCategorys(market)
        ].filter(Boolean).join(" ").toLowerCase();
    }

    function formatKES(value) {
        const amount = Number(value);
        return Number.isFinite(amount)
            ? `KSh ${amount.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`
            : "Not available";
    }

    function getImageUrl(value) {
        const url = text(value);
        if (!url) return "";
        if (/^data:image\/(jpeg|png|webp);base64,/i.test(url)) return url;
        if (/^(\.\.?\/|\/)/.test(url)) return url;
        try {
            const parsed = new URL(url, window.location.href);
            return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
        } catch {
            return "";
        }
    }

    function updateCount(count) {
        if (resultsCount) resultsCount.textContent =
            count === 1 ? "1 market available" : `${count} markets available`;
    }

    function showGridMessage(message, isError = false) {
        if (!grid) return;
        grid.innerHTML = `<div class="market-grid-message${isError ? " is-error" : ""}">
            <p>${escapeHTML(message)}</p>
            ${isError ? '<button type="button" id="retryMarkets" class="market-reset-filters">Try again</button>' : ""}
        </div>`;
        if (noResults) noResults.hidden = true;
        const retry = document.getElementById("retryMarkets");
        if (retry) retry.addEventListener("click", loadMarkets);
    }

    function populateCategoryOptions() {
        if (!categoryFilter) return;
        const selected = categoryFilter.value || "all";
        const categories = [...new Set(markets.flatMap(getCategorys))]
            .sort((a, b) => a.localeCompare(b));
        categoryFilter.innerHTML = '<option value="all">All categories</option>' +
            categories.map((category) => `<option value="${escapeHTML(normalize(category))}">${escapeHTML(category)}</option>`).join("");
        categoryFilter.value = categories.some((category) => normalize(category) === selected) ? selected : "all";
    }

    function renderMarkets() {
        if (!grid || loadingFailed) return;
        const term = normalize(searchInput?.value);
        const availability = availabilityFilter?.value || "all";
        const category = categoryFilter?.value || "all";
        const sortBy = sortSelect?.value || "recommended";

        let filtered = markets.filter((market) => {
            if (term && !getSearchText(market).includes(term)) return false;
            if (availability === "open" && !isOpen(market)) return false;
            if (availability === "closed" && isOpen(market)) return false;
            if (category !== "all" && !getCategorys(market).some((item) => normalize(item) === category)) return false;
            return true;
        });

        if (sortBy === "name") filtered.sort((a, b) => text(a.name).localeCompare(text(b.name)));
        if (sortBy === "rating") filtered.sort((a, b) => (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0));
        updateCount(filtered.length);
        if (!filtered.length) {
            grid.innerHTML = "";
            if (noResults) noResults.hidden = false;
            return;
        }
        if (noResults) noResults.hidden = true;

        grid.innerHTML = filtered.map((market) => {
            const name = text(market.name) || "Market";
            const open = isOpen(market);
            const rating = Number(market.average_rating);
            const ratingText = market.average_rating !== null &&
                market.average_rating !== undefined && Number.isFinite(rating)
                ? `★ ${rating.toFixed(1)}` : "No ratings";
            const categories = getCategorys(market);
            const firstLocationWord = (text(market.name) || "Market").split(/\s+/)[0] || "Market";
            const location = text(market.location_name) || `${firstLocationWord} Location`;
            const image = getImageUrl(market.logo_url || market.cover_image_url || market.image_url);
            const marketId = market.id ?? market.restaurant_id;
            const marketUrl = marketId !== null && marketId !== undefined
                ? `market.html?id=${encodeURIComponent(marketId)}`
                : "market.html";
            return `<article class="market-card">
                <div class="market-image${image ? "" : " has-no-image"}">
                    ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(name)}" loading="lazy" data-image-fallback="true">` : '<span class="market-image-fallback" aria-hidden="true">🍽</span>'}
                    <span class="market-status ${open ? "is-open" : "is-closed"}">${open ? "Open" : "Closed"}</span>
                </div>
                <div class="market-info">
                    <div class="market-title-row"><h3>${escapeHTML(name)}</h3><span class="rating">${escapeHTML(ratingText)}</span></div>
                    <p class="market-category">${escapeHTML(categories.join(" · ") || location || text(market.description) || "Category not specified")}</p>
                    <div class="market-meta">
                        ${location ? `<span>${escapeHTML(location)}</span>` : ""}
                    </div>
                    <a href="${escapeHTML(marketUrl)}" class="view-market-button">View Market</a>
                </div>
            </article>`;
        }).join("");

        grid.querySelectorAll("img[data-image-fallback]").forEach((img) => {
            img.addEventListener("error", () => {
                const wrapper = img.closest(".market-image");
                if (wrapper) {
                    img.remove();
                    wrapper.classList.add("has-no-image");
                    const fallback = document.createElement("span");
                    fallback.className = "market-image-fallback";
                    fallback.setAttribute("aria-hidden", "true");
                    fallback.textContent = "🍽";
                    wrapper.prepend(fallback);
                }
            }, { once: true });
        });
    }

    async function loadMarkets() {
        if (!grid) return;
        loadingFailed = false;
        showGridMessage("Loading markets…");
        updateCount(0);
        try {
            const response = await fetch(`${API_BASE}/restaurants`, {
                method: "GET",
                headers: { Accept: "application/json" }
            });
            const raw = await response.text();
            let result;
            try {
                result = JSON.parse(raw);
            } catch {
                throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
            }
            if (!response.ok || result?.success === false) {
                throw new Error(result?.message || `Request failed (HTTP ${response.status}).`);
            }

            // The current backend returns { success: true, data: { markets: [...] } }.
            // Also accept common wrappers used by older deployments or API gateways.
            function extractMarketList(value, depth = 0) {
                if (Array.isArray(value)) return value;
                if (!value || typeof value !== "object" || depth > 5) return null;

                for (const key of ["markets", "items", "results", "records", "rows", "data"]) {
                    if (Object.prototype.hasOwnProperty.call(value, key)) {
                        const found = extractMarketList(value[key], depth + 1);
                        if (found) return found;
                    }
                }
                return null;
            }

            const list = extractMarketList(result);
            if (!list) {
                const responseShape = result && typeof result === "object"
                    ? Object.fromEntries(Object.entries(result).map(([key, value]) => [
                        key,
                        Array.isArray(value) ? `array(${value.length})` :
                            value === null ? "null" : typeof value === "object" ? Object.keys(value).slice(0, 12) : typeof value
                    ]))
                    : typeof result;
                console.error("Unexpected markets API response shape:", responseShape, result);
                throw new Error("The API response did not contain a market list. Check the response shape in the console.");
            }

            markets = list.filter((market) => {
                if (!market || typeof market !== "object") return false;
                const activeValue = market.is_active ?? market.isActive ?? market.active;
                if (activeValue !== undefined && !asBoolean(activeValue, true)) return false;
                const status = normalize(market.approval_status ?? market.status);
                return !["pending", "rejected", "declined", "suspended", "inactive"].includes(status);
            });
            populateCategoryOptions();
            renderMarkets();
        } catch (error) {
            loadingFailed = true;
            console.error("Failed to load customer markets:", error);
            updateCount(0);
            showGridMessage("We couldn't load markets. Check your connection and try again.", true);
        }
    }

    if (searchForm) searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        renderMarkets();
    });
    if (searchInput) searchInput.addEventListener("input", renderMarkets);
    [availabilityFilter, categoryFilter, sortSelect].forEach((control) => {
        if (control) control.addEventListener("change", renderMarkets);
    });

    function resetFilters(clearSearch = false) {
        if (clearSearch && searchInput) searchInput.value = "";
        if (availabilityFilter) availabilityFilter.value = "all";
        if (categoryFilter) categoryFilter.value = "all";
        if (sortSelect) sortSelect.value = "recommended";
        renderMarkets();
    }
    if (clearSearchButton) clearSearchButton.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        renderMarkets();
        searchInput?.focus();
    });
    if (resetFiltersButton) resetFiltersButton.addEventListener("click", () => resetFilters(false));
    if (clearAllButton) clearAllButton.addEventListener("click", () => resetFilters(true));

    

    function updateCartCount() {
        if (!cartCount) return;
        try {
            const savedCart = JSON.parse(localStorage.getItem("productsDeliveryCart") || "[]");
            const total = Array.isArray(savedCart) ? savedCart.reduce((sum, item) =>
                sum + Math.max(0, Number(item.quantity) || 0), 0) : 0;
            cartCount.textContent = String(total);
        } catch {
            cartCount.textContent = "0";
        }
    }

    const initialSearch = new URLSearchParams(window.location.search).get("search");
    if (searchInput && initialSearch) searchInput.value = initialSearch;
    updateCartCount();
    loadMarkets();
});
