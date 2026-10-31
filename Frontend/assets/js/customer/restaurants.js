/* Customer restaurant discovery: API-backed search, filters, sorting and recovery. */
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const API_BASE = (window.FOOD_DELIVERY_API_BASE ||
        document.querySelector('meta[name="api-base-url"]')?.content?.trim() ||
        "http://localhost:5000/api").replace(/\/+$/, "");
    const PLACEHOLDER = "../../assets/images/restaurants/restaurant-placeholder.jpg";

    const searchForm = document.getElementById("restaurantSearchForm");
    const searchInput = document.getElementById("restaurantSearch");
    const clearSearchButton = document.getElementById("clearRestaurantSearch");
    const grid = document.getElementById("restaurantGrid");
    const resultsCount = document.getElementById("restaurantResultsCount");
    const noResults = document.getElementById("noRestaurantsMessage");
    const availabilityFilter = document.getElementById("restaurantAvailability");
    const cuisineFilter = document.getElementById("restaurantCuisine");
    const sortSelect = document.getElementById("restaurantSort");
    const resetFiltersButton = document.getElementById("resetRestaurantFilters");
    const clearAllButton = document.getElementById("clearRestaurantFilters");
    const cartCount = document.getElementById("cartCount");

    let restaurants = [];
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

    function isOpen(restaurant) {
        return asBoolean(restaurant.is_open ?? restaurant.isOpen ?? restaurant.open_now, false);
    }

    function getCuisines(restaurant) {
        const raw = restaurant.cuisines ?? restaurant.cuisine ?? restaurant.categories ??
            restaurant.category ?? restaurant.food_types ?? [];
        const values = Array.isArray(raw) ? raw : String(raw).split(/[,|]/);
        return values.map((item) => typeof item === "object" && item !== null
            ? text(item.name ?? item.title ?? item.label)
            : text(item)).filter(Boolean);
    }

    function getSearchText(restaurant) {
        return [
            restaurant.name, restaurant.description, restaurant.location_name,
            restaurant.location, restaurant.cuisine, restaurant.category, restaurant.food_type,
            ...getCuisines(restaurant)
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
        grid.innerHTML = `<div class="restaurant-grid-message${isError ? " is-error" : ""}">
            <p>${escapeHTML(message)}</p>
            ${isError ? '<button type="button" id="retryRestaurants" class="restaurant-reset-filters">Try again</button>' : ""}
        </div>`;
        if (noResults) noResults.hidden = true;
        const retry = document.getElementById("retryRestaurants");
        if (retry) retry.addEventListener("click", loadRestaurants);
    }

    function populateCuisineOptions() {
        if (!cuisineFilter) return;
        const selected = cuisineFilter.value || "all";
        const cuisines = [...new Set(restaurants.flatMap(getCuisines))]
            .sort((a, b) => a.localeCompare(b));
        cuisineFilter.innerHTML = '<option value="all">All cuisines</option>' +
            cuisines.map((cuisine) => `<option value="${escapeHTML(normalize(cuisine))}">${escapeHTML(cuisine)}</option>`).join("");
        cuisineFilter.value = cuisines.some((cuisine) => normalize(cuisine) === selected) ? selected : "all";
    }

    function renderRestaurants() {
        if (!grid || loadingFailed) return;
        const term = normalize(searchInput?.value);
        const availability = availabilityFilter?.value || "all";
        const cuisine = cuisineFilter?.value || "all";
        const sortBy = sortSelect?.value || "recommended";

        let filtered = restaurants.filter((restaurant) => {
            if (term && !getSearchText(restaurant).includes(term)) return false;
            if (availability === "open" && !isOpen(restaurant)) return false;
            if (availability === "closed" && isOpen(restaurant)) return false;
            if (cuisine !== "all" && !getCuisines(restaurant).some((item) => normalize(item) === cuisine)) return false;
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

        grid.innerHTML = filtered.map((restaurant) => {
            const name = text(restaurant.name) || "Restaurant";
            const open = isOpen(restaurant);
            const rating = Number(restaurant.average_rating);
            const ratingText = restaurant.average_rating !== null &&
                restaurant.average_rating !== undefined && Number.isFinite(rating)
                ? `★ ${rating.toFixed(1)}` : "No ratings";
            const cuisines = getCuisines(restaurant);
            const firstLocationWord = (text(restaurant.name) || "Restaurant").split(/\s+/)[0] || "Restaurant";
            const location = text(restaurant.location_name) || `${firstLocationWord} Location`;
            const image = getImageUrl(restaurant.logo_url || restaurant.cover_image_url || restaurant.image_url);
            const restaurantId = restaurant.id ?? restaurant.restaurant_id;
            const restaurantUrl = restaurantId !== null && restaurantId !== undefined
                ? `restaurant.html?id=${encodeURIComponent(restaurantId)}`
                : "restaurant.html";
            return `<article class="restaurant-card">
                <div class="restaurant-image${image ? "" : " has-no-image"}">
                    ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(name)}" loading="lazy" data-image-fallback="true">` : '<span class="restaurant-image-fallback" aria-hidden="true">🍽</span>'}
                    <span class="restaurant-status ${open ? "is-open" : "is-closed"}">${open ? "Open" : "Closed"}</span>
                </div>
                <div class="restaurant-info">
                    <div class="restaurant-title-row"><h3>${escapeHTML(name)}</h3><span class="rating">${escapeHTML(ratingText)}</span></div>
                    <p class="restaurant-category">${escapeHTML(cuisines.join(" · ") || location || text(restaurant.description) || "Cuisine not specified")}</p>
                    <div class="restaurant-meta">
                        ${location ? `<span>${escapeHTML(location)}</span>` : ""}
                    </div>
                    <a href="${escapeHTML(restaurantUrl)}" class="view-restaurant-button">View Market</a>
                </div>
            </article>`;
        }).join("");

        grid.querySelectorAll("img[data-image-fallback]").forEach((img) => {
            img.addEventListener("error", () => {
                const wrapper = img.closest(".restaurant-image");
                if (wrapper) {
                    img.remove();
                    wrapper.classList.add("has-no-image");
                    const fallback = document.createElement("span");
                    fallback.className = "restaurant-image-fallback";
                    fallback.setAttribute("aria-hidden", "true");
                    fallback.textContent = "🍽";
                    wrapper.prepend(fallback);
                }
            }, { once: true });
        });
    }

    async function loadRestaurants() {
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

            // The current backend returns { success: true, data: { restaurants: [...] } }.
            // Also accept common wrappers used by older deployments or API gateways.
            function extractRestaurantList(value, depth = 0) {
                if (Array.isArray(value)) return value;
                if (!value || typeof value !== "object" || depth > 5) return null;

                for (const key of ["restaurants", "items", "results", "records", "rows", "data"]) {
                    if (Object.prototype.hasOwnProperty.call(value, key)) {
                        const found = extractRestaurantList(value[key], depth + 1);
                        if (found) return found;
                    }
                }
                return null;
            }

            const list = extractRestaurantList(result);
            if (!list) {
                const responseShape = result && typeof result === "object"
                    ? Object.fromEntries(Object.entries(result).map(([key, value]) => [
                        key,
                        Array.isArray(value) ? `array(${value.length})` :
                            value === null ? "null" : typeof value === "object" ? Object.keys(value).slice(0, 12) : typeof value
                    ]))
                    : typeof result;
                console.error("Unexpected restaurants API response shape:", responseShape, result);
                throw new Error("The API response did not contain a restaurant list. Check the response shape in the console.");
            }

            restaurants = list.filter((restaurant) => {
                if (!restaurant || typeof restaurant !== "object") return false;
                const activeValue = restaurant.is_active ?? restaurant.isActive ?? restaurant.active;
                if (activeValue !== undefined && !asBoolean(activeValue, true)) return false;
                const status = normalize(restaurant.approval_status ?? restaurant.status);
                return !["pending", "rejected", "declined", "suspended", "inactive"].includes(status);
            });
            populateCuisineOptions();
            renderRestaurants();
        } catch (error) {
            loadingFailed = true;
            console.error("Failed to load customer restaurants:", error);
            updateCount(0);
            showGridMessage("We couldn't load markets. Check your connection and try again.", true);
        }
    }

    if (searchForm) searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        renderRestaurants();
    });
    if (searchInput) searchInput.addEventListener("input", renderRestaurants);
    [availabilityFilter, cuisineFilter, sortSelect].forEach((control) => {
        if (control) control.addEventListener("change", renderRestaurants);
    });

    function resetFilters(clearSearch = false) {
        if (clearSearch && searchInput) searchInput.value = "";
        if (availabilityFilter) availabilityFilter.value = "all";
        if (cuisineFilter) cuisineFilter.value = "all";
        if (sortSelect) sortSelect.value = "recommended";
        renderRestaurants();
    }
    if (clearSearchButton) clearSearchButton.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        renderRestaurants();
        searchInput?.focus();
    });
    if (resetFiltersButton) resetFiltersButton.addEventListener("click", () => resetFilters(false));
    if (clearAllButton) clearAllButton.addEventListener("click", () => resetFilters(true));

    

    function updateCartCount() {
        if (!cartCount) return;
        try {
            const savedCart = JSON.parse(localStorage.getItem("foodDeliveryCart") || "[]");
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
    loadRestaurants();
});
