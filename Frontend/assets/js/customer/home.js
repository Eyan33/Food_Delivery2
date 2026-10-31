/* =========================================================
   CUSTOMER HOME PAGE
   Loads restaurants and food from the public API.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const API_BASE = (window.FOOD_DELIVERY_API_BASE || document.querySelector('meta[name="api-base-url"]')?.content?.trim() || (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "http://localhost:5000/api" : window.location.origin + "/api")).replace(/\/+$/, "");

    const restaurantGrid = document.getElementById("restaurantGrid");
    const foodGrid = document.getElementById("foodGrid");
    const usernameElement = document.getElementById("username");
    const cartCountElement = document.getElementById("cartCount");
    const searchForm = document.getElementById("homeSearchForm");
    const searchInput = document.getElementById("homeSearchInput");
    let allRestaurants = [];
    let allFoods = [];


    const RESTAURANT_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22400%22%3E%3Crect width=%22640%22 height=%22400%22 fill=%22%23f1f5f9%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 fill=%22%2364748b%22%3ERestaurant%3C/text%3E%3C/svg%3E";

    const FOOD_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22400%22%3E%3Crect width=%22640%22 height=%22400%22 fill=%22%23f1f5f9%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 fill=%22%2364748b%22%3EFood%20image%20unavailable%3C/text%3E%3C/svg%3E";


    // Personalized customer greeting
const greeting = document.getElementById("customerGreeting");

if (greeting) {
    const savedUser =
        localStorage.getItem("foodDeliveryUser") ||
        sessionStorage.getItem("foodDeliveryUser");

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

        // Permit embedded restaurant images, relative paths and normal HTTP(S) URLs.
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

    function renderRestaurants(restaurants) {
        if (!restaurantGrid) return;

        const availableRestaurants = restaurants
            .filter((restaurant) => restaurant && restaurant.is_active !== false)
            .sort((a, b) => {
                // Surface restaurants with customer reviews in the home section.
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

        if (availableRestaurants.length === 0) {
            showMessage(
                restaurantGrid,
                "No markets are available right now."
            );
            return;
        }

        restaurantGrid.innerHTML = availableRestaurants
            .slice(0, 6)
            .map((restaurant) => {
                const name = restaurant.name || "Market";
                const isOpen = restaurant.is_open === true;
                const rating = Number(restaurant.average_rating);
                const ratingCount = Number(restaurant.rating_count) || 0;
                const deliveryFee = Number(restaurant.delivery_fee);

                const hasRating = restaurant.average_rating !== null &&
                    restaurant.average_rating !== undefined &&
                    Number.isFinite(rating) && rating > 0 && ratingCount > 0;
                const ratingText = hasRating
                    ? `★ ${rating.toFixed(1)} (${ratingCount})`
                    : "No reviews yet";

                const deliveryText = Number.isFinite(deliveryFee)
                    ? `${formatKES(deliveryFee)} delivery`
                    : "Delivery fee unavailable";

                const firstLocationWord = String(restaurant.name || "Market").trim().split(/\s+/)[0] || "Market";
                const location = restaurant.location_name || `${firstLocationWord} Location`;

                const imageUrl = getImageUrl(
                    restaurant.logo_url || restaurant.cover_image_url,
                    RESTAURANT_PLACEHOLDER
                );

                return `
                    <article class="restaurant-card">
                        <div class="restaurant-image">
                            <img
                                src="${escapeHTML(imageUrl)}"
                                alt="${escapeHTML(name)}"
                                loading="lazy"
                                data-fallback="${RESTAURANT_PLACEHOLDER}"
                            >

                            <span class="restaurant-status">
                                ${isOpen ? "Open" : "Closed"}
                            </span>
                        </div>

                        <div class="restaurant-info">
                            <div class="restaurant-title">
                                <h3>${escapeHTML(name)}</h3>
                                <span class="rating">
                                    ${escapeHTML(ratingText)}
                                </span>
                            </div>

                            <p class="restaurant-category">
                                ${escapeHTML(location || restaurant.description || "Market")}
                            </p>

                            <div class="restaurant-meta">
                                <span>${escapeHTML(deliveryText)}</span>
                            </div>
                        </div>
                    </article>
                `;
            })
            .join("");
    }

    async function loadRestaurants() {
        if (!restaurantGrid) return;

        showMessage(restaurantGrid, "Loading markets...");

        try {
            const data = await fetchPublicData("/restaurants");
            const restaurants = Array.isArray(data.restaurants)
                ? data.restaurants
                : [];

            allRestaurants = restaurants;
            renderRestaurants(filterBySearch(allRestaurants, "restaurant"));
        } catch (error) {
            console.error("Customer homepage: failed to load restaurants:", error);

            showMessage(restaurantGrid, "We couldn't load restaurants. Please try again.", "error");
            addRetryButton(restaurantGrid, loadRestaurants);
        }
    }

    /* ---------------------------------------------------------
       FOOD
       --------------------------------------------------------- */

    function renderFoods(foods) {
        if (!foodGrid) return;

        // Only show food currently marked available.
        // The homepage Popular Foods section is curated by admins using
        // the is_featured checkbox in Operations > Catalog > Edit food.
        const availableFoods = foods.filter((food) => {
            return food && food.is_available === true && food.is_featured === true;
        });

        if (availableFoods.length === 0) {
            showMessage(
                foodGrid,
                "No popular meals are available right now."
            );
            return;
        }

        foodGrid.innerHTML = availableFoods
            .slice(0, 6)
            .map((food) => {
                const name = food.name || "Food item";
                const restaurantName =
                    food.restaurant_name || "Market";
                const description =
                    food.description || "A delicious meal to enjoy.";

                const imageUrl = getImageUrl(
                    food.image_url,
                    FOOD_PLACEHOLDER
                );

                return `
                    <article class="food-card">
                        <div class="food-image">
                            <img
                                src="${escapeHTML(imageUrl)}"
                                alt="${escapeHTML(name)}"
                                loading="lazy"
                                data-fallback="${FOOD_PLACEHOLDER}"
                            >

                            ${
                                food.is_featured
                                    ? '<span class="food-featured-label">Featured</span>'
                                    : ""
                            }
                        </div>

                        <div class="food-info">
                            <p class="food-restaurant">
                                ${escapeHTML(restaurantName)}
                            </p>

                            <h3>${escapeHTML(name)}</h3>

                            <p class="food-description">
                                ${escapeHTML(description)}
                            </p>

                            <div class="food-bottom">
                                <strong>${escapeHTML(formatKES(food.price))}</strong>

                                <button
                                    type="button"
                                    class="add-food-button"
                                    data-food-id="${escapeHTML(food.id)}"
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

    async function loadFoods() {
        if (!foodGrid) return;

        showMessage(foodGrid, "Loading meals...");

        try {
            const data = await fetchPublicData("/foods");
            const foods = Array.isArray(data.foods) ? data.foods : [];
            allFoods = foods;
            renderFoods(filterBySearch(allFoods, "food"));
        } catch (error) {
            console.error("Customer homepage: failed to load foods:", error);

            showMessage(foodGrid, "We couldn't load products. Please try again.", "error");
            addRetryButton(foodGrid, loadFoods);
        }
    }

    function filterBySearch(items, kind) {
        const term = (searchInput?.value || "").trim().toLowerCase();
        if (!term) return items;
        return items.filter(item => {
            const restaurantName = kind === "food" ? (item.restaurant_name || allRestaurants.find(r => String(r.id) === String(item.restaurant_id))?.name || "") : "";
            return [item.name, item.description, item.city, item.address, item.category_name, item.category, restaurantName].filter(Boolean).join(" ").toLowerCase().includes(term);
        });
    }
    function addRetryButton(container, retry) {
        const button = document.createElement("button"); button.type = "button"; button.className = "home-retry-button"; button.textContent = "Try again";
        button.addEventListener("click", retry); container.appendChild(button); container.setAttribute("aria-busy", "false");
    }
    function updateCartCount() {
        if (!cartCountElement) return;
        try { const items = JSON.parse(localStorage.getItem("foodDeliveryCart") || "[]"); cartCountElement.textContent = String(Array.isArray(items) ? items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0) : 0); } catch { cartCountElement.textContent = "0"; }
    }
    function addFoodToCart(foodId, button) {
        const food = allFoods.find(item => String(item.id) === String(foodId)); if (!food) return;
        const restaurant = allRestaurants.find(item => String(item.id) === String(food.restaurant_id));
        if (restaurant && [false, "false", 0].includes(restaurant.is_open)) { showMessage(foodGrid, "This market is currently closed."); return; }
        if ([false, "false", 0].includes(food.is_available)) { showMessage(foodGrid, "This product is currently unavailable."); return; }
        let cart; try { cart = JSON.parse(localStorage.getItem("foodDeliveryCart") || "[]"); } catch { cart = []; } if (!Array.isArray(cart)) cart = [];
        const restaurantId = food.restaurant_id ?? restaurant?.id;
        if (cart.length && cart.some(item => item.restaurant_id != null && restaurantId != null && String(item.restaurant_id) !== String(restaurantId))) { if (!window.confirm("Your cart contains items from another market. Clear it and add this product?")) return; cart = []; }
        const existing = cart.find(item => String(item.id) === String(food.id) && String(item.restaurant_id) === String(restaurantId));
        if (existing) existing.quantity = Math.max(1, Number(existing.quantity) || 1) + 1;
        else cart.push({ id: food.id, restaurant_id: restaurantId, restaurant_name: food.restaurant_name || restaurant?.name || "Market", restaurant_is_open: restaurant?.is_open, delivery_fee: restaurant?.delivery_fee, name: food.name || "Food item", category: food.category_name || food.category || "Other", description: food.description || "", price: Number(food.price) || 0, image: getImageUrl(food.image_url, FOOD_PLACEHOLDER), quantity: 1 });
        try { localStorage.setItem("foodDeliveryCart", JSON.stringify(cart)); } catch { showMessage(foodGrid, "Could not save your cart. Check browser storage.", "error"); return; }
        updateCartCount(); if (button) { const old = button.textContent; button.textContent = "✓"; window.setTimeout(() => button.textContent = old, 900); }
    }
    searchForm?.addEventListener("submit", event => { event.preventDefault(); const term = (searchInput?.value || "").trim(); if (term) window.location.href = "restaurants.html?search=" + encodeURIComponent(term); });
    searchInput?.addEventListener("input", () => { renderRestaurants(filterBySearch(allRestaurants, "restaurant")); renderFoods(filterBySearch(allFoods, "food")); });
    foodGrid?.addEventListener("click", event => { const button = event.target.closest(".add-food-button"); if (button) addFoodToCart(button.dataset.foodId, button); });
    restaurantGrid?.addEventListener("click", event => { const card = event.target.closest("[data-restaurant-url]"); if (card) window.location.href = card.dataset.restaurantUrl; });
    restaurantGrid?.addEventListener("keydown", event => { const card = event.target.closest("[data-restaurant-url]"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); window.location.href = card.dataset.restaurantUrl; } });
    window.addEventListener("storage", event => { if (event.key === "foodDeliveryCart") updateCartCount(); });


    /* ---------------------------------------------------------
       INITIALIZE HOMEPAGE
       --------------------------------------------------------- */

    setCustomerGreeting();

    // Load both sections independently so one failure doesn't hide the other.
    loadRestaurants();
    loadFoods();
});