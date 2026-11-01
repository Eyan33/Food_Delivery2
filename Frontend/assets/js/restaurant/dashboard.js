/* =========================================================
   RESTAURANT DASHBOARD JAVASCRIPT
   FoodDelivery
   Backend integration
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const api = window.FoodDeliveryAuthApi;

    const sidebar = document.getElementById("restaurantSidebar");
    const menuButton = document.getElementById("restaurantMenuButton");

    // Bind mobile navigation immediately, independently of dashboard data loading.
    if (menuButton && sidebar && !menuButton.dataset.mobileNavBound) {
        menuButton.dataset.mobileNavBound = "true";
        menuButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            sidebar.classList.toggle("open");
            menuButton.setAttribute("aria-expanded", String(sidebar.classList.contains("open")));
        });
        document.addEventListener("click", (event) => {
            if (!sidebar.contains(event.target) && !menuButton.contains(event.target)) {
                sidebar.classList.remove("open");
                menuButton.setAttribute("aria-expanded", "false");
            }
        });
        sidebar.querySelectorAll(".restaurant-nav-link").forEach((link) => {
            link.addEventListener("click", () => {
                if (window.innerWidth <= 900) {
                    sidebar.classList.remove("open");
                    menuButton.setAttribute("aria-expanded", "false");
                }
            });
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 900) sidebar.classList.remove("open");
        });
    }

    const statusButton = document.getElementById("restaurantStatusButton");
    const statusText = document.getElementById("restaurantStatusText");
    const toggleRestaurantStatus = document.getElementById("toggleRestaurantStatus");
    const statusPanelTitle = document.getElementById("statusPanelTitle");
    const statusPanelDescription = document.getElementById("statusPanelDescription");

    const notificationButton = document.querySelector(".restaurant-notification-button");
    const profileButton = document.querySelector(".restaurant-topbar-profile");
    const viewAllLinks = document.querySelectorAll(".view-all-link");
    const quickActions = document.querySelectorAll(".quick-action");

    const statCards = document.querySelectorAll(".restaurant-stat-card");
    const recentOrdersBody = document.querySelector(".restaurant-orders-table tbody");
    const dashboardDate = document.querySelector(".dashboard-date strong");
    const orderNavBadge = document.querySelector(
        '.restaurant-nav-link[href="orders.html"] .nav-badge'
    );

    let restaurantIsOpen = false;
    let isSavingStatus = false;
    let currentOrders = [];
    let currentRestaurant = null;

    /* =====================================================
       COMMON HELPERS
       ===================================================== */

    function showMessage(message, type = "error") {
        let element = document.getElementById("restaurantDashboardMessage");

        if (!element) {
            element = document.createElement("div");
            element.id = "restaurantDashboardMessage";
            element.setAttribute("role", "status");
            element.style.cssText =
                "margin:12px 0;padding:12px 16px;border-radius:8px;" +
                "font-size:14px;";

            const content = document.querySelector(".restaurant-dashboard-content");
            if (content) {
                content.prepend(element);
            } else {
                document.body.prepend(element);
            }
        }

        element.textContent = message;
        element.style.background =
            type === "error" ? "#fee2e2" : "#dcfce7";
        element.style.color =
            type === "error" ? "#991b1b" : "#166534";
        element.style.display = "block";
    }

    function clearMessage() {
        const element = document.getElementById("restaurantDashboardMessage");
        if (element) element.style.display = "none";
    }

    function formatCurrency(value) {
        const amount = Number(value) || 0;

        return "KSh " + amount.toLocaleString("en-KE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }

    function formatDateTime(value) {
        if (!value) return "—";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";

        return date.toLocaleTimeString("en-KE", {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[character]);
    }

    function getCustomerName(order) {
        const firstName = order.customer_first_name || "";
        const lastName = order.customer_last_name || "";
        const fullName = `${firstName} ${lastName}`.trim();

        return fullName ||
            order.recipient_name ||
            order.customer_name ||
            "Customer";
    }

    function getInitials(name) {
        return String(name)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part.charAt(0).toUpperCase())
            .join("") || "C";
    }

    function getStatusLabel(status) {
        const labels = {
            pending: "Pending",
            confirmed: "Confirmed",
            preparing: "Preparing",
            ready: "Ready",
            out_for_delivery: "Out for delivery",
            delivered: "Delivered",
            cancelled: "Cancelled"
        };

        return labels[String(status || "").toLowerCase()] || "Unknown";
    }

    function getStatusClass(status) {
        const normalized = String(status || "").toLowerCase();

        return [
            "pending",
            "confirmed",
            "preparing",
            "ready",
            "out_for_delivery",
            "delivered",
            "cancelled"
        ].includes(normalized) ? normalized : "pending";
    }

    function getOrderDate(order) {
        return order.placed_at || order.created_at || null;
    }

    function isToday(value) {
        if (!value) return false;

        const date = new Date(value);
        const today = new Date();

        return !Number.isNaN(date.getTime()) &&
            date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    }

    async function apiRequest(path, options = {}) {
        if (!api || typeof api.request !== "function") {
            throw new Error(
                "The API helper is not loaded. Check dashboard.html includes auth-api.js before dashboard.js."
            );
        }

        return api.request(path, {
            ...options,
            authenticated: true
        });
    }

    /* =====================================================
       AUTHENTICATION CHECK
       ===================================================== */

    async function checkRestaurantSession() {
        if (!api || !api.getToken || !api.getToken()) {
            showMessage("Please log in with your restaurant account to view this dashboard.");
            return false;
        }

        const user = api.getCurrentUser ? api.getCurrentUser() : null;

        if (user && user.role && user.role !== "restaurant") {
            showMessage("This page is only available to restaurant accounts.");
            return false;
        }

        return true;
    }

    /* =====================================================
       RESTAURANT PROFILE
       ===================================================== */

    function renderRestaurantProfile(restaurant) {
        if (!restaurant) return;

        currentRestaurant = restaurant;
        restaurantIsOpen = Boolean(restaurant.is_open);

        const profileInfo = document.querySelector(".restaurant-profile-info");
        if (profileInfo) {
            const name = profileInfo.querySelector("strong");
            const subtitle = profileInfo.querySelector("span");

            if (name) name.textContent = restaurant.name || "My Restaurant";
            if (subtitle) subtitle.textContent = "Restaurant";
        }

        const avatar = document.querySelector(".restaurant-avatar");
        if (avatar) avatar.textContent = getInitials(restaurant.name || "Restaurant");

        const topbarAvatar = document.querySelector(".topbar-avatar");
        if (topbarAvatar) topbarAvatar.textContent = getInitials(restaurant.name || "Restaurant");

        const sidebarName = document.getElementById("restaurantSidebarName");
        if (sidebarName) sidebarName.textContent = restaurant.name || "My Restaurant";
        const topbarName = document.getElementById("restaurantTopbarName");
        if (topbarName) topbarName.textContent = restaurant.name || "My Restaurant";

        const welcomeHeading = document.getElementById("restaurantWelcomeHeading");
        if (welcomeHeading) {
            const hour = new Date().getHours();
            const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
            welcomeHeading.textContent = `${greeting}, ${restaurant.name || "your restaurant"}`;
        }

        const welcomeBack = document.getElementById("restaurantWelcomeBack");
        if (welcomeBack) welcomeBack.textContent = `Welcome back, ${restaurant.name || "your restaurant"}`;

        updateRestaurantStatusUI();
    }

    async function loadRestaurantProfile() {
        const result = await apiRequest("/restaurants/owner/me");
        const restaurant = result.restaurant || result;

        renderRestaurantProfile(restaurant);
        return restaurant;
    }

    /* =====================================================
       RESTAURANT OPEN / CLOSED STATUS
       ===================================================== */

    function updateRestaurantStatusUI() {
        if (statusButton) {
            statusButton.classList.toggle("open", restaurantIsOpen);
            statusButton.classList.toggle("closed", !restaurantIsOpen);
            statusButton.setAttribute("aria-pressed", String(restaurantIsOpen));
        }

        if (statusText) {
            statusText.textContent = restaurantIsOpen ? "Open" : "Closed";
        }

        if (statusPanelTitle) {
            statusPanelTitle.textContent = restaurantIsOpen
                ? "Your restaurant is open"
                : "Your restaurant is closed";
        }

        if (statusPanelDescription) {
            statusPanelDescription.textContent = restaurantIsOpen
                ? "Customers can currently place orders."
                : "Customers cannot currently place new orders.";
        }

        if (toggleRestaurantStatus) {
            toggleRestaurantStatus.textContent = restaurantIsOpen
                ? "Close Restaurant"
                : "Open Restaurant";

            toggleRestaurantStatus.classList.toggle("closed", !restaurantIsOpen);
            toggleRestaurantStatus.disabled = isSavingStatus;
        }
    }

    async function toggleStatus() {
        if (isSavingStatus) return;

        if (!currentRestaurant) {
            showMessage("Restaurant details have not loaded yet. Please try again.");
            return;
        }

        const requestedStatus = !restaurantIsOpen;
        isSavingStatus = true;
        updateRestaurantStatusUI();
        clearMessage();

        try {
            const result = await apiRequest("/restaurants/owner/status", {
                method: "PATCH",
                body: { is_open: requestedStatus }
            });

            const restaurant = result.restaurant || result;

            restaurantIsOpen = typeof restaurant.is_open === "boolean"
                ? restaurant.is_open
                : requestedStatus;

            currentRestaurant = {
                ...currentRestaurant,
                ...restaurant,
                is_open: restaurantIsOpen
            };

            updateRestaurantStatusUI();
            showMessage(
                restaurantIsOpen
                    ? "Your restaurant is now open."
                    : "Your restaurant is now closed.",
                "success"
            );
        } catch (error) {
            updateRestaurantStatusUI();
            showMessage(error.message || "Could not update restaurant status.");
        } finally {
            isSavingStatus = false;
            updateRestaurantStatusUI();
        }
    }

    if (toggleRestaurantStatus) {
        toggleRestaurantStatus.addEventListener("click", toggleStatus);
    }

    if (statusButton) {
        statusButton.addEventListener("click", toggleStatus);
    }

    /* =====================================================
       DASHBOARD STATISTICS
       ===================================================== */

    function updateStatCard(index, value, description) {
        const card = statCards[index];
        if (!card) return;

        const content = card.querySelector(".stat-card-content");
        if (!content) return;

        const strong = content.querySelector("strong");
        const small = content.querySelector("small");

        if (strong) strong.textContent = value;
        if (small && description !== undefined) {
            small.textContent = description;
        }
    }

    function renderStatistics(orders, foods, ordersFailed = false, foodsFailed = false) {
        const safeOrders = Array.isArray(orders) ? orders : [];
        const todaysOrders = safeOrders.filter(order => isToday(getOrderDate(order)));
        const pendingOrders = safeOrders.filter(order => String(order.status || "").toLowerCase() === "pending");

        // Revenue represents delivered orders, not orders that may still be cancelled.
        const todaysRevenue = todaysOrders.reduce((total, order) => {
            if (String(order.status || "").toLowerCase() !== "delivered") return total;
            // Restaurant revenue is food subtotal only; exclude delivery fees.
            return total + (Number(order.subtotal) || 0);
        }, 0);

        const foodList = Array.isArray(foods) ? foods : Array.isArray(foods?.foods) ? foods.foods : [];
        const activeFoodCount = foodList.filter(food => food.is_active !== false).length;
        const availableFoodCount = foodList.filter(food => food.is_active !== false && food.is_available !== false).length;

        updateStatCard(0, ordersFailed ? "—" : String(todaysOrders.length),
            ordersFailed ? "Could not load orders" : "All statuses, placed today");
        updateStatCard(1, ordersFailed ? "—" : String(pendingOrders.length),
            ordersFailed ? "Could not load pending orders" : "Currently awaiting action");
        updateStatCard(2, ordersFailed ? "—" : formatCurrency(todaysRevenue),
            ordersFailed ? "Could not calculate revenue" : "Delivered orders placed today");
        updateStatCard(3, foodsFailed ? "—" : String(activeFoodCount),
            foodsFailed ? "Could not load menu items" : `${availableFoodCount} currently available`);

        const firstBadge = statCards[0]?.querySelector(".stat-change");
        if (firstBadge) firstBadge.textContent = ordersFailed ? "Unavailable" : "Today";
        const pendingBadge = statCards[1]?.querySelector(".stat-change");
        if (pendingBadge) pendingBadge.textContent = ordersFailed ? "Unavailable" : `${pendingOrders.length} pending`;
        const revenueBadge = statCards[2]?.querySelector(".stat-change");
        if (revenueBadge) revenueBadge.textContent = ordersFailed ? "Unavailable" : "Today";
        const menuBadge = statCards[3]?.querySelector(".stat-change");
        if (menuBadge) menuBadge.textContent = foodsFailed ? "Unavailable" : "Menu";

        if (dashboardDate) {
            dashboardDate.textContent = new Date().toLocaleDateString("en-KE", {
                day: "numeric", month: "long", year: "numeric"
            });
        }

        if (orderNavBadge) {
            orderNavBadge.textContent = ordersFailed ? "" : String(pendingOrders.length);
            orderNavBadge.style.display = !ordersFailed && pendingOrders.length ? "" : "none";
        }
    }

    /* =====================================================
       RECENT ORDERS TABLE
       ===================================================== */

    function renderRecentOrders(orders, failed = false) {
        if (!recentOrdersBody) return;

        if (failed) {
            recentOrdersBody.innerHTML = `
                <tr><td colspan="6" style="text-align:center;padding:24px;">
                    We could not load recent orders. Refresh the page and try again.
                </td></tr>`;
            return;
        }

        const recentOrders = [...(Array.isArray(orders) ? orders : [])]
            .sort((a, b) => new Date(getOrderDate(b) || 0).getTime() - new Date(getOrderDate(a) || 0).getTime())
            .slice(0, 5);

        if (!recentOrders.length) {
            recentOrdersBody.innerHTML = `
                <tr><td colspan="6" style="text-align:center;padding:24px;">
                    No orders have been received yet.
                </td></tr>`;
            return;
        }

        recentOrdersBody.innerHTML = recentOrders.map(order => {
            const customerName = getCustomerName(order);
            const status = getStatusClass(order.status);
            const orderNumber = order.order_number || `#${order.id}`;
            const amount = formatCurrency(order.total_amount);
            const time = formatDateTime(getOrderDate(order));
            const count = Number(order.item_count);
            const itemLabel = Number.isFinite(count) && count >= 0
                ? `${count} ${count === 1 ? "item" : "items"}`
                : "—";

            return `
                <tr data-order-id="${escapeHtml(orderNumber)}" data-status="${escapeHtml(status)}">
                    <td><strong>${escapeHtml(orderNumber)}</strong></td>
                    <td><div class="customer-table-info">
                        <span class="customer-small-avatar">${escapeHtml(getInitials(customerName))}</span>
                        <span>${escapeHtml(customerName)}</span>
                    </div></td>
                    <td>${escapeHtml(itemLabel)}</td>
                    <td><strong>${escapeHtml(amount)}</strong></td>
                    <td><span class="order-status ${escapeHtml(status)}">${escapeHtml(getStatusLabel(status))}</span></td>
                    <td>${escapeHtml(time)}</td>
                </tr>`;
        }).join("");
    }

    /* =====================================================
       LOAD ORDERS AND MENU ITEMS
       ===================================================== */

    async function loadDashboardData() {
        const results = await Promise.allSettled([
            apiRequest("/orders/restaurant"),
            apiRequest("/foods/restaurant/my")
        ]);

        let orders = null;
        let foods = null;
        const errors = [];

        if (results[0].status === "fulfilled") {
            const result = results[0].value;
            if (Array.isArray(result?.orders)) orders = result.orders;
            else if (Array.isArray(result)) orders = result;
            else errors.push("Orders: the API returned an unexpected response.");
        } else {
            errors.push(`Orders: ${results[0].reason?.message || "request failed"}`);
        }

        if (results[1].status === "fulfilled") {
            const result = results[1].value;
            if (Array.isArray(result?.foods)) foods = result.foods;
            else if (Array.isArray(result)) foods = result;
            else errors.push("Menu: the API returned an unexpected response.");
        } else {
            errors.push(`Menu: ${results[1].reason?.message || "request failed"}`);
        }

        currentOrders = Array.isArray(orders) ? orders : [];
        renderStatistics(orders, foods, orders === null, foods === null);
        renderRecentOrders(orders, orders === null);

        if (errors.length) {
            showMessage("Some dashboard data could not be loaded. " + errors.join(" | "));
        } else {
            clearMessage();
        }
    }


    /* Notifications are omitted until a real notification endpoint exists. */

    const logoutLink = document.querySelector(".logout-link");
    if (logoutLink) {
        logoutLink.addEventListener("click", event => {
            event.preventDefault();
            if (api && typeof api.clearSession === "function") api.clearSession();
            window.location.href = "../../pages/auth/login.html";
        });
    }

    /* =====================================================
       PROFILE BUTTON
       ===================================================== */

    if (profileButton) {
        profileButton.addEventListener("click", () => {
            window.location.href = "restaurant-profile.html";
        });
    }

    /* =====================================================
       DASHBOARD LINKS AND QUICK ACTIONS
       ===================================================== */

    viewAllLinks.forEach(link => {
        const text = link.textContent.trim().toLowerCase();

        if (text.includes("view all")) {
            link.addEventListener("click", event => {
                event.preventDefault();
                window.location.href = "orders.html";
            });
        }
    });

    quickActions.forEach(action => {
        const actionText = action.textContent.trim().toLowerCase();

        action.addEventListener("click", event => {
            event.preventDefault();
            if (actionText.includes("view orders")) {
                window.location.href = "orders.html";
            } else if (actionText.includes("edit restaurant")) {
                window.location.href = "restaurant-profile.html";
            } else if (actionText.includes("view earnings")) {
                window.location.href = "earnings.html";
            }
        });
    });

    /* =====================================================
       INITIALIZE
       ===================================================== */

    async function initializeDashboard() {
        if (dashboardDate) {
            dashboardDate.textContent = new Date().toLocaleDateString("en-KE", {
                day: "numeric", month: "long", year: "numeric"
            });
        }

        const authenticated = await checkRestaurantSession();
        if (!authenticated) return;

        clearMessage();

        const results = await Promise.allSettled([
            loadRestaurantProfile(),
            loadDashboardData()
        ]);

        const profileResult = results[0];
        if (profileResult.status === "rejected") {
            showMessage(
                profileResult.reason.message ||
                "Could not load your restaurant profile."
            );
        }
    }

    initializeDashboard();
});