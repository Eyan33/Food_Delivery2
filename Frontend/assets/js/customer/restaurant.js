
/* =========================================================
   CUSTOMER RESTAURANT PAGE
   Loads market details and products from the backend.
   Preserves cart, search, category filters and mobile nav.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const API_BASE = (window.FOOD_DELIVERY_API_BASE || document.querySelector('meta[name="api-base-url"]')?.content?.trim() || "http://localhost:5000/api").replace(/\/+$/, "");
    const FOOD_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22640%22%20height%3D%22360%22%20viewBox%3D%220%200%20640%20360%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23f1f3f5%22%2F%3E%3Cg%20fill%3D%22%2368707a%22%20font-family%3D%22Arial%2Csans-serif%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%22320%22%20y%3D%22175%22%20font-size%3D%2226%22%3EProductsDelivery%3C%2Ftext%3E%3Ctext%20x%3D%22320%22%20y%3D%22210%22%20font-size%3D%2216%22%3EImage%20unavailable%3C%2Ftext%3E%3C%2Fg%3E%3C%2Fsvg%3E";
    const RESTAURANT_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22640%22%20height%3D%22360%22%20viewBox%3D%220%200%20640%20360%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23f1f3f5%22%2F%3E%3Cg%20fill%3D%22%2368707a%22%20font-family%3D%22Arial%2Csans-serif%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%22320%22%20y%3D%22175%22%20font-size%3D%2226%22%3EProductsDelivery%3C%2Ftext%3E%3Ctext%20x%3D%22320%22%20y%3D%22210%22%20font-size%3D%2216%22%3EImage%20unavailable%3C%2Ftext%3E%3C%2Fg%3E%3C%2Fsvg%3E";

    // Market elements
    const marketName = document.getElementById("marketName");
    const marketImage = document.getElementById("marketImage");
    const marketDescription =
        document.getElementById("marketDescription");
    const marketStatus = document.getElementById("marketStatus");
    const marketRating = document.getElementById("marketRating");
    const marketCategory = document.getElementById("marketCategory");
    const marketDeliveryTime = document.getElementById("marketDeliveryTime");

    // Products elements
    const productsSearchForm = document.getElementById("productsSearchForm");
    const productsSearch = document.getElementById("productsSearch");
    const productsProductsGrid = document.getElementById("productsProductsGrid");
    const productsCategories = document.getElementById("productsCategories");
    const noProductsResults = document.getElementById("noProductsResults");
    const cartCount = document.getElementById("cartCount");

    let market = null;
    let productss = [];
    let cart = [];
    let selectedCategory = "all";

    /* =====================================================
       HELPERS
    ===================================================== */

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function formatPrice(value) {
        const price = Number(value);
        return `KSh ${Number.isFinite(price) ? price.toLocaleString("en-KE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }) : "0"}`;
    }

    function getImageUrl(value, fallback) {
        if (typeof value !== "string" || !value.trim()) {
            return fallback;
        }

        const url = value.trim();

        // Support complete URLs and project-relative image paths.
        if (/^(https?:\/\/|data:image\/)/i.test(url)) {
            return url;
        }

        return url;
    }

    function normalizeBoolean(value, fallback = false) {
        if (value === true || value === 1) return true;
        if (value === false || value === 0 || value == null) return false;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "1", "yes", "open", "available"].includes(normalized)) return true;
            if (["false", "0", "no", "closed", "unavailable", ""].includes(normalized)) return false;
        }
        return fallback;
    }

    function normalizeCategory(value) {
        return String(value || "Other")
            .trim()
            .toLowerCase();
    }

    function getMarketId() {
        return new URLSearchParams(window.location.search).get("id");
    }

    async function fetchJSON(url) {
        const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" }
        });

        const text = await response.text();
        let result;

        try {
            result = JSON.parse(text);
        } catch {
            throw new Error(
                `The server returned an invalid response (HTTP ${response.status}).`
            );
        }

        if (!response.ok || result.success === false) {
            throw new Error(
                result.message || `Request failed (HTTP ${response.status}).`
            );
        }

        return result;
    }

    /* =====================================================
       CART
    ===================================================== */

    try {
        const savedCart = localStorage.getItem("productsDeliveryCart");
        if (savedCart) {
            const parsedCart = JSON.parse(savedCart);
            cart = Array.isArray(parsedCart) ? parsedCart : [];
        }
    } catch (error) {
        console.error("Unable to load saved cart:", error);
        cart = [];
    }

    function updateCartCount() {
        if (!cartCount) return;

        const count = cart.reduce(
            (total, item) => total + Math.max(0, Number(item.quantity) || 0),
            0
        );

        cartCount.textContent = String(count);
    }

    function saveCart() {
        try {
            localStorage.setItem("productsDeliveryCart", JSON.stringify(cart));
            return true;
        } catch (error) {
            console.error("Unable to save cart:", error);
            alert("Your cart could not be saved in this browser. Check storage settings and available space.");
            return false;
        }
    }

    function addToCart(products, button) {
        if (!market || !products) return;

        const previousCart = cart.map(item => ({ ...item }));

        if (!normalizeBoolean(market.is_open)) {
            alert("This market is currently closed.");
            return;
        }

        if (!normalizeBoolean(products.is_available, true)) {
            alert("This product is currently unavailable.");
            return;
        }

        // Prevent a cart from mixing products from different markets.
        const otherMarketItem = cart.find(
            item =>
                item.restaurant_id != null &&
                String(item.restaurant_id) !== String(market.id)
        );

        if (otherMarketItem) {
            const confirmed = window.confirm(
                "Your cart contains items from another market. " +
                "Clear the existing cart and add this item?"
            );

            if (!confirmed) return;
            cart = [];
        }

        const existingItem = cart.find(
            item =>
                String(item.id) === String(products.id) &&
                String(item.restaurant_id) === String(products.restaurant_id)
        );

        if (existingItem) {
            const currentQuantity = Number(existingItem.quantity) || 0;
            if (currentQuantity >= 99) {
                alert("You can add up to 99 of one item per order.");
                return;
            }
            existingItem.quantity = currentQuantity + 1;
        } else {
            cart.push({
                id: products.id,
                restaurant_id: products.restaurant_id ?? market.id,
                market_name: market.name,
                market_is_open: normalizeBoolean(market.is_open),
                delivery_fee: (() => {
                    const fee = Number(market.delivery_fee ?? market.deliveryFee);
                    return Number.isFinite(fee) && fee >= 0 ? fee : null;
                })(),
                name: products.name,
                category: products.category_name || "Other",
                description: products.description || "",
                price: Number(products.price) || 0,
                image: getImageUrl(products.image_url, FOOD_PLACEHOLDER),
                quantity: 1
            });
        }

        if (!saveCart()) {
            // Restore the entire prior cart, including items cleared after a market switch.
            cart = previousCart;
            updateCartCount();
            return;
        }
        updateCartCount();

        if (button) {
            const originalText = button.textContent;
            button.textContent = "Added";
            button.disabled = true;

            window.setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
            }, 800);
        }
    }

    /* =====================================================
       RESTAURANT DETAILS
    ===================================================== */

    function updateMarketDetails(data) {
        market = data;

        if (marketName) {
            marketName.textContent = data.name || "Market";
        }

        if (marketDescription) {
            marketDescription.textContent =
                data.description || "Explore this market's products.";
        }

        if (marketImage) {
            marketImage.src = getImageUrl(
                data.cover_image_url || data.logo_url,
                RESTAURANT_PLACEHOLDER
            );

            marketImage.alt = data.name || "Market";

            marketImage.onerror = () => {
                marketImage.onerror = null;
                marketImage.src = RESTAURANT_PLACEHOLDER;
            };
        }

        if (marketStatus) {
            const isOpen = normalizeBoolean(data.is_open);
            marketStatus.textContent = isOpen ? "Open" : "Closed";
            marketStatus.classList.toggle("closed", !isOpen);
            marketStatus.setAttribute(
                "aria-label",
                isOpen ? "Market is open" : "Market is closed"
            );
        }

        if (marketCategory) {
            marketCategory.textContent = data.category || data.category_name || data.category_name || "Market";
        }

        if (marketRating) {
            const rating = Number(data.average_rating);
            marketRating.textContent =
                Number.isFinite(rating) && rating > 0
                    ? rating.toFixed(1)
                    : "No ratings";
        }

        // Update the market image even if the initial HTML has a placeholder.
        document.title = `${data.name || "Market"} | ProductsDelivery`;

        // Update the existing delivery and minimum-order values without
        // requiring changes to the page layout.
        const metaItems = document.querySelectorAll(
            ".market-details-meta .meta-item"
        );

        metaItems.forEach((item) => {
            const label = item.querySelector(".meta-label");
            const value = item.querySelector("strong");

            if (!label || !value) return;

            const key = label.textContent.trim().toLowerCase();

            if (key.includes("delivery") && !key.includes("time")) {
                value.textContent = formatPrice(data.delivery_fee);
            } else if (key.includes("delivery") && key.includes("time")) {
                value.textContent = data.delivery_time || data.estimated_delivery_time || "Not provided";
            } else if (key.includes("minimum")) {
                value.textContent = formatPrice(data.minimum_order);
            }
        });
    }

    async function loadMarket(id) {
        const result = await fetchJSON(
            `${API_BASE}/markets/${encodeURIComponent(id)}`
        );

        const data = result.data?.market || result.market;

        if (!data || data.id == null) {
            throw new Error("The API response did not contain market details.");
        }

        updateMarketDetails(data);
    }

    async function loadMarketReviews(marketId) {
        const container = document.getElementById("marketReviewsList");
        if (!container) return;
        try {
            const result = await fetchJSON(`${API_BASE}/reviews/market/${encodeURIComponent(marketId)}`);
            const reviews = Array.isArray(result) ? result : (result.data?.reviews || result.reviews || []);
            if (!reviews.length) { container.innerHTML = '<p class="home-message">No reviews yet. Place an order and share your experience after it is delivered.</p>'; return; }
            container.innerHTML = reviews.map(review => {
                const rating = Math.max(1, Math.min(5, Number(review.rating) || 0));
                const customer = escapeHTML(review.customer_name || "Customer");
                const comment = escapeHTML(review.comment || "No written comment provided.");
                const date = review.created_at ? new Date(review.created_at).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "";
                return `<article class="market-review-card"><div class="market-review-card-heading"><strong>${customer}</strong><span class="market-review-stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5-rating)}</span></div><p>${comment}</p><small>${escapeHTML(date)}</small></article>`;
            }).join("");
        } catch (error) {
            console.error("Could not load market reviews:", error);
            container.innerHTML = '<p class="home-message">Reviews could not be loaded right now.</p>';
        }
    }

    /* =====================================================
       MENU CATEGORY BUTTONS
    ===================================================== */

    function buildCategoryButtons() {
        if (!productsCategories) return;

        const categoryNames = [
            ...new Set(
                productss.map(products => String(products.category_name || "").trim())
                    .filter(Boolean)
            )
        ].sort((a, b) => a.localeCompare(b));

        productsCategories.innerHTML = "";

        const allButton = document.createElement("button");
        allButton.type = "button";
        allButton.className = "products-category active";
        allButton.dataset.category = "all";
        allButton.textContent = "All";
        productsCategories.appendChild(allButton);

        categoryNames.forEach(name => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "products-category";
            button.dataset.category = normalizeCategory(name);
            button.textContent = name;
            productsCategories.appendChild(button);
        });
    }

    /* =====================================================
       RENDER MENU
    ===================================================== */

    function renderProductss() {
        if (!productsProductsGrid) return;

        if (productss.length === 0) {
            productsProductsGrid.innerHTML =
                '<p class="home-message">This market has no available products items right now.</p>';

            if (noProductsResults) noProductsResults.hidden = true;
            return;
        }

        productsProductsGrid.innerHTML = productss.map(products => {
            const name = escapeHTML(products.name || "Product");
            const description = escapeHTML(products.description || "");
            const categoryName = String(products.category_name || "Other");
            const category = escapeHTML(normalizeCategory(categoryName));
            const price = escapeHTML(formatPrice(products.price));
            const image = escapeHTML(
                getImageUrl(products.image_url, FOOD_PLACEHOLDER)
            );
            const id = escapeHTML(products.id);
            const available = normalizeBoolean(products.is_available, true);

            return `
                <article
                    class="products-products-card"
                    data-products-name="${name}"
                    data-category="${category}"
                    data-products-id="${id}"
                >
                    <div class="products-products-image">
                        <img
                            src="${image}"
                            alt="${name}"
                            loading="lazy"
                            data-fallback="${FOOD_PLACEHOLDER}"
                        />
                    </div>

                    <div class="products-products-info">
                        <h3>${name}</h3>
                        <p>${description}</p>

                        <div class="products-products-bottom">
                            <strong>${price}</strong>
                            <button
                                type="button"
                                class="add-products-button"
                                data-products-id="${id}"
                                ${available ? "" : "disabled"}
                            >${available ? "Add" : "Unavailable"}</button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        productsProductsGrid.querySelectorAll("img[data-fallback]").forEach(image => {
            image.addEventListener("error", () => {
                image.onerror = null;
                image.removeAttribute("data-fallback");
                image.alt = `${image.alt || "Products image"} (image unavailable)`;
                image.style.display = "none";
                image.parentElement?.classList.add("image-unavailable");
            }, { once: true });
        });

        filterProducts();
    }

    async function loadProductss(marketId) {
        const result = await fetchJSON(`${API_BASE}/productss?restaurant_id=${encodeURIComponent(marketId)}`);

        const responseData = result.data?.productss ?? result.productss ?? result.data;
        let productsList;

        // Accommodate a plain array or a paginated/list object.
        if (Array.isArray(responseData)) {
            productsList = responseData;
        } else if (Array.isArray(responseData?.productss)) {
            productsList = responseData.productss;
        } else {
            throw new Error("The API response did not contain a products list.");
        }

        productss = productsList.filter(products =>
            products &&
            String(products.restaurant_id) === String(marketId) &&
            normalizeBoolean(products.is_available, true)
        );

        buildCategoryButtons();
        renderProductss();
    }

    /* =====================================================
       SEARCH AND FILTERS
    ===================================================== */

    function filterProducts() {
        if (!productsProductsGrid) return;

        const searchTerm = productsSearch
            ? productsSearch.value.trim().toLowerCase()
            : "";

        let visibleCount = 0;

        productsProductsGrid.querySelectorAll(".products-products-card").forEach(card => {
            const name = (card.dataset.productsName || "").toLowerCase();
            const text = card.textContent.toLowerCase();
            const category = normalizeCategory(card.dataset.category);

            const matchesSearch =
                !searchTerm ||
                name.includes(searchTerm) ||
                text.includes(searchTerm);

            const matchesCategory =
                selectedCategory === "all" ||
                category === selectedCategory;

            const visible = matchesSearch && matchesCategory;
            card.style.display = visible ? "" : "none";

            if (visible) visibleCount++;
        });

        if (noProductsResults) {
            noProductsResults.hidden = visibleCount !== 0;
        }
    }

    if (productsSearchForm) {
        productsSearchForm.addEventListener("submit", event => {
            event.preventDefault();
            filterProducts();
        });
    }

    if (productsSearch) {
        productsSearch.addEventListener("input", filterProducts);
    }

    if (productsCategories) {
        productsCategories.addEventListener("click", event => {
            const button = event.target.closest(".products-category");
            if (!button) return;

            selectedCategory =
                normalizeCategory(button.dataset.category || "all");

            productsCategories.querySelectorAll(".products-category")
                .forEach(item => item.classList.remove("active"));

            button.classList.add("active");
            filterProducts();
        });
    }

    /* =====================================================
       ADD-TO-CART EVENTS
       Delegation works for products cards loaded dynamically.
    ===================================================== */

    if (productsProductsGrid) {
        productsProductsGrid.addEventListener("click", event => {
            const button = event.target.closest(".add-products-button");
            if (!button || button.disabled) return;

            const products = productss.find(
                item => String(item.id) === String(button.dataset.productsId)
            );

            if (!products) {
                console.error("Could not find product for cart:", button.dataset.productsId);
                return;
            }

            addToCart(products, button);
        });
    }


    /* =====================================================
       INITIALIZE
    ===================================================== */

    async function initializePage() {
        updateCartCount();

        const id = getMarketId();

        if (!id || !/^[1-9]\d*$/.test(id)) {
            if (marketName) marketName.textContent = "Market not found";

            if (productsProductsGrid) {
                productsProductsGrid.innerHTML = '<p class="home-message">Please return to the markets page and select a market.</p>';
            }
            const hero = document.querySelector(".market-details-card");
            if (hero) hero.hidden = true;

            console.error("Missing or invalid market ID in page URL.");
            return;
        }

        try {
            await loadMarket(id);
            await loadMarketReviews(id);
        } catch (error) {
            console.error("Failed to load market details:", error);
            if (marketName) marketName.textContent = "Market unavailable";
            if (marketDescription) marketDescription.textContent = "We could not load this market. Return to the market list and try again.";
            if (productsProductsGrid) productsProductsGrid.innerHTML = '<p class="home-message">Market details could not be loaded. <a href="markets.html">Back to markets</a>.</p>';
            return;
        }

        try {
            await loadProductss(id);
        } catch (error) {
            console.error("Failed to load market page:", error);

            if (productsProductsGrid) {
                productsProductsGrid.innerHTML = '<p class="home-message">We could not load this products. Please refresh and try again, or <a href="markets.html">choose another market</a>.</p>';
            }
        }
    }

    initializePage();
});
