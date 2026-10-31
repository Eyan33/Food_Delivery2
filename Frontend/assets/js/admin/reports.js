(() => {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    const API = window.FoodDeliveryAuthApi;
    const periodSelect = document.getElementById("reportPeriod");
    const typeSelect = document.getElementById("reportType");
    const startInput = document.getElementById("startDate");
    const endInput = document.getElementById("endDate");
    const chartMetric = document.getElementById("reportChartMetric");
    const applyButton = document.querySelector(".admin-report-filter-button .admin-primary-button");
    const exportButton = document.querySelector(".admin-page-actions .admin-secondary-button");
    const messageBox = document.getElementById("adminMessage");
    const money = value => `KSh ${Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
    const number = value => Number(value || 0).toLocaleString("en-KE");
    let currentReport = null;
    let currentReportKey = "";

    if (!API?.request || !periodSelect || !typeSelect || !startInput || !endInput) {
      if (messageBox) { messageBox.textContent = "Reports could not start because required page elements or the API client are missing."; messageBox.className = "admin-message danger visible"; }
      return;
    }
    function showMessage(text, type = "success") {
      if (!messageBox) return;
      messageBox.textContent = text;
      messageBox.className = `admin-message ${type} visible`;
    }
    function dateInput(date) {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 10);
    }
    function setPreset(value) {
      const today = new Date();
      let start = new Date(today), end = new Date(today);
      if (value === "Yesterday") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
      else if (value === "Last 7 Days") start.setDate(start.getDate() - 6);
      else if (value === "Last 30 Days") start.setDate(start.getDate() - 29);
      else if (value === "This Month") start.setDate(1);
      else if (value === "Last Month") { start.setDate(1); start.setMonth(start.getMonth() - 1); end.setDate(0); }
      else if (value === "This Year") start = new Date(today.getFullYear(), 0, 1);
      startInput.value = dateInput(start);
      endInput.value = dateInput(end);
      invalidateReport();
    }
    function invalidateReport() {
      currentReport = null;
      currentReportKey = "";
      if (messageBox) showMessage("Filters changed. The displayed figures are from the last loaded report; apply filters or generate a new report to refresh them.", "warning");
    }
    function reportQuery() {
      if (!startInput.value || !endInput.value || startInput.value > endInput.value) throw new Error("Choose a valid report date range.");
      const days = Math.floor((new Date(`${endInput.value}T00:00:00Z`) - new Date(`${startInput.value}T00:00:00Z`)) / 86400000) + 1;
      const period = days <= 7 ? "7d" : days <= 45 ? "30d" : days <= 180 ? "3m" : "12m";
      return { params: new URLSearchParams({ period, start_date: startInput.value, end_date: endInput.value }), key: `${period}|${startInput.value}|${endInput.value}` };
    }
    function setText(selector, value) { const node = document.querySelector(selector); if (node) node.textContent = value; }
    function listRows(container, rows, buildRow, emptyText) {
      if (!container) return;
      container.replaceChildren();
      if (!rows.length) { const empty = document.createElement("p"); empty.className = "admin-report-empty"; empty.textContent = emptyText; container.append(empty); return; }
      rows.forEach((row, index) => container.append(buildRow(row, index)));
    }
    function renderReport(data) {
      if (!data || !data.summary || !data.series || !Array.isArray(data.series.labels) || !Array.isArray(data.series.revenue) || !Array.isArray(data.orderStatusBreakdown) || !Array.isArray(data.paymentStatusBreakdown) || !Array.isArray(data.topRestaurants)) {
        throw new Error("The reports API returned incomplete data. Please try again or check the server logs.");
      }
      const typeKey = ({ "Overview": "overview", "Sales Report": "sales", "Orders Report": "orders", "Customer Report": "customers", "Restaurant Report": "restaurants", "Rider Report": "riders", "Payment Report": "payments" })[typeSelect.value] || "overview";
      document.querySelectorAll("[data-report-section]").forEach(section => {
        const visible = section.dataset.reportSection.split(/\s+/).includes(typeKey);
        section.hidden = !visible;
        section.style.display = visible ? "" : "none";
      });
      const cards = document.querySelectorAll(".admin-stats-grid .admin-stat-card");
      const stats = [data.summary.revenue, data.summary.orders, data.summary.activeCustomers || data.summary.customers, data.summary.averageOrder || { value: 0 }];
      stats.forEach((stat, index) => {
        const card = cards[index];
        const strong = card?.querySelector(".admin-stat-content strong");
        const small = card?.querySelector(".admin-stat-content small");
        if (strong) strong.textContent = index === 0 || index === 3 ? money(stat?.value) : number(stat?.value);
        if (small) small.textContent = `${stat?.change || ""}${stat?.description ? ` ${stat.description}` : ""}`.trim() || "Selected period";
      });
      const bars = document.querySelector(".admin-report-bars");
      const metric = chartMetric?.value === "orders" ? "orders" : "revenue";
      const values = (metric === "orders" ? (data.series.orders || []) : data.series.revenue).map(Number);
      const maxValue = Math.max(1, ...values);
      const axis = document.querySelectorAll(".admin-report-y-axis span");
      axis.forEach((tick, index) => {
        const value = maxValue * (axis.length - index - 1) / Math.max(1, axis.length - 1);
        tick.textContent = metric === "orders" ? number(Math.round(value)) : `KSh ${value.toLocaleString("en-KE", { notation: "compact", maximumFractionDigits: 1 })}`;
      });
      const chartTitle = document.querySelector(".admin-reports-revenue-card .admin-card-header p");
      if (chartTitle) chartTitle.textContent = metric === "orders" ? "Orders placed during the selected period." : "Completed payments collected during the selected period.";
      if (bars) {
        const labelEvery = Math.max(1, Math.ceil(data.series.labels.length / 12));
        bars.replaceChildren(...data.series.labels.map((label, index) => {
          const column = document.createElement("div"); column.className = "admin-report-bar-column";
          const bar = document.createElement("div"); bar.className = "admin-report-bar";
          bar.style.height = `${Math.max(2, (values[index] / maxValue) * 100)}%`;
          bar.title = metric === "orders" ? `${label}: ${number(values[index])} orders; ${money(data.series.revenue[index])} collected` : `${label}: ${money(values[index])}; ${number(data.series.orders?.[index])} orders`;
          const text = document.createElement("span"); text.textContent = index % labelEvery === 0 || data.series.labels.length <= 12 ? label : "";
          column.append(bar, text); return column;
        }));
      }
      const statusList = document.querySelector(".admin-report-status-list");
      listRows(statusList, data.orderStatusBreakdown, item => {
        const row = document.createElement("div"); row.className = "admin-report-status-item";
        const label = document.createElement("span"); label.textContent = String(item.status || "unknown").replaceAll("_", " ");
        const value = document.createElement("strong"); value.textContent = number(item.count); row.append(label, value); return row;
      }, "No orders in this date range.");
      setText(".admin-report-total strong", number(data.summary.orders.value));
      const restaurants = document.querySelector(".admin-report-ranking-list");
      listRows(restaurants, data.topRestaurants, (restaurant, index) => {
        const row = document.createElement("div"); row.className = "admin-report-ranking-item";
        const position = document.createElement("span"); position.className = "admin-ranking-number"; position.textContent = String(index + 1);
        const details = document.createElement("div"); details.className = "admin-ranking-info";
        const name = document.createElement("strong"); name.textContent = restaurant.name || "Unnamed restaurant";
        const orders = document.createElement("span"); orders.textContent = `${number(restaurant.orderCount)} orders`;
        details.append(name, orders); const revenue = document.createElement("strong"); revenue.className = "admin-ranking-value"; revenue.textContent = money(restaurant.revenue); row.append(position, details, revenue); return row;
      }, "No restaurant orders in this date range.");
      const methodLabels = { mpesa: "m-pesa", cash: "cash", card: "card", cash_on_delivery: "cash" };
      const payments = data.paymentStatusBreakdown;
      const paymentTotal = payments.reduce((sum, item) => sum + Number(item.count || 0), 0);
      document.querySelectorAll(".admin-report-payment-item").forEach(item => {
        const labelNode = item.querySelector(".admin-report-payment-header div strong");
        const rawName = labelNode?.textContent.trim().toLowerCase() || "";
        const method = Object.keys(methodLabels).find(key => methodLabels[key] === rawName) || rawName;
        const payment = payments.find(entry => String(entry.method || "").toLowerCase() === method) || (method === "cash" ? payments.find(entry => ["cash", "cash_on_delivery"].includes(String(entry.method).toLowerCase())) : null);
        const count = item.querySelector(".admin-report-payment-header div span");
        const share = item.querySelector(".admin-report-payment-header > strong");
        const progress = item.querySelector(".admin-report-progress-bar");
        const amount = item.querySelector(".admin-report-payment-footer strong");
        const percentage = paymentTotal ? Number(payment?.count || 0) / paymentTotal * 100 : 0;
        if (count) count.textContent = `${number(payment?.count)} transactions`;
        if (share) share.textContent = `${percentage.toFixed(1)}%`;
        if (progress) progress.style.width = `${percentage}%`;
        if (amount) amount.textContent = money(payment?.amount);
      });
      const customers = data.customers || {};
      setText("#reportNewCustomers", number(customers.new));
      setText("#reportReturningCustomers", number(customers.returning));
      setText("#reportInactiveCustomers", number(customers.inactive));
      setText("#reportRiderTotal", number(data.riders?.total));
      setText("#reportRiderActive", number(data.riders?.active));
      setText("#reportRiderDeliveries", number(data.riders?.deliveries));
      const riderList = document.getElementById("reportRiderList");
      listRows(riderList, data.riders?.performance || [], rider => {
        const row = document.createElement("div"); row.className = "admin-report-status-item";
        const label = document.createElement("span"); label.textContent = rider.name || `Rider ${rider.id}`;
        const value = document.createElement("strong"); value.textContent = `${number(rider.deliveries)} delivered / ${number(rider.assignedOrders)} assigned`;
        row.append(label, value); return row;
      }, "No rider activity in this date range.");
      const paymentStatusList = document.getElementById("reportPaymentStatuses");
      listRows(paymentStatusList, data.paymentStatuses || [], item => {
        const row = document.createElement("div"); row.className = "admin-report-status-item";
        const label = document.createElement("span"); label.textContent = String(item.status || "unknown").replaceAll("_", " ");
        const value = document.createElement("strong"); value.textContent = `${number(item.count)} · ${money(item.amount)}`; row.append(label, value); return row;
      }, "No payment activity in this date range.");
    }
    async function loadReport(button) {
      const oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = "Loading…"; }
      try {
        const query = reportQuery();
        const data = await API.request(`/admins/reports?${query.params}`, { authenticated: true });
        renderReport(data);
        currentReport = data; currentReportKey = query.key;
        showMessage(`Report updated for ${data.range?.start || startInput.value} to ${data.range?.end || endInput.value}.`);
        return true;
      } catch (error) {
        invalidateReport();
        showMessage(error.message || "Could not load report data.", "danger");
        return false;
      } finally {
        if (button) { button.disabled = false; button.textContent = oldText; }
      }
    }
    function csvCell(value) {
      let text = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    }
    async function exportReport() {
      let query;
      try { query = reportQuery(); } catch (error) { showMessage(error.message, "danger"); return; }
      if (!currentReport || currentReportKey !== query.key) {
        const loaded = await loadReport(exportButton);
        if (!loaded || !currentReport || currentReportKey !== query.key) return;
      }
      const data = currentReport;
      const rows = [["FoodDelivery Admin Report"], ["Report type", typeSelect.value], ["Start date", startInput.value], ["End date", endInput.value], [], ["Summary metric", "Value", "Notes"],
        ["Completed-payment revenue", data.summary.revenue.value, data.summary.revenue.description], ["Orders placed", data.summary.orders.value, data.summary.orders.description],
        ["Total customer accounts", data.summary.customers.value, data.summary.customers.description], ["Active customers", data.customers?.active || 0, "Customers with an order in this period"],
        ["New customers", data.customers?.new || 0, "Accounts created in this period"], ["Returning customers", data.customers?.returning || 0, "Pre-existing customers with an order in this period"],
        ["Inactive customers", data.customers?.inactive || 0, "Customer accounts with no order in this period"], ["Average paid order value", data.summary.averageOrder?.value || 0, data.summary.averageOrder?.description || ""],
        ["Delivered orders", data.summary.delivered?.value || 0, "Delivered in period"], ["Cancelled orders", data.summary.cancelled?.value || 0, "Placed in period"], [],
        ["Revenue series"], ["Bucket", "Revenue (KSh)", "Orders"], ...data.series.labels.map((label, i) => [label, data.series.revenue[i], data.series.orders?.[i] || 0]), [],
        ["Order status breakdown"], ["Status", "Orders"], ...data.orderStatusBreakdown.map(x => [x.status, x.count]), [],
        ["Payment methods"], ["Method", "Transactions", "Completed amount (KSh)"], ...data.paymentStatusBreakdown.map(x => [x.method, x.count, x.amount]), [],
        ["Payment statuses"], ["Status", "Transactions", "Completed amount (KSh)"], ...(data.paymentStatuses || []).map(x => [x.status, x.count, x.amount]), [],
        ["Top restaurants"], ["Restaurant", "Orders", "Completed payment revenue (KSh)"], ...data.topRestaurants.map(x => [x.name, x.orderCount, x.revenue]), [],
        ["Rider performance"], ["Rider", "Delivered", "Assigned orders"], ...(data.riders?.performance || []).map(x => [x.name, x.deliveries, x.assignedOrders])];
      const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `food-delivery-${typeSelect.value.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${startInput.value}-${endInput.value}.csv`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      showMessage("CSV export created using the currently selected report filters.");
    }
    periodSelect.addEventListener("change", () => setPreset(periodSelect.value));
    [startInput, endInput].forEach(input => input.addEventListener("change", invalidateReport));
    typeSelect.addEventListener("change", () => { if (currentReport) { try { renderReport(currentReport); } catch (error) { showMessage(error.message, "danger"); } } });
    chartMetric?.addEventListener("change", () => { if (currentReport) { try { renderReport(currentReport); } catch (error) { showMessage(error.message, "danger"); } } });
    document.querySelector(".admin-reports-revenue-card .admin-period-select")?.addEventListener("change", event => { periodSelect.value = event.currentTarget.value; setPreset(periodSelect.value); loadReport(); });
    applyButton?.addEventListener("click", () => loadReport(applyButton));
    exportButton?.addEventListener("click", exportReport);
    setPreset(periodSelect.value || "Last 7 Days");
    loadReport();
  });
})();
