(() => {
    "use strict";

    const PAGE_SIZE = 6;
    const DAILY_TARGET = 45000;

    const state = {
        page: 1,
        status: "all",
        search: "",
        loading: false,
    };

    let summaryRequestId = 0;
    let ordersRequestId = 0;
    let detailRequestId = 0;
    let foodRequestId = 0;
    let createOrderSubmitting = false;
    let modalOpen = false;

    const api = window.FoodDeliveryAuthApi;

    if (!api?.request) {
        console.error(
            "FoodDeliveryAuthApi is not loaded. Add auth-api.js before orders.js.",
        );
        return;
    }

    const formatNumber = (value) =>
        new Intl.NumberFormat("en-KE").format(
            Number(value) || 0,
        );

    const formatMoney = (value) =>
        `KSh ${formatNumber(value)}`;

    
function renderDailyRevenueTarget(actualRevenue, target) {
    const actual = Math.max(0, Number(actualRevenue) || 0);
    const goal = Math.max(1, Number(target) || 25000);
    const percentage = (actual / goal) * 100;
    const progress = Math.min(100, percentage);
    const remaining = Math.max(0, goal - actual);

    const input = document.getElementById("dailyRevenueTargetInput");
    const actualNode = document.getElementById("dailyRevenueActual");
    const bar = document.getElementById("dailyRevenueProgressBar");
    const track = document.getElementById("dailyRevenueProgressTrack");
    const progressText = document.getElementById("dailyRevenueProgressText");
    const remainingNode = document.getElementById("dailyRevenueRemaining");

    if (input && document.activeElement !== input) {
        input.value = String(goal);
    }

    if (actualNode) actualNode.textContent = formatMoney(actual);
    if (bar) bar.style.width = `${progress}%`;

    if (track) {
        track.setAttribute("aria-valuenow", String(Math.round(progress)));
    }

    if (progressText) {
        progressText.textContent = `${percentage.toFixed(1)}% of target`;
    }

    if (remainingNode) {
        remainingNode.textContent = remaining > 0
            ? `${formatMoney(remaining)} remaining`
            : `Target exceeded by ${formatMoney(actual - goal)}`;
    }
}

function setDailyTargetMessage(message, isError = false) {
    const node = document.getElementById("dailyRevenueTargetMessage");

    if (!node) return;

    node.textContent = message;
    node.style.color = isError ? "#b91c1c" : "#15803d";
}


    const getInitials = (name = "") =>
        String(name)
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0])
            .join("")
            .toUpperCase() || "—";

    const escapeHtml = (value = "") =>
        String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

    function showMessage(
        message,
        type = "success",
    ) {
        const box =
            document.getElementById(
                "adminMessage",
            );

        if (!box) return;

        box.textContent = message;
        box.className =
            `admin-message ${type}`;

        window.clearTimeout(
            showMessage.timer,
        );

        showMessage.timer =
            window.setTimeout(() => {
                box.textContent = "";
                box.className =
                    "admin-message";
            }, 4000);
    }

    function setLoading(
        button,
        loading,
        loadingText,
        normalText,
    ) {
        if (!button) return;

        button.disabled = loading;
        button.textContent = loading
            ? loadingText
            : normalText;
    }

    /*
    |--------------------------------------------------------------------------
    | Admin header
    |--------------------------------------------------------------------------
    */

    function renderAdminHeader(data) {
        const user =
            data.admin || {
                name: "Admin User",
                role: "Administrator",
            };

        document
            .querySelectorAll(
                ".admin-profile-info strong, .admin-topbar-profile-info strong",
            )
            .forEach((element) => {
                element.textContent =
                    user.name || "Admin User";
            });

        document
            .querySelectorAll(
                ".admin-profile-info span, .admin-topbar-profile-info span",
            )
            .forEach((element) => {
                element.textContent =
                    user.role || "Administrator";
            });

        document
            .querySelectorAll(
                ".admin-profile-avatar, .admin-topbar-avatar",
            )
            .forEach((element) => {
                element.textContent =
                    getInitials(
                        user.name ||
                            "Admin User",
                    );
            });

        const notificationBadge =
            document.querySelector(
                ".admin-notification-badge",
            );

        if (
            notificationBadge &&
            data.notificationCount !==
                undefined
        ) {
            notificationBadge.textContent =
                formatNumber(
                    data.notificationCount,
                );
        }

        const orderBadge =
            document.querySelector(
                ".admin-nav-badge",
            );

        if (
            orderBadge &&
            data.statistics
        ) {
            orderBadge.textContent =
                formatNumber(
                    data.statistics.pending,
                );
        }
    }

    /*
    |--------------------------------------------------------------------------
    | API
    |--------------------------------------------------------------------------
    */

    const ordersApi = {
        async getOrders() {
            const params =
                new URLSearchParams();

            params.set(
                "page",
                String(state.page),
            );

            params.set(
                "limit",
                String(PAGE_SIZE),
            );

            if (
                state.status &&
                state.status !== "all"
            ) {
                params.set(
                    "status",
                    state.status,
                );
            }

            if (state.search) {
                params.set(
                    "search",
                    state.search,
                );
            }

            return api.request(
                `/orders/admin?${params.toString()}`,
                {
                    authenticated: true,
                },
            );
        },

        async getSummary() {
            return api.request(
                "/orders/admin/summary",
                {
                    authenticated: true,
                },
            );
        },

        async getOptions(
            restaurantId = "",
        ) {
            const params =
                new URLSearchParams();

            if (restaurantId) {
                params.set(
                    "restaurant_id",
                    String(
                        restaurantId,
                    ),
                );
            }

            const suffix =
                params.toString()
                    ? `?${params.toString()}`
                    : "";

            return api.request(
                `/orders/admin/options${suffix}`,
                {
                    authenticated: true,
                },
            );
        },

        async createOrder(payload) {
            return api.request(
                "/orders/admin",
                {
                    method: "POST",
                    authenticated: true,
                    body: payload,
                },
            );
        },

        async getOrder(id) {
            return api.request(
                `/orders/admin/${id}`,
                {
                    authenticated: true,
                },
            );
        },

        async updateStatus(
            id,
            status,
        ) {
            return api.request(
                `/orders/admin/${id}/status`,
                {
                    method: "PATCH",
                    authenticated: true,
                    body: {
                        status,
                    },
                },
            );
        },

        async cancel(
            id,
            reason,
        ) {
            return api.request(
                `/orders/admin/${id}/cancel`,
                {
                    method: "PATCH",
                    authenticated: true,
                    body: {
                        reason,
                    },
                },
            );
        },
    };

    /*
    |--------------------------------------------------------------------------
    | Statistics
    |--------------------------------------------------------------------------
    */

    function renderStatistics(
        statistics,
        pagination,
    ) {
        const cards =
            document.querySelectorAll(
                ".admin-order-stat-card",
            );

        const values = [
            statistics?.total ?? 0,
            statistics?.pending ?? 0,
            statistics?.delivered ?? 0,
            statistics?.cancelled ?? 0,
        ];

        cards.forEach(
            (card, index) => {
                const value =
                    card.querySelector(
                        "strong",
                    );

                if (value) {
                    value.textContent =
                        formatNumber(
                            values[index],
                        );
                }
            },
        );

        const foundText =
            document.querySelector(
                ".admin-orders-card-header p",
            );

        if (foundText) {
            foundText.textContent =
                `${formatNumber(
                    pagination?.totalItems ?? 0,
                )} orders found`;
        }

        const tabs =
            document.querySelectorAll(
                ".admin-filter-tab",
            );

        const counts = {
            "All Orders":
                statistics?.total ?? 0,
            Pending:
                statistics?.pending ?? 0,
            Preparing:
                statistics?.preparing ?? 0,
            "Out for Delivery":
                statistics?.outForDelivery ??
                0,
            Delivered:
                statistics?.delivered ?? 0,
            Cancelled:
                statistics?.cancelled ?? 0,
        };

        tabs.forEach((tab) => {
            const label =
                tab.childNodes[0]?.textContent
                    ?.trim() || "";

            const count =
                tab.querySelector(
                    "span",
                );

            if (count) {
                count.textContent =
                    formatNumber(
                        counts[label] ??
                            0,
                    );
            }
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Orders table
    |--------------------------------------------------------------------------
    */

    function normalizeOrder(order) {
        const customerName =
            [
                order.customer_first_name,
                order.customer_last_name,
            ]
                .filter(Boolean)
                .join(" ")
                .trim() || "Unknown customer";

        const riderName =
            [
                order.rider_first_name,
                order.rider_last_name,
            ]
                .filter(Boolean)
                .join(" ")
                .trim();

        return {
            id: order.id,
            orderNumber:
                order.order_number ||
                `FD-${order.id}`,
            customerName,
            customerPhone:
                order.customer_phone || "—",
            restaurantName:
                order.restaurant_name ||
                "—",
            riderName:
                riderName || "Unassigned",
            riderId:
                order.rider_id || null,
            amount:
                Number(order.total_amount) ||
                0,
            itemCount:
                Number(order.item_count) ||
                0,
            status:
                order.status || "pending",
            placedAt:
                order.placed_at ||
                order.created_at ||
                null,
        };
    }

    function statusLabel(status) {
        return {
            pending: "Pending",
            confirmed: "Confirmed",
            preparing: "Preparing",
            ready: "Ready",
            out_for_delivery:
                "Out for Delivery",
            delivered: "Delivered",
            cancelled: "Cancelled",
        }[status] || status;
    }

    function statusClass(status) {
        return {
            pending: "pending",
            confirmed: "preparing",
            preparing: "preparing",
            ready: "preparing",
            out_for_delivery:
                "out-delivery",
            delivered: "delivered",
            cancelled: "cancelled",
        }[status] || "pending";
    }

    function formatOrderDate(value) {
        if (!value) {
            return {
                day: "—",
                time: "—",
            };
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime(),
            )
        ) {
            return {
                day: "—",
                time: "—",
            };
        }

        const day =
            date.toLocaleDateString(
                "en-KE",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                },
            );

        const time =
            date.toLocaleTimeString(
                "en-KE",
                {
                    hour: "numeric",
                    minute: "2-digit",
                },
            );

        return {
            day,
            time,
        };
    }

    function renderOrders(
        orders = [],
    ) {
        const body =
            document.querySelector(
                ".admin-orders-table tbody",
            );

        if (!body) return;

        body.replaceChildren();

        if (!orders.length) {
            const row =
                document.createElement(
                    "tr",
                );

            const cell =
                document.createElement(
                    "td",
                );

            cell.colSpan = 8;
            cell.style.textAlign =
                "center";
            cell.style.padding =
                "35px 20px";
            cell.textContent =
                "No orders found.";

            row.appendChild(cell);
            body.appendChild(row);

            return;
        }

        orders.forEach(
            (rawOrder) => {
                const order =
                    normalizeOrder(
                        rawOrder,
                    );

                const row =
                    document.createElement(
                        "tr",
                    );

                const date =
                    formatOrderDate(
                        order.placedAt,
                    );

                row.innerHTML = `
                    <td>
                        <div class="admin-order-number">
                            <strong>
                                #${escapeHtml(
                                    order.orderNumber,
                                )}
                            </strong>
                            <span>
                                ${formatNumber(
                                    order.itemCount,
                                )}
                                ${
                                    order.itemCount ===
                                    1
                                        ? "item"
                                        : "items"
                                }
                            </span>
                        </div>
                    </td>

                    <td>
                        <div class="admin-customer">
                            <div class="admin-customer-avatar">
                                ${escapeHtml(
                                    getInitials(
                                        order.customerName,
                                    ),
                                )}
                            </div>

                            <div>
                                <strong>
                                    ${escapeHtml(
                                        order.customerName,
                                    )}
                                </strong>

                                <span>
                                    ${escapeHtml(
                                        order.customerPhone,
                                    )}
                                </span>
                            </div>
                        </div>
                    </td>

                    <td>
                        <span class="admin-restaurant-name">
                            ${escapeHtml(
                                order.restaurantName,
                            )}
                        </span>
                    </td>

                    <td>
                        <div class="admin-rider">
                            <strong>
                                ${escapeHtml(
                                    order.riderName,
                                )}
                            </strong>

                            <span>
                                ${
                                    order.riderId
                                        ? `Rider #${escapeHtml(
                                              order.riderId,
                                          )}`
                                        : "Not assigned"
                                }
                            </span>
                        </div>
                    </td>

                    <td>
                        <strong class="admin-order-amount">
                            ${formatMoney(
                                order.amount,
                            )}
                        </strong>
                    </td>

                    <td>
                        <span
                            class="admin-status ${statusClass(
                                order.status,
                            )}"
                        >
                            ${escapeHtml(
                                statusLabel(
                                    order.status,
                                ),
                            )}
                        </span>
                    </td>

                    <td>
                        <div class="admin-order-date">
                            <strong>
                                ${escapeHtml(
                                    date.day,
                                )}
                            </strong>

                            <span>
                                ${escapeHtml(
                                    date.time,
                                )}
                            </span>
                        </div>
                    </td>

                    <td>
                        <button
                            type="button"
                            class="admin-view-button"
                            data-order-id="${escapeHtml(
                                order.id,
                            )}"
                        >
                            View
                        </button>
                    </td>
                `;

                row
                    .querySelector(
                        "[data-order-id]",
                    )
                    ?.addEventListener(
                        "click",
                        () =>
                            openOrderDetail(
                                order.id,
                            ),
                    );

                body.appendChild(row);
            },
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

    function renderPagination(
        pagination,
    ) {
        const container =
            document.querySelector(
                ".admin-orders-footer .admin-pagination",
            );

        const footer =
            document.querySelector(
                ".admin-orders-footer p",
            );

        if (!container) return;

        const page =
            Number(
                pagination?.page,
            ) || 1;

        const totalPages =
            Number(
                pagination?.totalPages,
            ) || 1;

        const totalItems =
            Number(
                pagination?.totalItems,
            ) || 0;

        const start =
            totalItems === 0
                ? 0
                : (page - 1) *
                      PAGE_SIZE +
                  1;

        const end = Math.min(
            page * PAGE_SIZE,
            totalItems,
        );

        if (footer) {
            footer.innerHTML =
                `Showing <strong>${start}–${end}</strong> of <strong>${totalItems}</strong> orders`;
        }

        const pages = new Set();

        pages.add(1);

        pages.add(totalPages);

        pages.add(page);

        pages.add(page - 1);

        pages.add(page + 1);

        pages.add(page - 2);

        pages.add(page + 2);

        const orderedPages =
            Array.from(pages)
                .filter(
                    (value) =>
                        value >= 1 &&
                        value <=
                            totalPages,
                )
                .sort(
                    (a, b) =>
                        a - b,
                );

        container.innerHTML = "";

        const previous =
            document.createElement(
                "button",
            );

        previous.type = "button";
        previous.className =
            "admin-pagination-button";
        previous.textContent = "‹";
        previous.disabled =
            page <= 1;

        previous.addEventListener(
            "click",
            () => {
                if (page <= 1) return;

                state.page =
                    page - 1;

                loadOrders();
            },
        );

        container.appendChild(
            previous,
        );

        let lastPage =
            null;

        orderedPages.forEach(
            (pageNumber) => {
                if (
                    lastPage !== null &&
                    pageNumber -
                        lastPage >
                        1
                ) {
                    const dots =
                        document.createElement(
                            "span",
                        );

                    dots.className =
                        "admin-pagination-dots";
                    dots.textContent =
                        "...";

                    container.appendChild(
                        dots,
                    );
                }

                const button =
                    document.createElement(
                        "button",
                    );

                button.type = "button";
                button.className =
                    "admin-pagination-button";

                if (
                    pageNumber ===
                    page
                ) {
                    button.classList.add(
                        "active",
                    );
                }

                button.textContent =
                    String(
                        pageNumber,
                    );

                button.addEventListener(
                    "click",
                    () => {
                        if (
                            pageNumber ===
                            state.page
                        ) {
                            return;
                        }

                        state.page =
                            pageNumber;

                        loadOrders();
                    },
                );

                container.appendChild(
                    button,
                );

                lastPage =
                    pageNumber;
            },
        );

        const next =
            document.createElement(
                "button",
            );

        next.type = "button";
        next.className =
            "admin-pagination-button";
        next.textContent = "›";
        next.disabled =
            page >= totalPages;

        next.addEventListener(
            "click",
            () => {
                if (
                    page >=
                    totalPages
                ) {
                    return;
                }

                state.page =
                    page + 1;

                loadOrders();
            },
        );

        container.appendChild(
            next,
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Quick summary
    |--------------------------------------------------------------------------
    */

    async function loadQuickOrderSummary() {
        const requestId =
            ++summaryRequestId;

        try {
            const data =
                await ordersApi.getSummary();

            if (
                requestId !==
                summaryRequestId
            ) {
                return;
            }

            renderQuickOrderSummary(
                data,
            );
        } catch (error) {
            console.error(
                "Could not load order summary:",
                error,
            );

            if (
                requestId ===
                summaryRequestId
            ) {
                renderQuickOrderSummary(
                    null,
                );
            }
        }
    }

    
function getSavedDailyRevenueTarget() {
    try {
        const saved = Number(
            localStorage.getItem(
                "foodDelivery.admin.dailyRevenueTarget"
            )
        );

        return Number.isFinite(saved) && saved > 0
            ? saved
            : null;
    } catch (error) {
        console.warn("Could not read daily target:", error);
        return null;
    }
}

function saveDailyRevenueTarget(value) {
    const target = Number(value);

    if (!Number.isFinite(target) || target <= 0) {
        showMessage(
            "Enter a daily target greater than KSh 0.",
            "error"
        );
        return false;
    }

    try {
        localStorage.setItem(
            "foodDelivery.admin.dailyRevenueTarget",
            String(Math.round(target))
        );
        return true;
    } catch (error) {
        console.error("Could not save daily target:", error);
        showMessage(
            "Could not save the target in this browser.",
            "error"
        );
        return false;
    }
}


    function renderQuickOrderSummary(
        data,
    ) {
        const summaryCards =
            document.querySelectorAll(
                ".admin-summary-card",
            );

        if (!summaryCards.length) {
            return;
        }

        const todayStatus =
            data?.todayStatus || {
                pending: 0,
                preparing: 0,
                delivery: 0,
                delivered: 0,
            };

        const revenue =
            data?.revenue || {
                today: 0,
                yesterday: 0,
                change: 0,
                target:
                    DAILY_TARGET,
            };

        const firstCard =
            summaryCards[0];

        if (firstCard) {
            const values = [
                todayStatus.pending,
                todayStatus.preparing,
                todayStatus.delivery,
                todayStatus.delivered,
            ];

            firstCard
                .querySelectorAll(
                    ".admin-summary-item strong",
                )
                .forEach(
                    (
                        element,
                        index,
                    ) => {
                        element.textContent =
                            formatNumber(
                                values[
                                    index
                                ] ??
                                    0,
                            );
                    },
                );
        }

        const revenueCard =
            summaryCards[1];

        if (!revenueCard) {
            return;
        }

        const revenueValue =
            revenueCard.querySelector(
                ".admin-revenue-summary strong",
            );

        if (revenueValue) {
            revenueValue.textContent =
                formatMoney(
                    revenue.today,
                );
        }

        const changeElement =
            revenueCard.querySelector(
                ".admin-revenue-positive",
            );

        if (changeElement) {
            const change =
                Number(
                    revenue.change,
                ) || 0;

            changeElement.textContent =
                `${change >= 0 ? "+" : ""}${change.toFixed(
                    1,
                )}% from yesterday`;
        }

        
const savedTarget = getSavedDailyRevenueTarget();
const apiTarget = Number(revenue.target);

const target =
    savedTarget ??
    (
        Number.isFinite(apiTarget) && apiTarget > 0
            ? apiTarget
            : DAILY_TARGET
    );


        const targetElement =
            revenueCard.querySelector(
                ".admin-revenue-footer strong",
            );

        if (targetElement) {
            targetElement.textContent =
                formatMoney(target);
        }

        const progress =
            revenueCard.querySelector(
                ".admin-revenue-bar span",
            );

        if (progress) {
            const percentage = Math.min(
                100,
                target > 0
                    ? (Number(
                          revenue.today,
                      ) /
                          target) *
                      100
                    : 0,
            );

            progress.style.width =
                `${percentage}%`;
        }

        
revenueCard.dataset.actualRevenue = String(
    Math.max(0, Number(revenue.today) || 0)
);

let targetControls = revenueCard.querySelector(
    ".admin-daily-target-controls"
);

if (!targetControls) {
    targetControls = document.createElement("div");
    targetControls.className = "admin-daily-target-controls";
    targetControls.style.cssText =
        "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;";

    const targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.min = "1";
    targetInput.step = "1000";
    targetInput.placeholder = "Enter daily target";
    targetInput.setAttribute(
        "aria-label",
        "Daily revenue target in Kenyan shillings"
    );
    targetInput.className = "admin-daily-target-input";
    targetInput.style.cssText =
        "max-width:190px;padding:8px 10px;border:1px solid #ccc;border-radius:6px;";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save target";
    saveButton.className = "admin-daily-target-save";
    saveButton.style.cssText =
        "padding:8px 12px;border:0;border-radius:6px;cursor:pointer;";

    const saveTarget = () => {
        if (!saveDailyRevenueTarget(targetInput.value)) {
            return;
        }

        const newTarget = Math.round(Number(targetInput.value));
        const currentRevenue = Math.max(
            0,
            Number(revenueCard.dataset.actualRevenue) || 0
        );

        targetInput.value = String(newTarget);

        const targetElement = revenueCard.querySelector(
            ".admin-revenue-footer strong"
        );

        if (targetElement) {
            targetElement.textContent = formatMoney(newTarget);
        }

        const progressBar = revenueCard.querySelector(
            ".admin-revenue-bar span"
        );

        if (progressBar) {
            const percentage = Math.min(
                100,
                (currentRevenue / newTarget) * 100
            );

            progressBar.style.width = `${percentage}%`;
        }

        showMessage("Daily revenue target saved in this browser only; it is not synced to the platform database.", "error");
    };

    saveButton.addEventListener("click", saveTarget);

    targetInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            saveTarget();
        }
    });

    targetControls.append(targetInput, saveButton);
    revenueCard.appendChild(targetControls);
}

const targetInput = targetControls.querySelector(
    ".admin-daily-target-input"
);

if (targetInput && document.activeElement !== targetInput) {
    targetInput.value = String(Math.round(target));
}

        
    }

    /*
    |--------------------------------------------------------------------------
    | Load orders
    |--------------------------------------------------------------------------
    */

    async function loadOrders() {
        // Ignore stale responses so a newer search/filter/page request wins.
        const requestId = ++ordersRequestId;

        try {
            const response = await ordersApi.getOrders();
            if (requestId !== ordersRequestId) return;
            if (response?.success === false) {
                throw new Error(response.message || "The server could not load orders.");
            }

            // Support both direct payloads and the standard { success, data } envelope.
            const data = response?.data && typeof response.data === "object"
                ? { ...response, ...response.data }
                : response;

            if (!Array.isArray(data?.orders)) {
                throw new Error("The orders API returned an unexpected response. Check the deployed API response.");
            }

            renderAdminHeader(data);
            renderStatistics(data.statistics || {}, data.pagination || {});
            renderOrders(data.orders);
            renderPagination(data.pagination || {});

        } catch (error) {
            console.error(
                "Could not load orders:",
                error,
            );

            if (requestId === ordersRequestId) {
                showMessage(error.message || "Could not load orders. Please try again.", "error");
            }
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Order Detail Modal
    |--------------------------------------------------------------------------
    */

    function getOrCreateDetailModal() {
        let modal =
            document.getElementById(
                "adminOrderDetailModal",
            );

        if (modal) {
            return modal;
        }

        modal =
            document.createElement(
                "div",
            );

        modal.id =
            "adminOrderDetailModal";

        modal.className =
            "admin-modal";

        modal.setAttribute(
            "aria-hidden",
            "true",
        );

        modal.innerHTML = `
            <div
                class="admin-modal-overlay"
                data-detail-close
            ></div>

            <section
                class="admin-modal-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="adminOrderDetailTitle"
            >
                <div class="admin-modal-header">
                    <div>
                        <p class="admin-modal-eyebrow">
                            ORDER DETAILS
                        </p>

                        <h2 id="adminOrderDetailTitle">
                            Order
                        </h2>

                        <p id="adminOrderDetailSubtitle">
                            Loading order...
                        </p>
                    </div>

                    <button
                        type="button"
                        class="admin-modal-close"
                        data-detail-close
                        aria-label="Close order details"
                    >
                        ×
                    </button>
                </div>

                <div
                    id="adminOrderDetailBody"
                    style="
                        padding:24px;
                        display:flex;
                        flex-direction:column;
                        gap:18px;
                    "
                ></div>
            </section>
        `;

        document.body.appendChild(
            modal,
        );

        modal
            .querySelectorAll(
                "[data-detail-close]",
            )
            .forEach((element) => {
                element.addEventListener(
                    "click",
                    () =>
                        closeDetailModal(),
                );
            });

        return modal;
    }

    function closeDetailModal() {
        detailRequestId += 1;
        const modal =
            document.getElementById(
                "adminOrderDetailModal",
            );

        if (!modal) return;

        modal.classList.remove(
            "open",
        );

        modal.setAttribute(
            "aria-hidden",
            "true",
        );

        if (!modalOpen) {
            document.body.style.overflow =
                "";
        }
    }

    async function openOrderDetail(
        orderId,
    ) {
        const requestId = ++detailRequestId;
        const modal =
            getOrCreateDetailModal();

        const body =
            modal.querySelector(
                "#adminOrderDetailBody",
            );

        const title =
            modal.querySelector(
                "#adminOrderDetailTitle",
            );

        const subtitle =
            modal.querySelector(
                "#adminOrderDetailSubtitle",
            );

        modal.classList.add(
            "open",
        );

        modal.setAttribute(
            "aria-hidden",
            "false",
        );

        document.body.style.overflow =
            "hidden";

        title.textContent =
            "Loading...";

        subtitle.textContent =
            "Loading order details...";

        body.innerHTML = `
            <div>
                Loading order...
            </div>
        `;

        try {
            const data = await ordersApi.getOrder(orderId);
            if (requestId !== detailRequestId || !modal.classList.contains("open")) return;

            const order = data?.order;

            if (!order) {
                throw new Error(
                    "Order not found.",
                );
            }

            renderOrderDetail(
                modal,
                order,
            );
        } catch (error) {
            if (requestId !== detailRequestId || !modal.classList.contains("open")) return;
            body.innerHTML = `
                <div
                    style="
                        padding:20px;
                        border:1px solid #f4caca;
                        border-radius:8px;
                        color:#c63d3d;
                        background:#fdeaea;
                    "
                >
                    ${escapeHtml(
                        error.message ||
                            "Could not load order.",
                    )}
                </div>
            `;
        }
    }

    function renderOrderDetail(
        modal,
        order,
    ) {
        const title =
            modal.querySelector(
                "#adminOrderDetailTitle",
            );

        const subtitle =
            modal.querySelector(
                "#adminOrderDetailSubtitle",
            );

        const body =
            modal.querySelector(
                "#adminOrderDetailBody",
            );

        const customerName =
            [
                order.customer_first_name,
                order.customer_last_name,
            ]
                .filter(Boolean)
                .join(" ")
                .trim() || "Unknown";

        const riderName =
            [
                order.rider_first_name,
                order.rider_last_name,
            ]
                .filter(Boolean)
                .join(" ")
                .trim() ||
            "Unassigned";

        title.textContent =
            `#${order.order_number}`;

        subtitle.textContent =
            `${statusLabel(order.status)} · ${formatMoney(
                order.total_amount,
            )}`;

        const items =
            Array.isArray(
                order.items,
            )
                ? order.items
                : [];

        const itemRows =
            items.length
                ? items
                      .map(
                          (item) => `
                    <div
                        style="
                            display:grid;
                            grid-template-columns:minmax(0,1fr) auto auto;
                            gap:15px;
                            align-items:center;
                            padding:12px 0;
                            border-bottom:1px solid #eeeeee;
                        "
                    >
                        <div>
                            <strong>
                                ${escapeHtml(
                                    item.food_name,
                                )}
                            </strong>

                            <div
                                style="
                                    margin-top:4px;
                                    color:#888;
                                    font-size:12px;
                                "
                            >
                                ${formatNumber(
                                    item.quantity,
                                )}
                                ×
                                ${formatMoney(
                                    item.unit_price,
                                )}
                            </div>
                        </div>

                        <span>
                            ${formatMoney(
                                item.subtotal,
                            )}
                        </span>
                    </div>
                `,
                      )
                      .join("")
                : `
                    <div>
                        No order items found.
                    </div>
                `;

        body.innerHTML = `
            <div
                style="
                    display:grid;
                    grid-template-columns:repeat(2,minmax(0,1fr));
                    gap:15px;
                "
            >
                <div
                    style="
                        padding:16px;
                        border:1px solid #eeeeee;
                        border-radius:10px;
                    "
                >
                    <small
                        style="
                            color:#888;
                        "
                    >
                        Customer
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                        "
                    >
                        ${escapeHtml(
                            customerName,
                        )}
                    </strong>

                    <span
                        style="
                            display:block;
                            margin-top:4px;
                            color:#888;
                            font-size:12px;
                        "
                    >
                        ${escapeHtml(
                            order.customer_phone ||
                                "—",
                        )}
                    </span>
                </div>

                <div
                    style="
                        padding:16px;
                        border:1px solid #eeeeee;
                        border-radius:10px;
                    "
                >
                    <small
                        style="
                            color:#888;
                        "
                    >
                        Restaurant
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                        "
                    >
                        ${escapeHtml(
                            order.restaurant_name ||
                                "—",
                        )}
                    </strong>
                </div>

                <div
                    style="
                        padding:16px;
                        border:1px solid #eeeeee;
                        border-radius:10px;
                    "
                >
                    <small
                        style="
                            color:#888;
                        "
                    >
                        Rider
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                        "
                    >
                        ${escapeHtml(
                            riderName,
                        )}
                    </strong>

                    <span
                        style="
                            display:block;
                            margin-top:4px;
                            color:#888;
                            font-size:12px;
                        "
                    >
                        ${escapeHtml(
                            order.rider_phone ||
                                "—",
                        )}
                    </span>
                </div>

                <div
                    style="
                        padding:16px;
                        border:1px solid #eeeeee;
                        border-radius:10px;
                    "
                >
                    <small
                        style="
                            color:#888;
                        "
                    >
                        Status
                    </small>

                    <div
                        style="
                            margin-top:7px;
                        "
                    >
                        <span
                            class="admin-status ${statusClass(
                                order.status,
                            )}"
                        >
                            ${escapeHtml(
                                statusLabel(
                                    order.status,
                                ),
                            )}
                        </span>
                    </div>
                </div>
            </div>

            <div
                style="
                    padding:16px;
                    border:1px solid #eeeeee;
                    border-radius:10px;
                "
            >
                <strong
                    style="
                        display:block;
                        margin-bottom:12px;
                    "
                >
                    Delivery
                </strong>

                <div
                    style="
                        color:#555;
                        line-height:1.7;
                        font-size:13px;
                    "
                >
                    ${escapeHtml(
                        order.recipient_name ||
                            customerName,
                    )}

                    <br />

                    ${escapeHtml(
                        order.delivery_address ||
                            "—",
                    )}

                    <br />

                    ${escapeHtml(
                        order.delivery_city ||
                            "—",
                    )}

                    <br />

                    ${escapeHtml(
                        order.recipient_phone ||
                            "—",
                    )}
                </div>
            </div>

            <div
                style="
                    padding:16px;
                    border:1px solid #eeeeee;
                    border-radius:10px;
                "
            >
                <strong
                    style="
                        display:block;
                        margin-bottom:8px;
                    "
                >
                    Items
                </strong>

                ${itemRows}
            </div>

            <div
                style="
                    display:flex;
                    justify-content:flex-end;
                "
            >
                <div
                    style="
                        width:min(320px,100%);
                    "
                >
                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            padding:7px 0;
                            color:#777;
                        "
                    >
                        <span>Subtotal</span>
                        <strong>
                            ${formatMoney(
                                order.subtotal,
                            )}
                        </strong>
                    </div>

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            padding:7px 0;
                            color:#777;
                        "
                    >
                        <span>Delivery fee</span>
                        <strong>
                            ${formatMoney(
                                order.delivery_fee,
                            )}
                        </strong>
                    </div>

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            padding:10px 0;
                            margin-top:5px;
                            border-top:1px solid #eeeeee;
                            font-size:15px;
                        "
                    >
                        <span>Total</span>
                        <strong>
                            ${formatMoney(
                                order.total_amount,
                            )}
                        </strong>
                    </div>
                </div>
            </div>

            <div
                style="
                    display:flex;
                    flex-wrap:wrap;
                    gap:10px;
                    padding-top:6px;
                    border-top:1px solid #eeeeee;
                "
            >
                ${buildStatusActionButtons(
                    order,
                )}
            </div>
        `;

        wireDetailActions(
            modal,
            order,
        );
    }

    function buildStatusActionButtons(
        order,
    ) {
        const allowed = {
            pending: [
                ["confirmed", "Confirm"],
            ],
            confirmed: [
                ["preparing", "Start Preparing"],
            ],
            preparing: [
                ["ready", "Mark Ready"],
            ],
            ready: [
                [
                    "out_for_delivery",
                    "Out for Delivery",
                ],
            ],
            out_for_delivery: [
                [
                    "delivered",
                    "Mark Delivered",
                ],
            ],
        };

        const actions =
            allowed[
                order.status
            ] || [];

        let html = actions
            .map(
                ([status, label]) => `
                <button
                    type="button"
                    class="admin-primary-button"
                    data-detail-status="${escapeHtml(
                        status,
                    )}"
                >
                    ${escapeHtml(
                        label,
                    )}
                </button>
            `,
            )
            .join("");

        if (
            order.status !==
                "delivered" &&
            order.status !==
                "cancelled"
        ) {
            html += `
                <button
                    type="button"
                    class="admin-secondary-button"
                    data-detail-cancel
                >
                    Cancel Order
                </button>
            `;
        }

        return html;
    }

    function wireDetailActions(
        modal,
        order,
    ) {
        modal
            .querySelectorAll(
                "[data-detail-status]",
            )
            .forEach((button) => {
                button.addEventListener(
                    "click",
                    async () => {
                        const status =
                            button.dataset
                                .detailStatus;

                        setLoading(
                            button,
                            true,
                            "Saving...",
                            button.textContent,
                        );

                        try {
                            await ordersApi.updateStatus(
                                order.id,
                                status,
                            );

                            showMessage(
                                "Order status updated successfully.",
                            );

                            closeDetailModal();
                            await loadOrders();
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not update order status.",
                                "error",
                            );

                            setLoading(
                                button,
                                false,
                                "Saving...",
                                statusLabel(
                                    status,
                                ),
                            );
                        }
                    },
                );
            });

        const cancelButton =
            modal.querySelector(
                "[data-detail-cancel]",
            );

        cancelButton?.addEventListener(
            "click",
            async () => {
                const reason =
                    window.prompt(
                        "Enter the cancellation reason:",
                    );

                if (
                    reason ===
                        null ||
                    !reason.trim()
                ) {
                    return;
                }

                setLoading(
                    cancelButton,
                    true,
                    "Cancelling...",
                    "Cancel Order",
                );

                try {
                    await ordersApi.cancel(
                        order.id,
                        reason.trim(),
                    );

                    showMessage(
                        "Order cancelled successfully.",
                    );

                    closeDetailModal();
                    await loadOrders();
                } catch (error) {
                    showMessage(
                        error.message ||
                            "Could not cancel order.",
                        "error",
                    );

                    setLoading(
                        cancelButton,
                        false,
                        "Cancelling...",
                        "Cancel Order",
                    );
                }
            },
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Create Order Modal
    |--------------------------------------------------------------------------
    */

    function ensureCreateOrderModal() {
        let modal = document.getElementById("createOrderModal");

        // Some deployed versions of orders.html do not include the modal shell.
        // Build it here so the Create Order button remains functional.
        if (!modal) {
            modal = document.createElement("section");
            modal.id = "createOrderModal";
            modal.className = "admin-modal";
            modal.setAttribute("aria-hidden", "true");
            modal.innerHTML = `
                <div class="admin-modal-overlay" data-create-overlay></div>
                <div class="admin-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="adminCreateOrderTitle">
                    <div class="admin-modal-content"></div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const content =
            modal.querySelector(
                ".admin-modal-content",
            );

        if (!content) {
            throw new Error(
                "The create order modal content is missing.",
            );
        }

        content.innerHTML = `
            <div class="admin-modal-header">
                <div>
                    <h2 class="admin-modal-eyebrow">
                        ORDER MANAGEMENT
                    </h2>

                    <h2>
                        Create New Order
                    </h2>

                    <p>
                        Create an order manually for a customer.
                    </p>
                </div>

                <button
                    type="button"
                    class="admin-modal-close"
                    data-create-close
                    aria-label="Close create order modal"
                >
                    ×
                </button>
            </div>

            <form
                id="adminCreateOrderForm"
                novalidate
            >
                <div
                    class="admin-modal-grid"
                >
                    <label class="admin-form-field">
                        <span>
                            Customer
                        </span>

                        <select
                            name="customer_id"
                            id="adminCreateCustomer"
                            required
                        >
                            <option value="">
                                Select customer
                            </option>
                        </select>
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Restaurant
                        </span>

                        <select
                            name="restaurant_id"
                            id="adminCreateRestaurant"
                            required
                        >
                            <option value="">
                                Select restaurant
                            </option>
                        </select>
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Recipient name
                        </span>

                        <input
                            type="text"
                            name="recipient_name"
                            id="adminCreateRecipientName"
                            placeholder="Recipient name"
                            required
                        />
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Recipient phone
                        </span>

                        <input
                            type="tel"
                            name="recipient_phone"
                            id="adminCreateRecipientPhone"
                            placeholder="0712 345 678"
                            required
                        />
                    </label>

                    <label
                        class="admin-form-field admin-form-field-full"
                    >
                        <span>
                            Delivery address
                        </span>

                        <input
                            type="text"
                            name="delivery_address"
                            id="adminCreateAddress"
                            placeholder="e.g. Kilimani, Nairobi"
                            required
                        />
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Delivery city
                        </span>

                        <input
                            type="text"
                            name="delivery_city"
                            id="adminCreateCity"
                            value="Nairobi"
                            required
                        />
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Assign rider
                        </span>

                        <select
                            name="rider_id"
                            id="adminCreateRider"
                        >
                            <option value="">
                                Assign later
                            </option>
                        </select>
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Payment method
                        </span>

                        <select
                            name="payment_method"
                            id="adminCreatePaymentMethod"
                            required
                        >
                            <option value="mpesa">M-Pesa</option>
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                        </select>
                    </label>
                </div>

                <div
                    style="
                        margin-top:22px;
                    "
                >
                    <div
                        style="
                            display:flex;
                            align-items:center;
                            justify-content:space-between;
                            gap:15px;
                            margin-bottom:10px;
                        "
                    >
                        <div>
                            <strong>
                                Food Items
                            </strong>

                            <div
                                style="
                                    margin-top:4px;
                                    color:#888;
                                    font-size:12px;
                                "
                            >
                                Select food and quantity.
                            </div>
                        </div>

                        <button
                            type="button"
                            class="admin-secondary-button"
                            id="adminAddOrderItem"
                        >
                            + Add Item
                        </button>
                    </div>

                    <div
                        id="adminOrderItems"
                        style="
                            display:flex;
                            flex-direction:column;
                            gap:10px;
                        "
                    ></div>

                    <div
                        id="adminOrderItemEmpty"
                        style="
                            padding:18px;
                            border:1px dashed #d6d6d6;
                            border-radius:8px;
                            color:#888;
                            text-align:center;
                            font-size:13px;
                        "
                    >
                        Select a restaurant, then add at least one food item.
                    </div>
                </div>

                <div
                    class="admin-form-grid"
                    style="
                        margin-top:20px;
                    "
                >
                    <label class="admin-form-field">
                        <span>
                            Delivery instructions
                        </span>

                        <textarea
                            name="delivery_instructions"
                            rows="3"
                            placeholder="Gate number, landmark, etc."
                        ></textarea>
                    </label>

                    <label class="admin-form-field">
                        <span>
                            Order notes
                        </span>

                        <textarea
                            name="notes"
                            rows="3"
                            placeholder="Internal order notes"
                        ></textarea>
                    </label>
                </div>

                <div
                    style="
                        margin-top:20px;
                        padding:16px;
                        border-radius:10px;
                        background:#fafafa;
                        border:1px solid #eeeeee;
                    "
                >
                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            gap:15px;
                            margin-bottom:8px;
                        "
                    >
                        <span>
                            Subtotal
                        </span>

                        <strong
                            id="adminOrderSubtotal"
                        >
                            KSh 0
                        </strong>
                    </div>

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            gap:15px;
                            margin-bottom:8px;
                        "
                    >
                        <span>
                            Delivery fee
                        </span>

                        <strong
                            id="adminOrderDeliveryFee"
                        >
                            KSh 0
                        </strong>
                    </div>

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            gap:15px;
                            padding-top:10px;
                            border-top:1px solid #e5e5e5;
                            font-size:15px;
                        "
                    >
                        <span>
                            Total
                        </span>

                        <strong
                            id="adminOrderTotal"
                        >
                            KSh 0
                        </strong>
                    </div>

                    <div
                        id="adminOrderMinimumNotice"
                        style="
                            margin-top:10px;
                            color:#b77900;
                            font-size:12px;
                        "
                    ></div>
                </div>

                <div
                    id="adminCreateOrderError"
                    style="
                        display:none;
                        margin-top:15px;
                        padding:12px 14px;
                        border-radius:8px;
                        background:#fdeaea;
                        border:1px solid #f4caca;
                        color:#c63d3d;
                        font-size:13px;
                    "
                ></div>

                <div
                    class="admin-modal-actions"
                    style="
                        margin-top:20px;
                    "
                >
                    <button
                        type="button"
                        class="admin-secondary-button"
                        data-create-close
                    >
                        Cancel
                    </button>

                    <button
                        type="submit"
                        class="admin-primary-button"
                        id="adminCreateOrderSubmit"
                    >
                        Create Order
                    </button>
                </div>
            </form>
        `;

        const closeButtons =
            modal.querySelectorAll(
                "[data-create-close]",
            );

        closeButtons.forEach(
            (button) => {
                button.addEventListener(
                    "click",
                    closeCreateOrderModal,
                );
            },
        );

        modal
            .querySelector(
                ".admin-modal-overlay",
            )
            ?.addEventListener(
                "click",
                closeCreateOrderModal,
            );

        const restaurantSelect =
            modal.querySelector(
                "#adminCreateRestaurant",
            );

        restaurantSelect?.addEventListener(
            "change",
            async () => {
                await loadCreateOrderFoods();
                addOrderItemRow();
            },
        );

        modal
            .querySelector(
                "#adminCreateCustomer",
            )
            ?.addEventListener(
                "change",
                fillRecipientFromCustomer,
            );

        modal
            .querySelector(
                "#adminAddOrderItem",
            )
            ?.addEventListener(
                "click",
                () => addOrderItemRow(),
            );

        modal
            .querySelector(
                "#adminCreateOrderForm",
            )
            ?.addEventListener(
                "submit",
                handleCreateOrderSubmit,
            );

        return modal;
    }

    let createOrderOptions = {
        customers: [],
        restaurants: [],
        riders: [],
        foods: [],
    };

    async function loadCreateOrderOptions() {
        const data =
            await ordersApi.getOptions();

        createOrderOptions =
            data || {
                customers: [],
                restaurants: [],
                riders: [],
                foods: [],
            };

        populateCustomerOptions();
        populateRestaurantOptions();
        populateRiderOptions();
    }

    function populateCustomerOptions() {
        const select =
            document.getElementById(
                "adminCreateCustomer",
            );

        if (!select) return;

        select.innerHTML = `
            <option value="">
                Select customer
            </option>
        `;

        createOrderOptions.customers.forEach(
            (customer) => {
                const name =
                    [
                        customer.first_name,
                        customer.last_name,
                    ]
                        .filter(Boolean)
                        .join(" ");

                const option =
                    document.createElement(
                        "option",
                    );

                option.value =
                    customer.id;

                option.textContent =
                    `${name} — ${
                        customer.phone ||
                        customer.email ||
                        "No contact"
                    }`;

                option.dataset.firstName =
                    customer.first_name ||
                    "";

                option.dataset.lastName =
                    customer.last_name ||
                    "";

                option.dataset.phone =
                    customer.phone ||
                    "";

                select.appendChild(
                    option,
                );
            },
        );
    }

    function populateRestaurantOptions() {
        const select =
            document.getElementById(
                "adminCreateRestaurant",
            );

        if (!select) return;

        select.innerHTML = `
            <option value="">
                Select restaurant
            </option>
        `;

        createOrderOptions.restaurants.forEach(
            (restaurant) => {
                const option =
                    document.createElement(
                        "option",
                    );

                option.value =
                    restaurant.id;

                option.textContent =
                    `${restaurant.name} — ${restaurant.city}`;

                option.dataset.deliveryFee =
                    restaurant.delivery_fee ??
                    0;

                option.dataset.minimumOrder =
                    restaurant.minimum_order ??
                    0;

                option.dataset.isOpen =
                    String(
                        restaurant.is_open,
                    );

                select.appendChild(
                    option,
                );
            },
        );
    }

    function populateRiderOptions() {
        const select =
            document.getElementById(
                "adminCreateRider",
            );

        if (!select) return;

        select.innerHTML = `
            <option value="">
                Assign later
            </option>
        `;

        createOrderOptions.riders.forEach(
            (rider) => {
                const name =
                    [
                        rider.first_name,
                        rider.last_name,
                    ]
                        .filter(Boolean)
                        .join(" ");

                const option =
                    document.createElement(
                        "option",
                    );

                option.value =
                    rider.id;

                option.textContent =
                    `${name || "Rider"} — ${
                        rider.phone ||
                        `#${rider.id}`
                    }`;

                select.appendChild(
                    option,
                );
            },
        );
    }

    async function loadCreateOrderFoods() {
        const requestId = ++foodRequestId;
        const restaurantId =
            document.getElementById(
                "adminCreateRestaurant",
            )?.value || "";

        createOrderOptions.foods = [];

        if (!restaurantId) {
            renderOrderItems();
            updateCreateOrderTotals();
            return;
        }

        try {
            const data = await ordersApi.getOptions(restaurantId);
            const currentRestaurantId = document.getElementById("adminCreateRestaurant")?.value || "";
            if (requestId !== foodRequestId || currentRestaurantId !== restaurantId) return;
            createOrderOptions.foods = Array.isArray(data?.foods) ? data.foods : [];
        } catch (error) {
            if (requestId !== foodRequestId) return;
            createOrderOptions.foods = [];
            showCreateOrderError(error.message || "Could not load food items for this restaurant.");
        }

        renderOrderItems();

        updateCreateOrderTotals();
    }

    function fillRecipientFromCustomer() {
        const customerSelect =
            document.getElementById(
                "adminCreateCustomer",
            );

        const option =
            customerSelect?.selectedOptions?.[0];

        if (!option) return;

        const firstName =
            option.dataset.firstName ||
            "";

        const lastName =
            option.dataset.lastName ||
            "";

        const phone =
            option.dataset.phone ||
            "";

        const recipientName =
            document.getElementById(
                "adminCreateRecipientName",
            );

        const recipientPhone =
            document.getElementById(
                "adminCreateRecipientPhone",
            );

        if (
            recipientName &&
            !recipientName.value
        ) {
            recipientName.value =
                `${firstName} ${lastName}`
                    .trim();
        }

        if (
            recipientPhone &&
            !recipientPhone.value
        ) {
            recipientPhone.value =
                phone;
        }
    }

    function getOrderItemRows() {
        return Array.from(
            document.querySelectorAll(
                "[data-order-item-row]",
            ),
        );
    }

    function addOrderItemRow() {
        const restaurantId =
            document.getElementById(
                "adminCreateRestaurant",
            )?.value || "";

        if (!restaurantId) {
            showCreateOrderError(
                "Select a restaurant before adding food items.",
            );
            return;
        }

        if (
            createOrderOptions.foods.length ===
            0
        ) {
            showCreateOrderError(
                "This restaurant has no available food items.",
            );
            return;
        }

        const container =
            document.getElementById(
                "adminOrderItems",
            );

        if (!container) return;

        const row =
            document.createElement(
                "div",
            );

        row.dataset.orderItemRow =
            "true";

        row.style.display =
            "grid";

        row.style.gridTemplateColumns =
            "minmax(0,1fr) 90px auto";

        row.style.gap = "10px";

        row.style.alignItems =
            "center";

        row.innerHTML = `
            <select
                data-food-select
                class="admin-order-food-select"
            >
                <option value="">
                    Select food
                </option>
            </select>

            <input
                type="number"
                min="1"
                step="1"
                value="1"
                data-food-quantity
                aria-label="Food quantity"
            />

            <button
                type="button"
                class="admin-secondary-button"
                data-remove-order-item
            >
                Remove
            </button>
        `;

        const select =
            row.querySelector(
                "[data-food-select]",
            );

        createOrderOptions.foods.forEach(
            (food) => {
                const option =
                    document.createElement(
                        "option",
                    );

                option.value =
                    food.id;

                option.textContent =
                    `${food.name} — ${formatMoney(
                        food.price,
                    )}`;

                option.dataset.price =
                    food.price;

                select.appendChild(
                    option,
                );
            },
        );

        row
            .querySelector(
                "[data-food-select]",
            )
            ?.addEventListener(
                "change",
                updateCreateOrderTotals,
            );

        row
            .querySelector(
                "[data-food-quantity]",
            )
            ?.addEventListener(
                "input",
                updateCreateOrderTotals,
            );

        row
            .querySelector(
                "[data-remove-order-item]",
            )
            ?.addEventListener(
                "click",
                () => {
                    row.remove();
                    renderOrderItems();
                    updateCreateOrderTotals();
                },
            );

        container.appendChild(
            row,
        );

        hideCreateOrderError();

        renderOrderItems();
        updateCreateOrderTotals();
    }

    function renderOrderItems() {
        const container =
            document.getElementById(
                "adminOrderItems",
            );

        const empty =
            document.getElementById(
                "adminOrderItemEmpty",
            );

        if (!container || !empty) {
            return;
        }

        empty.style.display =
            getOrderItemRows().length
                ? "none"
                : "block";
    }

    function updateCreateOrderTotals() {
        const rows =
            getOrderItemRows();

        let subtotal = 0;

        rows.forEach((row) => {
            const select =
                row.querySelector(
                    "[data-food-select]",
                );

            const quantity =
                Number(
                    row.querySelector(
                        "[data-food-quantity]",
                    )?.value,
                ) || 0;

            const option =
                select?.selectedOptions?.[0];

            const price =
                Number(
                    option?.dataset?.price,
                ) || 0;

            subtotal +=
                price * quantity;
        });

        const restaurantSelect =
            document.getElementById(
                "adminCreateRestaurant",
            );

        const restaurantOption =
            restaurantSelect?.selectedOptions?.[0];

        const deliveryFee =
            Number(
                restaurantOption?.dataset
                    ?.deliveryFee,
            ) || 0;

        const minimumOrder =
            Number(
                restaurantOption?.dataset
                    ?.minimumOrder,
            ) || 0;

        const total =
            subtotal +
            deliveryFee;

        const subtotalElement =
            document.getElementById(
                "adminOrderSubtotal",
            );

        const feeElement =
            document.getElementById(
                "adminOrderDeliveryFee",
            );

        const totalElement =
            document.getElementById(
                "adminOrderTotal",
            );

        if (subtotalElement) {
            subtotalElement.textContent =
                formatMoney(
                    subtotal,
                );
        }

        if (feeElement) {
            feeElement.textContent =
                formatMoney(
                    deliveryFee,
                );
        }

        if (totalElement) {
            totalElement.textContent =
                formatMoney(total);
        }

        const minimumNotice =
            document.getElementById(
                "adminOrderMinimumNotice",
            );

        if (minimumNotice) {
            if (
                minimumOrder >
                0
            ) {
                if (
                    subtotal <
                    minimumOrder
                ) {
                    minimumNotice.textContent =
                        `Minimum order: ${formatMoney(
                            minimumOrder,
                        )}`;
                } else {
                    minimumNotice.textContent =
                        `Minimum order satisfied: ${formatMoney(
                            minimumOrder,
                        )}`;
                }
            } else {
                minimumNotice.textContent =
                    "";
            }
        }
    }

    function showCreateOrderError(
        message,
    ) {
        const error =
            document.getElementById(
                "adminCreateOrderError",
            );

        if (!error) return;

        error.textContent = message;
        error.style.display =
            "block";
    }

    function hideCreateOrderError() {
        const error =
            document.getElementById(
                "adminCreateOrderError",
            );

        if (!error) return;

        error.textContent = "";
        error.style.display =
            "none";
    }

    function validateCreateOrderForm() {
        const customerId =
            document.getElementById(
                "adminCreateCustomer",
            )?.value || "";

        const restaurantId =
            document.getElementById(
                "adminCreateRestaurant",
            )?.value || "";

        const recipientName =
            document.getElementById(
                "adminCreateRecipientName",
            )?.value.trim() || "";

        const recipientPhone =
            document.getElementById(
                "adminCreateRecipientPhone",
            )?.value.trim() || "";

        const address =
            document.getElementById(
                "adminCreateAddress",
            )?.value.trim() || "";

        const city =
            document.getElementById(
                "adminCreateCity",
            )?.value.trim() || "";

        const rows =
            getOrderItemRows();

        if (!customerId) {
            throw new Error(
                "Please select a customer.",
            );
        }

        if (!restaurantId) {
            throw new Error(
                "Please select a restaurant.",
            );
        }

        const restaurantOption =
            document
                .getElementById(
                    "adminCreateRestaurant",
                )
                ?.selectedOptions?.[0];

        if (
            String(
                restaurantOption?.dataset
                    ?.isOpen,
            ) !== "true"
        ) {
            throw new Error(
                "The selected restaurant is currently closed.",
            );
        }

        if (!recipientName) {
            throw new Error(
                "Recipient name is required.",
            );
        }

        if (!recipientPhone) {
            throw new Error(
                "Recipient phone is required.",
            );
        }

        if (!address) {
            throw new Error(
                "Delivery address is required.",
            );
        }

        if (!city) {
            throw new Error(
                "Delivery city is required.",
            );
        }

        if (!rows.length) {
            throw new Error(
                "Add at least one food item.",
            );
        }

        const items = [];

        rows.forEach((row) => {
            const foodId =
                row.querySelector(
                    "[data-food-select]",
                )?.value || "";

            const quantity =
                Number(
                    row.querySelector(
                        "[data-food-quantity]",
                    )?.value,
                ) || 0;

            if (!foodId) {
                throw new Error(
                    "Select a food item for every row.",
                );
            }

            if (
                !Number.isInteger(
                    quantity,
                ) ||
                quantity <= 0
            ) {
                throw new Error(
                    "Food quantity must be a positive whole number.",
                );
            }

            items.push({
                food_id: foodId,
                quantity,
            });
        });

        const restaurant =
            createOrderOptions.restaurants.find(
                (item) =>
                    String(
                        item.id,
                    ) ===
                    String(
                        restaurantId,
                    ),
            );

        const subtotal =
            rows.reduce(
                (sum, row) => {
                    const selected =
                        row.querySelector(
                            "[data-food-select]",
                        )?.selectedOptions?.[0];

                    const price =
                        Number(
                            selected
                                ?.dataset
                                ?.price,
                        ) || 0;

                    const quantity =
                        Number(
                            row.querySelector(
                                "[data-food-quantity]",
                            )?.value,
                        ) || 0;

                    return (
                        sum +
                        price *
                            quantity
                    );
                },
                0,
            );

        const minimumOrder =
            Number(
                restaurant?.minimum_order ||
                    0,
            );

        if (
            subtotal <
            minimumOrder
        ) {
            throw new Error(
                `Minimum order amount is ${formatMoney(
                    minimumOrder,
                )}.`,
            );
        }

        return {
            customer_id:
                customerId,
            restaurant_id:
                restaurantId,
            rider_id:
                document.getElementById(
                    "adminCreateRider",
                )?.value || null,
            payment_method:
                document.getElementById(
                    "adminCreatePaymentMethod",
                )?.value || "",
            delivery_address:
                address,
            delivery_city:
                city,
            recipient_name:
                recipientName,
            recipient_phone:
                recipientPhone,
            delivery_instructions:
                document
                    .querySelector(
                        '#adminCreateOrderForm [name="delivery_instructions"]',
                    )
                    ?.value.trim() || "",
            notes:
                document
                    .querySelector(
                        '#adminCreateOrderForm [name="notes"]',
                    )
                    ?.value.trim() || "",
            items,
        };
    }

    async function handleCreateOrderSubmit(
        event,
    ) {
        event.preventDefault();
        if (createOrderSubmitting) return;
        createOrderSubmitting = true;

        hideCreateOrderError();

        const button =
            document.getElementById(
                "adminCreateOrderSubmit",
            );

        try {
            const payload =
                validateCreateOrderForm();

            setLoading(
                button,
                true,
                "Creating...",
                "Create Order",
            );

            await ordersApi.createOrder(
                payload,
            );

            closeCreateOrderModal();

            showMessage(
                "Order created successfully.",
            );

            state.page = 1;
            state.status = "all";

            document
                .querySelectorAll(
                    ".admin-filter-tab",
                )
                .forEach(
                    (tab, index) => {
                        tab.classList.toggle(
                            "active",
                            index ===
                                0,
                        );
                    },
                );

            await loadOrders();
        } catch (error) {
            console.error(
                "Create order error:",
                error,
            );

            showCreateOrderError(
                error.message ||
                    "Could not create the order.",
            );
        } finally {
            createOrderSubmitting = false;
            setLoading(button, false, "Creating...", "Create Order");
        }
    }

    async function openCreateOrderModal() {
        const modal =
            ensureCreateOrderModal();

        modal.classList.add(
            "open",
        );

        modal.setAttribute(
            "aria-hidden",
            "false",
        );

        modalOpen = true;

        document.body.style.overflow =
            "hidden";

        hideCreateOrderError();

        const form =
            document.getElementById(
                "adminCreateOrderForm",
            );

        form?.reset();

        const city =
            document.getElementById(
                "adminCreateCity",
            );

        if (city) {
            city.value = "Nairobi";
        }

        const itemContainer =
            document.getElementById(
                "adminOrderItems",
            );

        if (itemContainer) {
            itemContainer.replaceChildren();
        }

        createOrderOptions = {
            customers: [],
            restaurants: [],
            riders: [],
            foods: [],
        };

        renderOrderItems();
        updateCreateOrderTotals();

        try {
            await loadCreateOrderOptions();

            document
                .getElementById(
                    "adminCreateCustomer",
                )
                ?.focus();
        } catch (error) {
            showCreateOrderError(
                error.message ||
                    "Could not load customers, restaurants and riders.",
            );
        }
    }

    function closeCreateOrderModal() {
        const modal =
            document.getElementById(
                "createOrderModal",
            );

        if (!modal) return;

        modal.classList.remove(
            "open",
        );

        modal.setAttribute(
            "aria-hidden",
            "true",
        );

        modalOpen = false;

        if (
            !document.querySelector(
                ".admin-modal.open",
            )
        ) {
            document.body.style.overflow =
                "";
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Search / filters
    |--------------------------------------------------------------------------
    */

    function setupSearch() {
        const searchInput =
            document.querySelector(
                ".admin-search-box input",
            );

        if (!searchInput) return;

        let timer = null;

        searchInput.addEventListener(
            "input",
            (event) => {
                window.clearTimeout(
                    timer,
                );

                timer =
                    window.setTimeout(
                        () => {
                            state.search =
                                event.target.value.trim();

                            state.page = 1;

                            loadOrders();
                        },
                        300,
                    );
            },
        );
    }

    function setupFilterTabs() {
        const tabs =
            document.querySelectorAll(
                ".admin-filter-tab",
            );

        const map = {
            "All Orders":
                "all",
            Pending:
                "pending",
            Preparing:
                "preparing",
            "Out for Delivery":
                "out_for_delivery",
            Delivered:
                "delivered",
            Cancelled:
                "cancelled",
        };

        tabs.forEach((tab) => {
            tab.addEventListener(
                "click",
                () => {
                    const label =
                        tab.childNodes[0]
                            ?.textContent
                            ?.trim() ||
                        "";

                    state.status =
                        map[label] ||
                        "all";

                    state.page = 1;

                    tabs.forEach(
                        (item) =>
                            item.classList.remove(
                                "active",
                            ),
                    );

                    tab.classList.add(
                        "active",
                    );

                    loadOrders();
                },
            );
        });
    }

    function setupCreateButton() {
        const button =
            document.querySelector(
                ".admin-header-actions .admin-primary-button",
            );

        button?.addEventListener(
            "click",
            () =>
                openCreateOrderModal(),
        );
    }

    function setupExportButton() {
        const button =
            document.querySelector(
                ".admin-header-actions .admin-secondary-button",
            );

        button?.addEventListener(
            "click",
            () => {
                const table =
                    document.querySelector(
                        ".admin-orders-table",
                    );

                if (!table) {
                    return;
                }

                const rows =
                    Array.from(
                        table.querySelectorAll(
                            "tr",
                        ),
                    );

                const csv =
                    rows
                        .map(
                            (row) =>
                                Array.from(
                                    row.querySelectorAll(
                                        "th, td",
                                    ),
                                )
                                    .map(
                                        (
                                            cell,
                                        ) =>
                                            `"${cell.textContent
                                                .replace(
                                                    /"/g,
                                                    '""',
                                                )
                                                .trim()}"`,
                                    )
                                    .join(
                                        ",",
                                    ),
                        )
                        .join("\n");

                const blob =
                    new Blob(
                        [csv],
                        {
                            type: "text/csv;charset=utf-8;",
                        },
                    );

                const url =
                    URL.createObjectURL(
                        blob,
                    );

                const link =
                    document.createElement(
                        "a",
                    );

                link.href = url;
                link.download =
                    "orders.csv";

                document.body.appendChild(
                    link,
                );

                link.click();
                link.remove();

                URL.revokeObjectURL(
                    url,
                );
            },
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Keyboard
    |--------------------------------------------------------------------------
    */

    document.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key ===
                "Escape"
            ) {
                const createModal =
                    document.getElementById(
                        "createOrderModal",
                    );

                if (
                    createModal?.classList.contains(
                        "open",
                    )
                ) {
                    closeCreateOrderModal();
                    return;
                }

                const detailModal =
                    document.getElementById(
                        "adminOrderDetailModal",
                    );

                if (
                    detailModal?.classList.contains(
                        "open",
                    )
                ) {
                    closeDetailModal();
                }
            }
        },
    );

    /*
    |--------------------------------------------------------------------------
    | Startup
    |--------------------------------------------------------------------------
    */

    document.addEventListener(
        "DOMContentLoaded",
        () => {
            setupSearch();
            setupFilterTabs();
            setupCreateButton();
            setupExportButton();

            loadOrders();
            loadQuickOrderSummary();
        },
    );

    /*
    |--------------------------------------------------------------------------
    | Expose for testing
    |--------------------------------------------------------------------------
    */

    window.adminOrdersPage = {
        loadOrders,
        loadQuickOrderSummary,
        openCreateOrderModal,
        closeCreateOrderModal,
        openOrderDetail,
    };
})();
