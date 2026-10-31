/* =========================================================
   FOOD DELIVERY — ADMIN RIDER MANAGEMENT
   File: Frontend/assets/js/admin/riders.js

   Uses FoodDeliveryAuthApi.
   API base URL: window.FOOD_DELIVERY_API_BASE (see assets/js/api-config.js)
   Backend routes: /api/riders
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* =====================================================
         CONFIGURATION
      ===================================================== */

    const authApi = window.FoodDeliveryAuthApi;

    const configuredBaseUrl = document
        .querySelector('meta[name="api-base-url"]')
        ?.content?.trim();

    const API_BASE_URL = (
        configuredBaseUrl || (window.FOOD_DELIVERY_API_BASE || document.querySelector('meta[name="api-base-url"]')?.content?.trim() || "http://localhost:5000/api").replace(/\/+$/, "")
    ).replace(/\/+$/, "");

    const RIDERS_ENDPOINT = `${API_BASE_URL}/riders`;
    const PAGE_SIZE = 10;

    const VEHICLE_TYPES = ["motorcycle", "bicycle", "car"];

    const STATUS_OPTIONS = [
        "all",
        "active",
        "inactive",
        "online",
        "available",
        "on_delivery",
        "offline",
        "pending",
        "approved",
        "rejected",
    ];

    const state = {
        riders: [],
        page: 1,
        limit: PAGE_SIZE,
        totalItems: 0,
        totalPages: 1,
        search: "",
        status: "all",
        vehicleType: "",
        joinedFrom: "",
        joinedTo: "",
        sort: "newest",
        summary: {},
        statistics: {},
        modalMode: "add",
        selectedRider: null,
        loading: false,
        requestVersion: 0,
    };

    /* =====================================================
         DOM REFERENCES
      ===================================================== */

    const table = document.querySelector(".admin-riders-card .admin-table");

    const tableBody = table?.querySelector("tbody");
    const searchInput = document.querySelector(".admin-search input");
    const filterButton = document.querySelector(".admin-filter-button");
    const tabs = Array.from(document.querySelectorAll(".admin-rider-tab"));

    const messageBox = document.getElementById("adminMessage");

    const exportButton = document.querySelector(
        ".admin-page-actions .admin-secondary-button",
    );

    const addButton = document.querySelector(
        ".admin-page-actions .admin-primary-button",
    );

    const paginationContainer = document.querySelector(".admin-pagination");

    const paginationFooter = document.querySelector(".admin-table-footer p");

    if (!authApi || typeof authApi.request !== "function") {
        showMessage(
            "The authentication API helper is missing. Check that auth-api.js is loaded before riders.js.",
            "error",
        );
        return;
    }

    if (!tableBody) {
        console.error(
            "Rider table body was not found. Check .admin-riders-card .admin-table tbody in riders.html.",
        );

        showMessage(
            "The rider table could not be found. Check the riders page HTML.",
            "error",
        );
        return;
    }

    /* =====================================================
         GENERAL HELPERS
      ===================================================== */

    let messageTimeout = null;

    function showMessage(message, type = "success") {
        if (!messageBox) {
            if (type === "error") {
                console.error(message);
            } else {
                console.info(message);
            }
            return;
        }

        messageBox.textContent = message;
        messageBox.className = `admin-message ${type} visible`;
        messageBox.setAttribute("role", "alert");

        if (messageTimeout) {
            clearTimeout(messageTimeout);
        }

        messageTimeout = setTimeout(() => {
            messageBox.classList.remove("visible");
        }, 5000);
    }

    function escapeHtml(value) {
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

    function formatNumber(value) {
        const number = Number(value ?? 0);

        return Number.isFinite(number) ? number.toLocaleString() : "0";
    }

    function formatRating(value) {
        const number = Number(value);

        return Number.isFinite(number) ? number.toFixed(1) : "0.0";
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "—";
        }

        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function getFullName(rider) {
        const name = [rider?.first_name, rider?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim();

        return name || "Unnamed rider";
    }

    function getInitials(name) {
        return (
            String(name || "R")
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase())
                .join("") || "R"
        );
    }

    function humanize(value) {
        return String(value ?? "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }

    function normalizeAvailability(rider) {
        return String(rider?.availability || "offline").toLowerCase();
    }

    function normalizeApprovalStatus(rider) {
        return String(rider?.approval_status || "pending").toLowerCase();
    }

    
function isRiderActive(rider) {
    const value = rider?.is_active;

    // Handle boolean values returned by PostgreSQL/API.
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value == null) return false;

    // Handle string values from APIs or database serialization.
    const normalized = String(value).trim().toLowerCase();

    return ["true", "1", "t", "yes", "active"].includes(normalized);
}

    function getRiderStatusLabel(rider) {
        const approval = normalizeApprovalStatus(rider);

        if (approval === "pending" || approval === "rejected") {
            return approval;
        }

        if (!isRiderActive(rider)) {
            return "inactive";
        }

        const availability = normalizeAvailability(rider);

        if (availability === "on_delivery") {
            return "on_delivery";
        }

        if (availability === "available") {
            return "available";
        }

        if (availability === "online") {
            return "online";
        }

        return "offline";
    }

    function getStatusClass(status) {
        const allowedClasses = [
            "active",
            "inactive",
            "online",
            "available",
            "offline",
            "pending",
            "approved",
            "rejected",
            "on_delivery",
        ];

        return allowedClasses.includes(status) ? status : "offline";
    }

    function getVehicleLabel(vehicleType) {
        return vehicleType ? humanize(vehicleType) : "—";
    }

    function createElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }

        return element;
    }

    function setButtonLoading(button, loading, loadingText = "Please wait…") {
        if (!button) return;

        if (loading) {
            if (button.dataset.originalText === undefined) {
                button.dataset.originalText = button.textContent;
            }

            button.disabled = true;
            button.textContent = loadingText;
        } else {
            button.disabled = false;

            if (button.dataset.originalText !== undefined) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    function requirePositiveId(id) {
        const parsed = Number(id);

        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error("The rider ID is invalid.");
        }

        return parsed;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function getNumberOrNull(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const number = Number(value);

        return Number.isFinite(number) ? number : null;
    }

    /* =====================================================
         API REQUESTS
    
         FoodDeliveryAuthApi.request():
         - Uses the configured API base URL.
         - Adds the bearer token when authenticated.
         - Parses JSON and handles unsuccessful responses.
         - May return result.data when present.
      ===================================================== */

    const ridersApi = {
        list(params = {}) {
            const query = new URLSearchParams();

            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== "") {
                    query.set(key, String(value));
                }
            });

            const suffix = query.toString() ? `?${query.toString()}` : "";

            return authApi.request(`/riders${suffix}`, {
                method: "GET",
                authenticated: true,
            });
        },

        summary() {
            return authApi.request("/riders/summary", {
                method: "GET",
                authenticated: true,
            });
        },

        get(id) {
            return authApi.request(`/riders/${requirePositiveId(id)}`, {
                method: "GET",
                authenticated: true,
            });
        },

        create(payload) {
            return authApi.request("/riders", {
                method: "POST",
                body: payload,
                authenticated: true,
            });
        },

        update(id, payload) {
            return authApi.request(`/riders/${requirePositiveId(id)}`, {
                method: "PUT",
                body: payload,
                authenticated: true,
            });
        },

        remove(id) {
            return authApi.request(`/riders/${requirePositiveId(id)}`, {
                method: "DELETE",
                authenticated: true,
            });
        },

        activate(id) {
            return authApi.request(`/riders/${requirePositiveId(id)}/activate`, {
                method: "PATCH",
                authenticated: true,
            });
        },


