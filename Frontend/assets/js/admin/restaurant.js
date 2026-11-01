document.addEventListener("DOMContentLoaded", () => {
  const API = window.FoodDeliveryAuthApi;

  if (!API || typeof API.request !== "function") {
    console.error("FoodDeliveryAuthApi is not available.");
    return;
  }

  const tableBody = document.getElementById("restaurantTableBody");
  const searchInput = document.getElementById("restaurantSearch");

  const tabs = document.querySelectorAll(".admin-restaurant-tab");

  const addButton = document.getElementById("addRestaurantButton");
  const exportButton = document.getElementById("exportRestaurantsButton");

  const messageBox = document.getElementById("adminMessage");

  const filterButton = document.getElementById("restaurantFilterButton");
  const filterPanel = document.getElementById("restaurantFilterPanel");

  const openFilter = document.getElementById("restaurantOpenFilter");
  const approvalFilter = document.getElementById("restaurantApprovalFilter");

  const applyFilterButton = document.getElementById(
    "applyRestaurantFiltersButton",
  );

  const resetFilterButton = document.getElementById(
    "resetRestaurantFiltersButton",
  );

  const showingText = document.getElementById("restaurantShowingText");
  const paginationContainer = document.getElementById("restaurantPagination");

  const state = {
    page: 1,
    limit: 10,
    search: "",
    status: "all",
    open: "all",
    approval: "all",
    totalPages: 1,
    totalItems: 0,
    restaurants: [],
  };

  let searchTimer = null;
  let messageTimer = null;

  /*
   * =========================================================
   * API
   * =========================================================
   */

  const restaurantsApi = {
    async list(params = {}) {
      const query = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
        ) {
          query.set(key, value);
        }
      });

      const suffix = query.toString() ? `?${query.toString()}` : "";

      return API.request(`/restaurants/admin${suffix}`, {
        method: "GET",
        authenticated: true,
      });
    },

    async get(restaurantId) {
      return API.request(
        `/restaurants/admin/${encodeURIComponent(restaurantId)}`,
        {
          method: "GET",
          authenticated: true,
        },
      );
    },

    async create(data) {
      return API.request("/restaurants/admin", {
        method: "POST",
        body: data,
        authenticated: true,
      });
    },

    async update(restaurantId, data) {
      return API.request(
        `/restaurants/admin/${encodeURIComponent(restaurantId)}`,
        {
          method: "PUT",
          body: data,
          authenticated: true,
        },
      );
    },

    async approve(restaurantId) {
      return API.request(
        `/restaurants/admin/${encodeURIComponent(restaurantId)}/approve`,
        {
          method: "PATCH",
          authenticated: true,
        },
      );
    },

    async reject(restaurantId, reason) {
      return API.request(
        `/restaurants/admin/${encodeURIComponent(restaurantId)}/reject`,
        {
          method: "PATCH",
          body: {
            reason,
          },
          authenticated: true,
        },
      );
    },

    async activate(restaurantId) {
      return API.request(
        `/restaurants/admin/${encodeURIComponent(restaurantId)}/activate`,
        {
          method: "PATCH",
          authenticated: true,
        },
      );
    },

    async deactivate(restaurantId) {
      return API.request(
        `/restaurants/admin/${encodeURIComponent(restaurantId)}/deactivate`,
        {
          method: "PATCH",
          authenticated: true,
        },
      );
    },
  };

  /*
   * =========================================================
   * GENERAL HELPERS
   * =========================================================
   */

  function showMessage(message, type = "success") {
    if (!messageBox) {
      return;
    }

    window.clearTimeout(messageTimer);

    messageBox.textContent = message;
    messageBox.className = `admin-message ${type}`;

    messageTimer = window.setTimeout(() => {
      messageBox.textContent = "";
      messageBox.className = "admin-message";
    }, 4000);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getInitials(name) {
    return (
      String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word.charAt(0))
        .join("")
        .toUpperCase() || "R"
    );
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatMoney(value) {
    const amount = Number(value || 0);

    return `KSh ${amount.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatRating(value) {
    const rating = Number(value || 0);

    if (!rating) {
      return "—";
    }

    return `★ ${rating.toFixed(1)}`;
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function restaurantDisplayStatus(restaurant) {
    if (restaurant.approval_status === "pending") {
      return {
        label: "Pending",
        className: "warning",
      };
    }

    if (restaurant.approval_status === "rejected") {
      return {
        label: "Suspended",
        className: "danger",
      };
    }

    if (restaurant.is_active) {
      return {
        label: "Active",
        className: "success",
      };
    }

    return {
      label: "Inactive",
      className: "danger",
    };
  }

  function getOwnerName(restaurant) {
    return (
      [restaurant.owner_first_name, restaurant.owner_last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || "—"
    );
  }

  /*
   * =========================================================
   * LOAD RESTAURANTS
   * =========================================================
   */

  async function loadRestaurants() {
    tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding:35px;">
                    Loading restaurants...
                </td>
            </tr>
        `;

    try {
      const response = await restaurantsApi.list({
        search: state.search,
        status: state.status,
        open: state.open,
        approval: state.approval,
        page: state.page,
        limit: state.limit,
      });

      state.restaurants = Array.isArray(response?.restaurants)
        ? response.restaurants
        : [];

      state.totalItems = Number(response?.pagination?.totalItems || 0);

      state.totalPages = Math.max(
        1,
        Number(response?.pagination?.totalPages || 1),
      );

      if (state.page > state.totalPages) {
        state.page = state.totalPages;

        return loadRestaurants();
      }

      renderRestaurants();
      renderPagination();
      renderStatistics(response?.statistics || {});
    } catch (error) {
      console.error("Failed to load restaurants:", error);

      tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center; padding:35px;">
                        Could not load restaurants.
                    </td>
                </tr>
            `;

      state.totalItems = 0;
      state.totalPages = 1;

      renderPagination();

      showMessage(
        error?.message || "Could not load restaurants. Please try again.",
        "error",
      );
    }
  }

  /*
   * =========================================================
   * RENDER TABLE
   * =========================================================
   */

  function renderRestaurants() {
    if (!state.restaurants.length) {
      tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center; padding:35px;">
                        No restaurants found.
                    </td>
                </tr>
            `;

      updateShowingText();
      return;
    }

    tableBody.innerHTML = "";

    state.restaurants.forEach((restaurant) => {
      const row = document.createElement("tr");

      const status = restaurantDisplayStatus(restaurant);

      const ownerName = getOwnerName(restaurant);

      const orders = Number(restaurant.orders_count || 0);

      const rating = Number(restaurant.rating || 0);

      let quickAction = "";

      if (
        restaurant.approval_status === "pending" ||
        restaurant.approval_status === "rejected"
      ) {
        quickAction = `
                    <button
                        type="button"
                        class="admin-table-action approve-button"
                        data-id="${escapeHtml(restaurant.id)}"
                        aria-label="Approve restaurant"
                        title="Approve restaurant"
                    >
                        ✓
                    </button>
                `;
      } else if (restaurant.is_active) {
        quickAction = `
                    <button
                        type="button"
                        class="admin-table-action danger deactivate-button"
                        data-id="${escapeHtml(restaurant.id)}"
                        aria-label="Deactivate restaurant"
                        title="Deactivate restaurant"
                    >
                        ×
                    </button>
                `;
      } else {
        quickAction = `
                    <button
                        type="button"
                        class="admin-table-action activate-button"
                        data-id="${escapeHtml(restaurant.id)}"
                        aria-label="Activate restaurant"
                        title="Activate restaurant"
                    >
                        ✓
                    </button>
                `;
      }

      row.innerHTML = `
                <td>
                    <div class="admin-restaurant">

                        <div class="admin-restaurant-avatar">
                            ${restaurant.logo_url && /^data:image\/(jpeg|png|webp);base64,/i.test(restaurant.logo_url)
                              ? `<img src="${restaurant.logo_url}" alt="${escapeHtml(restaurant.name)} image" loading="lazy">`
                              : escapeHtml(getInitials(restaurant.name))}
                        </div>

                        <div class="admin-restaurant-info">

                            <strong>
                                ${escapeHtml(restaurant.name)}
                            </strong>

                            <span>
                                ${restaurant.is_open ? "Open now" : "Closed"}
                            </span>

                        </div>

                    </div>
                </td>

                <td>
                    ${escapeHtml(ownerName)}
                </td>

                <td>
                    ${escapeHtml(restaurant.location_name || `${String(restaurant.name || "Restaurant").trim().split(/\s+/)[0]} Location`)}
                </td>

                <td>
                    ${formatNumber(orders)}
                </td>

                <td>
                    <span class="admin-rating">
                        ${escapeHtml(formatRating(rating))}
                    </span>
                </td>

                <td>
                    <span
                        class="admin-status ${status.className}"
                    >
                        ${escapeHtml(status.label)}
                    </span>
                </td>

                <td>

                    <div class="admin-table-actions">

                        <button
                            type="button"
                            class="admin-table-action view-button"
                            data-id="${escapeHtml(restaurant.id)}"
                            aria-label="View restaurant"
                            title="View restaurant"
                        >
                            ◉
                        </button>

                        <button
                            type="button"
                            class="admin-table-action edit-button"
                            data-id="${escapeHtml(restaurant.id)}"
                            aria-label="Edit restaurant"
                            title="Edit restaurant"
                        >
                            ✎
                        </button>

                        ${quickAction}
                        <button type="button" class="admin-table-action permanent-delete-button" data-id="${escapeHtml(restaurant.id)}" aria-label="Permanently delete restaurant" title="Permanently delete restaurant">Delete</button>

                    </div>

                </td>
            `;

      tableBody.appendChild(row);
    });

    updateShowingText();
  }

  /*
   * =========================================================
   * TABLE ACTIONS
   * =========================================================
   */

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-id]");

    if (!button) {
      return;
    }

    const restaurantId = button.dataset.id;

    if (!restaurantId) {
      return;
    }

    if (button.classList.contains("view-button")) {
      await openRestaurantModal(restaurantId);

      return;
    }

    if (button.classList.contains("edit-button")) {
      await openRestaurantModal(restaurantId);

      return;
    }

    if (button.classList.contains("approve-button")) {
      await handleApproveRestaurant(restaurantId);

      return;
    }

    if (button.classList.contains("activate-button")) {
      await handleActivateRestaurant(restaurantId);

      return;
    }

    if (button.classList.contains("deactivate-button")) {
      await handleDeactivateRestaurant(restaurantId);
    }

    if (button.classList.contains("permanent-delete-button")) {
      const restaurant = state.restaurants?.find((item) => String(item.id) === String(restaurantId));
      const name = restaurant?.name || ("restaurant #" + restaurantId);
      const reason = window.prompt("Enter the reason for permanently deleting " + name + ":");
      if (reason === null) return;
      if (reason.trim().length < 3) { showMessage("A deletion reason of at least 3 characters is required.", "error"); return; }
      if (!window.confirm("Permanently delete " + name + "? This cannot be undone.")) return;
      if (button.disabled) return;
      button.disabled = true; button.textContent = "Deleting...";
      try {
        const result = await API.request("/admins/deleted-accounts/restaurant/" + encodeURIComponent(restaurantId), {
          method: "DELETE", authenticated: true, body: { reason: reason.trim() },
        });
        showMessage(result?.message || "Restaurant deleted and archived.", "success");
        await loadRestaurants();
      } catch (error) {
        showMessage(error?.message || "Could not delete this restaurant.", "error");
      } finally { button.disabled = false; button.textContent = "Delete"; }
      return;
    }
  });

  /*
   * =========================================================
   * STATISTICS
   * =========================================================
   */

  function renderStatistics(statistics) {
    const total = Number(statistics.total || 0);

    const active = Number(statistics.active || 0);

    const inactive = Number(statistics.inactive || 0);

    const open = Number(statistics.open || 0);

    const pending = Number(statistics.pending || 0);

    const rejected = Number(statistics.rejected || 0);

    const topRated = Number(statistics.topRated || 0);

    document.getElementById("restaurantTotalStat").textContent =
      formatNumber(total);

    document.getElementById("restaurantActiveStat").textContent =
      formatNumber(active);

    document.getElementById("restaurantPendingStat").textContent =
      formatNumber(pending);

    document.getElementById("restaurantTopRatedStat").textContent =
      formatNumber(topRated);

    document.getElementById("restaurantSummaryActive").textContent =
      formatNumber(active);

    document.getElementById("restaurantSummaryOpen").textContent =
      formatNumber(open);

    document.getElementById("restaurantSummaryPending").textContent =
      formatNumber(pending);

    document.getElementById("restaurantSummaryRejected").textContent =
      formatNumber(rejected);

    document.getElementById("restaurantSummaryInactive").textContent =
      formatNumber(inactive);

    
  }

  /*
   * =========================================================
   * PAGINATION
   * =========================================================
   */

  function renderPagination() {
    paginationContainer.innerHTML = "";

    const totalPages = Math.max(1, Number(state.totalPages || 1));

    const currentPage = Math.min(totalPages, Math.max(1, state.page));

    addPaginationButton("‹", currentPage <= 1, () => {
      if (currentPage <= 1) {
        return;
      }

      state.page = currentPage - 1;

      loadRestaurants();
    });

    const pageNumbers = buildPageNumbers(currentPage, totalPages);

    pageNumbers.forEach((page) => {
      if (page === "...") {
        const span = document.createElement("span");

        span.textContent = "...";

        span.style.padding = "0 6px";

        paginationContainer.appendChild(span);

        return;
      }

      addPaginationButton(
        String(page),
        false,
        () => {
          state.page = page;

          loadRestaurants();
        },
        page === currentPage,
      );
    });

    addPaginationButton("›", currentPage >= totalPages, () => {
      if (currentPage >= totalPages) {
        return;
      }

      state.page = currentPage + 1;

      loadRestaurants();
    });
  }

  function addPaginationButton(label, disabled, onClick, active = false) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;

    if (active) {
      button.classList.add("active");
    }

    button.addEventListener("click", onClick);

    paginationContainer.appendChild(button);
  }

  function buildPageNumbers(currentPage, totalPages) {
    if (totalPages <= 7) {
      return Array.from(
        {
          length: totalPages,
        },
        (_, index) => index + 1,
      );
    }

    const pages = [1];

    if (currentPage > 4) {
      pages.push("...");
    }

    const start = Math.max(2, currentPage - 1);

    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }

    if (currentPage < totalPages - 3) {
      pages.push("...");
    }

    pages.push(totalPages);

    return pages;
  }

  function updateShowingText() {
    const total = state.totalItems;

    if (!total) {
      showingText.textContent = "Showing 0–0 of 0 restaurants";

      return;
    }

    const start = (state.page - 1) * state.limit + 1;

    const end = Math.min(state.page * state.limit, total);

    showingText.textContent = `Showing ${start}–${end} of ${formatNumber(
      total,
    )} restaurants`;
  }

  /*
   * =========================================================
   * TABS
   * =========================================================
   */

  tabs.forEach((tab) => {
    tab.addEventListener("click", (event) => {
      event.preventDefault();

      tabs.forEach((item) => {
        item.classList.remove("active");
      });

      tab.classList.add("active");

      const filter = tab.dataset.filter;

      state.page = 1;
      state.open = "all";

      if (filter === "all") {
        state.status = "all";

        state.approval = "all";
      }

      if (filter === "active") {
        state.status = "active";

        state.approval = "all";
      }

      if (filter === "pending") {
        state.status = "all";

        state.approval = "pending";
      }

      if (filter === "suspended") {
        state.status = "all";

        state.approval = "rejected";
      }

      openFilter.value = state.open;

      approvalFilter.value = state.approval;

      loadRestaurants();
    });
  });

  /*
   * =========================================================
   * SEARCH
   * =========================================================
   */

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);

    searchTimer = window.setTimeout(() => {
      state.search = searchInput.value.trim();

      state.page = 1;

      loadRestaurants();
    }, 350);
  });

  /*
   * =========================================================
   * FILTER PANEL
   * =========================================================
   */

  filterButton.addEventListener("click", () => {
    const willOpen = filterPanel.hasAttribute("hidden");

    if (willOpen) {
      filterPanel.removeAttribute("hidden");
    } else {
      filterPanel.setAttribute("hidden", "");
    }

    filterButton.setAttribute("aria-expanded", String(willOpen));
  });

  applyFilterButton.addEventListener("click", () => {
    state.open = openFilter.value;

    state.approval = approvalFilter.value;

    state.status = "all";

    state.page = 1;

    tabs.forEach((tab) => {
      tab.classList.remove("active");
    });

    tabs[0]?.classList.add("active");

    filterPanel.setAttribute("hidden", "");

    filterButton.setAttribute("aria-expanded", "false");

    loadRestaurants();
  });

  resetFilterButton.addEventListener("click", () => {
    openFilter.value = "all";

    approvalFilter.value = "all";

    state.status = "all";

    state.open = "all";

    state.approval = "all";

    state.page = 1;

    tabs.forEach((tab) => {
      tab.classList.remove("active");
    });

    tabs[0]?.classList.add("active");

    filterPanel.setAttribute("hidden", "");

    filterButton.setAttribute("aria-expanded", "false");

    loadRestaurants();
  });

  /*
   * =========================================================
   * RESTAURANT MODAL
   * =========================================================
   */

  const modal = document.createElement("dialog");

  modal.className = "admin-modal-dialog";

  modal.innerHTML = `
        <form
            id="restaurantForm"
            class="admin-customer-form"
            novalidate
        >

            <div class="admin-modal-header">

                <div>

                    <p class="admin-modal-eyebrow">
                        RESTAURANT MANAGEMENT
                    </p>

                    <h2 id="restaurantModalTitle">
                        Add Restaurant
                    </h2>

                    <p id="restaurantModalSubtitle">
                        Create a restaurant account for the platform.
                    </p>

                </div>

                <button
                    type="button"
                    class="admin-modal-close"
                    id="closeRestaurantModal"
                    aria-label="Close modal"
                >
                    ×
                </button>

            </div>


            <div
                id="restaurantModalMessage"
                class="admin-message"
                role="alert"
                aria-live="polite"
            ></div>


            <div
                id="restaurantFormGrid"
                class="admin-form-grid"
                style="margin-top:22px;"
            >

                <div
                    class="admin-form-field admin-form-field-full"
                >
                    <label for="restaurantName">
                        Restaurant name <span>*</span>
                    </label>

                    <input
                        id="restaurantName"
                        name="restaurantName"
                        type="text"
                        placeholder="e.g. Nairobi Kitchen"
                        required
                    />

                    <small class="admin-form-error"></small>
                </div>


                <div
                    class="admin-form-field admin-form-field-full"
                >
                    <label for="restaurantDescription">
                        Description
                    </label>

                    <textarea
                        id="restaurantDescription"
                        name="restaurantDescription"
                        rows="3"
                        placeholder="Describe the restaurant..."
                    ></textarea>

                    <small class="admin-form-error"></small>
                </div>


                <div class="admin-form-field admin-form-field-full">
                    <label for="restaurantImage">Restaurant image <span>*</span></label>
                    <input id="restaurantImage" name="restaurantImage" type="file"
                        accept="image/jpeg,image/png,image/webp" />
                    <small class="admin-form-hint">JPEG, PNG or WebP. Maximum 5 MB. Required when creating a restaurant; optional when editing.</small>
                    <div id="restaurantImagePreviewWrap" hidden style="margin-top:10px;">
                        <img id="restaurantImagePreview" alt="Restaurant image preview"
                            style="display:block;width:100%;max-height:190px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;" />
                        <button type="button" id="clearRestaurantImage" class="admin-secondary-button" style="margin-top:8px;">Remove selected image</button>
                    </div>
                    <small class="admin-form-error" id="restaurantImageError"></small>
                </div>

                <div class="admin-form-field">

                    <label for="restaurantPhone">
                        Restaurant phone
                    </label>

                    <input
                        id="restaurantPhone"
                        name="restaurantPhone"
                        type="tel"
                        placeholder="0712 345 678"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="restaurantEmail">
                        Restaurant email
                    </label>

                    <input
                        id="restaurantEmail"
                        name="restaurantEmail"
                        type="email"
                        placeholder="restaurant@example.com"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field admin-form-field-full">
                    <label for="restaurantLocationButton">
                        Restaurant location <span>*</span>
                    </label>

                    <button
                        type="button"
                        id="restaurantLocationButton"
                        class="admin-secondary-button"
                        style="width:100%;"
                    >
                        Use Live Location
                    </button>

                    <small id="restaurantLocationStatus" class="admin-form-hint" role="status" aria-live="polite">
                        Required. Use this button and allow location access to save the restaurant's GPS coordinates.
                    </small>
                    <small id="restaurantLocationError" class="admin-form-error"></small>

                    <input id="restaurantLatitude" name="restaurantLatitude" type="hidden" />
                    <input id="restaurantLongitude" name="restaurantLongitude" type="hidden" />
                </div>


                <div class="admin-form-field">

                    <label for="restaurantDeliveryFee">
                        Delivery fee
                    </label>

                    <input
                        id="restaurantDeliveryFee"
                        name="restaurantDeliveryFee"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="restaurantMinimumOrder">
                        Minimum order
                    </label>

                    <input
                        id="restaurantMinimumOrder"
                        name="restaurantMinimumOrder"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="restaurantOpeningTime">
                        Opening time
                    </label>

                    <input
                        id="restaurantOpeningTime"
                        name="restaurantOpeningTime"
                        type="time"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="restaurantClosingTime">
                        Closing time
                    </label>

                    <input
                        id="restaurantClosingTime"
                        name="restaurantClosingTime"
                        type="time"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="restaurantOpen">
                        Restaurant open status
                    </label>

                    <select
                        id="restaurantOpen"
                        name="restaurantOpen"
                    >
                        <option value="true">
                            Open
                        </option>

                        <option value="false">
                            Closed
                        </option>
                    </select>

                </div>


                <div
                    class="admin-form-field admin-form-field-full"
                >
                    <div
                        style="
                            padding-bottom:8px;
                            margin-bottom:4px;
                            border-bottom:1px solid #eee;
                        "
                    >
                        <strong>Owner Account</strong>
                    </div>
                </div>


                <div class="admin-form-field">

                    <label for="ownerFirstName">
                        Owner first name <span>*</span>
                    </label>

                    <input
                        id="ownerFirstName"
                        name="ownerFirstName"
                        type="text"
                        placeholder="e.g. Jane"
                        required
                        autocomplete="given-name"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="ownerLastName">
                        Owner last name <span>*</span>
                    </label>

                    <input
                        id="ownerLastName"
                        name="ownerLastName"
                        type="text"
                        placeholder="e.g. Wanjiku"
                        required
                        autocomplete="family-name"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="ownerEmail">
                        Owner email <span>*</span>
                    </label>

                    <input
                        id="ownerEmail"
                        name="ownerEmail"
                        type="email"
                        placeholder="owner@example.com"
                        required
                        autocomplete="email"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div class="admin-form-field">

                    <label for="ownerPhone">
                        Owner phone
                    </label>

                    <input
                        id="ownerPhone"
                        name="ownerPhone"
                        type="tel"
                        placeholder="0712 345 678"
                        autocomplete="tel"
                    />

                    <small class="admin-form-error"></small>

                </div>


                <div
                    class="admin-form-field admin-form-field-full"
                    id="temporaryPasswordNote"
                >

                    <small class="admin-form-hint">
                        A temporary password is generated automatically. You
                        will see it once after the restaurant is created. The
                        owner can change it from their portal.
                    </small>

                </div>

            </div>


            <div
                id="restaurantCredentials"
                style="display:none; margin-top:22px;"
            >

                <p>
                    The restaurant and its owner account were created. Share
                    these sign-in details with the owner. The password is
                    shown only once.
                </p>

                <div
                    class="admin-form-grid"
                    style="margin-top:16px;"
                >

                    <div
                        class="admin-form-field admin-form-field-full"
                    >

                        <label for="credentialsEmail">
                            Owner email
                        </label>

                        <input
                            id="credentialsEmail"
                            type="text"
                            readonly
                        />

                    </div>


                    <div
                        class="admin-form-field admin-form-field-full"
                    >

                        <label for="credentialsPassword">
                            Temporary password
                        </label>

                        <div style="display:flex; gap:10px;">

                            <input
                                id="credentialsPassword"
                                type="text"
                                readonly
                                style="flex:1;"
                            />

                            <button
                                type="button"
                                class="admin-secondary-button"
                                id="copyCredentialsPassword"
                            >
                                Copy
                            </button>

                        </div>

                    </div>

                </div>

            </div>


            <div
                class="admin-modal-actions"
                style="
                    display:flex;
                    flex-wrap:wrap;
                    gap:10px;
                    margin-top:24px;
                "
            >

                <button
                    type="button"
                    class="admin-secondary-button"
                    id="cancelRestaurantModal"
                >
                    Close
                </button>


                <button
                    type="button"
                    class="admin-secondary-button"
                    id="rejectRestaurantButton"
                >
                    Reject
                </button>


                <button
                    type="button"
                    class="admin-secondary-button"
                    id="approveRestaurantButton"
                >
                    Approve
                </button>


                <button
                    type="button"
                    class="admin-secondary-button"
                    id="deactivateRestaurantButton"
                >
                    Deactivate
                </button>


                <button
                    type="button"
                    class="admin-secondary-button"
                    id="activateRestaurantButton"
                >
                    Activate
                </button>


                <button
                    type="submit"
                    class="admin-primary-button"
                    id="saveRestaurantButton"
                >
                    Create Restaurant
                </button>

            </div>

        </form>
    `;

  document.body.appendChild(modal);

  /*
   * =========================================================
   * MODAL REFERENCES
   * =========================================================
   */

  const form = modal.querySelector("#restaurantForm");

  const formGrid = modal.querySelector("#restaurantFormGrid");
  const restaurantImageInput = modal.querySelector("#restaurantImage");
  const restaurantImagePreviewWrap = modal.querySelector("#restaurantImagePreviewWrap");
  const restaurantImagePreview = modal.querySelector("#restaurantImagePreview");
  const clearRestaurantImageButton = modal.querySelector("#clearRestaurantImage");
  const restaurantImageError = modal.querySelector("#restaurantImageError");
  const restaurantLocationButton = modal.querySelector("#restaurantLocationButton");
  const restaurantLocationStatus = modal.querySelector("#restaurantLocationStatus");
  const restaurantLocationError = modal.querySelector("#restaurantLocationError");
  let selectedRestaurantImageData = "";

  const modalTitle = modal.querySelector("#restaurantModalTitle");

  const modalSubtitle = modal.querySelector("#restaurantModalSubtitle");

  const modalMessage = modal.querySelector("#restaurantModalMessage");

  const saveButton = modal.querySelector("#saveRestaurantButton");

  const cancelButton = modal.querySelector("#cancelRestaurantModal");

  const approveButton = modal.querySelector("#approveRestaurantButton");

  const rejectButton = modal.querySelector("#rejectRestaurantButton");

  const activateButton = modal.querySelector("#activateRestaurantButton");

  const deactivateButton = modal.querySelector("#deactivateRestaurantButton");

  const temporaryPasswordNote = modal.querySelector("#temporaryPasswordNote");

  const credentialsBox = modal.querySelector("#restaurantCredentials");

  const credentialsEmail = modal.querySelector("#credentialsEmail");

  const credentialsPassword = modal.querySelector("#credentialsPassword");

  const copyCredentialsButton = modal.querySelector("#copyCredentialsPassword");

  const restaurantModal = {
    mode: "add",
    restaurantId: null,
    restaurant: null,
    loading: false,
    showingCredentials: false,
  };

  /*
   * =========================================================
   * MODAL HELPERS
   * =========================================================
   */

  function showModalMessage(message, type = "error") {
    modalMessage.textContent = message;

    modalMessage.className = `admin-message ${type}`;
  }

  function clearModalMessage() {
    modalMessage.textContent = "";

    modalMessage.className = "admin-message";
  }

  function clearFormErrors() {
    form.querySelectorAll(".admin-form-field").forEach((field) => {
      field.classList.remove("is-invalid");

      const error = field.querySelector(".admin-form-error");

      if (error) {
        error.textContent = "";
      }
    });
  }

  function setFieldVisible(field, visible) {
    if (!field) {
      return;
    }

    field.hidden = !visible;
  }

  function setInputValue(id, value) {
    const input = modal.querySelector(`#${id}`);

    if (input) {
      input.value = value === null || value === undefined ? "" : String(value);
    }
  }

  function openDialog() {
    if (!modal.open) {
      modal.showModal();
    }
  }

  function resetCredentialsView() {
    restaurantModal.showingCredentials = false;

    formGrid.style.display = "";

    credentialsBox.style.display = "none";

    credentialsEmail.value = "";

    credentialsPassword.value = "";

    copyCredentialsButton.textContent = "Copy";

    cancelButton.textContent = "Close";
  }

  function closeDialog() {
    if (modal.open) {
      modal.close();
    }

    form.reset();

    clearModalMessage();
    clearFormErrors();
    resetCredentialsView();

    restaurantModal.mode = "add";

    restaurantModal.restaurantId = null;

    restaurantModal.restaurant = null;

    restaurantModal.loading = false;

    setFieldVisible(temporaryPasswordNote, true);

    approveButton.hidden = true;
    rejectButton.hidden = true;
    activateButton.hidden = true;
    deactivateButton.hidden = true;

    saveButton.hidden = false;
    saveButton.disabled = false;
    saveButton.textContent = "Create Restaurant";
  }

  /*
   * =========================================================
   * TEMPORARY PASSWORD
   * =========================================================
   *
   * The system generates the owner's first password. It is sent to
   * the backend with the new restaurant and shown to the admin once,
   * so it can be passed on. The owner changes it from their portal.
   */

  function randomInt(max) {
    const limit = Math.floor(0x100000000 / max) * max;

    const buffer = new Uint32Array(1);

    do {
      window.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);

    return buffer[0] % max;
  }

  function generateTemporaryPassword(length = 14) {
    const sets = [
      "ABCDEFGHJKLMNPQRSTUVWXYZ",
      "abcdefghijkmnopqrstuvwxyz",
      "23456789",
      "!@#$%&*?",
    ];

    const all = sets.join("");

    const pick = (chars) => chars[randomInt(chars.length)];

    const chars = sets.map(pick);

    while (chars.length < length) {
      chars.push(pick(all));
    }

    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);

      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join("");
  }

  function showCredentials(email, password) {
    restaurantModal.showingCredentials = true;

    clearModalMessage();

    formGrid.style.display = "none";

    credentialsBox.style.display = "";

    credentialsEmail.value = email;

    credentialsPassword.value = password;

    modalTitle.textContent = "Restaurant Created";

    modalSubtitle.textContent =
      "Copy the owner's sign-in details before closing.";

    saveButton.hidden = true;

    cancelButton.textContent = "Done";

    credentialsPassword.focus();

    credentialsPassword.select();
  }

  copyCredentialsButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(credentialsPassword.value);

      copyCredentialsButton.textContent = "Copied";
    } catch (error) {
      credentialsPassword.select();

      copyCredentialsButton.textContent = "Press Ctrl+C";
    }

    window.setTimeout(() => {
      copyCredentialsButton.textContent = "Copy";
    }, 1500);
  });

  /*
   * =========================================================
   * VALIDATION
   * =========================================================
   */

  function showFieldError(input, message) {
    if (!input) {
      return;
    }

    const field = input.closest(".admin-form-field");

    if (!field) {
      return;
    }

    field.classList.add("is-invalid");

    const error = field.querySelector(".admin-form-error");

    if (error) {
      error.textContent = message;
    }
  }

  function validateRequiredInput(id, label, minimumLength = 1) {
    const input = modal.querySelector(`#${id}`);

    if (!input) {
      return false;
    }

    const value = input.value.trim();

    if (value.length < minimumLength) {
      showFieldError(
        input,
        `${label} must contain at least ${minimumLength} characters.`,
      );

      return false;
    }

    return true;
  }

  function validateEmailInput(id, label) {
    const input = modal.querySelector(`#${id}`);

    if (!input) {
      return false;
    }

    const value = input.value.trim();

    if (!value || !input.validity.valid) {
      showFieldError(input, `${label} must be a valid email address.`);

      return false;
    }

    return true;
  }

  async function captureRestaurantLocation() {
    restaurantLocationError.textContent = "";
    if (!navigator.geolocation) {
      restaurantLocationError.textContent = "This browser does not support live location.";
      return;
    }

    restaurantLocationButton.disabled = true;
    restaurantLocationButton.textContent = "Getting location…";
    restaurantLocationStatus.textContent = "Allow location access when your browser asks.";

    navigator.geolocation.getCurrentPosition(async (position) => {
      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      form.elements.restaurantLatitude.value = String(latitude);
      form.elements.restaurantLongitude.value = String(longitude);
      const restaurantName = form.elements.restaurantName.value.trim();
      const firstName = restaurantName.split(/\s+/)[0] || "Restaurant";
      restaurantLocationStatus.textContent =
        `Saved as ${firstName} Location · ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      restaurantLocationButton.textContent = "Refresh Live Location";
      restaurantLocationButton.disabled = false;
    }, (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? "Location permission was denied. Enable location access in your browser and try again."
        : error.code === error.POSITION_UNAVAILABLE
          ? "Your current location is unavailable. Check device location services and retry."
          : "Location request timed out. Please try again.";
      restaurantLocationError.textContent = message;
      restaurantLocationStatus.textContent = "Restaurant location has not been selected.";
      restaurantLocationButton.textContent = "Use Live Location";
      restaurantLocationButton.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  restaurantLocationButton.addEventListener("click", captureRestaurantLocation);

  function validateRestaurantForm() {
    clearFormErrors();

    let valid = true;

    valid =
      validateRequiredInput("restaurantName", "Restaurant name", 2) && valid;

    if (
      !form.elements.restaurantLatitude.value ||
      !form.elements.restaurantLongitude.value
    ) {
      restaurantLocationError.textContent = "Restaurant location is required. Select Use Live Location and allow location access.";
      valid = false;
    }

    valid =
      validateRequiredInput("ownerFirstName", "Owner first name", 2) && valid;

    valid =
      validateRequiredInput("ownerLastName", "Owner last name", 2) && valid;

    valid = validateEmailInput("ownerEmail", "Owner email") && valid;

    if (restaurantModal.mode === "add" && !selectedRestaurantImageData) {
      restaurantImageError.textContent = "Choose a restaurant image before creating the restaurant.";
      valid = false;
    }

    const restaurantEmail = modal.querySelector("#restaurantEmail");

    if (restaurantEmail.value.trim() && !restaurantEmail.validity.valid) {
      showFieldError(restaurantEmail, "Restaurant email must be valid.");

      valid = false;
    }

    return valid;
  }

  /*
   * =========================================================
   * POPULATE MODAL
   * =========================================================
   */

  function populateRestaurantForm(restaurant) {
    setInputValue("restaurantName", restaurant.name);

    setInputValue("restaurantDescription", restaurant.description);
    selectedRestaurantImageData = "";
    restaurantImageInput.value = "";
    restaurantImagePreviewWrap.hidden = true;
    if (restaurant.logo_url && /^data:image\/(jpeg|png|webp);base64,/i.test(restaurant.logo_url)) {
      restaurantImagePreview.src = restaurant.logo_url;
      restaurantImagePreviewWrap.hidden = false;
    }

    setInputValue("restaurantPhone", restaurant.phone);

    setInputValue("restaurantEmail", restaurant.email);

    setInputValue("restaurantLatitude", restaurant.latitude);
    setInputValue("restaurantLongitude", restaurant.longitude);
    if (restaurant.latitude != null && restaurant.longitude != null) {
      restaurantLocationStatus.textContent = `Saved location: ${Number(restaurant.latitude).toFixed(6)}, ${Number(restaurant.longitude).toFixed(6)}`;
      restaurantLocationButton.textContent = "Refresh Live Location";
    } else {
      restaurantLocationStatus.textContent = "No GPS location saved. Select Use Live Location.";
      restaurantLocationButton.textContent = "Use Live Location";
    }
    restaurantLocationError.textContent = "";

    setInputValue("restaurantDeliveryFee", restaurant.delivery_fee);

    setInputValue("restaurantMinimumOrder", restaurant.minimum_order);

    setInputValue(
      "restaurantOpeningTime",
      restaurant.opening_time
        ? String(restaurant.opening_time).slice(0, 5)
        : "",
    );

    setInputValue(
      "restaurantClosingTime",
      restaurant.closing_time
        ? String(restaurant.closing_time).slice(0, 5)
        : "",
    );

    setInputValue(
      "restaurantOpen",
      Boolean(restaurant.is_open) ? "true" : "false",
    );

    setInputValue("ownerFirstName", restaurant.owner_first_name);

    setInputValue("ownerLastName", restaurant.owner_last_name);

    setInputValue("ownerEmail", restaurant.owner_email);

    setInputValue("ownerPhone", restaurant.owner_phone);
  }

  /*
   * =========================================================
   * MODAL CONFIGURATION
   * =========================================================
   */

  function configureAddModal() {
    restaurantModal.mode = "add";

    restaurantModal.restaurantId = null;

    restaurantModal.restaurant = null;

    form.reset();
    restaurantLocationStatus.textContent = "Required. Use this button and allow location access to save the restaurant's GPS coordinates.";
    restaurantLocationButton.textContent = "Use Live Location";
    restaurantLocationButton.disabled = false;
    restaurantLocationError.textContent = "";
    selectedRestaurantImageData = "";
    restaurantImagePreview.removeAttribute("src");
    restaurantImagePreviewWrap.hidden = true;
    restaurantImageError.textContent = "";

    clearFormErrors();
    clearModalMessage();
    resetCredentialsView();

    modalTitle.textContent = "Add Restaurant";

    modalSubtitle.textContent = "Create a new restaurant and owner account.";

    saveButton.textContent = "Create Restaurant";

    saveButton.hidden = false;

    setFieldVisible(temporaryPasswordNote, true);

    approveButton.hidden = true;

    rejectButton.hidden = true;

    activateButton.hidden = true;

    deactivateButton.hidden = true;

    form.elements.restaurantOpen.value = "false";

    openDialog();

    form.elements.restaurantName.focus();
  }

  function configureEditModal(restaurant) {
    restaurantModal.mode = "edit";

    restaurantModal.restaurantId = restaurant.id;

    restaurantModal.restaurant = restaurant;

    clearFormErrors();
    clearModalMessage();

    modalTitle.textContent = "View / Update Restaurant";

    modalSubtitle.textContent =
      "Review and update restaurant and owner information.";

    saveButton.textContent = "Update Restaurant";

    saveButton.hidden = false;
    saveButton.disabled = false;
    restaurantModal.loading = false;

    setFieldVisible(temporaryPasswordNote, false);

    populateRestaurantForm(restaurant);

    configureActionButtons(restaurant);

    openDialog();

    form.elements.restaurantName.focus();
  }

  function configureActionButtons(restaurant) {
    approveButton.hidden = true;

    rejectButton.hidden = true;

    activateButton.hidden = true;

    deactivateButton.hidden = true;

    if (restaurant.approval_status === "pending") {
      approveButton.hidden = false;

      rejectButton.hidden = false;

      return;
    }

    if (restaurant.approval_status === "rejected") {
      approveButton.hidden = false;

      return;
    }

    if (restaurant.approval_status === "approved" && restaurant.is_active) {
      deactivateButton.hidden = false;

      return;
    }

    if (restaurant.approval_status === "approved" && !restaurant.is_active) {
      activateButton.hidden = false;
    }
  }

  /*
   * =========================================================
   * OPEN VIEW / UPDATE MODAL
   * =========================================================
   */

  async function openRestaurantModal(restaurantId) {
    configureAddModal();

    restaurantModal.mode = "edit";

    restaurantModal.restaurantId = restaurantId;

    modalTitle.textContent = "View / Update Restaurant";

    modalSubtitle.textContent = "Loading restaurant details...";

    setFieldVisible(temporaryPasswordNote, false);

    approveButton.hidden = true;

    rejectButton.hidden = true;

    activateButton.hidden = true;

    deactivateButton.hidden = true;

    saveButton.hidden = false;

    saveButton.disabled = true;

    saveButton.textContent = "Loading...";

    openDialog();

    try {
      const response = await restaurantsApi.get(restaurantId);

      const restaurant = response?.restaurant || null;

      if (!restaurant) {
        throw new Error("Restaurant details were not returned by the server.");
      }

      restaurantModal.restaurant = restaurant;

      configureEditModal(restaurant);
    } catch (error) {
      console.error("Failed to load restaurant details:", error);

      showModalMessage(error?.message || "Could not load restaurant details.");

      saveButton.disabled = false;

      saveButton.textContent = "Update Restaurant";
    }
  }

  /*
   * =========================================================
   * CREATE / UPDATE
   * =========================================================
   */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (restaurantModal.loading) {
      return;
    }

    if (!validateRestaurantForm()) {
      return;
    }

    restaurantModal.loading = true;

    saveButton.disabled = true;

    saveButton.textContent =
      restaurantModal.mode === "add" ? "Creating..." : "Updating...";

    clearModalMessage();

    try {
      const basePayload = {
        name: form.elements.restaurantName.value.trim(),

        description: form.elements.restaurantDescription.value.trim() || null,

        logo_url: selectedRestaurantImageData || restaurantModal.restaurant?.logo_url || null,

        phone: form.elements.restaurantPhone.value.trim() || null,

        email: form.elements.restaurantEmail.value.trim() || null,

        latitude: Number(form.elements.restaurantLatitude.value),

        longitude: Number(form.elements.restaurantLongitude.value),

        delivery_fee:
          form.elements.restaurantDeliveryFee.value === ""
            ? null
            : Number(form.elements.restaurantDeliveryFee.value),

        minimum_order:
          form.elements.restaurantMinimumOrder.value === ""
            ? null
            : Number(form.elements.restaurantMinimumOrder.value),

        opening_time: form.elements.restaurantOpeningTime.value || null,

        closing_time: form.elements.restaurantClosingTime.value || null,

        is_open: form.elements.restaurantOpen.value === "true",

        owner_first_name: form.elements.ownerFirstName.value.trim(),

        owner_last_name: form.elements.ownerLastName.value.trim(),

        owner_email: form.elements.ownerEmail.value.trim(),

        owner_phone: form.elements.ownerPhone.value.trim() || null,
      };

      /*
       * -------------------------------------------------
       * CREATE
       * -------------------------------------------------
       */

      if (restaurantModal.mode === "add") {
        const temporaryPassword = generateTemporaryPassword();

        basePayload.password = temporaryPassword;

        const response = await restaurantsApi.create(basePayload);

        const restaurant = response?.restaurant || null;

        if (!restaurant) {
          throw new Error(
            "Created restaurant details were not returned by the server.",
          );
        }

        state.page = 1;

        await loadRestaurants();

        showMessage("Restaurant created successfully.");

        showCredentials(basePayload.owner_email, temporaryPassword);

        return;
      }

      /*
       * -------------------------------------------------
       * UPDATE
       * -------------------------------------------------
       */

      const restaurantId = restaurantModal.restaurantId;

      if (!restaurantId) {
        throw new Error(
          "Restaurant ID is missing. Please close the modal and try again.",
        );
      }

      const response = await restaurantsApi.update(restaurantId, basePayload);

      const updatedRestaurant = response?.restaurant || null;

      if (!updatedRestaurant) {
        throw new Error(
          "Updated restaurant details were not returned by the server.",
        );
      }

      /*
       * Store the fresh restaurant returned by the backend.
       */
      restaurantModal.restaurant = updatedRestaurant;

      /*
       * Repopulate the modal with the server's
       * actual saved values.
       */
      populateRestaurantForm(updatedRestaurant);

      configureActionButtons(updatedRestaurant);

      /*
       * Refresh the restaurant table without
       * closing the update modal.
       */
      await loadRestaurants();

      showModalMessage("Restaurant updated successfully.", "success");
    } catch (error) {
      console.error("Failed to save restaurant:", error);

      showModalMessage(error?.message || "Could not save the restaurant.");
    } finally {
      restaurantModal.loading = false;

      saveButton.disabled = false;

      saveButton.textContent =
        restaurantModal.mode === "add"
          ? "Create Restaurant"
          : "Update Restaurant";
    }
  });

  /*
   * =========================================================
   * REJECT
   * =========================================================
   */

  rejectButton.addEventListener("click", async () => {
    const restaurantId = restaurantModal.restaurantId;

    if (!restaurantId) {
      return;
    }

    const reason = window.prompt(
      "Enter the reason for rejecting this restaurant:",
    );

    if (reason === null) {
      return;
    }

    const trimmedReason = reason.trim();

    if (trimmedReason.length < 3) {
      showModalMessage("Rejection reason must contain at least 3 characters.");

      return;
    }

    try {
      rejectButton.disabled = true;

      await restaurantsApi.reject(restaurantId, trimmedReason);

      await openRestaurantModal(restaurantId);

      await loadRestaurants();

      showMessage("Restaurant rejected successfully.");
    } catch (error) {
      console.error("Failed to reject restaurant:", error);

      showModalMessage(error?.message || "Could not reject the restaurant.");
    } finally {
      rejectButton.disabled = false;
    }
  });

  /*
   * =========================================================
   * ACTIVATE
   * =========================================================
   */

  activateButton.addEventListener("click", async () => {
    const restaurantId = restaurantModal.restaurantId;

    if (!restaurantId) {
      return;
    }

    try {
      activateButton.disabled = true;

      await restaurantsApi.activate(restaurantId);

      await openRestaurantModal(restaurantId);

      await loadRestaurants();

      showMessage("Restaurant activated successfully.");
    } catch (error) {
      console.error("Failed to activate restaurant:", error);

      showModalMessage(error?.message || "Could not activate the restaurant.");
    } finally {
      activateButton.disabled = false;
    }
  });

  /*
   * =========================================================
   * DEACTIVATE
   * =========================================================
   */

  deactivateButton.addEventListener("click", async () => {
    const restaurantId = restaurantModal.restaurantId;

    if (!restaurantId) {
      return;
    }

    const confirmed = window.confirm(
      "Deactivate this restaurant? It will also be closed.",
    );

    if (!confirmed) {
      return;
    }

    try {
      deactivateButton.disabled = true;

      await restaurantsApi.deactivate(restaurantId);

      await openRestaurantModal(restaurantId);

      await loadRestaurants();

      showMessage("Restaurant deactivated successfully.");
    } catch (error) {
      console.error("Failed to deactivate restaurant:", error);

      showModalMessage(
        error?.message || "Could not deactivate the restaurant.",
      );
    } finally {
      deactivateButton.disabled = false;
    }
  });

  /*
   * =========================================================
   * MODAL CLOSE
   * =========================================================
   *
   * While the temporary password is on screen, only the Done and
   * close buttons dismiss the modal. Escape and clicks on the
   * backdrop are ignored so the password is not lost by accident.
   */

  cancelButton.addEventListener("click", closeDialog);

  modal
    .querySelector("#closeRestaurantModal")
    .addEventListener("click", closeDialog);

  modal.addEventListener("cancel", (event) => {
    event.preventDefault();

    if (restaurantModal.showingCredentials) {
      return;
    }

    closeDialog();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal && !restaurantModal.showingCredentials) {
      closeDialog();
    }
  });

  restaurantImageInput.addEventListener("change", () => {
    restaurantImageError.textContent = "";
    const file = restaurantImageInput.files?.[0];
    if (!file) {
      selectedRestaurantImageData = "";
      restaurantImagePreviewWrap.hidden = true;
      restaurantImagePreview.removeAttribute("src");
      return;
    }
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      restaurantImageInput.value = "";
      selectedRestaurantImageData = "";
      restaurantImageError.textContent = "Use a JPEG, PNG or WebP image.";
      restaurantImagePreviewWrap.hidden = true;
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      restaurantImageInput.value = "";
      selectedRestaurantImageData = "";
      restaurantImageError.textContent = "Image must be 5 MB or smaller.";
      restaurantImagePreviewWrap.hidden = true;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      selectedRestaurantImageData = String(reader.result || "");
      restaurantImagePreview.src = selectedRestaurantImageData;
      restaurantImagePreviewWrap.hidden = false;
    };
    reader.onerror = () => {
      selectedRestaurantImageData = "";
      restaurantImageError.textContent = "Could not read the selected image. Please try again.";
    };
    reader.readAsDataURL(file);
  });

  clearRestaurantImageButton.addEventListener("click", () => {
    restaurantImageInput.value = "";
    selectedRestaurantImageData = "";
    restaurantImagePreview.removeAttribute("src");
    restaurantImagePreviewWrap.hidden = true;
    restaurantImageError.textContent = restaurantModal.mode === "add"
      ? "A restaurant image is required."
      : "";
  });

  /*
   * =========================================================
   * ADD RESTAURANT
   * =========================================================
   */

  addButton.addEventListener("click", configureAddModal);

  /*
   * =========================================================
   * EXPORT
   * =========================================================
   */

  exportButton.addEventListener("click", async () => {
    try {
      exportButton.disabled = true;

      exportButton.textContent = "Exporting...";

      const allRows = [];

      let page = 1;

      let totalPages = 1;

      do {
        const response = await restaurantsApi.list({
          search: state.search,

          status: state.status,

          open: state.open,

          approval: state.approval,

          page,

          limit: 100,
        });

        if (Array.isArray(response?.restaurants)) {
          allRows.push(...response.restaurants);
        }

        totalPages = Number(response?.pagination?.totalPages || 1);

        page += 1;
      } while (page <= totalPages);

      const headers = [
        "ID",
        "Restaurant",
        "Owner",
        "Owner Email",
        "Owner Phone",
        "Restaurant Location",
        "Orders",
        "Rating",
        "Approval Status",
        "Account Status",
        "Open Status",
        "Created At",
      ];

      const rows = allRows.map((restaurant) => [
        restaurant.id,

        restaurant.name,

        getOwnerName(restaurant),

        restaurant.owner_email || "",

        restaurant.owner_phone || "",

        restaurant.location_name || `${String(restaurant.name || "Restaurant").trim().split(/\s+/)[0]} Location`,

        restaurant.orders_count || 0,

        restaurant.rating || 0,

        restaurant.approval_status || "",

        restaurant.is_active ? "Active" : "Inactive",

        restaurant.is_open ? "Open" : "Closed",

        restaurant.created_at || "",
      ]);

      const csv = [headers, ...rows]
        .map((row) =>
          row
            .map((value) => {
              const escaped = String(value ?? "").replace(/"/g, '""');

              return `"${escaped}"`;
            })
            .join(","),
        )
        .join("\n");

      const file = new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      });

      const url = URL.createObjectURL(file);

      const link = document.createElement("a");

      link.href = url;

      link.download = "restaurants.csv";

      document.body.appendChild(link);

      link.click();

      link.remove();

      URL.revokeObjectURL(url);

      showMessage("Restaurant export downloaded successfully.");
    } catch (error) {
      console.error("Restaurant export failed:", error);

      showMessage(error?.message || "Could not export restaurants.", "error");
    } finally {
      exportButton.disabled = false;

      exportButton.textContent = "Export Restaurants";
    }
  });

  /*
   * =========================================================
   * INITIAL LOAD
   * =========================================================
   */

  loadRestaurants();
});
