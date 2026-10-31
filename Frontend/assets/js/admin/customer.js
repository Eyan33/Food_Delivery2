/*
|--------------------------------------------------------------------------
| ADMIN CUSTOMERS PAGE
|--------------------------------------------------------------------------
| Connected customer operations:
|
| GET  /api/customers
| POST /api/customers
| GET  /api/customers/:id
| PUT  /api/customers/:id
|--------------------------------------------------------------------------
*/

(() => {
  "use strict";

  const API = window.FoodDeliveryAuthApi;

  if (!API) {
    console.error(
      "FoodDeliveryAuthApi is not available. " +
        "Make sure auth-api.js loads before customer.js.",
    );

    return;
  }

  const PAGE_SIZE = 6;

  const customerState = {
    page: 1,
    status: "all",
    search: "",
  };

  /* =========================================================
     FORMATTERS
  ========================================================= */

  const number = (value) =>
    new Intl.NumberFormat("en-KE").format(
      Number(value) || 0,
    );

  const money = (value) =>
    `KSh ${new Intl.NumberFormat("en-KE").format(
      Number(value) || 0,
    )}`;

  const initials = (name = "") =>
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) =>
        word.charAt(0).toUpperCase(),
      )
      .join("") || "C";

  const escapeHtml = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString("en-KE", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  /* =========================================================
     MESSAGE
  ========================================================= */

  let messageTimer;

  function showMessage(
    message,
    type = "success",
  ) {
    const box =
      document.getElementById(
        "adminMessage",
      );

    if (!box) {
      return;
    }

    clearTimeout(messageTimer);

    box.textContent = message;
    box.className =
      `admin-message ${type}`;

    messageTimer =
      window.setTimeout(() => {
        box.textContent = "";
        box.className =
          "admin-message";
      }, 3500);
  }

  /* =========================================================
     API
  ========================================================= */

  const customersApi = {
    async getCustomers({
      page,
      status,
      search,
    }) {
      const query =
        new URLSearchParams();

      query.set(
        "page",
        String(page || 1),
      );

      query.set(
        "limit",
        String(PAGE_SIZE),
      );

      if (
        status &&
        status !== "all"
      ) {
        query.set(
          "status",
          status,
        );
      }

      if (search) {
        query.set(
          "search",
          search,
        );
      }

      return API.request(
        `/customers?${query.toString()}`,
        {
          method: "GET",
          authenticated: true,
        },
      );
    },

    async createCustomer(data) {
      return API.request(
        "/customers",
        {
          method: "POST",
          authenticated: true,
          body: data,
        },
      );
    },

    async getCustomer(customerId) {
      return API.request(
        `/customers/${encodeURIComponent(
          customerId,
        )}`,
        {
          method: "GET",
          authenticated: true,
        },
      );
    },

    async updateCustomer(
      customerId,
      data,
    ) {
      return API.request(
        `/customers/${encodeURIComponent(
          customerId,
        )}`,
        {
          method: "PUT",
          authenticated: true,
          body: data,
        },
      );
    },

    async exportCustomers() {
      try {
        const exportLimit = 100;
        const firstResponse = await API.request(
          `/customers?${new URLSearchParams({
            page: "1",
            limit: String(exportLimit),
            ...(customerState.status && customerState.status !== "all" ? { status: customerState.status } : {}),
            ...(customerState.search ? { search: customerState.search } : {}),
          }).toString()}`,
          { method: "GET", authenticated: true },
        );
        const firstData = firstResponse || {};
        const pagination = firstData.pagination || {};
        const customers = [...(firstData.customers || [])];
        const totalPages = Math.max(1, Number(pagination.totalPages) || 1);

        for (let page = 2; page <= totalPages; page += 1) {
          const query = new URLSearchParams({ page: String(page), limit: String(exportLimit) });
          if (customerState.status && customerState.status !== "all") query.set("status", customerState.status);
          if (customerState.search) query.set("search", customerState.search);
          const response = await API.request(`/customers?${query.toString()}`, {
            method: "GET",
            authenticated: true,
          });
          customers.push(...((response && response.customers) || []));
        }

        if (!customers.length) {
          showMessage("There are no customers to export for the current filters.", "info");
          return;
        }

        const columns = [
          ["ID", (c) => c.id],
          ["First name", (c) => c.first_name],
          ["Last name", (c) => c.last_name],
          ["Email", (c) => c.email],
          ["Phone", (c) => c.phone],
          ["Status", (c) => c.is_active ? "Active" : "Inactive"],
          ["Orders", (c) => c.order_count ?? 0],
          ["Total spent (KSh)", (c) => c.total_spent ?? 0],
          ["Last order", (c) => c.last_order_at || ""],
          ["Joined", (c) => c.created_at || ""],
        ];
        const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const csv = [
          columns.map(([heading]) => csvCell(heading)).join(","),
          ...customers.map((customer) => columns.map(([, getValue]) => csvCell(getValue(customer))).join(",")),
        ].join("\r\n");
        const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showMessage(`Exported ${customers.length} customer(s) to CSV.`, "success");
      } catch (error) {
        console.error("Customer export failed:", error);
        showMessage(error.message || "Could not export customers. Please try again.", "error");
      }
    },

    async viewCustomer(
      customerId,
    ) {
      const modal =
        document.getElementById(
          "viewCustomerModal",
        );

      const loading =
        document.getElementById(
          "viewCustomerLoading",
        );

      const content =
        document.getElementById(
          "viewCustomerContent",
        );

      const errorBox =
        document.getElementById(
          "viewCustomerError",
        );

      if (!modal) {
        console.error(
          "View customer modal was not found.",
        );

        return;
      }

      modal.dataset.customerId =
        String(customerId);

      modal.classList.add(
        "is-open",
      );

      modal.setAttribute(
        "aria-hidden",
        "false",
      );

      document.body.classList.add(
        "modal-open",
      );

      if (loading) {
        loading.style.display =
          "block";
      }

      if (content) {
        content.style.display =
          "none";
      }

      if (errorBox) {
        errorBox.style.display =
          "none";

        errorBox.textContent = "";
      }

      try {
        const response =
          await customersApi.getCustomer(
            customerId,
          );

        /*
         * auth-api.js already returns
         * result.data.
         *
         * Therefore the customer is:
         *
         * response.customer
         */
        const customer =
          response?.customer ||
          null;

        if (!customer) {
          console.error(
            "Unexpected customer response:",
            response,
          );

          throw new Error(
            "Customer details were not returned by the server.",
          );
        }

        populateCustomerForm(
          customer,
        );

        if (loading) {
          loading.style.display =
            "none";
        }

        if (content) {
          content.style.display =
            "block";
        }
      } catch (error) {
        console.error(
          "Failed to load customer details:",
          error,
        );

        if (loading) {
          loading.style.display =
            "none";
        }

        if (content) {
          content.style.display =
            "none";
        }

        if (errorBox) {
          errorBox.textContent =
            error?.message ||
            "Could not load customer details.";

          errorBox.style.display =
            "block";
        }
      }
    },
  };

  /* =========================================================
     POPULATE VIEW/UPDATE FORM
  ========================================================= */

  function populateCustomerForm(
    customer,
  ) {
    const fullName =
      `${customer.first_name || ""} ${
        customer.last_name || ""
      }`.trim() ||
      "Customer Details";

    const title =
      document.getElementById(
        "viewCustomerTitle",
      );

    const subtitle =
      document.getElementById(
        "viewCustomerSubtitle",
      );

    const idInput =
      document.getElementById(
        "viewCustomerId",
      );

    const firstNameInput =
      document.getElementById(
        "viewCustomerFirstName",
      );

    const lastNameInput =
      document.getElementById(
        "viewCustomerLastName",
      );

    const emailInput =
      document.getElementById(
        "viewCustomerEmail",
      );

    const phoneInput =
      document.getElementById(
        "viewCustomerPhone",
      );

    const statusInput =
      document.getElementById(
        "viewCustomerStatus",
      );

    const createdInput =
      document.getElementById(
        "viewCustomerCreatedAt",
      );

    const updatedInput =
      document.getElementById(
        "viewCustomerUpdatedAt",
      );

    const passwordInput =
      document.getElementById(
        "viewCustomerPassword",
      );

    if (title) {
      title.textContent =
        fullName;
    }

    if (subtitle) {
      subtitle.textContent =
        customer.email ||
        "Customer account information";
    }

    if (idInput) {
      idInput.value =
        customer.id ?? "";
    }

    if (firstNameInput) {
      firstNameInput.value =
        customer.first_name ?? "";
    }

    if (lastNameInput) {
      lastNameInput.value =
        customer.last_name ?? "";
    }

    if (emailInput) {
      emailInput.value =
        customer.email ?? "";
    }

    if (phoneInput) {
      phoneInput.value =
        customer.phone ?? "";
    }

    if (statusInput) {
      statusInput.value =
        customer.is_active
          ? "active"
          : "inactive";
    }

    if (createdInput) {
      createdInput.value =
        formatDateTime(
          customer.created_at,
        );
    }

    if (updatedInput) {
      updatedInput.value =
        formatDateTime(
          customer.updated_at,
        );
    }

    if (passwordInput) {
      passwordInput.value = "";
    }
  }

  /* =========================================================
     ADMIN HEADER
  ========================================================= */

  function renderAdmin(data) {
    const admin =
      data.admin ||
      API.getCurrentUser() ||
      {};

    const firstName =
      admin.first_name ||
      admin.firstName ||
      "";

    const lastName =
      admin.last_name ||
      admin.lastName ||
      "";

    const adminName =
      admin.name ||
      `${firstName} ${lastName}`.trim() ||
      "Admin User";

    const role =
      admin.role ||
      "Administrator";

    document
      .querySelectorAll(
        ".admin-profile-info strong, " +
          ".admin-topbar-profile-info strong",
      )
      .forEach((element) => {
        element.textContent =
          adminName;
      });

    document
      .querySelectorAll(
        ".admin-profile-info span, " +
          ".admin-topbar-profile-info span",
      )
      .forEach((element) => {
        element.textContent =
          role;
      });

    document
      .querySelectorAll(
        ".admin-profile-avatar, " +
          ".admin-topbar-avatar",
      )
      .forEach((element) => {
        element.textContent =
          initials(adminName);
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
        number(
          data.notificationCount,
        );
    }
  }

  /* =========================================================
     STATISTICS
  ========================================================= */

  function renderStatistics(
    data,
  ) {
    const statistics =
      data.statistics || {};

    const cards =
      document.querySelectorAll(
        ".admin-stat-card",
      );

    const values = [
      statistics.total || 0,
      statistics.active || 0,
      statistics.new || 0,
      statistics.inactive || 0,
    ];

    cards.forEach(
      (card, index) => {
        const strong =
          card.querySelector(
            "strong",
          );

        if (strong) {
          strong.textContent =
            number(
              values[index],
            );
        }
      },
    );

    const tabCounts = {
      "All Customers":
        statistics.total || 0,

      Active:
        statistics.active || 0,

      New:
        statistics.new || 0,

      Inactive:
        statistics.inactive || 0,
    };

    document
      .querySelectorAll(
        ".admin-customer-tab",
      )
      .forEach((tab) => {
        const label =
          tab.childNodes[0]
            ?.textContent
            ?.trim() || "";

        const count =
          tab.querySelector(
            "span",
          );

        if (count) {
          count.textContent =
            number(
              tabCounts[label] || 0,
            );
        }
      });
  }

  /* =========================================================
     CUSTOMER TABLE
  ========================================================= */

  function renderCustomers(
    customers = [],
  ) {
    const tableBody =
      document.querySelector(
        ".admin-table tbody",
      );

    if (!tableBody) {
      return;
    }

    tableBody.innerHTML = "";

    if (
      !Array.isArray(
        customers,
      ) ||
      customers.length === 0
    ) {
      tableBody.innerHTML = `
        <tr>
          <td
            colspan="8"
            style="
              text-align: center;
              padding: 32px;
            "
          >
            No customers found.
          </td>
        </tr>
      `;

      return;
    }

    customers.forEach(
      (customer) => {
        const name =
          `${customer.first_name || ""} ${
            customer.last_name || ""
          }`.trim() ||
          "Customer";

        const status =
          customer.is_active
            ? "active"
            : "inactive";

        const joined =
          formatDate(
            customer.created_at,
          );

        const orders = Number(customer.order_count ?? customer.orders_count ?? 0);
        const totalSpent = Number(customer.total_spent ?? customer.totalSpent ?? 0);
        const lastOrderAt = customer.last_order_at || customer.last_order || null;

        const row =
          document.createElement(
            "tr",
          );

        row.innerHTML = `
          <td>
            <div class="admin-customer">
              <div class="admin-customer-avatar">
                ${escapeHtml(
                  initials(name),
                )}
              </div>

              <div>
                <strong>
                  ${escapeHtml(name)}
                </strong>

                <span>
                  #${escapeHtml(
                    String(
                      customer.id,
                    ),
                  )}
                </span>
              </div>
            </div>
          </td>

          <td>
            <div class="admin-customer-contact">
              <strong>
                ${escapeHtml(
                  customer.phone ||
                    "—",
                )}
              </strong>

              <span>
                ${escapeHtml(
                  customer.email ||
                    "—",
                )}
              </span>
            </div>
          </td>

          <td>
            <strong>
              ${number(orders)}
            </strong>
          </td>

          <td>
            <strong>
              ${money(totalSpent)}
            </strong>
          </td>

          <td>
            <div class="admin-last-order">
              <strong>
                ${lastOrderAt ? escapeHtml(formatDate(lastOrderAt)) : (orders > 0 ? "Date unavailable" : "No orders")}
              </strong>

              <span>
                ${lastOrderAt ? escapeHtml(formatDateTime(lastOrderAt)) : (orders > 0 ? `${number(orders)} order(s)` : "—")}
              </span>
            </div>
          </td>

          <td>
            <span
              class="admin-status ${escapeHtml(
                status,
              )}"
            >
              ${escapeHtml(
                status,
              )}
            </span>
          </td>

          <td>
            ${escapeHtml(
              joined,
            )}
          </td>

          <td>
            <button type="button" class="admin-view-button">View</button>
            <button type="button" class="admin-permanent-delete-button" data-account-id="${escapeHtml(String(customer.id))}" style="margin-left:6px;background:#a12622;color:#fff;border:0;border-radius:6px;padding:7px 9px;cursor:pointer">Delete permanently</button>
          </td>
        `;

        const viewButton =
          row.querySelector(
            ".admin-view-button",
          );

        viewButton?.addEventListener(
          "click",
          () =>
            customersApi.viewCustomer(
              customer.id,
            ),
        );

        row.querySelector(".admin-permanent-delete-button")?.addEventListener("click", () => {
          window.location.href = "deleted-accounts.html?type=customer&id=" + encodeURIComponent(customer.id);
        });

        tableBody.appendChild(
          row,
        );
      },
    );
  }

  /* =========================================================
     PAGINATION
  ========================================================= */

  function renderPagination(
    pagination = {},
  ) {
    const footer =
      document.querySelector(
        ".admin-table-footer p",
      );

    if (!footer) {
      return;
    }

    const page =
      Number(
        pagination.page,
      ) || 1;

    const totalItems =
      Number(
        pagination.totalItems,
      ) || 0;

    const totalPages =
      Math.max(
        1,
        Number(
          pagination.totalPages,
        ) || 1,
      );

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

    footer.innerHTML = `
      Showing
      <strong>
        ${start}–${end}
      </strong>
      of
      <strong>
        ${totalItems}
      </strong>
      customers
    `;

    document
      .querySelectorAll(
        ".admin-pagination-button",
      )
      .forEach((button) => {
        const label =
          button.textContent.trim();

        if (label === "‹") {
          const disabled =
            page <= 1;

          button.disabled =
            disabled;

          button.classList.toggle(
            "disabled",
            disabled,
          );
        }

        if (label === "›") {
          const disabled =
            page >= totalPages;

          button.disabled =
            disabled;

          button.classList.toggle(
            "disabled",
            disabled,
          );
        }

        if (
          /^\d+$/.test(label)
        ) {
          button.classList.toggle(
            "active",
            Number(label) ===
              page,
          );
        }
      });
  }

  /* =========================================================
     SUMMARY
  ========================================================= */

  function renderSummary(
    data,
  ) {
    const activity =
      data.activity || {};

    const cards =
      document.querySelectorAll(
        ".admin-bottom-grid " +
          ".admin-content-card",
      );

    if (cards[0]) {
      const values = [
        activity.activeToday ||
          0,

        activity.customersWithOrders ||
          0,

        activity.newRegistrations ||
          0,

        activity.inactiveCustomers ??
          data.statistics
            ?.inactive ??
          0,
      ];

      cards[0]
        .querySelectorAll(
          ".admin-summary-item strong",
        )
        .forEach(
          (
            element,
            index,
          ) => {
            element.textContent =
              number(
                values[index] ||
                  0,
              );
          },
        );
    }

    const spending =
      data.spending || {};

    if (cards[1]) {
      const average =
        cards[1].querySelector(
          ".admin-spending strong",
        );

      const monthly =
        cards[1].querySelector(
          ".admin-spending-footer strong",
        );

      const progress =
        cards[1].querySelector(
          ".admin-progress span",
        );

      if (average) {
        average.textContent =
          money(
            spending.averageOrderValue ||
              0,
          );
      }

      if (monthly) {
        monthly.textContent =
          money(
            spending.monthlyRevenue ||
              0,
          );
      }

      if (progress) {
        progress.style.width =
          `${Math.min(
            100,
            Number(
              spending.progress,
            ) || 0,
          )}%`;
      }
    }
  }

  /* =========================================================
     LOAD CUSTOMERS
  ========================================================= */

  async function loadCustomers() {
    try {
      const response =
        await customersApi.getCustomers(
          customerState,
        );

      const data =
        response || {};

      renderAdmin(data);
      renderStatistics(data);

      renderCustomers(
        data.customers || [],
      );

      renderPagination(
        data.pagination || {},
      );

      renderSummary(data);
    } catch (error) {
      console.error(
        "Could not load customers:",
        error,
      );

      showMessage(
        error.message ||
          "Could not load customers. Please try again.",
        "error",
      );
    }
  }

  /* =========================================================
     ADD CUSTOMER MODAL
  ========================================================= */

  function openAddCustomerModal() {
    const modal =
      document.getElementById(
        "addCustomerModal",
      );

    const form =
      document.getElementById(
        "addCustomerForm",
      );

    if (!modal || !form) {
      return;
    }

    modal.classList.add(
      "is-open",
    );

    modal.setAttribute(
      "aria-hidden",
      "false",
    );

    document.body.classList.add(
      "modal-open",
    );

    document
      .getElementById(
        "customerName",
      )
      ?.focus();
  }

  function closeAddCustomerModal() {
    const modal =
      document.getElementById(
        "addCustomerModal",
      );

    const form =
      document.getElementById(
        "addCustomerForm",
      );

    if (!modal || !form) {
      return;
    }

    modal.classList.remove(
      "is-open",
    );

    modal.setAttribute(
      "aria-hidden",
      "true",
    );

    document.body.classList.remove(
      "modal-open",
    );

    form.reset();

    form
      .querySelectorAll(
        ".admin-form-field",
      )
      .forEach((field) => {
        field.classList.remove(
          "is-invalid",
        );

        const error =
          field.querySelector(
            ".admin-form-error",
          );

        if (error) {
          error.textContent = "";
        }
      });
  }

  /* =========================================================
     VIEW CUSTOMER MODAL
  ========================================================= */

  function closeViewCustomerModal() {
    const modal =
      document.getElementById(
        "viewCustomerModal",
      );

    if (!modal) {
      return;
    }

    modal.classList.remove(
      "is-open",
    );

    modal.setAttribute(
      "aria-hidden",
      "true",
    );

    document.body.classList.remove(
      "modal-open",
    );
  }

  /* =========================================================
     UPDATE CUSTOMER
  ========================================================= */

  async function handleUpdateCustomer() {
    const modal =
      document.getElementById(
        "viewCustomerModal",
      );

    if (!modal) {
      return;
    }

    const customerId =
      modal.dataset.customerId;

    if (!customerId) {
      showMessage(
        "Customer ID is missing.",
        "error",
      );

      return;
    }

    const firstNameInput =
      document.getElementById(
        "viewCustomerFirstName",
      );

    const lastNameInput =
      document.getElementById(
        "viewCustomerLastName",
      );

    const emailInput =
      document.getElementById(
        "viewCustomerEmail",
      );

    const phoneInput =
      document.getElementById(
        "viewCustomerPhone",
      );

    const statusInput =
      document.getElementById(
        "viewCustomerStatus",
      );

    const passwordInput =
      document.getElementById(
        "viewCustomerPassword",
      );

    const errorBox =
      document.getElementById(
        "viewCustomerError",
      );

    const updateButton =
      document.getElementById(
        "updateCustomerButton",
      );

    const firstName =
      firstNameInput?.value.trim() ||
      "";

    const lastName =
      lastNameInput?.value.trim() ||
      "";

    const email =
      emailInput?.value.trim() ||
      "";

    const phone =
      phoneInput?.value.trim() ||
      "";

    const password =
      passwordInput?.value.trim() ||
      "";

    const isActive =
      statusInput?.value ===
      "active";

    if (!firstName) {
      showViewError(
        "First name is required.",
      );

      firstNameInput?.focus();

      return;
    }

    if (!lastName) {
      showViewError(
        "Last name is required.",
      );

      lastNameInput?.focus();

      return;
    }

    if (
      !email ||
      !emailInput?.validity.valid
    ) {
      showViewError(
        "Please provide a valid email address.",
      );

      emailInput?.focus();

      return;
    }

    if (!phone) {
      showViewError(
        "Phone number is required.",
      );

      phoneInput?.focus();

      return;
    }

    if (
      password &&
      password.length < 8
    ) {
      showViewError(
        "New password must contain at least 8 characters.",
      );

      passwordInput?.focus();

      return;
    }

    const payload = {
      first_name:
        firstName,

      last_name:
        lastName,

      email:
        email,

      phone:
        phone,

      is_active:
        isActive,
    };

    /*
     * Password is optional during
     * account updates.
     *
     * Empty password means:
     * keep the current password.
     */
    if (password) {
      payload.password =
        password;
    }

    if (updateButton) {
      updateButton.disabled =
        true;

      updateButton.textContent =
        "Updating...";
    }

    if (errorBox) {
      errorBox.style.display =
        "none";

      errorBox.textContent = "";
    }

    try {
      const response =
        await customersApi.updateCustomer(
          customerId,
          payload,
        );

      /*
       * auth-api.js already unwraps
       * response.data.
       *
       * So:
       * response.customer
       */
      const updatedCustomer =
        response?.customer ||
        null;

      if (!updatedCustomer) {
        console.error(
          "Unexpected update response:",
          response,
        );

        throw new Error(
          "Customer was updated but no customer data was returned.",
        );
      }

      /*
       * Refresh modal with the
       * saved database values.
       */
      populateCustomerForm(
        updatedCustomer,
      );

      /*
       * Refresh the table so the
       * changed name/email/phone/status
       * appears immediately.
       */
      await loadCustomers();

      showMessage(
        "Customer details updated successfully.",
        "success",
      );

      /*
       * Clear the password field
       * after a successful update.
       */
      if (passwordInput) {
        passwordInput.value = "";
      }
    } catch (error) {
      console.error(
        "Update customer failed:",
        error,
      );

      showViewError(
        error.message ||
          "Could not update customer.",
      );
    } finally {
      if (updateButton) {
        updateButton.disabled =
          false;

        updateButton.textContent =
          "Update Customer";
      }
    }
  }

  function showViewError(
    message,
  ) {
    const errorBox =
      document.getElementById(
        "viewCustomerError",
      );

    if (!errorBox) {
      showMessage(
        message,
        "error",
      );

      return;
    }

    errorBox.textContent =
      message;

    errorBox.style.display =
      "block";
  }

  /* =========================================================
     CREATE CUSTOMER
  ========================================================= */

  function validateField(
    input,
    message,
  ) {
    if (!input) {
      return true;
    }

    const field =
      input.closest(
        ".admin-form-field",
      );

    const error =
      field?.querySelector(
        ".admin-form-error",
      );

    const value =
      input.value.trim();

    let invalid =
      value.length === 0;

    if (
      input.type === "email" &&
      value
    ) {
      invalid =
        !input.validity.valid;
    }

    if (
      input.name ===
        "password" &&
      value
    ) {
      invalid =
        value.length < 8;
    }

    field?.classList.toggle(
      "is-invalid",
      invalid,
    );

    if (error) {
      error.textContent =
        invalid
          ? message
          : "";
    }

    return !invalid;
  }

  async function handleCreateCustomer(
    event,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const nameInput =
      form.elements.name;

    const emailInput =
      form.elements.email;

    const phoneInput =
      form.elements.phone;

    const passwordInput =
      form.elements.password;

    let valid = true;

    valid =
      validateField(
        nameInput,
        "Enter the customer's full name.",
      ) && valid;

    valid =
      validateField(
        emailInput,
        "Enter a valid email address.",
      ) && valid;

    valid =
      validateField(
        phoneInput,
        "Enter a phone number.",
      ) && valid;

    valid =
      validateField(
        passwordInput,
        "Password must be at least 8 characters.",
      ) && valid;

    if (!valid) {
      return;
    }

    const fullName =
      nameInput.value
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (fullName.length < 2) {
      const field =
        nameInput.closest(
          ".admin-form-field",
        );

      const error =
        field?.querySelector(
          ".admin-form-error",
        );

      field?.classList.add(
        "is-invalid",
      );

      if (error) {
        error.textContent =
          "Enter the customer's first and last name.";
      }

      return;
    }

    const firstName =
      fullName.shift();

    const lastName =
      fullName.join(" ");

    const submitButton =
      form.querySelector(
        'button[type="submit"]',
      );

    const originalText =
      submitButton?.textContent ||
      "Create Customer";

    if (submitButton) {
      submitButton.disabled =
        true;

      submitButton.textContent =
        "Creating...";
    }

    try {
      const response =
        await customersApi.createCustomer(
          {
            first_name:
              firstName,

            last_name:
              lastName,

            email:
              emailInput.value.trim(),

            phone:
              phoneInput.value.trim(),

            password:
              passwordInput.value,

            role: "customer",
          },
        );

      const createdCustomer =
        response?.customer ||
        null;

      customerState.page =
        1;

      customerState.search =
        "";

      customerState.status =
        "all";

      const searchInput =
        document.getElementById(
          "customerSearch",
        );

      if (searchInput) {
        searchInput.value =
          "";
      }

      document
        .querySelectorAll(
          ".admin-customer-tab",
        )
        .forEach(
          (
            tab,
            index,
          ) => {
            tab.classList.toggle(
              "active",
              index === 0,
            );
          },
        );

      closeAddCustomerModal();

      await loadCustomers();

      const createdName =
        createdCustomer
          ? `${createdCustomer.first_name || firstName} ${
              createdCustomer.last_name ||
              lastName
            }`.trim()
          : `${firstName} ${lastName}`;

      showMessage(
        `${createdName} was created successfully.`,
      );

      if (
        form.elements
          .sendWelcomeEmail
          ?.checked
      ) {
        console.info(
          "Welcome email requested, " +
            "but email delivery is not connected yet.",
        );
      }
    } catch (error) {
      console.error(
        "Create customer failed:",
        error,
      );

      showMessage(
        error.message ||
          "Could not create the customer.",
        "error",
      );
    } finally {
      if (submitButton) {
        submitButton.disabled =
          false;

        submitButton.textContent =
          originalText;
      }
    }
  }

  /* =========================================================
     DOM INITIALISATION
  ========================================================= */

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const searchInput =
        document.getElementById(
          "customerSearch",
        );

      const tabs =
        document.querySelectorAll(
          ".admin-customer-tab",
        );

      const paginationButtons =
        document.querySelectorAll(
          ".admin-pagination-button",
        );

      const exportButton =
        document.querySelector(
          ".admin-page-actions " +
            ".admin-secondary-button",
        );

      const addCustomerButton =
        document.querySelector(
          ".admin-page-actions " +
            ".admin-primary-button",
        );

      const addCustomerForm =
        document.getElementById(
          "addCustomerForm",
        );

      const updateCustomerButton =
        document.getElementById(
          "updateCustomerButton",
        );

      const tabStatus = {
        "All Customers":
          "all",

        Active:
          "active",

        New:
          "new",

        Inactive:
          "inactive",
      };

      let searchTimer;

      /* SEARCH */

      if (searchInput) {
        searchInput.addEventListener(
          "input",
          (event) => {
            clearTimeout(
              searchTimer,
            );

            searchTimer =
              window.setTimeout(
                () => {
                  customerState.search =
                    event.target.value.trim();

                  customerState.page =
                    1;

                  loadCustomers();
                },
                300,
              );
          },
        );
      }

      /* STATUS TABS */

      tabs.forEach((tab) => {
        tab.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            tabs.forEach(
              (item) => {
                item.classList.remove(
                  "active",
                );
              },
            );

            tab.classList.add(
              "active",
            );

            const label =
              tab.childNodes[0]
                ?.textContent
                ?.trim() || "";

            customerState.status =
              tabStatus[label] ||
              "all";

            customerState.page =
              1;

            loadCustomers();
          },
        );
      });

      /* PAGINATION */

      paginationButtons.forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              if (
                button.disabled
              ) {
                return;
              }

              const label =
                button.textContent.trim();

              if (
                label === "‹" &&
                customerState.page > 1
              ) {
                customerState.page--;
              } else if (
                label === "›"
              ) {
                customerState.page++;
              } else if (
                /^\d+$/.test(
                  label,
                )
              ) {
                customerState.page =
                  Number(label);
              } else {
                return;
              }

              loadCustomers();
            },
          );
        },
      );

      /* EXPORT */

      if (exportButton) {
        exportButton.addEventListener(
          "click",
          () => {
            customersApi.exportCustomers();
          },
        );
      }

      /* ADD CUSTOMER */

      if (addCustomerButton) {
        addCustomerButton.addEventListener(
          "click",
          openAddCustomerModal,
        );
      }

      /* ADD CUSTOMER MODAL CLOSE */

      document
        .querySelectorAll(
          "#addCustomerModal [data-close-modal]",
        )
        .forEach((button) => {
          button.addEventListener(
            "click",
            closeAddCustomerModal,
          );
        });

      /* VIEW CUSTOMER MODAL CLOSE */

      document
        .getElementById(
          "viewCustomerClose",
        )
        ?.addEventListener(
          "click",
          closeViewCustomerModal,
        );

      document
        .getElementById(
          "viewCustomerDone",
        )
        ?.addEventListener(
          "click",
          closeViewCustomerModal,
        );

      document
        .getElementById(
          "viewCustomerBackdrop",
        )
        ?.addEventListener(
          "click",
          closeViewCustomerModal,
        );

      /* UPDATE CUSTOMER */

      if (updateCustomerButton) {
        updateCustomerButton.addEventListener(
          "click",
          handleUpdateCustomer,
        );
      }

      /* ESCAPE */

      document.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key !==
            "Escape"
          ) {
            return;
          }

          const addModal =
            document.getElementById(
              "addCustomerModal",
            );

          const viewModal =
            document.getElementById(
              "viewCustomerModal",
            );

          if (
            addModal?.classList.contains(
              "is-open",
            )
          ) {
            closeAddCustomerModal();
            return;
          }

          if (
            viewModal?.classList.contains(
              "is-open",
            )
          ) {
            closeViewCustomerModal();
          }
        },
      );

      /* CREATE FORM */

      if (addCustomerForm) {
        addCustomerForm.addEventListener(
          "submit",
          handleCreateCustomer,
        );
      }

      /* INITIAL LOAD */

      loadCustomers();
    },
  );

  window.customersApi =
    customersApi;

  window.loadCustomers =
    loadCustomers;
})();