deactivate(id) {
    return authApi.request(
        `/riders/${requirePositiveId(id)}/deactivate`,
        {
            method: "PATCH",
            authenticated: true,
        }
    );
},

        approve(id) {
            return authApi.request(`/riders/${requirePositiveId(id)}/approve`, {
                method: "PATCH",
                authenticated: true,
            });
        },

        reject(id, reason) {
            return authApi.request(`/riders/${requirePositiveId(id)}/reject`, {
                method: "PATCH",
                body: { reason },
                authenticated: true,
            });
        },
    };

    /* =====================================================
         STATISTICS
      ===================================================== */

    function setStatValue(label, value) {
        const cards = document.querySelectorAll(".admin-stat-card");

        cards.forEach((card) => {
            const labelElement = card.querySelector(".admin-stat-content span");

            const valueElement = card.querySelector(".admin-stat-content strong");

            if (!labelElement || !valueElement) return;

            if (
                labelElement.textContent.trim().toLowerCase() === label.toLowerCase()
            ) {
                const number = getNumberOrNull(value);
                valueElement.textContent = number === null ? "—" : formatNumber(number);
            }
        });
    }

    function renderStatistics(statistics = {}) {
        state.statistics = {
            ...state.statistics,
            ...statistics,
        };

        const summary = {
            ...state.statistics,
            ...state.summary,
        };

        setStatValue("Total Riders", summary.total);
        setStatValue("Online Riders", summary.online);
        setStatValue("Available Riders", summary.available);
        setStatValue("Pending Approval", summary.pendingApproval);
    }

    function renderActivitySummary(summary = {}) {
        const summaryItems = document.querySelectorAll(
            ".admin-summary-list .admin-summary-item",
        );

        const values = {
            "online riders": summary.online,
            available: summary.available,
            "on delivery": summary.onDelivery,
            offline: summary.offline,
            "pending approval": summary.pendingApproval,
        };

        summaryItems.forEach((item) => {
            const label = item
                .querySelector("strong")
                ?.textContent?.trim()
                ?.toLowerCase();

            const valueElement = item.querySelector(":scope > span");

            if (!label || !valueElement) return;

            if (Object.prototype.hasOwnProperty.call(values, label)) {
                const value = getNumberOrNull(values[label]);

                valueElement.textContent = value === null ? "—" : formatNumber(value);
            }
        });
    }

    /*
     * Updates the existing performance cards.
     * Missing backend values display "—" instead of retaining
     * old, potentially misleading placeholder numbers.
     */
    function renderPerformance(summary = {}) {
        const items = document.querySelectorAll(
            ".admin-rider-performance .admin-performance-item",
        );

        items.forEach((item) => {
            const label = item
                .querySelector(".admin-performance-header span")
                ?.textContent?.trim()
                ?.toLowerCase();

            const valueElement = item.querySelector(
                ".admin-performance-header strong",
            );

            const progressElement = item.querySelector(".admin-progress-value");

            if (!label || !valueElement) return;

            let rawValue = null;
            let displayValue = "—";
            let progress = null;

            if (label.includes("delivery completion")) {
                rawValue = getNumberOrNull(summary.deliveryCompletionRate);

                if (rawValue !== null) {
                    const value = clamp(rawValue, 0, 100);
                    displayValue = `${value.toFixed(1)}%`;
                    progress = value;
                }
            } else if (label.includes("on-time delivery")) {
                rawValue = getNumberOrNull(summary.onTimeRate);

                if (rawValue !== null) {
                    const value = clamp(rawValue, 0, 100);
                    displayValue = `${value.toFixed(1)}%`;
                    progress = value;
                }
            } else if (label.includes("average rating")) {
                rawValue = getNumberOrNull(summary.averageRating);

                if (rawValue !== null) {
                    const value = clamp(rawValue, 0, 5);
                    displayValue = `${value.toFixed(1)} / 5`;
                    progress = (value / 5) * 100;
                }
            } else if (label.includes("completed today")) {
                /*
                 * The current summary API does not expose a daily
                 * completed-deliveries metric. Do not present a static
                 * HTML placeholder as live data.
                 */
                valueElement.textContent = "—";

                if (progressElement) {
                    progressElement.style.width = "0%";
                }

                return;
            } else {
                return;
            }

            valueElement.textContent = displayValue;

            if (progressElement) {
                progressElement.style.width =
                    progress === null ? "0%" : `${clamp(progress, 0, 100)}%`;
            }
        });
    }

    async function loadSummary() {
        try {
            const response = await ridersApi.summary();
            const summary = response?.summary || response || {};

            state.summary = summary;

            renderStatistics(state.statistics);
            renderActivitySummary(summary);
            renderPerformance(summary);
        } catch (error) {
            console.error("Failed to load rider summary:", error);

            showMessage(
                error?.message || "Could not load rider statistics.",
                "error",
            );
        }
    }

    /* =====================================================
         RIDER TABLE
      ===================================================== */

    function createActionButton(label, riderId, options = {}) {
        const button = createElement(
            "button",
            `admin-table-action${options.danger ? " danger" : ""}`,
            options.text || label,
        );

        button.type = "button";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.dataset.action = options.action || "";
        button.dataset.riderId = String(riderId);

        if (options.disabled) {
            button.disabled = true;
        }

        return button;
    }

    function createRiderRow(rider) {
        const row = document.createElement("tr");

        const riderId = rider.id;
        const fullName = getFullName(rider);
        const approvalStatus = normalizeApprovalStatus(rider);
        const riderStatus = getRiderStatusLabel(rider);
        const active = isRiderActive(rider);

        row.dataset.riderId = String(riderId);

        // Rider identity
        const identityCell = document.createElement("td");
        const identity = createElement("div", "admin-rider");

        const avatar = createElement(
            "div",
            "admin-rider-avatar",
            getInitials(fullName),
        );

        const identityInfo = createElement("div", "admin-rider-info");

        identityInfo.append(
            createElement("strong", "", fullName),
            createElement("span", "", `Rider ID: ${riderId}`),
        );

        identity.append(avatar, identityInfo);
        identityCell.appendChild(identity);

        // Phone and email
        const phoneCell = document.createElement("td");
        const phoneInfo = createElement("div", "admin-rider-info");

        phoneInfo.append(
            createElement("strong", "", rider.phone || "—"),
            createElement("span", "", rider.email || "—"),
        );

        phoneCell.appendChild(phoneInfo);

        // Vehicle
        const vehicleCell = document.createElement("td");
        const vehicleInfo = createElement("div", "admin-rider-info");

        vehicleInfo.append(
            createElement("strong", "", getVehicleLabel(rider.vehicle_type)),
            createElement("span", "", rider.vehicle_plate || "No plate"),
        );

        vehicleCell.appendChild(vehicleInfo);

        // Deliveries
        const deliveriesCell = document.createElement("td");

        deliveriesCell.appendChild(
            createElement("strong", "", formatNumber(rider.deliveries)),
        );

        // Rating
        const ratingCell = document.createElement("td");
        const rating = Number(rider.rating ?? 0);
        const ratingCount = Number(rider.rating_count ?? 0);

        ratingCell.appendChild(
            createElement(
                "span",
                "admin-rider-rating",
                `★ ${formatRating(rating)} (${formatNumber(ratingCount)})`,
            ),
        );

        // Status
        const statusCell = document.createElement("td");

        statusCell.appendChild(
            createElement(
                "span",
                `admin-status ${getStatusClass(riderStatus)}`,
                humanize(riderStatus),
            ),
        );

        // Actions
        const actionsCell = document.createElement("td");
        const actions = createElement("div", "admin-table-actions");

        actions.appendChild(
            createActionButton("View rider", riderId, {
                text: "View",
                action: "view",
            }),
        );

        actions.appendChild(
            createActionButton("Edit rider", riderId, {
                text: "Edit",
                action: "edit",
            }),
        );

        
        // Approval actions
        if (approvalStatus === "pending") {
            actions.append(
                createActionButton("Approve rider", riderId, {
                    text: "Approve",
                    action: "approve",
                }),
                createActionButton("Reject rider", riderId, {
                    text: "Reject",
                    action: "reject",
                    danger: true,
                }),
            );
        } else if (approvalStatus === "rejected") {
            actions.appendChild(
                createActionButton("Approve rider", riderId, {
                    text: "Approve",
                    action: "approve",
                }),
            );
        }

        // Account activation actions are independent of approval actions.
        if (active) {
            actions.appendChild(
                createActionButton("Deactivate rider", riderId, {
                    text: "Deactivate",
                    action: "deactivate",
                    danger: true,
                }),
            );
        } else {
            actions.appendChild(
                createActionButton("Activate rider", riderId, {
                    text: "Activate",
                    action: "activate",
                }),
            );
        }

        actions.append(
            createActionButton("Deactivate/delete rider", riderId, {
                text: "Delete",
                action: "delete",
                danger: true,
            }),
            createActionButton("Permanently delete rider (archive first)", riderId, {
                text: "Delete permanently",
                action: "permanent-delete",
                danger: true,
            }),
        );

        actionsCell.appendChild(actions);

        row.append(
            identityCell,
            phoneCell,
            vehicleCell,
            deliveriesCell,
            ratingCell,
            statusCell,
            actionsCell,
        );

        return row;
    }

    function renderRiders() {
        tableBody.replaceChildren();

        if (!state.riders.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 7;
            cell.className = "admin-empty-state";
            cell.textContent = state.loading ? "Loading riders…" : "No riders found.";

            cell.style.textAlign = "center";
            cell.style.padding = "2rem 1rem";

            row.appendChild(cell);
            tableBody.appendChild(row);

            return;
        }

        const fragment = document.createDocumentFragment();

        state.riders.forEach((rider) => {
            fragment.appendChild(createRiderRow(rider));
        });

        tableBody.appendChild(fragment);
    }

    /* =====================================================
         PAGINATION
      ===================================================== */

    function renderPagination(pagination = {}) {
        const page = Number(pagination.page ?? state.page);
        const limit = Number(pagination.limit ?? state.limit);
        const totalItems = Number(pagination.totalItems ?? state.totalItems);

        const totalPages = Math.max(
            1,
            Number(
                pagination.totalPages ?? Math.ceil(totalItems / Math.max(1, limit)),
            ),
        );

        state.page = page;
        state.limit = limit;
        state.totalItems = totalItems;
        state.totalPages = totalPages;

        const start = totalItems === 0 ? 0 : (page - 1) * limit + 1;

        const end = Math.min(page * limit, totalItems);

        if (paginationFooter) {
            paginationFooter.textContent = `Showing ${start}–${end} of ${totalItems} riders`;
        }

        if (!paginationContainer) return;

        paginationContainer.replaceChildren();

        function addPageButton(label, targetPage, options = {}) {
            const button = createElement("button", "", label);

            button.type = "button";
            button.disabled = Boolean(options.disabled);
            button.dataset.page = String(targetPage);

            if (options.active) {
                button.classList.add("active");
                button.setAttribute("aria-current", "page");
            }

            if (options.disabled) {
                button.classList.add("disabled");
            }

            paginationContainer.appendChild(button);
        }

        addPageButton("‹", Math.max(1, page - 1), {
            disabled: page <= 1,
        });

        let firstPage = Math.max(1, page - 2);
        let lastPage = Math.min(totalPages, firstPage + 4);

        firstPage = Math.max(1, lastPage - 4);

        for (let current = firstPage; current <= lastPage; current += 1) {
            addPageButton(String(current), current, {
                active: current === page,
            });
        }

        addPageButton("›", Math.min(totalPages, page + 1), {
            disabled: page >= totalPages,
        });
    }

    /* =====================================================
         LOAD RIDERS
      ===================================================== */

    async function loadRiders() {
        const requestVersion = ++state.requestVersion;

        state.loading = true;
        renderRiders();

        const params = {
            page: state.page,
            limit: state.limit,
            search: state.search,
            status: state.status,
            vehicle_type: state.vehicleType,
            joined_from: state.joinedFrom,
            joined_to: state.joinedTo,
            sort: state.sort,
        };

        try {
            const response = await ridersApi.list(params);

            // Ignore stale results after a newer search/filter request.
            if (requestVersion !== state.requestVersion) return;

            state.riders = Array.isArray(response?.riders) ? response.riders : [];

            const pagination = response?.pagination || {};

            state.page = Number(pagination.page ?? state.page);
            state.limit = Number(pagination.limit ?? state.limit);

            state.totalItems = Number(pagination.totalItems ?? state.riders.length);

            state.totalPages = Number(
                pagination.totalPages ??
                Math.max(1, Math.ceil(state.totalItems / Math.max(1, state.limit))),
            );

            if (response?.statistics) {
                state.statistics = {
                    ...state.statistics,
                    ...response.statistics,
                };
            }

            renderRiders();
            renderPagination(pagination);
            renderStatistics(state.statistics);
        } catch (error) {
            if (requestVersion !== state.requestVersion) return;

            console.error("Failed to load riders:", error);

            state.riders = [];

            renderRiders();

            renderPagination({
                page: 1,
                limit: state.limit,
                totalItems: 0,
                totalPages: 1,
            });

            showMessage(
                error?.message || "Could not load riders from the server.",
                "error",
            );
        } finally {
            if (requestVersion === state.requestVersion) {
                state.loading = false;
                renderRiders();
            }
        }
    }

    async function reloadData() {
        await Promise.all([loadRiders(), loadSummary()]);
    }

    /* =====================================================
         MODAL STYLES
      ===================================================== */

    let filterPanel = null;
    let riderModal = null;

    function injectModalStyles() {
        if (document.getElementById("admin-riders-js-styles")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "admin-riders-js-styles";

        style.textContent = `
      .admin-js-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, .55);
        overflow-y: auto;
      }

      .admin-js-overlay.hidden {
        display: none;
      }

      .admin-js-dialog {
        width: min(100%, 700px);
        max-height: 90vh;
        overflow-y: auto;
        padding: 24px;
        border-radius: 12px;
        background: var(--admin-card-bg, #fff);
        color: var(--admin-text, #222);
        box-shadow: 0 16px 48px rgba(0, 0, 0, .25);
      }

      .admin-js-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }

      .admin-js-dialog-header h3 {
        margin: 0;
      }

      .admin-js-close {
        border: 0;
        background: transparent;
        font-size: 26px;
        cursor: pointer;
      }

      .admin-js-form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .admin-js-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }

      .admin-js-field.full {
        grid-column: 1 / -1;
      }

      .admin-js-field label {
        font-weight: 600;
        font-size: .92rem;
      }

      .admin-js-field input,
      .admin-js-field select,
      .admin-js-field textarea {
        width: 100%;
        min-height: 42px;
        padding: 10px 12px;
        border: 1px solid #ccc;
        border-radius: 7px;
        font: inherit;
        color: inherit;
        background: transparent;
        box-sizing: border-box;
      }

      .admin-js-field input:disabled,
      .admin-js-field select:disabled {
        opacity: .75;
        cursor: not-allowed;
      }

      .admin-js-field textarea {
        min-height: 90px;
        resize: vertical;
      }

      .admin-js-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 22px;
      }

      .admin-js-actions button,
      .admin-js-inline-action {
        padding: 9px 13px;
        border: 1px solid #ccc;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }

      .admin-js-actions button.primary {
        background: var(--admin-primary, #2563eb);
        border-color: var(--admin-primary, #2563eb);
        color: #fff;
      }

      .admin-js-actions button.danger {
        color: #b91c1c;
        border-color: #b91c1c;
      }

      .admin-js-actions button:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      .admin-js-error {
        min-height: 1em;
        color: #b91c1c;
        font-size: .9rem;
        margin-top: 10px;
      }

      .admin-js-message {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 7px;
        background: rgba(100, 100, 100, .1);
      }

      .admin-js-message.error {
        color: #b91c1c;
        background: rgba(185, 28, 28, .08);
      }

      .admin-js-details {
        display: grid;
        grid-template-columns: minmax(120px, .7fr) 1.3fr;
        gap: 10px 16px;
        overflow-wrap: anywhere;
      }

      .admin-js-details dt {
        font-weight: 600;
      }

      .admin-js-details dd {
        margin: 0;
      }

      .admin-js-account-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        padding: 14px;
        border: 1px solid #ddd;
        border-radius: 8px;
      }

      .admin-js-account-status p {
        margin: 4px 0 0;
        font-size: .88rem;
        opacity: .8;
      }

      .admin-js-account-status button {
        padding: 9px 13px;
        border: 1px solid #ccc;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }

      .admin-js-account-status button.danger {
        color: #b91c1c;
        border-color: #b91c1c;
      }

      .admin-table-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .admin-table-actions .admin-table-action {
        padding: 5px 8px;
        cursor: pointer;
      }

      .admin-table-actions .admin-table-action:disabled {
        opacity: .5;
        cursor: not-allowed;
      }

      @media (max-width: 600px) {
        .admin-js-form-grid {
          grid-template-columns: 1fr;
        }

        .admin-js-field.full {
          grid-column: auto;
        }

        .admin-js-dialog {
          padding: 18px;
        }
      }
    `;

        document.head.appendChild(style);
    }

    function createOverlay(id, title) {
        injectModalStyles();

        const overlay = createElement("div", "admin-js-overlay hidden");
        overlay.id = id;
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", title);

        const dialog = createElement("section", "admin-js-dialog");
        const header = createElement("div", "admin-js-dialog-header");
        const heading = createElement("h3", "", title);
        const closeButton = createElement("button", "admin-js-close", "×");

        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Close dialog");

        header.append(heading, closeButton);
        dialog.appendChild(header);
        overlay.appendChild(dialog);

        const close = () => {
            overlay.classList.add("hidden");
        };

        closeButton.addEventListener("click", close);

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                close();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
                close();
            }
        });

        document.body.appendChild(overlay);

        return {
            overlay,
            dialog,
            heading,
        };
    }

    /* =====================================================
         FILTER PANEL
      ===================================================== */

    function ensureFilterPanel() {
        if (filterPanel) return filterPanel;

        const { overlay, dialog } = createOverlay(
            "adminRiderFilters",
            "Filter riders",
        );

        const form = document.createElement("form");
        form.className = "admin-js-form-grid";

        form.innerHTML = `
      <div class="admin-js-field">
        <label for="riderFilterStatus">Status</label>
        <select id="riderFilterStatus" name="status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="online">Online</option>
          <option value="available">Available</option>
          <option value="on_delivery">On delivery</option>
          <option value="offline">Offline</option>
          <option value="pending">Pending approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div class="admin-js-field">
        <label for="riderFilterVehicle">Vehicle type</label>
        <select id="riderFilterVehicle" name="vehicle_type">
          <option value="">All vehicles</option>
          <option value="motorcycle">Motorcycle</option>
          <option value="bicycle">Bicycle</option>
          <option value="car">Car</option>
        </select>
      </div>

      <div class="admin-js-field">
        <label for="riderFilterJoinedFrom">Joined from</label>
        <input id="riderFilterJoinedFrom" name="joined_from" type="date">
      </div>

      <div class="admin-js-field">
        <label for="riderFilterJoinedTo">Joined to</label>
        <input id="riderFilterJoinedTo" name="joined_to" type="date">
      </div>

      <div class="admin-js-field full">
        <label for="riderFilterSort">Sort by</label>
        <select id="riderFilterSort" name="sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name</option>
          <option value="deliveries">Deliveries</option>
          <option value="rating">Rating</option>
        </select>
      </div>

      <div class="admin-js-field full">
        <p class="admin-js-error" id="riderFilterError" aria-live="polite"></p>
      </div>

      <div class="admin-js-actions full">
        <button type="button" id="riderFilterReset">Reset</button>
        <button type="submit" class="primary">Apply filters</button>
      </div>
    `;

        dialog.appendChild(form);

        form.elements.status.value = state.status;
        form.elements.vehicle_type.value = state.vehicleType;
        form.elements.joined_from.value = state.joinedFrom;
        form.elements.joined_to.value = state.joinedTo;
        form.elements.sort.value = state.sort;

        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            const from = form.elements.joined_from.value;
            const to = form.elements.joined_to.value;

            const errorElement = form.querySelector("#riderFilterError");

            if (from && to && from > to) {
                errorElement.textContent =
                    "The start date must be on or before the end date.";
                return;
            }

            errorElement.textContent = "";

            state.status = form.elements.status.value || "all";
            state.vehicleType = form.elements.vehicle_type.value;
            state.joinedFrom = from;
            state.joinedTo = to;
            state.sort = form.elements.sort.value || "newest";
            state.page = 1;

            updateActiveTab();
            overlay.classList.add("hidden");

            await loadRiders();
        });

        form
            .querySelector("#riderFilterReset")
            .addEventListener("click", async () => {
                form.reset();

                state.status = "all";
                state.vehicleType = "";
                state.joinedFrom = "";
                state.joinedTo = "";
                state.sort = "newest";
                state.search = "";
                state.page = 1;

                form.elements.status.value = "all";
                form.elements.vehicle_type.value = "";
                form.elements.joined_from.value = "";
                form.elements.joined_to.value = "";
                form.elements.sort.value = "newest";

                if (searchInput) {
                    searchInput.value = "";
                }

                updateActiveTab();
                overlay.classList.add("hidden");

                await loadRiders();
            });

        filterPanel = { overlay, form };

        return filterPanel;
    }

    function updateActiveTab() {
        tabs.forEach((tab) => {
            const label = tab.textContent.trim().toLowerCase();

            let isActive = false;

            if (state.status === "all") {
                isActive = label === "all";
            } else if (state.status === "pending") {
                isActive = label === "pending";
            } else if (["online", "available", "offline"].includes(state.status)) {
                isActive = label === state.status;
            }

            tab.classList.toggle("active", isActive);
        });
    }

    /* =====================================================
         RIDER FORM MODAL
      ===================================================== */

    function ensureRiderModal() {
        if (riderModal) return riderModal;

        const { overlay, dialog, heading } = createOverlay(
            "adminRiderModal",
            "Add rider",
        );

        const form = document.createElement("form");
        form.id = "adminRiderForm";

        form.innerHTML = `
      <div class="admin-js-form-grid">
        <div class="admin-js-field">
          <label for="riderFirstName">First name *</label>
          <input
            id="riderFirstName"
            name="first_name"
            type="text"
            autocomplete="given-name"
            required
          >
        </div>

        <div class="admin-js-field">
          <label for="riderLastName">Last name *</label>
          <input
            id="riderLastName"
            name="last_name"
            type="text"
            autocomplete="family-name"
            required
          >
        </div>

        <div class="admin-js-field">
          <label for="riderEmail">Email address *</label>
          <input
            id="riderEmail"
            name="email"
            type="email"
            autocomplete="email"
            required
          >
        </div>

        <div class="admin-js-field">
          <label for="riderPhone">Phone number *</label>
          <input
            id="riderPhone"
            name="phone"
            type="tel"
            autocomplete="tel"
            required
          >
        </div>

        <div class="admin-js-field">
          <label for="riderVehicleType">Vehicle type *</label>
          <select id="riderVehicleType" name="vehicle_type" required>
            <option value="">Select a vehicle</option>
            <option value="motorcycle">Motorcycle</option>
            <option value="bicycle">Bicycle</option>
            <option value="car">Car</option>
          </select>
        </div>

        <div class="admin-js-field">
          <label for="riderVehiclePlate">Vehicle plate</label>
          <input
            id="riderVehiclePlate"
            name="vehicle_plate"
            type="text"
            autocomplete="off"
          >
        </div>

        <div class="admin-js-field full" id="riderPasswordField">
          <label for="riderPassword">Password</label>
          <input
            id="riderPassword"
            name="password"
            type="password"
            minlength="8"
            autocomplete="new-password"
          >
          <small>
            Leave blank when creating a rider to let the backend generate
            a temporary password. When editing, leave blank to keep the
            current password.
          </small>
        </div>

        <div class="admin-js-field full" id="riderRejectionField" hidden>
          <label for="riderRejectionReason">Rejection reason</label>
          <textarea id="riderRejectionReason" readonly></textarea>
        </div>

        <div class="admin-js-field full" id="riderAccountStatusField" hidden>
          <div class="admin-js-account-status">
            <div>
              <strong id="riderAccountStatusTitle">Account status</strong>
              <p id="riderAccountStatusDescription"></p>
            </div>

            <button
              type="button"
              id="riderAccountToggle"
            >
              Deactivate Rider
            </button>
          </div>
        </div>
      </div>

      <div
        class="admin-js-message"
        id="riderModalMessage"
        role="alert"
        hidden
      ></div>

      <p
        class="admin-js-error"
        id="riderModalError"
        role="alert"
        aria-live="polite"
      ></p>

      <div class="admin-js-actions" id="riderModalActions">
        <button type="button" id="riderModalCancel">Close</button>
        <button type="submit" class="primary" id="riderModalSave">
          Create Rider
        </button>
      </div>
    `;

        dialog.appendChild(form);

        form
            .querySelector("#riderModalCancel")
            .addEventListener("click", () => overlay.classList.add("hidden"));

        form
            .querySelector("#riderAccountToggle")
            .addEventListener("click", handleModalAccountToggle);

        form.addEventListener("submit", handleRiderSubmit);

        riderModal = {
            overlay,
            dialog,
            heading,
            form,
        };

        return riderModal;
    }

    function showModalMessage(message, type = "info") {
        const modal = ensureRiderModal();
        const box = modal.form.querySelector("#riderModalMessage");

        box.textContent = message;
        box.className = `admin-js-message ${type}`;
        box.hidden = false;
    }

    function showModalError(message) {
        const modal = ensureRiderModal();

        modal.form.querySelector("#riderModalError").textContent = message;
    }

    function clearModalMessages() {
        const modal = ensureRiderModal();

        modal.form.querySelector("#riderModalError").textContent = "";

        const box = modal.form.querySelector("#riderModalMessage");

        box.textContent = "";
        box.hidden = true;
        box.className = "admin-js-message";
    }

    function setModalReadOnly(readOnly) {
        const modal = ensureRiderModal();
        const form = modal.form;

        [
            "first_name",
            "last_name",
            "email",
            "phone",
            "vehicle_type",
            "vehicle_plate",
            "password",
        ].forEach((name) => {
            const field = form.elements[name];

            if (field) {
                field.disabled = readOnly;
            }
        });

        form.querySelector("#riderModalSave").hidden = readOnly;
        form.querySelector("#riderPasswordField").hidden = readOnly;

        const statusField = form.querySelector("#riderAccountStatusField");

        statusField.hidden = readOnly || state.modalMode !== "edit";

        form.querySelector("#riderAccountToggle").disabled = readOnly;
    }

    function populateRiderForm(rider) {
        const modal = ensureRiderModal();
        const form = modal.form;

        form.elements.first_name.value = rider?.first_name || "";
        form.elements.last_name.value = rider?.last_name || "";
        form.elements.email.value = rider?.email || "";
        form.elements.phone.value = rider?.phone || "";
        form.elements.vehicle_type.value = rider?.vehicle_type || "";
        form.elements.vehicle_plate.value = rider?.vehicle_plate || "";
        form.elements.password.value = "";

        const rejectionField = form.querySelector("#riderRejectionField");
        const rejectionReason = form.querySelector("#riderRejectionReason");

        rejectionReason.value = rider?.rejection_reason || "";
        rejectionField.hidden = !rider?.rejection_reason;

        renderModalAccountStatus(rider);
    }

    function renderModalAccountStatus(rider) {
        const modal = ensureRiderModal();
        const form = modal.form;

        const statusField = form.querySelector("#riderAccountStatusField");

        const statusTitle = form.querySelector("#riderAccountStatusTitle");

        const statusDescription = form.querySelector(
            "#riderAccountStatusDescription",
        );

        const toggleButton = form.querySelector("#riderAccountToggle");

        if (!rider || state.modalMode !== "edit") {
            statusField.hidden = true;
            return;
        }

        const active = isRiderActive(rider);

        statusField.hidden = false;

        statusTitle.textContent = active
            ? "Account is active"
            : "Account is inactive";

        statusDescription.textContent = active
            ? "This rider account is currently active."
            : "This rider account is currently deactivated.";

        toggleButton.textContent = active ? "Deactivate Rider" : "Activate Rider";

        toggleButton.classList.toggle("danger", active);
        toggleButton.disabled = false;
    }

    function renderModalDetails(rider) {
        const modal = ensureRiderModal();
        const form = modal.form;

        form.querySelector("#riderExtraDetails")?.remove();

        if (state.modalMode !== "view") return;

        const extraDetails = document.createElement("dl");

        extraDetails.id = "riderExtraDetails";
        extraDetails.className = "admin-js-details";

        const details = [
            ["Approval status", humanize(normalizeApprovalStatus(rider))],
            ["Availability", humanize(normalizeAvailability(rider))],
            ["Account active", isRiderActive(rider) ? "Yes" : "No"],
            ["Completed deliveries", formatNumber(rider.deliveries)],
            ["Active orders", formatNumber(rider.active_orders)],
            ["Rating", `${formatRating(rider.rating)} / 5`],
            ["Rating count", formatNumber(rider.rating_count)],
            ["Joined", formatDate(rider.created_at)],
            ["Approved at", formatDate(rider.approved_at)],
            ["Last updated", formatDate(rider.updated_at)],
        ];

        details.forEach(([label, value]) => {
            extraDetails.append(
                createElement("dt", "", label),
                createElement("dd", "", value),
            );
        });

        form.querySelector("#riderModalActions").before(extraDetails);
    }

    async function openRiderModal(mode, riderId = null) {
        const modal = ensureRiderModal();
        const form = modal.form;
        const saveButton = form.querySelector("#riderModalSave");

        state.modalMode = mode;
        state.selectedRider = null;

        form.reset();
        clearModalMessages();

        form.querySelector("#riderRejectionField").hidden = true;
        form.querySelector("#riderPasswordField").hidden = false;
        form.querySelector("#riderExtraDetails")?.remove();

        modal.heading.textContent =
            mode === "add"
                ? "Add rider"
                : mode === "view"
                    ? "Rider details"
                    : "Edit rider";

        saveButton.textContent = mode === "add" ? "Create Rider" : "Save Changes";

        setModalReadOnly(mode === "view");

        if (mode === "add") {
            state.selectedRider = null;

            form.querySelector("#riderAccountStatusField").hidden = true;

            modal.overlay.classList.remove("hidden");
            form.elements.first_name.focus();

            return;
        }

        if (!riderId) {
            showMessage("Select a rider first.", "error");
            return;
        }

        modal.overlay.classList.remove("hidden");
        saveButton.disabled = true;

        try {
            const response = await ridersApi.get(riderId);
            const rider = response?.rider || response;

            if (!rider?.id) {
                throw new Error("The server did not return the rider details.");
            }

            state.selectedRider = rider;

            populateRiderForm(rider);
            setModalReadOnly(mode === "view");
            renderModalDetails(rider);

            if (mode === "edit") {
                renderModalAccountStatus(rider);
            }
        } catch (error) {
            showModalError(error?.message || "Could not load the rider details.");
        } finally {
            saveButton.disabled = false;
        }
    }

    function validateRiderPayload(payload) {
        if (!payload.first_name) {
            return "First name is required.";
        }

        if (!payload.last_name) {
            return "Last name is required.";
        }

        if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
            return "Enter a valid email address.";
        }

        if (!payload.phone) {
            return "Phone number is required.";
        }

        if (!VEHICLE_TYPES.includes(payload.vehicle_type)) {
            return "Select a valid vehicle type.";
        }

        if (payload.password && payload.password.length < 8) {
            return "Password must contain at least 8 characters.";
        }

        return "";
    }

    async function handleRiderSubmit(event) {
        event.preventDefault();

        const modal = ensureRiderModal();
        const form = modal.form;
        const saveButton = form.querySelector("#riderModalSave");

        clearModalMessages();

        if (state.modalMode === "view") return;

        const payload = {
            first_name: form.elements.first_name.value.trim(),
            last_name: form.elements.last_name.value.trim(),
            email: form.elements.email.value.trim(),
            phone: form.elements.phone.value.trim(),
            vehicle_type: form.elements.vehicle_type.value,
            vehicle_plate: form.elements.vehicle_plate.value.trim() || null,
        };

        const password = form.elements.password.value;

        if (password) {
            payload.password = password;
        }

        const validationError = validateRiderPayload(payload);

        if (validationError) {
            showModalError(validationError);
            return;
        }

        const mode = state.modalMode;

        saveButton.disabled = true;
        saveButton.textContent = mode === "add" ? "Creating…" : "Saving…";

        try {
            if (mode === "add") {
                const response = await ridersApi.create(payload);
                const rider = response?.rider || response;

                if (!rider?.id) {
                    throw new Error("The server did not return the created rider.");
                }

                modal.overlay.classList.add("hidden");

                state.page = 1;

                await reloadData();

                const temporaryPassword = response?.temporary_password;

                if (temporaryPassword) {
                    window.alert(
                        `Rider created successfully.\n\n` +
                        `Temporary password: ${temporaryPassword}\n\n` +
                        `Copy and securely share this password with the rider. ` +
                        `It will not be shown again here.`,
                    );
                }

                showMessage("Rider created successfully.", "success");
            } else {
                const riderId = state.selectedRider?.id;

                if (!riderId) {
                    throw new Error("No rider is selected for updating.");
                }

                await ridersApi.update(riderId, payload);

                modal.overlay.classList.add("hidden");

                await reloadData();

                showMessage("Rider updated successfully.", "success");
            }
        } catch (error) {
            console.error("Failed to save rider:", error);

            showModalError(error?.message || "Could not save the rider.");
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = mode === "add" ? "Create Rider" : "Save Changes";
        }
    }

    /* =====================================================
         ACCOUNT STATUS TOGGLE IN EDIT MODAL
      ===================================================== */

   
