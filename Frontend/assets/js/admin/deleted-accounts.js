(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  let page = 1;
  let pages = 1;
  let records = [];
  let loading = false;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  const api = () => window.FoodDeliveryAuthApi;
  const setStatus = (id, message, isError = false) => {
    const element = $(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
  };

  async function request(path, options = {}) {
    const client = api();
    if (!client || typeof client.request !== "function") {
      throw new Error("The secure API client did not load. Refresh the page and try again.");
    }
    if (typeof client.getToken === "function" && !client.getToken()) {
      throw new Error("Your admin session is missing or has expired. Sign in again.");
    }
    return client.request(path, { ...options, authenticated: true });
  }

  async function load() {
    if (loading) return;
    loading = true;
    $("apply").disabled = true;
    $("export").disabled = true;
    setStatus("status", "Loading archived accounts…");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
        search: $("search").value.trim(),
        type: $("type").value
      });
      let result = await request("/admins/deleted-accounts?" + params.toString());
      if (result?.success === false) throw new Error(result.message || "Could not load archived accounts.");
      let data = result?.data || result;
      if (!Array.isArray(data?.accounts)) {
        throw new Error("The server response did not contain an archived-account list. Check that the latest backend is deployed.");
      }
      let pagination = data.pagination || {};
      pages = Math.max(1, Number(pagination.pages) || 1);
      if (page > pages) {
        page = pages;
        const retryParams = new URLSearchParams({
          page: String(page), limit: "25",
          search: $("search").value.trim(), type: $("type").value
        });
        result = await request("/admins/deleted-accounts?" + retryParams.toString());
        if (result?.success === false) throw new Error(result.message || "Could not load archived accounts.");
        data = result?.data || result;
        pagination = data.pagination || {};
        pages = Math.max(1, Number(pagination.pages) || 1);
      }
      records = data.accounts || [];
      renderRows(records);
      setStatus("status", Number(pagination.total ?? records.length) + " archived account(s) found.");
      $("pageLabel").textContent = "Page " + page + " of " + pages;
      $("prev").disabled = page <= 1;
      $("next").disabled = page >= pages;
    } catch (error) {
      records = [];
      renderRows([]);
      setStatus("status", (error?.message || "Unable to load archived accounts.") + " Use Search to retry.", true);
      $("pageLabel").textContent = "Page " + page;
      $("prev").disabled = page <= 1;
      $("next").disabled = true;
      console.error("Deleted Accounts page load failed:", error);
    } finally {
      loading = false;
      $("apply").disabled = false;
      $("export").disabled = false;
    }
  }

  function renderRows(rows) {
    $("rows").innerHTML = rows.length ? rows.map(row => {
      const snapshot = row.account_data ?? row.snapshot ?? {};
      return '<tr><td>' + esc(row.deleted_at ? new Date(row.deleted_at).toLocaleString() : "—") +
        '</td><td>' + esc(row.account_type || "—") +
        '</td><td>' + esc(row.original_account_id ?? "—") +
        '</td><td>' + esc(row.account_label || "—") +
        '</td><td>' + esc(row.deleted_by_label || (row.deleted_by ? "Admin #" + row.deleted_by : "—")) +
        '</td><td>' + esc(row.deletion_reason || "—") +
        '</td><td><details><summary>View snapshot</summary><pre>' + esc(JSON.stringify(snapshot, null, 2)) +
        '</pre></details></td></tr>';
    }).join("") : '<tr><td class="deleted-empty" colspan="7">No archived accounts match these filters.</td></tr>';
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\u0000-\u0020]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCurrentPage() {
    if (!records.length) {
      setStatus("status", "There are no archived accounts on this page to export.");
      return;
    }
    const columns = [
      ["deleted_at", "Deleted at"], ["account_type", "Type"],
      ["original_account_id", "Original ID"], ["account_label", "Account"],
      ["deleted_by_label", "Deleted by"], ["deletion_reason", "Reason"],
      ["account_data", "Snapshot"]
    ];
    const csv = [
      columns.map(column => csvCell(column[1])).join(","),
      ...records.map(row => columns.map(([key]) => {
        if (key === "deleted_by_label") return csvCell(row.deleted_by_label || (row.deleted_by ? "Admin #" + row.deleted_by : ""));
        if (key === "account_data") return csvCell(JSON.stringify(row.account_data ?? row.snapshot ?? {}));
        return csvCell(row[key]);
      }).join(","))
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "deleted-accounts-page-" + page + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function permanentlyDelete() {
    const type = $("deleteType").value;
    const id = String($("deleteId").value || "").trim();
    const reason = $("deleteReason").value.trim();
    if (!/^[1-9][0-9]*$/.test(id)) {
      setStatus("deleteStatus", "Enter a valid positive account ID.", true);
      $("deleteId").focus();
      return;
    }
    const confirmed = window.confirm("Permanently delete this " + type + " account #" + id + "? A snapshot will be archived first. This cannot be undone.");
    if (!confirmed) return;

    const button = $("permanentDelete");
    button.disabled = true;
    button.textContent = "Deleting…";
    setStatus("deleteStatus", "Processing permanent deletion…");
    try {
      const result = await request("/admins/deleted-accounts/" + encodeURIComponent(type) + "/" + encodeURIComponent(id), {
        method: "DELETE",
        body: { reason }
      });
      if (result?.success === false) throw new Error(result.message || "Permanent deletion failed.");
      setStatus("deleteStatus", result?.message || result?.data?.message || "Account deleted and archived.");
      $("deleteId").value = "";
      $("deleteReason").value = "";
      page = 1;
      await load();
    } catch (error) {
      setStatus("deleteStatus", error?.message || "Permanent deletion failed.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Permanently delete";
    }
  }

  const incoming = new URLSearchParams(window.location.search);
  if (["customer", "restaurant", "rider"].includes(incoming.get("type"))) $("deleteType").value = incoming.get("type");
  if (/^[1-9][0-9]*$/.test(incoming.get("id") || "")) {
    $("deleteId").value = incoming.get("id");
    setStatus("deleteStatus", "Account selected. Verify the ID before permanently deleting.");
  }

  $("permanentDelete").addEventListener("click", permanentlyDelete);
  $("apply").addEventListener("click", () => { page = 1; load(); });
  $("search").addEventListener("keydown", event => { if (event.key === "Enter") { page = 1; load(); } });
  $("type").addEventListener("change", () => { page = 1; load(); });
  $("prev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
  $("next").addEventListener("click", () => { if (page < pages) { page++; load(); } });
  $("export").addEventListener("click", exportCurrentPage);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})();