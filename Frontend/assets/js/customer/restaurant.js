
/* =========================================================
   CUSTOMER RESTAURANT PAGE
   Loads restaurant details and menu from the backend.
   Preserves cart, search, category filters and mobile nav.
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const API_BASE = (window.FOOD_DELIVERY_API_BASE || document.querySelector('meta[name="api-base-url"]')?.content?.trim() || "http://localhost:5000/api").replace(/\/+$/, "");
    const FOOD_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22640%22%20height%3D%22360%22%20viewBox%3D%220%200%20640%20360%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23f1f3f5%22%2F%3E%3Cg%20fill%3D%22%2368707a%22%20font-family%3D%22Arial%2Csans-serif%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%22320%22%20y%3D%22175%22%20font-size%3D%2226%22%3EFoodDelivery%3C%2Ftext%3E%3Ctext%20x%3D%22320%22%20y%3D%22210%22%20font-size%3D%2216%22%3EImage%20unavailable%3C%2Ftext%3E%3C%2Fg%3E%3C%2Fsvg%3E";
    const RESTAURANT_PLACEHOLDER =
        "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22640%22%20height%3D%22360%22%20viewBox%3D%220%200%20640%20360%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23f1f3f5%22%2F%3E%3Cg%20fill%3D%22%2368707a%22%20font-family%3D%22Arial%2Csans-serif%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%22320%22%20y%3D%22175%22%20font-size%3D%2226%22%3EFoodDelivery%3C%2Ftext%3E%3Ctext%20x%3D%22320%22%20y%3D%22210%22%20font-size%3D%2216%22%3EImage%20unavailable%3C%2Ftext%3E%3C%2Fg%3E%3C%2Fsvg%3E";

    // Restaurant elements
    const restaurantName = document.getElementById("restaurantName");
    const restaurantImage = document.getElementById("restaurantImage");
    const restaurantDescription =
        document.getElementById("restaurantDescription");
    const restaurantStatus = document.getElementById("restaurantStatus");
    const restaurantRating = document.getElementById("restaurantRating");
    const restaurantCuisine = document.getElementById("restaurantCuisine");
    const restaurantDeliveryTime = document.getElementById("restaurantDeliveryTime");

    // Menu elements
    const menuSearchForm = document.getElementById("menuSearchForm");
    const menuSearch = document.getElementById("menuSearch");
    const menuFoodGrid = document.getElementById("menuFoodGrid");
    const menuCategories = document.getElementById("menuCategories");
    const noMenuResults = document.getElementById("noMenuResults");
    const cartCount = document.getElementById("cartCount");

    let restaurant = null;
    let foods = [];
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

    function getRestaurantId() {
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
        const savedCart = localStorage.getItem("foodDeliveryCart");
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
            localStorage.setItem("foodDeliveryCart", JSON.stringify(cart));
            return true;
        } catch (error) {
            console.error("Unable to save cart:", error);
            alert("Your cart could not be saved in this browser. Check storage settings and available space.");
            return false;
        }
    }

    function addToCart(food, button) {
        if (!restaurant || !food) return;

        const previousCart = cart.map(item => ({ ...item }));

        if (!normalizeBoolean(restaurant.is_open)) {
            alert("This market is currently closed.");
            return;
        }

        if (!normalizeBoolean(food.is_available, true)) {
            alert("This product is currently unavailable.");
            return;
        }

        // Prevent a cart from mixing food from different restaurants.
        const otherRestaurantItem = cart.find(
            item =>
                item.restaurant_id != null &&
                String(item.restaurant_id) !== String(restaurant.id)
        );

        if (otherRestaurantItem) {
            const confirmed = window.confirm(
                "Your cart contains items from another market. " +
                "Clear the existing cart and add this product?"
            );

            if (!confirmed) return;
            cart = [];
        }

        const existingItem = cart.find(
            item =>
                String(item.id) === String(food.id) &&
                String(item.restaurant_id) === String(food.restaurant_id)
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
                id: food.id,
                restaurant_id: food.restaurant_id ?? restaurant.id,
                restaurant_name: restaurant.name,
                restaurant_is_open: normalizeBoolean(restaurant.is_open),
                delivery_fee: (() => {
                    const fee = Number(restaurant.delivery_fee ?? restaurant.deliveryFee);
                    return Number.isFinite(fee) && fee >= 0 ? fee : null;
                })(),
                name: food.name,
                category: food.category_name || "Other",
                description: food.description || "",
                price: Number(food.price) || 0,
                image: getImageUrl(food.image_url, FOOD_PLACEHOLDER),
                quantity: 1
            });
        }

        if (!saveCart()) {
            // Restore the entire prior cart, including items cleared after a restaurant switch.
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

    function updateRestaurantDetails(data) {
        restaurant = data;

        if (restaurantName) {
            restaurantName.textContent = data.name || "Market";
        }

        if (restaurantDescription) {
            restaurantDescription.textContent =
                data.description || "Browse products available at this market.";
        }

        if (restaurantImage) {
            restaurantImage.src = getImageUrl(
                data.cover_image_url || data.logo_url,
                RESTAURANT_PLACEHOLDER
            );

            restaurantImage.alt = data.name || "Market";

            restaurantImage.onerror = () => {
                restaurantImage.onerror = null;
                restaurantImage.src = RESTAURANT_PLACEHOLDER;
            };
        }

        if (restaurantStatus) {
            const isOpen = normalizeBoolean(data.is_open);
            restaurantStatus.textContent = isOpen ? "Open" : "Closed";
            restaurantStatus.classList.toggle("closed", !isOpen);
            restaurantStatus.setAttribute(
                "aria-label",
                isOpen ? "Market is open" : "Market is closed"
            );
        }

        if (restaurantCuisine) {
            restaurantCuisine.textContent = data.cuisine || data.cuisine_name || data.category_name || "Market";
        }

        if (restaurantRating) {
            const rating = Number(data.average_rating);
            restaurantRating.textContent =
                Number.isFinite(rating) && rating > 0
                    ? rating.toFixed(1)
                    : "No ratings";
        }

        // Update the restaurant image even if the initial HTML has a placeholder.
        document.title = `${data.name || "Market"} | DeRon Market Deliveries`;

        // Update the existing delivery and minimum-order values without
        // requiring changes to the page layout.
        const metaItems = document.querySelectorAll(
            ".restaurant-details-meta .meta-item"
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

    async function loadRestaurant(id) {
        const result = await fetchJSON(
            `${API_BASE}/restaurants/${encodeURIComponent(id)}`
        );

        const data = result.data?.restaurant || result.restaurant;

        if (!data || data.id == null) {
            throw new Error("The API response did not contain market details.");
        }

        updateRestaurantDetails(data);
    }

    async function loadRestaurantReviews(restaurantId) {
        const container = document.getElementById("restaurantReviewsList");
        if (!container) return;
        try {
            const result = await fetchJSON(`${API_BASE}/reviews/restaurant/${encodeURIComponent(restaurantId)}`);
            const reviews = Array.isArray(result) ? result : (result.data?.reviews || result.reviews || []);
            if (!reviews.length) { container.innerHTML = '<p class="home-message">No reviews yet. Place an order and share your experience after it is delivered.</p>'; return; }
            container.innerHTML = reviews.map(review => {
                const rating = Math.max(1, Math.min(5, Number(review.rating) || 0));
                const customer = escapeHTML(review.customer_name || "Customer");
                const comment = escapeHTML(review.comment || "No written comment provided.");
                const date = review.created_at ? new Date(review.created_at).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "";
                return `<article class="restaurant-review-card"><div class="restaurant-review-card-heading"><strong>${customer}</strong><span class="restaurant-review-stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5-rating)}</span></div><p>${comment}</p><small>${escapeHTML(date)}</small></article>`;
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
        if (!menuCategories) return;

        const categoryNames = [
            ...new Set(
                foods.map(food => String(food.category_name || "").trim())
                    .filter(Boolean)
            )
        ].sort((a, b) => a.localeCompare(b));

        menuCategories.innerHTML = "";

        const allButton = document.createElement("button");
        allButton.type = "button";
        allButton.className = "menu-category active";
        allButton.dataset.category = "all";
        allButton.textContent = "All";
        menuCategories.appendChild(allButton);

        categoryNames.forEach(name => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "menu-category";
            button.dataset.category = normalizeCategory(name);
            button.textContent = name;
            menuCategories.appendChild(button);
        });
    }

    /* =====================================================
       RENDER MENU
    ===================================================== */

    function renderFoods() {
        if (!menuFoodGrid) return;

        if (foods.length === 0) {
            menuFoodGrid.innerHTML =
                '<p class="home-message">This restaurant has no available menu items right now.</p>';

            if (noMenuResults) noMenuResults.hidden = true;
            return;
        }

        menuFoodGrid.innerHTML = foods.map(food => {
            const name = escapeHTML(food.name || "Food item");
            const description = escapeHTML(food.description || "");
            const categoryName = String(food.category_name || "Other");
            const category = escapeHTML(normalizeCategory(categoryName));
            const price = escapeHTML(formatPrice(food.price));
            const image = escapeHTML(
                getImageUrl(food.image_url, FOOD_PLACEHOLDER)
            );
            const id = escapeHTML(food.id);
            const available = normalizeBoolean(food.is_available, true);

            return `
                <article
                    class="menu-food-card"
                    data-food-name="${name}"
                    data-category="${category}"
                    data-food-id="${id}"
                >
                    <div class="menu-food-image">
                        <img
                            src="${image}"
                            alt="${name}"
                            loading="lazy"
                            data-fallback="${FOOD_PLACEHOLDER}"
                        />
                    </div>

                    <div class="menu-food-info">
                        <h3>${name}</h3>
                        <p>${description}</p>

                        <div class="menu-food-bottom">
                            <strong>${price}</strong>
                            <button
                                type="button"
                                class="add-food-button"
                                data-food-id="${id}"
                                ${available ? "" : "disabled"}
                            >${available ? "Add" : "Unavailable"}</button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        menuFoodGrid.querySelectorAll("img[data-fallback]").forEach(image => {
            image.addEventListener("error", () => {
                image.onerror = null;
                image.removeAttribute("data-fallback");
                image.alt = `${image.alt || "Food image"} (image unavailable)`;
                image.style.display = "none";
                image.parentElement?.classList.add("image-unavailable");
            }, { once: true });
        });

        filterMenu();
    }

    async function loadFoods(restaurantId) {
        const result = await fetchJSON(`${API_BASE}/foods?restaurant_id=${encodeURIComponent(restaurantId)}`);

        const responseData = result.data?.foods ?? result.foods ?? result.data;
        let foodList;

        // Accommodate a plain array or a paginated/list object.
        if (Array.isArray(responseData)) {
            foodList = responseData;
        } else if (Array.isArray(responseData?.foods)) {
            foodList = responseData.foods;
        } else {
            throw new Error("The API response did not contain a food list.");
        }

        foods = foodList.filter(food =>
            food &&
            String(food.restaurant_id) === String(restaurantId) &&
            normalizeBoolean(food.is_available, true)
        );

        buildCategoryButtons();
        renderFoods();
    }

    /* =====================================================
       SEARCH AND FILTERS
    ===================================================== */

    function filterMenu() {
        if (!menuFoodGrid) return;

        const searchTerm = menuSearch
            ? menuSearch.value.trim().toLowerCase()
            : "";

        let visibleCount = 0;

        menuFoodGrid.querySelectorAll(".menu-food-card").forEach(card => {
            const name = (card.dataset.foodName || "").toLowerCase();
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

        if (noMenuResults) {
            noMenuResults.hidden = visibleCount !== 0;
        }
    }

    if (menuSearchForm) {
        menuSearchForm.addEventListener("submit", event => {
            event.preventDefault();
            filterMenu();
        });
    }

    if (menuSearch) {
        menuSearch.addEventListener("input", filterMenu);
    }

    if (menuCategories) {
        menuCategories.addEventListener("click", event => {
            const button = event.target.closest(".menu-category");
            if (!button) return;

            selectedCategory =
                normalizeCategory(button.dataset.category || "all");

            menuCategories.querySelectorAll(".menu-category")
                .forEach(item => item.classList.remove("active"));

            button.classList.add("active");
            filterMenu();
        });
    }

    /* =====================================================
       ADD-TO-CART EVENTS
       Delegation works for menu cards loaded dynamically.
    ===================================================== */

    if (menuFoodGrid) {
        menuFoodGrid.addEventListener("click", event => {
            const button = event.target.closest(".add-food-button");
            if (!button || button.disabled) return;

            const food = foods.find(
                item => String(item.id) === String(button.dataset.foodId)
            );

            if (!food) {
                console.error("Could not find food item for cart:", button.dataset.foodId);
                return;
            }

            addToCart(food, button);
        });
    }


    /* =====================================================
       INITIALIZE
    ===================================================== */

    async function initializePage() {
        updateCartCount();

        const id = getRestaurantId();

        if (!id || !/^[1-9]\d*$/.test(id)) {
            if (restaurantName) restaurantName.textContent = "Restaurant not found";

            if (menuFoodGrid) {
                menuFoodGrid.innerHTML = '<p class="home-message">Please return to the restaurants page and select a restaurant.</p>';
            }
            const hero = document.querySelector(".restaurant-details-card");
            if (hero) hero.hidden = true;

            console.error("Missing or invalid restaurant ID in page URL.");
            return;
        }

        try {
            await loadRestaurant(id);
            await loadRestaurantReviews(id);
        } catch (error) {
            console.error("Failed to load restaurant details:", error);
            if (restaurantName) restaurantName.textContent = "Restaurant unavailable";
            if (restaurantDescription) restaurantDescription.textContent = "We could not load this restaurant. Return to the restaurant list and try again.";
            if (menuFoodGrid) menuFoodGrid.innerHTML = '<p class="home-message">Market details could not be loaded. <a href="restaurants.html">Back to restaurants</a>.</p>';
            return;
        }

        try {
            await loadFoods(id);
        } catch (error) {
            console.error("Failed to load restaurant page:", error);

            if (menuFoodGrid) {
                menuFoodGrid.innerHTML = '<p class="home-message">We could not load this menu. Please refresh and try again, or <a href="restaurants.html">choose another restaurant</a>.</p>';
            }
        }
    }

    initializePage();
});
