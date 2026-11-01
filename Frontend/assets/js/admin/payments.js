/* =========================================================
   ADMIN PAYMENTS PAGE — payments.js (API-connected)

   Backend endpoints used:
     GET   /api/payments/admin                 list + pagination + statistics
     GET   /api/payments/admin/:id             single payment
     PATCH /api/payments/admin/:id/status      change status
     PATCH /api/payments/admin/:id/refund      mark completed payment refunded

   Requires, in payments.html (before this file):
     <script src="../../assets/js/auth/auth-api.js"></script>
========================================================= */

(() => {
    "use strict";

    const API = window.FoodDeliveryAuthApi;
    const LOGIN_URL = "../auth/login.html";
    const PAGE_SIZE = 10;
    const EXPORT_PAGE_SIZE = 100; // backend maximum
    const EXPORT_MAX_PAGES = 50;

    /* Mirrors the backend ADMIN_PAYMENT_TRANSITIONS (server still enforces) */
    const TRANSITIONS = {
        pending: ["processing", "completed", "failed"],
        processing: ["completed", "failed"],
        failed: ["pending", "processing"],
        completed: [],
        refunded: [],
    };

    const STATUS_CLASS = {
        completed: "success",
        pending: "warning",
        processing: "neutral",
        failed: "danger",
        refunded: "info",
    };

    const METHOD_LABEL = { mpesa: "M-Pesa", card: "Card", cash: "Cash" };

    const state = {
        page: 1,
        status: "",
        method: "",
        search: "",
        dateFrom: "",
        dateTo: "",
        payments: [],
    };

    /* ---------------------------------------------------
       ELEMENTS
    --------------------------------------------------- */
    const el = {
        search: document.querySelector(".admin-search input"),
        filterBtn: document.querySelector(".admin-filter-button"),
        cardHeader: document.querySelector(".admin-payments-card .admin-card-header"),
        tabs: Array.from(document.querySelectorAll(".admin-payment-tab")),
        tbody: document.querySelector(".admin-payments-card .admin-table tbody"),
        footerText: document.querySelector(".admin-table-footer p"),
        pagination: document.querySelector(".admin-pagination"),
        message: document.getElementById("adminMessage"),
        exportBtn: document.querySelector(".admin-page-actions .admin-secondary-button"),
        recordBtn: document.querySelector(".admin-page-actions .admin-primary-button"),
        statsGrid: document.querySelector(".admin-stats-grid"),
        statValues: Array.from(document.querySelectorAll(".admin-stat-card strong")),
        summaryItems: Array.from(document.querySelectorAll(".admin-summary-item")),
        perfItems: Array.from(document.querySelectorAll(".admin-performance-item")),
        todayCount: document.querySelector(".admin-spending-footer strong"),
    };

    /* ---------------------------------------------------
       HELPERS
    --------------------------------------------------- */
    const esc = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[c]));

    function money(value) {
        return `KSh ${Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
    }

    function moneyCompact(value) {
        const n = Number(value || 0);
        if (n >= 1e6) return `KSh ${(n / 1e6).toFixed(2)}M`;
        if (n >= 1e3) return `KSh ${(n / 1e3).toFixed(1)}K`;
        return `KSh ${n.toFixed(0)}`;
    }

    function formatDate(value) {
        if (!value) return "—";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }

    function formatDateTime(value) {
        if (!value) return "—";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    }

    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
    const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

    function debounce(fn, ms) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    }

    /* ---------------------------------------------------
       MESSAGES + AUTH ERRORS
    --------------------------------------------------- */
    let messageTimer;

    function showMessage(text, type = "success") {
        if (!el.message) return;
        el.message.textContent = text;
        el.message.className = `admin-message ${type} show`;
        el.message.scrollIntoView({ block: "nearest", behavior: "smooth" });
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => el.message.classList.remove("show"), 5000);
    }

    function isAuthError(message) {
        return /token|log in|authoriz|expired|deactivated|account not found/i.test(message || "");
    }

    function redirectToLogin() {
        API?.clearSession?.();
        window.location.replace(LOGIN_URL);
    }

    /* Returns true if the error was an auth problem (and was handled). */
    function handleAuthError(err) {
        if (!isAuthError(err?.message)) return false;
        showMessage("Your session has expired. Redirecting to login…", "error");
        setTimeout(redirectToLogin, 1200);
        return true;
    }

    function handleError(err) {
        if (handleAuthError(err)) return;
        showMessage(err?.message || "Something went wrong.", "error");
    }

    /* ---------------------------------------------------
       API
    --------------------------------------------------- */
    function listUrl(extra = {}, { includeFilters = true } = {}) {
        const params = new URLSearchParams();
        if (includeFilters) {
            if (state.status) params.set("status", state.status);
            if (state.method) params.set("payment_method", state.method);
            if (state.search) params.set("search", state.search);
            if (state.dateFrom) params.set("date_from", state.dateFrom);
            if (state.dateTo) params.set("date_to", state.dateTo);
        }
        Object.entries(extra).forEach(([k, v]) => params.set(k, String(v)));
        return `/payments/admin?${params.toString()}`;
    }

    const apiGet = (path) => API.request(path, { authenticated: true });
    const apiPatch = (path, body) =>
        API.request(path, { method: "PATCH", body, authenticated: true });

    /* ---------------------------------------------------
       TABLE
    --------------------------------------------------- */
    function setTableMessage(text, className = "") {
        el.tbody.innerHTML = `<tr><td colspan="8" class="${className}" style="text-align:center;padding:28px;">${esc(text)}</td></tr>`;
    }

    function rowHtml(p) {
        const status = p.payment_status;
        const ref = p.transaction_reference || `PAY-${p.id}`;
        const orderLabel = p.order_number ? `#${p.order_number}` : `#${p.order_id}`;
        const method = METHOD_LABEL[p.payment_method] || cap(p.payment_method);

        return `
            <tr data-id="${Number(p.id)}">
                <td>
                    <div class="admin-payment">
                        <div class="admin-payment-icon">KSh</div>
                        <div class="admin-payment-info">
                            <strong>${esc(ref)}</strong>
                            <span>${esc(method)}</span>
                        </div>
                    </div>
                </td>
                <td>${esc(p.customer_name || "—")}</td>
                <td>${esc(orderLabel)}</td>
                <td><span class="admin-payment-method">${esc(method)}</span></td>
                <td><strong class="admin-amount">${esc(money(p.amount))}</strong></td>
                <td>${esc(formatDate(p.paid_at || p.created_at))}</td>
                <td><span class="admin-status ${STATUS_CLASS[status] || "neutral"}">${esc(cap(status))}</span></td>
                <td>
                    <div class="admin-table-actions">
                        <button type="button" class="admin-table-action" data-action="view"
                                aria-label="View payment">◉</button>
                    </div>
                </td>
            </tr>`;
    }

    function renderRows(payments) {
        if (!payments.length) {
            setTableMessage("No payments match your filters.");
            return;
        }
        el.tbody.innerHTML = payments.map(rowHtml).join("");
    }

    function renderPagination({ page, limit, totalItems, totalPages }) {
        const start = totalItems === 0 ? 0 : (page - 1) * limit + 1;
        const end = Math.min(page * limit, totalItems);

        if (el.footerText) {
            el.footerText.textContent =
                `Showing ${start}–${end} of ${Number(totalItems).toLocaleString()} transactions`;
        }
        if (!el.pagination) return;

        const first = Math.max(1, Math.min(page - 2, totalPages - 4));
        const last = Math.min(totalPages, first + 4);
        const buttons = [
            `<button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>`,
        ];
        for (let i = first; i <= last; i++) {
            buttons.push(
                `<button type="button" data-page="${i}" class="${i === page ? "active" : ""}">${i}</button>`,
            );
        }
        buttons.push(
            `<button type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>›</button>`,
        );
        el.pagination.innerHTML = buttons.join("");
    }

    let listRequestId = 0;

    async function loadPayments() {
        const requestId = ++listRequestId;
        setTableMessage("Loading payments…");

        try {
            const data = await apiGet(listUrl({ page: state.page, limit: PAGE_SIZE }));
            if (requestId !== listRequestId) return; // a newer request superseded this one

            state.payments = data.payments || [];
            renderRows(state.payments);
            renderPagination(data.pagination);
        } catch (err) {
            if (requestId !== listRequestId) return;
            setTableMessage("Could not load payments.", "danger");
            handleError(err);
        }
    }

    /* ---------------------------------------------------
       STATISTICS (always unfiltered, independent of the table)
    --------------------------------------------------- */
    async function loadStats() {
        const q = (extra) => apiGet(listUrl({ limit: 1, ...extra }, { includeFilters: false }));

        try {
            const [all, mpesa, card, cash] = await Promise.all([
                q({}),
                q({ payment_method: "mpesa" }),
                q({ payment_method: "card" }),
                q({ payment_method: "cash" }),
            ]);

            const s = all.statistics;
            const total = s.totalTransactions;

            // Top stat cards: revenue, today, pending, refunds
            const cardValues = [
                moneyCompact(s.totalRevenue),
                moneyCompact(s.todayRevenue),
                moneyCompact(s.pendingAmount),
                moneyCompact(s.refundedAmount),
            ];
            el.statValues.slice(0, 4).forEach((node, i) => {
                node.textContent = cardValues[i];
            });

            // Summary list: method share, success %, failed %
            const setSummary = (index, text) => {
                const span = el.summaryItems[index]?.querySelector(":scope > span");
                if (span) span.textContent = text;
            };
            setSummary(0, `${pct(mpesa.statistics.totalTransactions, total)}%`);
            setSummary(1, `${pct(card.statistics.totalTransactions, total)}%`);
            setSummary(2, `${pct(cash.statistics.totalTransactions, total)}%`);
            setSummary(3, `${s.successRate}%`);
            setSummary(4, `${pct(s.failedTransactions, total)}%`);

            // Performance bars: overall, M-Pesa, card
            const rates = [s.successRate, mpesa.statistics.successRate, card.statistics.successRate];
            el.perfItems.slice(0, 3).forEach((item, i) => {
                const strong = item.querySelector(".admin-performance-header strong");
                const bar = item.querySelector(".admin-progress-value");
                if (strong) strong.textContent = `${rates[i]}%`;
                if (bar) bar.style.width = `${rates[i]}%`;
            });

            if (el.todayCount) el.todayCount.textContent = String(s.completedToday);
        } catch (err) {
            // Stats are secondary; don't blank the page over them.
            console.error("Failed to load payment statistics:", err);
            handleAuthError(err);
        }
    }

    function refreshAll() {
        loadPayments();
        loadStats();
    }

    /* ---------------------------------------------------
       DETAIL / MANAGE MODAL
    --------------------------------------------------- */
    let overlay;
    let modalBody;
    let modalTitle;
    let currentPaymentId = null;

    function injectStyles() {
        const style = document.createElement("style");
        style.textContent = `
            .pay-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:0 24px 16px}
            .pay-filters[hidden]{display:none}
            .pay-filters label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#64748b}
            .pay-filters select,.pay-filters input{padding:8px 10px;border:1px solid #d9e0ea;border-radius:8px;font-size:13px;background:#fff}
            .pay-btn{padding:9px 16px;border:1px solid #d9e0ea;border-radius:8px;background:#fff;font-size:13px;cursor:pointer}
            .pay-btn.primary{background:#2875c7;border-color:#2875c7;color:#fff}
            .pay-btn.danger{background:#c63d3d;border-color:#c63d3d;color:#fff}
            .pay-btn:disabled{opacity:.6;cursor:not-allowed}
            .pay-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000}
            .pay-overlay[hidden]{display:none}
            .pay-modal{background:#fff;border-radius:12px;width:100%;max-width:640px;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)}
            .pay-modal-head{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid #e8edf3}
            .pay-modal-head h3{margin:0;font-size:17px}
            .pay-close{border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:#64748b}
            .pay-modal-body{padding:20px 22px}
            .pay-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;margin:0 0 20px}
            .pay-grid dt{font-size:12px;color:#64748b;margin:0 0 2px}
            .pay-grid dd{margin:0;font-size:14px;word-break:break-word}
            .pay-grid .wide{grid-column:1 / -1}
            .pay-section{border-top:1px solid #e8edf3;padding-top:16px;margin-top:6px}
            .pay-section h4{margin:0 0 10px;font-size:14px}
            .pay-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
            .pay-row label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#64748b;flex:1;min-width:160px}
            .pay-row select,.pay-row input{padding:9px 10px;border:1px solid #d9e0ea;border-radius:8px;font-size:13px}
            .pay-note{font-size:12px;color:#64748b;margin:0 0 10px}
            .pay-warn{font-size:12px;color:#9a6700;background:#fff8e1;border:1px solid #f3e0a6;border-radius:8px;padding:8px 10px;margin:0 0 10px}
            .pay-error{display:none;margin-top:12px;padding:10px 12px;border-radius:8px;background:#fdeaea;border:1px solid #f4caca;color:#c63d3d;font-size:13px}
            .pay-error.show{display:block}
            .pay-pre{background:#f6f8fb;border-radius:8px;padding:10px;font-size:12px;max-height:160px;overflow:auto;white-space:pre-wrap;margin:0}
            @media(max-width:560px){.pay-grid{grid-template-columns:1fr}}
        `;
        document.head.appendChild(style);
    }

    function buildModal() {
        overlay = document.createElement("div");
        overlay.className = "pay-overlay";
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="pay-modal" role="dialog" aria-modal="true" aria-labelledby="payModalTitle">
                <div class="pay-modal-head">
                    <h3 id="payModalTitle">Payment</h3>
                    <button type="button" class="pay-close" aria-label="Close">&times;</button>
                </div>
                <div class="pay-modal-body"></div>
            </div>`;
        document.body.appendChild(overlay);

        modalBody = overlay.querySelector(".pay-modal-body");
        modalTitle = overlay.querySelector("#payModalTitle");

        overlay.querySelector(".pay-close").addEventListener("click", closeModal);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !overlay.hidden) closeModal();
        });
    }

    function closeModal() {
        overlay.hidden = true;
        currentPaymentId = null;
        modalBody.innerHTML = "";
    }

    function formatProviderResponse(value) {
        if (value === null || value === undefined || value === "") return "";
        if (typeof value === "object") return JSON.stringify(value, null, 2);
        return String(value);
    }

    function field(label, valueHtml, wide = false) {
        return `<div class="${wide ? "wide" : ""}"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>`;
    }

    function detailHtml(p) {
        const status = p.payment_status;
        const next = TRANSITIONS[status] || [];
        const orderTotal = p.order_total_amount ?? p.total_amount;
        const mismatch =
            orderTotal !== undefined &&
            orderTotal !== null &&
            Math.abs(Number(p.amount) - Number(orderTotal)) > 0.01;

        const provider = formatProviderResponse(p.provider_response);

        const info = `
            <dl class="pay-grid">
                ${field("Payment ID", esc(p.id))}
                ${field("Status", `<span class="admin-status ${STATUS_CLASS[status] || "neutral"}">${esc(cap(status))}</span>`)}
                ${field("Order", esc(p.order_number ? `#${p.order_number}` : `#${p.order_id}`))}
                ${field("Order status", esc(cap(p.order_status || "—")))}
                ${field("Customer", esc(p.customer_name || "—"))}
                ${field("Contact", esc([p.customer_email, p.customer_phone].filter(Boolean).join(" · ") || "—"))}
                ${field("Restaurant", esc(p.restaurant_name || "—"))}
                ${field("Method", esc(METHOD_LABEL[p.payment_method] || cap(p.payment_method)))}
                ${field("Amount", esc(money(p.amount)))}
                ${field("Order total", esc(orderTotal != null ? money(orderTotal) : "—") +
                    (mismatch ? ' <span class="admin-status danger">Mismatch</span>' : ""))}
                ${field("M-Pesa phone", esc(p.phone_number || "—"))}
                ${field("Reference", esc(p.transaction_reference || "—"))}
                ${field("Created", esc(formatDateTime(p.created_at)))}
                ${field("Paid at", esc(formatDateTime(p.paid_at)))}
                ${provider ? field("Provider response", `<pre class="pay-pre">${esc(provider)}</pre>`, true) : ""}
            </dl>`;

        let actions = "";

        if (next.length) {
            actions += `
                <div class="pay-section">
                    <h4>Update status</h4>
                    <div class="pay-row">
                        <label>New status
                            <select id="payStatusSelect">
                                ${next.map((s) => `<option value="${s}">${esc(cap(s))}</option>`).join("")}
                            </select>
                        </label>
                        <label>Transaction reference (recommended for M-Pesa/card)
                            <input id="payStatusRef" type="text" maxlength="100" autocomplete="off" />
                        </label>
                        <button type="button" class="pay-btn primary" id="payStatusBtn">Update</button>
                    </div>
                </div>`;
        }

        if (status === "completed") {
            actions += `
                <div class="pay-section">
                    <h4>Refund</h4>
                    <p class="pay-warn">
                        This only marks the payment as refunded in this system.
                        It does <strong>not</strong> send money back through M-Pesa or the card
                        provider &mdash; do that separately first.
                    </p>
                    <div class="pay-row">
                        <label>Refund reference (optional)
                            <input id="payRefundRef" type="text" maxlength="100" autocomplete="off" />
                        </label>
                        <button type="button" class="pay-btn danger" id="payRefundBtn">Mark as refunded</button>
                    </div>
                </div>`;
        }

        if (!next.length && status !== "completed") {
            actions = `<p class="pay-note">This payment is in a final state and can't be changed.</p>`;
        }

        return `${info}${actions}<div class="pay-error" id="payError" role="alert"></div>`;
    }

    function setModalError(err) {
        if (handleAuthError(err)) return;
        const box = modalBody.querySelector("#payError");
        if (!box) return;
        box.textContent = err?.message || "Something went wrong.";
        box.classList.add("show");
    }

    function wireModalActions(paymentId) {
        const statusBtn = modalBody.querySelector("#payStatusBtn");
        const refundBtn = modalBody.querySelector("#payRefundBtn");

        const lock = (locked) => {
            modalBody.querySelectorAll("button, input, select").forEach((n) => {
                n.disabled = locked;
            });
        };

        const run = async (path, body, successText) => {
            modalBody.querySelector("#payError")?.classList.remove("show");
            lock(true);
            try {
                await apiPatch(path, body);
                closeModal();
                showMessage(successText, "success");
                refreshAll();
            } catch (err) {
                lock(false);
                setModalError(err);
            }
        };

        if (statusBtn) {
            statusBtn.addEventListener("click", () => {
                const status = modalBody.querySelector("#payStatusSelect").value;
                const ref = modalBody.querySelector("#payStatusRef").value.trim();
                const body = { payment_status: status };
                if (ref) body.transaction_reference = ref;
                run(`/payments/admin/${paymentId}/status`, body, `Payment marked as ${status}.`);
            });
        }

        if (refundBtn) {
            refundBtn.addEventListener("click", () => {
                const ok = window.confirm(
                    "Mark this payment as refunded?\n\nThis only updates the record here — " +
                    "it does not send money back to the customer.",
                );
                if (!ok) return;
                const ref = modalBody.querySelector("#payRefundRef").value.trim();
                const body = {};
                if (ref) body.transaction_reference = ref;
                run(`/payments/admin/${paymentId}/refund`, body, "Payment marked as refunded.");
            });
        }
    }

    async function openPayment(id) {
        currentPaymentId = id;
        const fromList = state.payments.find((p) => Number(p.id) === Number(id)) || {};

        modalTitle.textContent = `Payment #${id}`;
        modalBody.innerHTML = `<p class="pay-note">Loading…</p>`;
        overlay.hidden = false;
        overlay.querySelector(".pay-close").focus();

        try {
            const data = await apiGet(`/payments/admin/${id}`);
            if (currentPaymentId !== id) return; // modal was closed or switched
            const payment = { ...fromList, ...(data.payment || {}) };
            modalBody.innerHTML = detailHtml(payment);
            wireModalActions(id);
        } catch (err) {
            if (currentPaymentId !== id) return;
            modalBody.innerHTML = `<div class="pay-error show" role="alert">${esc(err?.message || "Could not load payment.")}</div>`;
            handleAuthError(err);
        }
    }

    /* ---------------------------------------------------
       FILTER PANEL
    --------------------------------------------------- */
    let filterPanel;

    function buildFilterPanel() {
        if (!el.cardHeader) return;

        filterPanel = document.createElement("div");
        filterPanel.className = "pay-filters";
        filterPanel.hidden = true;
        filterPanel.innerHTML = `
            <label>Method
                <select id="payFilterMethod">
                    <option value="">All methods</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                </select>
            </label>
            <label>From <input type="date" id="payFilterFrom" /></label>
            <label>To <input type="date" id="payFilterTo" /></label>
            <button type="button" class="pay-btn primary" id="payFilterApply">Apply</button>
            <button type="button" class="pay-btn" id="payFilterClear">Clear</button>`;
        el.cardHeader.after(filterPanel);

        const methodSel = filterPanel.querySelector("#payFilterMethod");
        const fromInput = filterPanel.querySelector("#payFilterFrom");
        const toInput = filterPanel.querySelector("#payFilterTo");

        filterPanel.querySelector("#payFilterApply").addEventListener("click", () => {
            if (fromInput.value && toInput.value && fromInput.value > toInput.value) {
                showMessage("The 'From' date can't be after the 'To' date.", "error");
                return;
            }
            state.method = methodSel.value;
            state.dateFrom = fromInput.value;
            state.dateTo = toInput.value;
            state.page = 1;
            loadPayments();
        });

        filterPanel.querySelector("#payFilterClear").addEventListener("click", () => {
            methodSel.value = "";
            fromInput.value = "";
            toInput.value = "";
            state.method = "";
            state.dateFrom = "";
            state.dateTo = "";
            state.page = 1;
            loadPayments();
        });

        el.filterBtn?.addEventListener("click", () => {
            filterPanel.hidden = !filterPanel.hidden;
        });
    }

    /* ---------------------------------------------------
       EXPORT (CSV of everything matching the current filters)
    --------------------------------------------------- */
    function csvCell(value) {
        let s = String(value ?? "");
        // Neutralise spreadsheet formula injection
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
    }

    async function exportCsv() {
        if (!el.exportBtn) return;
        const original = el.exportBtn.textContent;
        el.exportBtn.disabled = true;
        el.exportBtn.textContent = "Exporting…";

        try {
            const rows = [];
            let page = 1;
            let totalPages = 1;

            do {
                const data = await apiGet(listUrl({ page, limit: EXPORT_PAGE_SIZE }));
                rows.push(...(data.payments || []));
                totalPages = data.pagination.totalPages;
                page += 1;
            } while (page <= totalPages && page <= EXPORT_MAX_PAGES);

            if (!rows.length) {
                showMessage("There are no payments to export.", "info");
                return;
            }

            const header = [
                "Payment ID", "Reference", "Order", "Customer", "Customer email",
                "Restaurant", "Method", "Amount", "Status", "Phone", "Created", "Paid at",
            ];
            const lines = [header.map(csvCell).join(",")];
            rows.forEach((p) => {
                lines.push([
                    p.id, p.transaction_reference || "", p.order_number || p.order_id,
                    p.customer_name, p.customer_email, p.restaurant_name,
                    METHOD_LABEL[p.payment_method] || p.payment_method,
                    p.amount, p.payment_status, p.phone_number || "",
                    p.created_at, p.paid_at || "",
                ].map(csvCell).join(","));
            });

            const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            const truncated = page <= totalPages;
            showMessage(
                truncated
                    ? `Exported the first ${rows.length} payments (export limit reached — narrow your filters).`
                    : `Exported ${rows.length} payments.`,
                truncated ? "info" : "success",
            );
        } catch (err) {
            handleError(err);
        } finally {
            el.exportBtn.disabled = false;
            el.exportBtn.textContent = original;
        }
    }

    /* ---------------------------------------------------
       INIT
    --------------------------------------------------- */
    function requireAdmin() {
        if (!API) {
            showMessage("auth-api.js is not loaded. Add it before payments.js in payments.html.", "error");
            return false;
        }
        const user = API.getCurrentUser();
        if (!API.getToken() || !user || !["admin", "super_admin"].includes(user.role)) {
            redirectToLogin();
            return false;
        }
        return true;
    }

    function init() {
        if (!el.tbody) return;

        // Show messages above the stats instead of at the very bottom of the page
        if (el.message && el.statsGrid) el.statsGrid.before(el.message);

        if (!requireAdmin()) return;

        injectStyles();
        buildModal();
        buildFilterPanel();

        // There is no admin "create payment" endpoint — payments come from customer checkout.
        if (el.recordBtn) el.recordBtn.hidden = true;

        // Add a Processing tab (the backend has this status; the static page didn't)
        const pendingTab = el.tabs.find((t) => t.textContent.trim().toLowerCase() === "pending");
        if (pendingTab) {
            const processingTab = pendingTab.cloneNode(true);
            processingTab.classList.remove("active");
            processingTab.textContent = " Processing ";
            pendingTab.after(processingTab);
            el.tabs.splice(el.tabs.indexOf(pendingTab) + 1, 0, processingTab);
        }

        el.tabs.forEach((tab) => {
            tab.addEventListener("click", (event) => {
                event.preventDefault();
                el.tabs.forEach((t) => t.classList.remove("active"));
                tab.classList.add("active");

                const label = tab.textContent.trim().toLowerCase();
                state.status = label === "all" ? "" : label;
                state.page = 1;
                loadPayments();
            });
        });

        el.search?.addEventListener(
            "input",
            debounce(() => {
                state.search = el.search.value.trim();
                state.page = 1;
                loadPayments();
            }, 350),
        );

        el.pagination?.addEventListener("click", (event) => {
            const btn = event.target.closest("button[data-page]");
            if (!btn || btn.disabled) return;
            state.page = Number(btn.dataset.page);
            loadPayments();
        });

        el.tbody.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-action='view']");
            if (!btn) return;
            const row = btn.closest("tr[data-id]");
            if (row) openPayment(Number(row.dataset.id));
        });

        el.exportBtn?.addEventListener("click", exportCsv);

        refreshAll();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();