async function handleModalAccountToggle() {
    const rider = state.selectedRider;

    if (!rider?.id || state.modalMode !== "edit") {
        showModalError("Open a rider in edit mode first.");
        return;
    }

    const active = isRiderActive(rider);

    if (active) {
        await deactivateRider(rider.id, { fromModal: true });
    } else {
        await activateRider(rider.id, { fromModal: true });
    }
}

    /* =====================================================
         RIDER ACTIONS
      ===================================================== */

    async function approveRider(riderId) {
        if (!window.confirm("Approve this rider?")) return;

        try {
            await ridersApi.approve(riderId);

            await reloadData();

            showMessage("Rider approved successfully.", "success");
        } catch (error) {
            showMessage(error?.message || "Could not approve this rider.", "error");
        }
    }

    async function rejectRider(riderId) {
        const reason = window.prompt("Enter the reason for rejecting this rider:");

        if (reason === null) return;

        const trimmedReason = reason.trim();

        if (!trimmedReason) {
            showMessage("A rejection reason is required.", "error");
            return;
        }

        try {
            await ridersApi.reject(riderId, trimmedReason);

            await reloadData();

            showMessage("Rider rejected successfully.", "success");
        } catch (error) {
            showMessage(error?.message || "Could not reject this rider.", "error");
        }
    }

    async function activateRider(riderId, options = {}) {
        const modal = ensureRiderModal();
        const toggleButton = modal.form.querySelector("#riderAccountToggle");

        if (!options.fromModal) {
            if (!window.confirm("Activate this rider account?")) {
                return;
            }
        }

        if (options.fromModal) {
            toggleButton.disabled = true;
            clearModalMessages();
        }

        try {
            await ridersApi.activate(riderId);

            await reloadData();

            if (options.fromModal) {
                const response = await ridersApi.get(riderId);
                const updatedRider = response?.rider || response;

                if (updatedRider?.id) {
                    state.selectedRider = updatedRider;
                    populateRiderForm(updatedRider);
                    renderModalAccountStatus(updatedRider);
                }

                showModalMessage("Rider activated successfully.", "success");
            } else {
                showMessage("Rider activated successfully.", "success");
            }
        } catch (error) {
            if (options.fromModal) {
                showModalError(error?.message || "Could not activate this rider.");
            } else {
                showMessage(
                    error?.message || "Could not activate this rider.",
                    "error",
                );
            }
        } finally {
            if (options.fromModal) {
                toggleButton.disabled = false;
            }
        }
    }


    

