/* =========================================================
   CUSTOMER HOME PAGE
   Loads markets and products from the public API.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const API_BASE = (window.FOOD_DELIVERY_API_BASE || document.querySelector('meta[name="api-base-url"]')?.content?.trim() || (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "http://localhost:5000/api" : window.location.origin + "/api")).replace(/\/+$/, "");

    const marketGrid = document.getElementById("marketGrid");
    const productsGrid = document.getElementById("productsGrid");
    const usernameElement = document.getElementById("username");
    const cartCountElement = document.getElementById("cartCount");
    const searchForm = document.getElementById("homeSearchForm");
    const searchInput = document.getElementById("homeSearchInput");
    let allMarkets = [];
    let allProductss = [];


    const RESTAURANT_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22400%22%3E%3Crect width=%22640%22 height=%22400%22 fill=%22%23f1f5f9%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 fill=%22%2364748b%22%3EMarket%3C/text%3E%3C/svg%3E";

    const FOOD_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22400%22%3E%3Crect width=%22640%22 height=%22400%22 fill=%22%23f1f5f9%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 fill=%22%2364748b%22%3EProducts%20image%20unavailable%3C/text%3E%3C/svg%3E";


    // Personalized customer greeting
const greeting = document.getElementById("customerGreeting");

if (greeting) {
    const savedUser =
        localStorage.getItem("productsDeliveryUser") ||
        sessionStorage.getItem("productsDeliveryUser");

    let user = {};

    try {
        user = savedUser ? JSON.parse(savedUser) : {};
    } catch (error) {
        console.error("Could not read saved customer details:", error);
    }

    const username =
        user.first_name ||
        user.username ||
        user.name ||
        "there";

    greeting.textContent = `${username}, what are you`;
}    

    /* ---------------------------------------------------------
       GENERAL HELPERS
       --------------------------------------------------------- */

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => {
            const entities = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            };

            return entities[character];
        });
    }

    function formatKES(value) {
        const amount = Number(value);

        if (!Number.isFinite(amount)) {
            return "Price unavailable";
        }

        return `KSh ${amount.toLocaleString("en-KE", {
            maximumFractionDigits: 2,
        })}`;
    }

    function getImageUrl(url, fallback) {
        const imageUrl = String(url ?? "").trim();

        if (!imageUrl) {
            return fallback;
        }

        // Permit embedded market images, relative paths and normal HTTP(S) URLs.
        if (/^data:image\/(jpeg|png|webp);base64,/i.test(imageUrl)) {
            return imageUrl;
        }

        if (
            imageUrl.startsWith("/") ||
            imageUrl.startsWith("./") ||
            imageUrl.startsWith("../")
        ) {
            return imageUrl;
        }

        try {
            const parsed = new URL(imageUrl, window.location.href);

            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                return parsed.href;
            }
        } catch (error) {
            // Use the fallback for invalid image URLs.
        }

        return fallback;
    }

    function showMessage(container, message, type = "info") {
        if (!container) return;

        container.innerHTML = `
            <p class="home-message home-message-${escapeHTML(type)}">
                ${escapeHTML(message)}
            </p>
        `;
    }

    async function fetchPublicData(endpoint) {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
            },
        });

        let result;

        try {
            result = await response.json();
        } catch (error) {
            throw new Error("The server returned an invalid response.");
        }

        if (!response.ok || result.success === false) {
            throw new Error(
                result.message || `Request failed (${response.status}).`
            );
        }

        return result.data || {};
    }

    /* ---------------------------------------------------------
       CUSTOMER GREETING
       --------------------------------------------------------- */

    function setCustomerGreeting() {
        if (!usernameElement) return;

        // Use a stored user profile only if one is available.
        // The homepage does not assume a specific login storage format.
        const possibleKeys = [
            "user",
            "currentUser",
            "customer",
            "userData",
        ];

        let storedUser = null;

        for (const key of possibleKeys) {
            const rawValue =
                localStorage.getItem(key) ||
                sessionStorage.getItem(key);

            if (!rawValue) continue;

            try {
                const parsed = JSON.parse(rawValue);

                if (parsed && typeof parsed === "object") {
                    storedUser = parsed.user || parsed.data?.user || parsed;
                    break;
                }
            } catch (error) {
                // Ignore non-JSON values such as token strings.
            }
        }

        const firstName =
            storedUser?.first_name ||
            storedUser?.firstName ||
            storedUser?.name ||
            "";

        usernameElement.textContent = firstName
            ? `${firstName}, `
            : "";
    }

    /* ---------------------------------------------------------
       RESTAURANTS
       --------------------------------------------------------- */

    function renderMarkets(markets) {
        if (!marketGrid) return;

        const availableMarkets = markets
            .filter((market) => market && market.is_active !== false)
            .sort((a, b) => {
                // Surface markets with customer reviews in the home section.
                const aCount = Number(a.rating_count) || 0;
                const bCount = Number(b.rating_count) || 0;
                if ((aCount > 0) !== (bCount > 0)) return bCount > 0 ? 1 : -1;
                if (aCount > 0 && bCount > 0) {
                    const ratingDifference = (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0);
                    if (ratingDifference !== 0) return ratingDifference;
                    return bCount - aCount;
                }
                return 0;
            });

        if (availableMarkets.length === 0) {
            showMessage(
                marketGrid,
                "No markets are available right now."
            );
            return;
        }

        marketGrid.innerHTML = availableMarkets
            .slice(0, 6)
            .map((market) => {
                const name = market.name || "Market";
                const isOpen = market.is_open === true;
                const rating = Number(market.average_rating);
                const ratingCount = Number(market.rating_count) || 0;
                const deliveryFee = Number(market.delivery_fee);

                const hasRating = market.average_rating !== null &&
                    market.average_rating !== undefined &&
                    Number.isFinite(rating) && rating > 0 && ratingCount > 0;
                const ratingText = hasRating
                    ? `★ ${rating.toFixed(1)} (${ratingCount})`
                    : "No reviews yet";

                const deliveryText = Number.isFinite(deliveryFee)
                    ? `${formatKES(deliveryFee)} delivery`
                    : "Delivery fee unavailable";

                const firstLocationWord = String(market.name || "Market").trim().split(/\s+/)[0] || "Market";
                const location = market.location_name || `${firstLocationWord} Location`;

                const imageUrl = getImageUrl(
                    market.logo_url || market.cover_image_url,
                    RESTAURANT_PLACEHOLDER
                );

                return `
                    <article class="market-card">
                        <div class="market-image">
                            <img
                                src="${escapeHTML(imageUrl)}"
                                alt="${escapeHTML(name)}"
                                loading="lazy"
                                data-fallback="${RESTAURANT_PLACEHOLDER}"
                            >

                            <span class="market-status">
                                ${isOpen ? "Open" : "Closed"}
                            </span>
                        </div>

                        <div class="market-info">
                            <div class="market-title">
                                <h3>${escapeHTML(name)}</h3>
                                <span class="rating">
                                    ${escapeHTML(ratingText)}
                                </span>
                            </div>

                            <p class="market-category">
                                ${escapeHTML(location || market.description || "Market")}
                            </p>

                            <div class="market-meta">
                                <span>${escapeHTML(deliveryText)}</span>
                            </div>
                        </div>
                    </article>
                `;
            })
            .join("");
    }

    async function loadMarkets() {
        if (!marketGrid) return;

        showMessage(marketGrid, "Loading markets...");

        try {
            const data = await fetchPublicData("/restaurants");
            const markets = Array.isArray(data.markets)
                ? data.markets
                : [];

            allMarkets = markets;
            renderMarkets(filterBySearch(allMarkets, "market"));
        } catch (error) {
            console.error("Customer homepage: failed to load markets:", error);

            showMessage(marketGrid, "We couldn't load markets. Please try again.", "error");
            addRetryButton(marketGrid, loadMarkets);
        }
    }

    /* ---------------------------------------------------------
       FOOD
       --------------------------------------------------------- */

    function renderProductss(productss) {
        if (!productsGrid) return;

        // Only show products currently marked available.
        // The homepage Popular Productss section is curated by admins using
        // the is_featured checkbox in Operations > Catalog > Edit products.
        const availableProductss = productss.filter((products) => {
            return products && products.is_available === true && products.is_featured === true;
        });

        if (availableProductss.length === 0) {
            showMessage(
                productsGrid,
                "No popular products are available right now."
            );
            return;
        }

        productsGrid.innerHTML = availableProductss
            .slice(0, 6)
            .map((products) => {
                const name = products.name || "Product";
                const marketName =
                    products.market_name || "Market";
                const description =
                    products.description || "A delicious product to enjoy.";

                const imageUrl = getImageUrl(
                    products.image_url,
                    FOOD_PLACEHOLDER
                );

                return `
                    <article class="products-card">
                        <div class="products-image">
                            <img
                                src="${escapeHTML(imageUrl)}"
                                alt="${escapeHTML(name)}"
                                loading="lazy"
                                data-fallback="${FOOD_PLACEHOLDER}"
                            >

                            ${
                                products.is_featured
                                    ? '<span class="products-featured-label">Featured</span>'
                                    : ""
                            }
                        </div>

                        <div class="products-info">
                            <p class="products-market">
                                ${escapeHTML(marketName)}
                            </p>

                            <h3>${escapeHTML(name)}</h3>

                            <p class="products-description">
                                ${escapeHTML(description)}
                            </p>

                            <div class="products-bottom">
                                <strong>${escapeHTML(formatKES(products.price))}</strong>

                                <button
                                    type="button"
                                    class="add-products-button"
                                    data-products-id="${escapeHTML(products.id)}"
                                    aria-label="Add ${escapeHTML(name)} to cart"
                                    title="Add to cart"
                                >+</button>
                            </div>
                        </div>
                    </article>
                `;
            })
            .join("");
    }

    async function loadProductss() {
        if (!productsGrid) return;

        showMessage(productsGrid, "Loading products...");

        try {
            const data = await fetchPublicData("/productss");
            const productss = Array.isArray(data.productss) ? data.productss : [];
            allProductss = productss;
            renderProductss(filterBySearch(allProductss, "products"));
        } catch (error) {
            console.error("Customer homepage: failed to load productss:", error);

            showMessage(productsGrid, "We couldn't load products. Please try again.", "error");
            addRetryButton(productsGrid, loadProductss);
        }
    }

    function filterBySearch(items, kind) {
        const term = (searchInput?.value || "").trim().toLowerCase();
        if (!term) return items;
        return items.filter(item => {
            const marketName = kind === "products" ? (item.market_name || allMarkets.find(r => String(r.id) === String(item.restaurant_id))?.name || "") : "";
            return [item.name, item.description, item.city, item.address, item.category_name, item.category, marketName].filter(Boolean).join(" ").toLowerCase().includes(term);
        });
    }
    function addRetryButton(container, retry) {
        const button = document.createElement("button"); button.type = "button"; button.className = "home-retry-button"; button.textContent = "Try again";
        button.addEventListener("click", retry); container.appendChild(button); container.setAttribute("aria-busy", "false");
    }
    function updateCartCount() {
        if (!cartCountElement) return;
        try { const items = JSON.parse(localStorage.getItem("productsDeliveryCart") || "[]"); cartCountElement.textContent = String(Array.isArray(items) ? items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0) : 0); } catch { cartCountElement.textContent = "0"; }
    }
    function addProductsToCart(productsId, button) {
        const products = allProductss.find(item => String(item.id) === String(productsId)); if (!products) return;
        const market = allMarkets.find(item => String(item.id) === String(products.restaurant_id));
        if (market && [false, "false", 0].includes(market.is_open)) { showMessage(productsGrid, "This market is currently closed."); return; }
        if ([false, "false", 0].includes(products.is_available)) { showMessage(productsGrid, "This product is currently unavailable."); return; }
        let cart; try { cart = JSON.parse(localStorage.getItem("productsDeliveryCart") || "[]"); } catch { cart = []; } if (!Array.isArray(cart)) cart = [];
        const marketId = products.restaurant_id ?? market?.id;
        if (cart.length && cart.some(item => item.restaurant_id != null && marketId != null && String(item.restaurant_id) !== String(marketId))) { if (!window.confirm("Your cart contains items from another market. Clear it and add this product?")) return; cart = []; }
        const existing = cart.find(item => String(item.id) === String(products.id) && String(item.restaurant_id) === String(marketId));
        if (existing) existing.quantity = Math.max(1, Number(existing.quantity) || 1) + 1;
        else cart.push({ id: products.id, restaurant_id: marketId, market_name: products.market_name || market?.name || "Market", market_is_open: market?.is_open, delivery_fee: market?.delivery_fee, name: products.name || "Product", category: products.category_name || products.category || "Other", description: products.description || "", price: Number(products.price) || 0, image: getImageUrl(products.image_url, FOOD_PLACEHOLDER), quantity: 1 });
        try { localStorage.setItem("productsDeliveryCart", JSON.stringify(cart)); } catch { showMessage(productsGrid, "Could not save your cart. Check browser storage.", "error"); return; }
        updateCartCount(); if (button) { const old = button.textContent; button.textContent = "✓"; window.setTimeout(() => button.textContent = old, 900); }
    }
    searchForm?.addEventListener("submit", event => { event.preventDefault(); const term = (searchInput?.value || "").trim(); if (term) window.location.href = "markets.html?search=" + encodeURIComponent(term); });
    searchInput?.addEventListener("input", () => { renderMarkets(filterBySearch(allMarkets, "market")); renderProductss(filterBySearch(allProductss, "products")); });
    productsGrid?.addEventListener("click", event => { const button = event.target.closest(".add-products-button"); if (button) addProductsToCart(button.dataset.productsId, button); });
    marketGrid?.addEventListener("click", event => { const card = event.target.closest("[data-market-url]"); if (card) window.location.href = card.dataset.marketUrl; });
    marketGrid?.addEventListener("keydown", event => { const card = event.target.closest("[data-market-url]"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); window.location.href = card.dataset.marketUrl; } });
    window.addEventListener("storage", event => { if (event.key === "productsDeliveryCart") updateCartCount(); });


    /* ---------------------------------------------------------
       INITIALIZE HOMEPAGE
       --------------------------------------------------------- */

    setCustomerGreeting();

    // Load both sections independently so one failure doesn't hide the other.
    loadMarkets();
    loadProductss();
});