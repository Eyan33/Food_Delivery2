
/*
 * FoodDelivery Admin Dashboard
 * Loads dashboard information from the admin API.
 */
(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const API = window.FoodDeliveryAuthApi;
        const messageBox = document.getElementById("adminMessage");
        const periodSelect = document.querySelector(
            ".admin-revenue-card .admin-period-select"
        );

        const numberFormat = new Intl.NumberFormat("en-KE", {
            maximumFractionDigits: 0
        });

        const moneyFormat = new Intl.NumberFormat("en-KE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });

        function showMessage(message, type = "error") {
            if (!messageBox) {
                console.error(message);
                return;
            }

            messageBox.textContent = message;
            messageBox.className = `admin-message show ${type}`;
            messageBox.setAttribute("role", "alert");
            messageBox.setAttribute("aria-live", "polite");
        }

        function clearMessage() {
            if (!messageBox) return;

            messageBox.textContent = "";
            messageBox.className = "admin-message";
        }

        function formatNumber(value) {
            return numberFormat.format(Number(value) || 0);
        }

        function formatMoney(value) {
            return `KSh ${moneyFormat.format(Number(value) || 0)}`;
        }

        function setText(element, value) {
            if (element) {
                element.textContent = value ?? "";
            }
        }

        function setStatCard(index, value, change, description, isMoney = false) {
            const cards = document.querySelectorAll(
                ".admin-stats-grid .admin-stat-card"
            );

            const card = cards[index];
            if (!card) return;

            const valueNode = card.querySelector(".admin-stat-content strong");

            setText(
                valueNode,
                value === null || value === undefined || value === ""
                    ? "—"
                    : (isMoney ? formatMoney(value) : formatNumber(value))
            );

            const small = card.querySelector(".admin-stat-content small");
            if (small) {
                small.replaceChildren();
                const parts = [];
                if (change !== null && change !== undefined && change !== "") {
                    const changeNode = document.createElement("b");
                    changeNode.textContent = String(change);
                    parts.push(changeNode);
                }
                if (description) parts.push(document.createTextNode(String(description)));
                small.append(...parts);
            }
        }

        function renderProfile(admin) {
            if (!admin) return;

            const name = String(admin.name || "Administrator").trim();
            const role = String(admin.role || "Administrator");
            const initial = name.charAt(0).toUpperCase() || "A";

            document.querySelectorAll(
                ".admin-profile-info strong, .admin-topbar-profile-info strong"
            ).forEach(node => setText(node, name));

            document.querySelectorAll(
                ".admin-profile-info span, .admin-topbar-profile-info span"
            ).forEach(node => setText(node, role));

            document.querySelectorAll(
                ".admin-profile-avatar, .admin-topbar-avatar"
            ).forEach(node => setText(node, initial));
        }

        function renderRevenueChart(revenue) {
            const area = document.querySelector(".admin-chart-bars");
            if (!area) return;

            const labels = Array.isArray(revenue?.labels)
                ? revenue.labels
                : [];

            const values = Array.isArray(revenue?.values)
                ? revenue.values.map(value => Number(value) || 0)
                : [];

            const maximum = Math.max(1, ...values);

            area.replaceChildren();
            const yAxisNode = document.querySelector(".admin-chart-y-axis");
            if (labels.length === 0) {
                if (yAxisNode) {
                    yAxisNode.replaceChildren(...Array.from({ length: 5 }, () => {
                        const item = document.createElement("span");
                        item.textContent = "—";
                        return item;
                    }));
                }
                return;
            }

            labels.forEach((label, index) => {
                const column = document.createElement("div");
                column.className = "admin-bar-column";

                const bar = document.createElement("div");
                bar.className = "admin-bar";

                const value = values[index] || 0;
                const height = value > 0
                    ? Math.max(2, (value / maximum) * 100)
                    : 0;

                bar.style.height = `${height}%`;
                bar.title = `${label}: ${formatMoney(value)}`;

                const caption = document.createElement("span");
                caption.textContent = label;

                column.append(bar, caption);
                area.append(column);
            });

            const yAxis = document.querySelector(".admin-chart-y-axis");

            if (yAxis) {
                const steps = [
                    maximum,
                    maximum * 0.75,
                    maximum * 0.5,
                    maximum * 0.25,
                    0
                ];

                yAxis.replaceChildren(
                    ...steps.map(step => {
                        const item = document.createElement("span");

                        item.textContent = step >= 1000
                            ? `${Math.round(step / 1000)}K`
                            : formatNumber(step);

                        return item;
                    })
                );
            }
        }

        function renderOrderStatus(statuses, totalOrders) {
            setText(
                document.querySelector(".admin-status-total strong"),
                formatNumber(totalOrders)
            );

            const list = document.querySelector(".admin-status-list");
            if (!list) return;

            const labels = {
                pending: "Pending",
                preparing: "Preparing",
                delivery: "Out for delivery",
                completed: "Completed",
                cancelled: "Cancelled"
            };

            const items = Array.isArray(statuses) ? statuses : [];

            list.replaceChildren();

            Object.entries(labels).forEach(([key, label]) => {
                const item = items.find(entry =>
                    String(entry.key || "").toLowerCase() === key
                );

                const row = document.createElement("div");
                row.className = "admin-status-item";

                const labelBox = document.createElement("div");
                labelBox.className = "admin-status-label";

                const dot = document.createElement("span");
                dot.className = `admin-status-dot ${key}`;

                const text = document.createElement("span");
                text.textContent = label;

                labelBox.append(dot, text);

                const count = document.createElement("strong");
                count.textContent = formatNumber(item?.count || 0);

                row.append(labelBox, count);
                list.append(row);
            });
        }

        function renderRecentOrders(orders) {
            const tbody = document.querySelector(
                ".admin-bottom-grid .admin-table tbody"
            );

            if (!tbody) return;

            tbody.replaceChildren();

            const rows = Array.isArray(orders) ? orders : [];

            if (rows.length === 0) {
                const row = document.createElement("tr");
                const cell = document.createElement("td");

                cell.colSpan = 5;
                cell.textContent = "No recent orders found.";

                row.append(cell);
                tbody.append(row);
                return;
            }

            rows.forEach(order => {
                const row = document.createElement("tr");

                const values = [
                    order.number || "—",
                    order.customer || "Unknown customer",
                    order.restaurant || "Unknown restaurant",
                    formatMoney(order.amount)
                ];

                values.forEach(value => {
                    const cell = document.createElement("td");
                    cell.textContent = value;
                    row.append(cell);
                });

                const statusCell = document.createElement("td");
                const status = document.createElement("span");
                const statusKey = String(order.status || "pending")
                    .toLowerCase();

                status.className = `admin-status ${statusKey}`;
                status.textContent = order.statusLabel ||
                    statusKey.replace(/_/g, " ")
                        .replace(/\b\w/g, letter => letter.toUpperCase());

                statusCell.append(status);
                row.append(statusCell);
                tbody.append(row);
            });
        }
        
function renderPlatformSummary(summary) {
    if (!summary) {
        console.warn("Platform Summary data is missing from the API.");
        return;
    }

    const summaryItems = document.querySelectorAll(
        ".admin-summary-list .admin-summary-item"
    );

    const values = [
        {
            value: summary.activeRiders,
            format: formatNumber
        },
        {
            value: summary.onlineRiders,
            format: formatNumber
        },
        {
            value: summary.activeRestaurants,
            format: formatNumber
        },
        {
            value: summary.pendingApprovals,
            format: formatNumber
        },
        {
            value: summary.openSupportTickets,
            format: formatNumber
        },
        {
            value: summary.todaysRevenue,
            format: formatMoney
        }
    ];

    summaryItems.forEach((item, index) => {
        const strong = item.querySelector("strong");
        const entry = values[index];

        if (!strong || !entry) return;

        strong.textContent = entry.format(entry.value);
    });
}


        function renderDashboard(data) {
            if (!data || typeof data !== "object") {
                throw new Error("Unexpected dashboard API response.");
            }

            renderProfile(data.admin);

            const stats = data.stats || {};

            setStatCard(
                0,
                stats.totalOrders?.value,
                stats.totalOrders?.change,
                stats.totalOrders?.description
            );

            setStatCard(
                1,
                stats.totalRevenue?.value,
                stats.totalRevenue?.change,
                stats.totalRevenue?.description,
                true
            );

            setStatCard(
                2,
                stats.customers?.value,
                stats.customers?.change,
                stats.customers?.description
            );

            setStatCard(
                3,
                stats.restaurants?.value,
                stats.restaurants?.change,
                stats.restaurants?.description
            );

            const dateNode = document.querySelector(
                ".admin-page-header .admin-date strong"
            );

            setText(
                dateNode,
                new Intl.DateTimeFormat("en-KE", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Africa/Nairobi"
                }).format(new Date())
            );

            renderRevenueChart(data.revenue);

            const statuses = Array.isArray(data.orderStatus)
                ? data.orderStatus
                : [];

            const totalOrders = statuses.reduce(
                (sum, item) => sum + (Number(item.count) || 0),
                0
            );

            renderOrderStatus(statuses, totalOrders);
            renderRecentOrders(data.recentOrders);

            const pending = Number(
                data.pendingOrderCount ?? data.notificationCount
            ) || 0;

            document.querySelectorAll(".admin-nav-badge").forEach(badge => {
                badge.textContent = pending > 99 ? "99+" : String(pending);
                badge.hidden = pending === 0;
            });
        }

        function resetDashboard() {
            document.querySelectorAll(".admin-stats-grid .admin-stat-content strong")
                .forEach(node => { node.textContent = "—"; });
            document.querySelectorAll(".admin-stats-grid .admin-stat-content small")
                .forEach(node => node.replaceChildren());

            const bars = document.querySelector(".admin-chart-bars");
            if (bars) bars.replaceChildren();
            const yAxis = document.querySelector(".admin-chart-y-axis");
            if (yAxis) {
                yAxis.replaceChildren(...Array.from({ length: 5 }, () => {
                    const item = document.createElement("span");
                    item.textContent = "—";
                    return item;
                }));
            }

            const total = document.querySelector(".admin-status-total strong");
            if (total) total.textContent = "—";
            document.querySelectorAll(".admin-status-list .admin-status-item strong")
                .forEach(node => { node.textContent = "—"; });

            const tbody = document.querySelector(".admin-bottom-grid .admin-table tbody");
            if (tbody) {
                const row = document.createElement("tr");
                const cell = document.createElement("td");
                cell.colSpan = 5;
                cell.textContent = "Dashboard data is unavailable.";
                row.append(cell);
                tbody.replaceChildren(row);
            }
        }

        async function loadDashboard() {
            if (!API || typeof API.request !== "function") {
                resetDashboard();
                showMessage(
                    "Dashboard API client did not load. Please refresh the page.",
                    "error"
                );
                return;
            }

            const selected = periodSelect?.value || "Last 7 Days";

            const period = selected === "Last 30 Days"
                ? "30d"
                : selected === "Last 3 Months"
                    ? "3m"
                    : "7d";

            if (periodSelect) periodSelect.disabled = true;

            clearMessage();

            try {
                const data = await API.request(
                    `/admins/dashboard?period=${encodeURIComponent(period)}`,
                    { authenticated: true }
                );

                renderDashboard(data);
            } catch (error) {
                console.error("Admin dashboard error:", error);
                resetDashboard();

                showMessage(
                    error?.message ||
                    "Could not load dashboard data. Please try again.",
                    "error"
                );
            } finally {
                if (periodSelect) periodSelect.disabled = false;
            }
        }

        if (periodSelect) {
            periodSelect.addEventListener("change", loadDashboard);
        }

        resetDashboard();
        loadDashboard();
    });
})();