async function deactivateRider(riderId, options = {}) {
    const rider =
        state.riders.find(
            (item) => String(item.id) === String(riderId)
        ) ||
        (String(state.selectedRider?.id) === String(riderId)
            ? state.selectedRider
            : null);

    const name = rider ? getFullName(rider) : `Rider #${riderId}`;

    const confirmed = window.confirm(
        `Deactivate ${name}?\n\n` +
        "If this rider has active orders, deactivation will be blocked. " +
        "You must reassign or complete those orders first."
    );

    if (!confirmed) return;

    const toggleButton = options.fromModal
        ? ensureRiderModal().form.querySelector("#riderAccountToggle")
        : null;

    if (toggleButton) {
        toggleButton.disabled = true;
    }

    try {
        await ridersApi.deactivate(riderId);

        await reloadData();

        if (options.fromModal) {
            const response = await ridersApi.get(riderId);
            const updatedRider = response?.rider || response;

            if (updatedRider?.id) {
                state.selectedRider = updatedRider;
                populateRiderForm(updatedRider);
                renderModalAccountStatus(updatedRider);
            }

            showModalMessage("Rider deactivated successfully.", "success");
        } else {
            showMessage("Rider deactivated successfully.", "success");
        }
    } catch (error) {
        const message = error?.message || "";

        if (
            /active orders|reassign|unassign/i.test(message) ||
            error?.statusCode === 409
        ) {
            const warning =
                "Cannot deactivate this rider because they have active orders. " +
                "Reassign or complete the orders before trying again.";

            if (options.fromModal) {
                showModalError(warning);
            }

            showMessage(warning, "error");
            return;
        }

        if (options.fromModal) {
            showModalError(message || "Could not deactivate this rider.");
        } else {
            showMessage(
                message || "Could not deactivate this rider.",
                "error"
            );
        }
    } finally {
        if (toggleButton) {
            toggleButton.disabled = false;
        }
    }
}

    async function deleteRider(riderId) {
        const rider = state.riders.find(
            (item) => String(item.id) === String(riderId),
        );

        const name = rider ? getFullName(rider) : `Rider #${riderId}`;

        if (!window.confirm(`Delete ${name}? This action may not be reversible.`)) {
            return;
        }

        try {
            await ridersApi.remove(riderId);

            if (state.riders.length === 1 && state.page > 1) {
                state.page -= 1;
            }

            await reloadData();

            showMessage("Rider deleted successfully.", "success");
        } catch (error) {
            showMessage(error?.message || "Could not delete this rider.", "error");
        }
    }

    async function handleTableAction(event) {
        const button = event.target.closest("[data-action][data-rider-id]");

        if (!button || !tableBody.contains(button)) return;

        const action = button.dataset.action;
        const riderId = button.dataset.riderId;

        if (!riderId) return;

        try {
            switch (action) {
                case "view":
                    await openRiderModal("view", riderId);
                    break;

                case "edit":
                    await openRiderModal("edit", riderId);
                    break;

                case "approve":
                    await approveRider(riderId);
                    break;

                case "reject":
                    await rejectRider(riderId);
                    break;

                case "activate":
                    await activateRider(riderId);
                    break;

                case "deactivate":
                    await deactivateRider(riderId);
                    break;

                case "delete":
                    await deleteRider(riderId);
                    break;

                case "permanent-delete":
                    window.location.href = `deleted-accounts.html?type=rider&id=${encodeURIComponent(riderId)}`;
                    break;

                default:
                    console.warn("Unknown rider action:", action);
            }
        } catch (error) {
            console.error("Rider action failed:", error);

            showMessage(
                error?.message || "The rider action could not be completed.",
                "error",
            );
        }
    }

    /* =====================================================
         CSV EXPORT
      ===================================================== */

    async function exportRiders() {
        if (!exportButton) return;

        const token = authApi.getToken?.();

        if (!token) {
            showMessage("Please log in before exporting riders.", "error");
            return;
        }

        const query = new URLSearchParams();

        if (state.search) {
            query.set("search", state.search);
        }

        if (state.status && state.status !== "all") {
            query.set("status", state.status);
        }

        if (state.vehicleType) {
            query.set("vehicle_type", state.vehicleType);
        }

        if (state.joinedFrom) {
            query.set("joined_from", state.joinedFrom);
        }

        if (state.joinedTo) {
            query.set("joined_to", state.joinedTo);
        }

        if (state.sort) {
            query.set("sort", state.sort);
        }

        const suffix = query.toString() ? `?${query.toString()}` : "";

        const exportUrl = `${RIDERS_ENDPOINT}/export${suffix}`;

        setButtonLoading(exportButton, true, "Exporting…");

        try {
            const response = await fetch(exportUrl, {
                method: "GET",
                headers: {
                    Accept: "text/csv, application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                const errorResult = await response.json().catch(() => ({}));

                throw new Error(
                    errorResult.error ||
                    errorResult.message ||
                    `Export failed (${response.status}).`,
                );
            }

            const contentType = response.headers.get("content-type") || "";

            if (contentType.includes("application/json")) {
                const data = await response.json();

                throw new Error(
                    data?.message ||
                    "The export endpoint returned JSON instead of a CSV file.",
                );
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");

            link.href = objectUrl;
            link.download = `riders-${new Date().toISOString().slice(0, 10)}.csv`;

            document.body.appendChild(link);
            link.click();
            link.remove();

            URL.revokeObjectURL(objectUrl);

            showMessage("Rider export downloaded.", "success");
        } catch (error) {
            console.error("Rider export failed:", error);

            showMessage(error?.message || "Could not export riders.", "error");
        } finally {
            setButtonLoading(exportButton, false);
        }
    }

    /* =====================================================
         SEARCH AND FILTER EVENT HANDLERS
      ===================================================== */

    let searchDebounce = null;

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.search = searchInput.value.trim();
            state.page = 1;

            if (searchDebounce) {
                clearTimeout(searchDebounce);
            }

            searchDebounce = setTimeout(() => {
                loadRiders();
            }, 300);
        });
    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", async (event) => {
            event.preventDefault();

            const label = tab.textContent.trim().toLowerCase();

            const statusMap = {
                all: "all",
                online: "online",
                available: "available",
                offline: "offline",
                pending: "pending",
            };

            if (!Object.prototype.hasOwnProperty.call(statusMap, label)) {
                return;
            }

            state.status = statusMap[label];
            state.page = 1;

            updateActiveTab();

            await loadRiders();
        });
    });

    if (filterButton) {
        filterButton.addEventListener("click", () => {
            const panel = ensureFilterPanel();

            // Refresh the controls with the current filter state.
            panel.form.elements.status.value = state.status;
            panel.form.elements.vehicle_type.value = state.vehicleType;
            panel.form.elements.joined_from.value = state.joinedFrom;
            panel.form.elements.joined_to.value = state.joinedTo;
            panel.form.elements.sort.value = state.sort;

            panel.overlay.classList.remove("hidden");
        });
    }

    if (addButton) {
        addButton.addEventListener("click", () => {
            openRiderModal("add");
        });
    }

    if (exportButton) {
        exportButton.addEventListener("click", exportRiders);
    }

    tableBody.addEventListener("click", handleTableAction);

    if (paginationContainer) {
        paginationContainer.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-page]");

            if (!button || button.disabled) return;

            const nextPage = Number(button.dataset.page);

            if (
                !Number.isInteger(nextPage) ||
                nextPage < 1 ||
                nextPage > state.totalPages ||
                nextPage === state.page
            ) {
                return;
            }

            state.page = nextPage;

            await loadRiders();
        });
    }

    /* =====================================================
         INITIAL PAGE LOAD
      ===================================================== */

    updateActiveTab();
    reloadData();
});
