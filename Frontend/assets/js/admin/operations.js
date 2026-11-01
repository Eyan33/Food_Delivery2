document.addEventListener("DOMContentLoaded", () => {
    const API = window.FoodDeliveryAuthApi;
    const byId = (id) => document.getElementById(id);
    const message = byId("operationsMessage");

    if (!API?.request) {
        console.error("FoodDeliveryAuthApi is not available.");
        return;
    }

    const request = (path, options = {}) =>
        API.request(path, { ...options, authenticated: true });

    // Regular admins can manage platform fees. Administrator account management
    // and audit history remain super-admin-only in both UI and API.
    const signedInUser = API.getCurrentUser?.();
    if (signedInUser?.role !== "super_admin") {
        ["admins", "audit"].forEach((panelName) => {
            const tab = document.querySelector(`.operations-tabs [data-panel="${panelName}"]`);
            const panel = byId(`panel-${panelName}`);
            if (tab) tab.hidden = true;
            if (panel) panel.hidden = true;
        });
    }

    const showMessage = (text, error = false) => {
        if (!message) return;

        message.textContent = text;
        message.classList.toggle("error", error);
        message.classList.toggle("success", Boolean(text) && !error);
    };

    const listFrom = (data, name) =>
        data?.[name] || data?.data?.[name] || [];

    const money = (value) =>
        `KSh ${Number(value || 0).toLocaleString("en-KE")}`;

    let catalogCache = {
        foods: [],
        categories: [],
        restaurants: [],
    };

    let selectedRestaurantId = null;
    let currentAdminId = null;
    let foodSearchTimer = null;
    let reviewSearchTimer = null;
    let catalogEditTrigger = null;
    let platformFeeSettingsCache = {};
    let paymentSettingsCache = {};

    const listPages = {
        admins: 1,
        reviews: 1,
        audit: 1,
    };

    const listPagination = {
        admins: null,
        reviews: null,
        audit: null,
    };

    function cell(row, text) {
        const element = document.createElement("td");
        element.textContent =
            text == null || text === "" ? "—" : String(text);

        row.append(element);
        return element;
    }

    function button(label, action, secondary = false) {
        const element = document.createElement("button");

        element.type = "button";
        element.textContent = label;
        element.className = secondary
            ? "admin-secondary-button"
            : "admin-primary-button";

        element.addEventListener("click", action);

        return element;
    }

    function sameId(a, b) {
        return String(a ?? "") === String(b ?? "");
    }

    function restaurantName(restaurantId) {
        const restaurant = catalogCache.restaurants.find(
            (item) => sameId(item.id, restaurantId)
        );

        return restaurant?.name ||
            `Restaurant ${restaurantId ?? ""}`;
    }

    function restaurantFoods(restaurantId) {
        return catalogCache.foods.filter(
            (food) => sameId(food.restaurant_id, restaurantId)
        );
    }

    function restaurantCategories(restaurantId) {
        return catalogCache.categories.filter(
            (category) =>
                sameId(category.restaurant_id, restaurantId)
        );
    }

    function setRestaurantSelects(restaurantId) {
        const foodRestaurant = byId("foodRestaurant");
        const categoryRestaurant = byId("categoryRestaurant");

        if (foodRestaurant) {
            foodRestaurant.value = String(restaurantId ?? "");
        }

        if (categoryRestaurant) {
            categoryRestaurant.value = String(restaurantId ?? "");
        }

        refreshFoodCategories();
    }

    // =======================================================
    // Restaurant cards
    // =======================================================

    function renderRestaurantCards() {
        const host = byId("restaurantCards");
        if (!host) return;

        host.replaceChildren();

        if (!catalogCache.restaurants.length) {
            const empty = document.createElement("div");

            empty.className = "restaurant-cards-empty";
            empty.textContent =
                "No restaurants were found. Add or activate a restaurant first.";

            host.append(empty);
            return;
        }

        catalogCache.restaurants.forEach((restaurant) => {
            const foods = restaurantFoods(restaurant.id);
            const categories = restaurantCategories(restaurant.id);

            const card = document.createElement("button");

            card.type = "button";
            card.className = "restaurant-card";
            card.setAttribute(
                "aria-label",
                `Manage catalog for ${restaurant.name || "restaurant"}`
            );

            const icon = document.createElement("span");

            icon.className = "restaurant-card-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = "▦";

            const name = document.createElement("h4");
            name.textContent =
                restaurant.name || "Unnamed restaurant";

            const description = document.createElement("p");

            description.className = "restaurant-card-description";
            description.textContent =
                restaurant.address || "Manage foods and categories";

            const stats = document.createElement("div");
            stats.className = "restaurant-card-stats";

            const foodCount = document.createElement("span");

            foodCount.textContent =
                `${foods.length} ${
                    foods.length === 1 ? "food item" : "food items"
                }`;

            const categoryCount = document.createElement("span");

            categoryCount.textContent =
                `${categories.length} ${
                    categories.length === 1 ? "category" : "categories"
                }`;

            stats.append(foodCount, categoryCount);

            const action = document.createElement("span");

            action.className = "restaurant-card-action";
            action.textContent = "Manage catalog →";

            card.append(icon, name, description, stats, action);

            card.addEventListener("click", () => {
                selectedRestaurantId = restaurant.id;

                byId("restaurantCards").hidden = true;
                byId("restaurantCatalogWorkspace").hidden = false;

                byId("selectedRestaurantName").textContent =
                    restaurant.name || "Restaurant";

                byId("selectedRestaurantSummary").textContent =
                    "Manage food items, prices, availability, and categories for this restaurant.";

                setRestaurantSelects(restaurant.id);
                byId("foodSearch").value = "";

                renderSelectedCatalog();
                showMessage("");
            });

            host.append(card);
        });
    }

    // =======================================================
    // Food and category tables
    // =======================================================

    function renderSelectedCatalog() {
        if (selectedRestaurantId == null) return;

        const restaurantId = selectedRestaurantId;
        const foodsBody = byId("foodsBody");
        const categoriesBody = byId("categoriesBody");

        if (!foodsBody || !categoriesBody) return;

        const search = byId("foodSearch").value
            .trim()
            .toLowerCase();

        const foods = restaurantFoods(restaurantId).filter((food) =>
            String(food.name || "").toLowerCase().includes(search)
        );

        foodsBody.replaceChildren();

        foods.forEach((food) => {
            const row = document.createElement("tr");


            const foodNameCell = document.createElement("td");
            foodNameCell.className = "food-name-cell";
            if (food.image_url) {
                const thumbnail = document.createElement("img");
                thumbnail.className = "food-image-thumb";
                thumbnail.src = food.image_url;
                thumbnail.alt = "";
                thumbnail.loading = "lazy";
                thumbnail.onerror = () => thumbnail.remove();
                foodNameCell.append(thumbnail);
            }
            const foodName = document.createElement("span");
            foodName.textContent = food.name || "Unnamed food";
            foodNameCell.append(foodName);
            row.append(foodNameCell);
            cell(row, restaurantName(food.restaurant_id));
            cell(row, money(food.price));
            cell(
                row,
                food.is_available ? "Available" : "Unavailable"
            );

            const actions = document.createElement("td");

            // Open the food edit modal.
            actions.append(
                button("Edit", () => {
                    openCatalogEditModal("food", food);
                }, true)
            );

            // Toggle food availability.
            actions.append(
                button(
                    food.is_available
                        ? "Mark unavailable"
                        : "Make available",
                    async () => {
                        try {
                            await request(
                                `/foods/admin/${encodeURIComponent(food.id)}/availability`,
                                {
                                    method: "PATCH",
                                    body: {
                                        is_available: !food.is_available,
                                    },
                                }
                            );

                            await loadCatalog();
                            showMessage("Food availability updated.");
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not update availability.",
                                true
                            );
                        }
                    }
                )
            );

            // Delete food.
            actions.append(
                button(
                    "Delete",
                    async () => {
                        if (
                            !window.confirm(
                                `Delete food item "${food.name}"?`
                            )
                        ) {
                            return;
                        }

                        try {
                            await request(
                                `/foods/admin/${encodeURIComponent(food.id)}`,
                                { method: "DELETE" }
                            );

                            await loadCatalog();
                            showMessage("Food item deleted.");
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not delete food item.",
                                true
                            );
                        }
                    },
                    true
                )
            );

            row.append(actions);
            foodsBody.append(row);
        });

        if (!foods.length) {
            const row = document.createElement("tr");
            const empty = document.createElement("td");

            empty.colSpan = 5;
            empty.className = "operations-empty";
            empty.textContent = search
                ? "No food items match your search."
                : "No food items have been added to this restaurant yet.";

            row.append(empty);
            foodsBody.append(row);
        }

        // Render categories.
        const categories = restaurantCategories(restaurantId);

        categoriesBody.replaceChildren();

        categories.forEach((category) => {
            const row = document.createElement("tr");

            cell(row, category.name);
            cell(row, restaurantName(category.restaurant_id));
            cell(
                row,
                category.is_active ? "Active" : "Inactive"
            );

            const actions = document.createElement("td");

            // Open the category edit modal.
            actions.append(
                button("Edit", () => {
                    openCatalogEditModal("category", category);
                }, true)
            );

            // Delete category.
            actions.append(
                button(
                    "Delete",
                    async () => {
                        if (
                            !window.confirm(
                                `Delete category "${category.name}"?`
                            )
                        ) {
                            return;
                        }

                        try {
                            await request(
                                `/categories/admin/${encodeURIComponent(category.id)}`,
                                { method: "DELETE" }
                            );

                            await loadCatalog();
                            showMessage("Category deleted.");
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not delete category.",
                                true
                            );
                        }
                    },
                    true
                )
            );

            row.append(actions);
            categoriesBody.append(row);
        });

        if (!categories.length) {
            const row = document.createElement("tr");
            const empty = document.createElement("td");

            empty.colSpan = 4;
            empty.className = "operations-empty";
            empty.textContent =
                "No categories have been added to this restaurant yet.";

            row.append(empty);
            categoriesBody.append(row);
        }

        // Refresh restaurant card counts without leaving the workspace.
        renderRestaurantCards();

        byId("restaurantCards").hidden = true;
        byId("restaurantCatalogWorkspace").hidden = false;
    }

    // =======================================================
    // Load catalog
    // =======================================================

    async function loadCatalog() {
        const [foodData, categoryData, restaurantData] =
            await Promise.all([
                request("/foods/admin?limit=100"),
                request("/categories/admin?limit=100"),
                request("/restaurants/admin?limit=100"),
            ]);

        catalogCache = {
            foods: listFrom(foodData, "foods"),
            categories: listFrom(categoryData, "categories"),
            restaurants: listFrom(restaurantData, "restaurants"),
        };

        const restaurantOptions = catalogCache.restaurants.map(
            (restaurant) =>
                new Option(restaurant.name, restaurant.id)
        );

        [
            byId("foodRestaurant"),
            byId("categoryRestaurant"),
        ].forEach((select) => {
            if (!select) return;

            select.replaceChildren(
                ...restaurantOptions.map((option) =>
                    option.cloneNode(true)
                )
            );
        });

        renderRestaurantCards();

        if (selectedRestaurantId != null) {
            const restaurant = catalogCache.restaurants.find(
                (item) =>
                    sameId(item.id, selectedRestaurantId)
            );

            if (restaurant) {
                byId("selectedRestaurantName").textContent =
                    restaurant.name || "Restaurant";

                setRestaurantSelects(restaurant.id);
                renderSelectedCatalog();
            } else {
                selectedRestaurantId = null;

                byId("restaurantCards").hidden = false;
                byId("restaurantCatalogWorkspace").hidden = true;
            }
        } else {
            byId("restaurantCards").hidden = false;
            byId("restaurantCatalogWorkspace").hidden = true;
        }
    }

    function refreshFoodCategories() {
        const categorySelect = byId("foodCategory");
        if (!categorySelect) return;

        const previousCategory = categorySelect.value;

        const categories = selectedRestaurantId == null
            ? []
            : restaurantCategories(selectedRestaurantId);

        categorySelect.replaceChildren(
            new Option("No category", ""),
            ...categories.map(
                (category) =>
                    new Option(category.name, category.id)
            )
        );

        if (
            categories.some((category) =>
                sameId(category.id, previousCategory)
            )
        ) {
            categorySelect.value = previousCategory;
        }
    }

    // =======================================================
    // Catalog edit modal
    // =======================================================

    function openCatalogEditModal(type, item) {
        const modal = byId("catalogEditModal");
        const form = byId("catalogEditForm");
        const priceGroup = byId("catalogEditPriceGroup");
        const priceInput = byId("catalogEditPrice");
        const nameInput = byId("catalogEditName");
        const foodOptions = byId("catalogEditFoodOptions");
        const editImageInput = byId("catalogEditImage");
        const editImagePreview = byId("catalogEditImagePreview");
        const featuredInput = byId("catalogEditFeatured");

        if (
            !modal ||
            !form ||
            !priceGroup ||
            !priceInput ||
            !nameInput
        ) {
            showMessage(
                "The edit modal is missing from operations.html. Add the catalog edit modal HTML first.",
                true
            );
            return;
        }

        catalogEditTrigger = document.activeElement;

        if (!form) {
    showMessage(
        'Edit form not found. Check that operations.html contains id="catalogEditForm".',
        true
    );
    return;
}

form.reset();

        byId("catalogEditError").hidden = true;
        byId("catalogEditError").textContent = "";

        byId("catalogEditType").value = type;
        byId("catalogEditId").value = String(item.id);

        nameInput.value = item.name || "";
        if (editImageInput) editImageInput.value = "";
        if (editImagePreview) {
            editImagePreview.hidden = !item.image_url;
            editImagePreview.src = item.image_url || "";
        }
        if (foodOptions) foodOptions.hidden = type !== "food";

        if (type === "food") {
            byId("catalogEditTitle").textContent =
                "Edit food item";

            byId("catalogEditDescription").textContent =
                "Update the food name and price.";

            byId("catalogEditNameLabel").textContent =
                "Food name";

            nameInput.maxLength = 150;

            priceGroup.hidden = false;
            priceInput.required = true;
            priceInput.value = String(item.price ?? "");
            if (featuredInput) featuredInput.checked = item.is_featured === true;
        } else if (type === "category") {
            byId("catalogEditTitle").textContent =
                "Edit category";

            byId("catalogEditDescription").textContent =
                "Update the category name.";

            byId("catalogEditNameLabel").textContent =
                "Category name";

            nameInput.maxLength = 100;

            priceGroup.hidden = true;
            priceInput.required = false;
            priceInput.value = "";
        } else {
            showMessage("Invalid item type.", true);
            return;
        }

        modal.hidden = false;
        document.body.classList.add("catalog-modal-open");

        nameInput.focus();
        nameInput.select();
    }

    function closeCatalogEditModal() {
        const modal = byId("catalogEditModal");

        if (!modal || modal.hidden) return;

        modal.hidden = true;
        document.body.classList.remove("catalog-modal-open");

        byId("catalogEditForm").reset();
        byId("catalogEditError").hidden = true;
        byId("catalogEditError").textContent = "";

        if (catalogEditTrigger?.isConnected) {
            catalogEditTrigger.focus();
        }
    }

    function showCatalogEditError(text) {
        const error = byId("catalogEditError");

        error.textContent = text;
        error.hidden = false;
    }

    const catalogEditImageInput = byId("catalogEditImage");
    const catalogEditImagePreview = byId("catalogEditImagePreview");
    if (catalogEditImageInput && catalogEditImagePreview) {
        catalogEditImageInput.addEventListener("change", () => {
            const file = catalogEditImageInput.files?.[0];
            if (!file) return;
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
                file.size === 0 || file.size > 5 * 1024 * 1024) {
                catalogEditImageInput.value = "";
                showCatalogEditError("Choose a JPEG, PNG, or WebP image no larger than 5 MB.");
                return;
            }
            catalogEditImagePreview.src = URL.createObjectURL(file);
            catalogEditImagePreview.hidden = false;
            byId("catalogEditError").hidden = true;
        });
    }

    const catalogEditForm = byId("catalogEditForm");

    if (catalogEditForm) {
        catalogEditForm.addEventListener(
            "submit",
            async (event) => {
                event.preventDefault();

                const type = byId("catalogEditType").value;
                const id = byId("catalogEditId").value;
                const name = byId("catalogEditName").value.trim();
                const priceValue = byId("catalogEditPrice").value;
                const saveButton = byId("catalogEditSave");

                if (
                    type !== "food" &&
                    type !== "category"
                ) {
                    showCatalogEditError(
                        "Invalid item type."
                    );
                    return;
                }

                if (!id || !name) {
                    showCatalogEditError(
                        "Please enter a valid name."
                    );
                    return;
                }

                const body = { name };
                if (type === "food") {
                    body.is_featured = byId("catalogEditFeatured").checked;
                    const file = byId("catalogEditImage").files?.[0];
                    if (file) {
                        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
                            file.size === 0 || file.size > 5 * 1024 * 1024) {
                            showCatalogEditError("Choose a JPEG, PNG, or WebP image no larger than 5 MB.");
                            return;
                        }
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => reject(new Error("Could not read the selected image."));
                            reader.readAsDataURL(file);
                        });
                        const comma = String(dataUrl).indexOf(",");
                        if (comma < 0) {
                            showCatalogEditError("Could not prepare the selected image.");
                            return;
                        }
                        body.image_mime_type = file.type;
                        body.image_data = String(dataUrl).slice(comma + 1);
                    }
                }

                if (type === "food") {
                    if (priceValue.trim() === "") {
                        showCatalogEditError(
                            "Please enter a price."
                        );
                        return;
                    }

                    const price = Number(priceValue);

                    if (
                        !Number.isFinite(price) ||
                        price < 0
                    ) {
                        showCatalogEditError(
                            "Price must be a valid non-negative number."
                        );
                        return;
                    }

                    body.price = price;
                }

                saveButton.disabled = true;
                saveButton.textContent = "Saving...";

                byId("catalogEditCancel").disabled = true;
                byId("catalogEditClose").disabled = true;

                try {
                    const endpoint = type === "food"
                        ? `/foods/admin/${encodeURIComponent(id)}`
                        : `/categories/admin/${encodeURIComponent(id)}`;

                    await request(endpoint, {
                        method: "PUT",
                        body,
                    });

                    closeCatalogEditModal();

                    await loadCatalog();

                    showMessage(
                        type === "food"
                            ? "Food item updated successfully."
                            : "Category updated successfully."
                    );
                } catch (error) {
                    showCatalogEditError(
                        error.message ||
                            "Could not save changes. Please try again."
                    );
                } finally {
                    saveButton.disabled = false;
                    saveButton.textContent = "Save changes";

                    byId("catalogEditCancel").disabled = false;
                    byId("catalogEditClose").disabled = false;
                }
            }
        );
    }

    const catalogEditCancel = byId("catalogEditCancel");
    const catalogEditClose = byId("catalogEditClose");
    const catalogEditModal = byId("catalogEditModal");

    if (catalogEditCancel) {
        catalogEditCancel.addEventListener(
            "click",
            closeCatalogEditModal
        );
    }

    if (catalogEditClose) {
        catalogEditClose.addEventListener(
            "click",
            closeCatalogEditModal
        );
    }

    if (catalogEditModal) {
        catalogEditModal.addEventListener(
            "click",
            (event) => {
                if (
                    event.target.matches("[data-close-modal]")
                ) {
                    closeCatalogEditModal();
                }
            }
        );
    }

    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            catalogEditModal &&
            !catalogEditModal.hidden
        ) {
            closeCatalogEditModal();
        }
    });

    // =======================================================
    // Pagination
    // =======================================================

    function renderPager(key, elementId) {
        const host = byId(elementId);
        if (!host) return;

        host.replaceChildren();

        const pagination = listPagination[key];

        if (
            !pagination ||
            Number(pagination.totalPages || 1) <= 1
        ) {
            if (
                pagination &&
                Number(pagination.totalItems || 0) > 0
            ) {
                host.textContent =
                    `${pagination.totalItems} records`;
            }

            return;
        }

        const label = document.createElement("span");

        label.textContent =
            `Page ${pagination.page} of ${pagination.totalPages} · ${pagination.totalItems} records`;

        const previous = button(
            "Previous",
            async () => {
                if (listPages[key] > 1) {
                    listPages[key]--;
                    await loadPage(key);
                }
            },
            true
        );

        previous.disabled =
            Number(pagination.page) <= 1;

        const next = button(
            "Next",
            async () => {
                if (
                    listPages[key] <
                    Number(pagination.totalPages)
                ) {
                    listPages[key]++;
                    await loadPage(key);
                }
            },
            true
        );

        next.disabled =
            Number(pagination.page) >=
            Number(pagination.totalPages);

        host.append(label, previous, next);
    }

    async function loadPage(key) {
        try {
            if (key === "admins") await loadAdmins();
            if (key === "reviews") await loadReviews();
            if (key === "audit") await loadAudit();
        } catch (error) {
            showMessage(
                error.message || "Could not load this page.",
                true
            );
        }
    }

    // =======================================================
    // Administrator accounts
    // =======================================================

    async function loadAdmins() {
        const data = await request(
            `/admins?page=${listPages.admins}&limit=25`
        );

        const admins = listFrom(data, "admins");

        listPagination.admins =
            data?.data?.pagination ||
            data?.pagination ||
            null;

        renderPager("admins", "adminsPager");

        const body = byId("adminsBody");
        body.replaceChildren();

        admins.forEach((admin) => {
            const row = document.createElement("tr");

            cell(
                row,
                `${admin.first_name} ${admin.last_name}`
            );

            cell(row, admin.email);
            cell(row, admin.phone);
            cell(
                row,
                admin.is_active ? "Active" : "Inactive"
            );

            const actions = document.createElement("td");

            actions.append(
                button("Edit", async () => {
                    const firstName = window.prompt("First name:", admin.first_name || "");
                    if (firstName === null) return;
                    const lastName = window.prompt("Last name:", admin.last_name || "");
                    if (lastName === null) return;
                    const email = window.prompt("Email address:", admin.email || "");
                    if (email === null) return;
                    const phone = window.prompt("Phone number (optional):", admin.phone || "");
                    if (phone === null) return;
                    try {
                        await request(`/admins/${encodeURIComponent(admin.id)}`, {
                            method: "PUT",
                            body: {
                                first_name: firstName.trim(),
                                last_name: lastName.trim(),
                                email: email.trim(),
                                phone: phone.trim() || null
                            }
                        });
                        await loadAdmins();
                        showMessage("Administrator details updated.");
                    } catch (error) {
                        showMessage(error.message || "Could not update administrator.", true);
                    }
                }, true)
            );

            actions.append(
                button("Reset password", async () => {
                    const password = window.prompt("Enter a new temporary password (at least 8 characters):");
                    if (password === null) return;
                    if (password.length < 8) {
                        showMessage("Temporary password must contain at least 8 characters.", true);
                        return;
                    }
                    try {
                        await request(`/admins/${encodeURIComponent(admin.id)}`, {
                            method: "PUT",
                            body: { password }
                        });
                        showMessage("Password reset. The administrator must change it at next sign-in.");
                    } catch (error) {
                        showMessage(error.message || "Could not reset administrator password.", true);
                    }
                }, true)
            );

            if (admin.is_active) {
                const isSelf =
                    currentAdminId != null &&
                    sameId(admin.id, currentAdminId);

                const deactivate = button(
                    isSelf ? "Your account" : "Deactivate",
                    async () => {
                        if (isSelf) return;

                        if (
                            !window.confirm(
                                `Deactivate ${admin.email}?`
                            )
                        ) {
                            return;
                        }

                        try {
                            await request(
                                `/admins/${encodeURIComponent(admin.id)}`,
                                { method: "DELETE" }
                            );

                            await loadAdmins();
                            showMessage(
                                "Administrator deactivated."
                            );
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not deactivate administrator.",
                                true
                            );
                        }
                    },
                    true
                );

                deactivate.disabled = isSelf;

                if (isSelf) {
                    deactivate.title =
                        "You cannot deactivate the currently signed-in account.";
                }

                actions.append(deactivate);
            } else {
                actions.append(
                    button("Activate", async () => {
                        try {
                            await request(
                                `/admins/${encodeURIComponent(admin.id)}/activate`,
                                { method: "PATCH" }
                            );

                            await loadAdmins();
                            showMessage(
                                "Administrator activated."
                            );
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not activate administrator.",
                                true
                            );
                        }
                    })
                );
            }

            row.append(actions);
            body.append(row);
        });

        if (!admins.length) {
            const row = document.createElement("tr");
            const empty = document.createElement("td");

            empty.colSpan = 5;
            empty.className = "operations-empty";
            empty.textContent =
                "No administrator accounts found.";

            row.append(empty);
            body.append(row);
        }
    }

    // =======================================================
    // Reviews
    // =======================================================

    async function loadReviews() {
        const params = new URLSearchParams({
            page: String(listPages.reviews),
            limit: "25",
            visibility: byId("reviewVisibility").value,
            search: byId("reviewSearch").value.trim(),
        });

        const data = await request(
            `/admins/reviews?${params}`
        );

        const reviews = listFrom(data, "reviews");

        listPagination.reviews =
            data?.data?.pagination ||
            data?.pagination ||
            null;

        renderPager("reviews", "reviewsPager");

        const body = byId("reviewsBody");
        body.replaceChildren();

        reviews.forEach((review) => {
            const row = document.createElement("tr");

            cell(row, review.customer_name);
            cell(row, review.restaurant_name);
            cell(row, `${review.rating} / 5`);
            cell(row, review.comment);

            cell(
                row,
                review.created_at
                    ? new Date(review.created_at).toLocaleDateString()
                    : "—"
            );

            cell(
                row,
                review.is_visible ? "Visible" : "Hidden"
            );

            const actions = document.createElement("td");

            actions.append(
                button(
                    review.is_visible ? "Hide" : "Restore",
                    async () => {
                        try {
                            await request(
                                `/admins/reviews/${encodeURIComponent(review.id)}/visibility`,
                                {
                                    method: "PATCH",
                                    body: {
                                        is_visible: !review.is_visible,
                                    },
                                }
                            );

                            await loadReviews();

                            showMessage(
                                review.is_visible
                                    ? "Review hidden from customers."
                                    : "Review restored."
                            );
                        } catch (error) {
                            showMessage(
                                error.message ||
                                    "Could not update review visibility.",
                                true
                            );
                        }
                    },
                    review.is_visible
                )
            );

            row.append(actions);
            body.append(row);
        });

        if (!reviews.length) {
            const row = document.createElement("tr");
            const empty = document.createElement("td");

            empty.colSpan = 7;
            empty.className = "operations-empty";
            empty.textContent =
                "No reviews match this filter.";

            row.append(empty);
            body.append(row);
        }
    }

    // =======================================================
    // Audit history
    // =======================================================

    async function loadAudit() {
        const data = await request(
            `/admins/audit-logs?page=${listPages.audit}&limit=25`
        );

        const logs = listFrom(data, "logs");

        listPagination.audit =
            data?.data?.pagination ||
            data?.pagination ||
            null;

        renderPager("audit", "auditPager");

        const body = byId("auditBody");
        body.replaceChildren();

        logs.forEach((log) => {
            const row = document.createElement("tr");

            cell(
                row,
                log.created_at
                    ? new Date(log.created_at).toLocaleString()
                    : "—"
            );

            cell(
                row,
                log.admin_name ||
                    log.admin_email ||
                    "Admin removed"
            );

            cell(row, log.action);
            cell(row, log.resource);

            const statusCode = Number(log.status_code);

            cell(
                row,
                `${
                    statusCode >= 200 && statusCode < 400
                        ? "Success"
                        : "Failed"
                } (${statusCode})`
            );

            body.append(row);
        });

        if (!logs.length) {
            const row = document.createElement("tr");
            const empty = document.createElement("td");

            empty.colSpan = 5;
            empty.className = "operations-empty";
            empty.textContent =
                "No recorded admin changes yet.";

            row.append(empty);
            body.append(row);
        }
    }

    // =======================================================
    // Add food
    // =======================================================

    const foodImageInput = byId("foodImage");
    const foodImagePreview = byId("foodImagePreview");
    let foodImagePreviewUrl = null;

    foodImageInput.addEventListener("change", () => {
        const file = foodImageInput.files?.[0];
        if (foodImagePreviewUrl) URL.revokeObjectURL(foodImagePreviewUrl);
        foodImagePreviewUrl = null;
        foodImagePreview.removeAttribute("src");
        foodImagePreview.hidden = true;
        if (!file) return;

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(file.type)) {
            foodImageInput.value = "";
            showMessage("Choose a JPEG, PNG, or WebP image.", true);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            foodImageInput.value = "";
            showMessage("Food image must be 5 MB or smaller.", true);
            return;
        }

        foodImagePreviewUrl = URL.createObjectURL(file);
        foodImagePreview.src = foodImagePreviewUrl;
        foodImagePreview.hidden = false;
        showMessage("");
    });

    byId("foodForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        // currentTarget is only populated while the event handler is running.
        // Keep the form reference because this handler awaits image reading/API calls.
        const form = event.currentTarget;

        if (selectedRestaurantId == null) {
            showMessage("Select a restaurant first.", true);
            return;
        }

        const name = byId("foodName").value.trim();
        const priceValue = byId("foodPrice").value;
        const price = Number(priceValue);
        const preparation = byId("foodPrep").value;
        const imageFile = foodImageInput.files?.[0];

        if (!imageFile) {
            showMessage("A food image is required before creating the item.", true);
            foodImageInput.focus();
            return;
        }
        if (!["image/jpeg", "image/png", "image/webp"].includes(imageFile.type) ||
            imageFile.size === 0 || imageFile.size > 5 * 1024 * 1024) {
            showMessage("Choose a valid JPEG, PNG, or WebP image no larger than 5 MB.", true);
            return;
        }
        if (!name || priceValue.trim() === "" || !Number.isFinite(price) || price < 0) {
            showMessage("Enter a food name and a valid price.", true);
            return;
        }

        const submitButton = event.currentTarget.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = "Saving food…";

        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("Could not read the selected image."));
                reader.readAsDataURL(imageFile);
            });
            const comma = String(dataUrl).indexOf(",");
            if (comma < 0) throw new Error("Could not prepare the selected image.");

            await request("/foods/admin", {
                method: "POST",
                body: {
                    restaurant_id: Number(selectedRestaurantId),
                    category_id: byId("foodCategory").value
                        ? Number(byId("foodCategory").value)
                        : null,
                    name,
                    price,
                    preparation_time: preparation ? Number(preparation) : null,
                    image_mime_type: imageFile.type,
                    image_data: String(dataUrl).slice(comma + 1),
                },
            });

            form.reset();
            foodImagePreview.hidden = true;
            foodImagePreview.removeAttribute("src");
            if (foodImagePreviewUrl) URL.revokeObjectURL(foodImagePreviewUrl);
            foodImagePreviewUrl = null;

            setRestaurantSelects(selectedRestaurantId);
            await loadCatalog();
            showMessage("Food item and image saved successfully.");
        } catch (error) {
            showMessage(error.message || "Could not create food item.", true);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Add food";
        }
    });

    // =======================================================
    // Add category
    // =======================================================

    byId("categoryForm").addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();
            // Keep the form reference across awaited API calls; event.currentTarget
            // is cleared by the browser once the synchronous event dispatch ends.
            const form = event.currentTarget;

            if (selectedRestaurantId == null) {
                showMessage(
                    "Select a restaurant first.",
                    true
                );
                return;
            }

            const name =
                byId("categoryName").value.trim();

            if (!name) {
                showMessage(
                    "Enter a category name.",
                    true
                );
                return;
            }

            try {
                await request("/categories/admin", {
                    method: "POST",
                    body: {
                        restaurant_id:
                            Number(selectedRestaurantId),
                        name,
                    },
                });

                form.reset();

                setRestaurantSelects(
                    selectedRestaurantId
                );

                await loadCatalog();
                showMessage("Category created.");
            } catch (error) {
                showMessage(
                    error.message ||
                        "Could not create category.",
                    true
                );
            }
        }
    );

    // =======================================================
    // Create administrator
    // =======================================================

    byId("adminForm").addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();

            try {
                await request("/admins", {
                    method: "POST",
                    body: {
                        first_name:
                            byId("newAdminFirst").value.trim(),

                        last_name:
                            byId("newAdminLast").value.trim(),

                        email:
                            byId("newAdminEmail").value.trim(),

                        phone:
                            byId("newAdminPhone").value.trim() ||
                            null,

                        password:
                            byId("newAdminPassword").value,
                    },
                });

                event.currentTarget.reset();

                await loadAdmins();

                showMessage(
                    "Administrator account created."
                );
            } catch (error) {
                showMessage(
                    error.message ||
                        "Could not create administrator.",
                    true
                );
            }
        }
    );

    // =======================================================
    // Return to restaurant cards
    // =======================================================

    byId("backToRestaurants").addEventListener(
        "click",
        () => {
            selectedRestaurantId = null;

            byId("restaurantCatalogWorkspace").hidden = true;
            byId("restaurantCards").hidden = false;
            byId("foodSearch").value = "";

            showMessage("");
        }
    );

    // =======================================================
    // Platform fee settings
    // =======================================================

    async function loadPlatformFees() {
        const transactionInput = byId("platformTransactionFee");
        const rateInput = byId("deliveryFeePerKm");
        const saveButton = byId("savePlatformFee");
        if (!transactionInput || !rateInput) return;
        if (saveButton) saveButton.disabled = true;
        try {
            const response = await request("/admins/settings");
            const settings = (response?.data || response)?.settings || {};
            platformFeeSettingsCache = settings.platformFees && typeof settings.platformFees === "object" ? { ...settings.platformFees } : {};
            paymentSettingsCache = settings.payments && typeof settings.payments === "object" ? { ...settings.payments } : {};
            transactionInput.value = String(paymentSettingsCache.transactionFee ?? 5);
            rateInput.value = String(platformFeeSettingsCache.deliveryFeePerKm ?? 0);
            showMessage("");
        } catch (error) {
            showMessage(error.message || "Could not load platform fee settings.", true);
        } finally { if (saveButton) saveButton.disabled = false; }
    }

    async function savePlatformFees(event) {
        event.preventDefault();
        const transactionInput = byId("platformTransactionFee");
        const rateInput = byId("deliveryFeePerKm");
        const saveButton = byId("savePlatformFee");
        const transactionFee = Number(transactionInput?.value);
        const deliveryFeePerKm = Number(rateInput?.value);
        if (!Number.isFinite(transactionFee) || transactionFee < 0 || transactionFee > 100) {
            showMessage("Platform transaction fee must be between 0 and 100 percent.", true);
            transactionInput?.focus(); return;
        }
        if (!Number.isFinite(deliveryFeePerKm) || deliveryFeePerKm < 0) {
            showMessage("Delivery charge per kilometre must be zero or greater.", true);
            rateInput?.focus(); return;
        }
        if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Saving…"; }
        try {
            const payments = { ...paymentSettingsCache, transactionFee };
            const platformFees = { ...platformFeeSettingsCache, deliveryFeePerKm };
            const response = await request("/admins/settings", { method: "PUT", body: { payments, platformFees } });
            const savedPayments = response?.data?.settings?.payments || payments;
            const savedPlatformFees = response?.data?.settings?.platformFees || platformFees;
            paymentSettingsCache = { ...savedPayments };
            platformFeeSettingsCache = { ...savedPlatformFees };
            transactionInput.value = String(savedPayments.transactionFee ?? transactionFee);
            rateInput.value = String(savedPlatformFees.deliveryFeePerKm ?? deliveryFeePerKm);
            showMessage("Platform fees saved successfully.");
        } catch (error) {
            showMessage(error.message || "Could not save platform fees.", true);
        } finally {
            if (saveButton) { saveButton.disabled = false; saveButton.textContent = "Save platform fees"; }
        }
    }

    byId("platformFeeForm")?.addEventListener("submit", savePlatformFees);

    // =======================================================
    // Tabs
    // =======================================================

    document
        .querySelectorAll(".operations-tabs button")
        .forEach((tab) => {
            tab.addEventListener(
                "click",
                async () => {
                    document
                        .querySelectorAll(".operations-tabs button")
                        .forEach((item) => {
                            item.classList.toggle(
                                "active",
                                item === tab
                            );
                        });

                    document
                        .querySelectorAll(".operations-panel")
                        .forEach((panel) => {
                            panel.hidden =
                                panel.id !==
                                `panel-${tab.dataset.panel}`;
                        });

                    try {
                        if (tab.dataset.panel === "catalog") {
                            await loadCatalog();
                        }

                        if (tab.dataset.panel === "platform-fees") {
                            await loadPlatformFees();
                        }

                        if (tab.dataset.panel === "admins") {
                            await loadAdmins();
                        }

                        if (tab.dataset.panel === "reviews") {
                            await loadReviews();
                        }

                        if (tab.dataset.panel === "audit") {
                            await loadAudit();
                        }
                    } catch (error) {
                        showMessage(
                            error.message ||
                                "Could not load operations data.",
                            true
                        );
                    }
                }
            );
        });

    // =======================================================
    // Refresh and search handlers
    // =======================================================

    byId("foodSearch").addEventListener(
        "input",
        () => {
            clearTimeout(foodSearchTimer);

            foodSearchTimer = setTimeout(() => {
                renderSelectedCatalog();
            }, 200);
        }
    );

    byId("refreshCatalog").addEventListener(
        "click",
        () => {
            loadCatalog().catch((error) => {
                showMessage(
                    error.message ||
                        "Could not refresh catalog.",
                    true
                );
            });
        }
    );

    byId("reviewVisibility").addEventListener(
        "change",
        () => {
            listPages.reviews = 1;

            loadReviews().catch((error) => {
                showMessage(error.message, true);
            });
        }
    );

    byId("reviewSearch").addEventListener(
        "input",
        () => {
            listPages.reviews = 1;
            clearTimeout(reviewSearchTimer);

            reviewSearchTimer = setTimeout(() => {
                loadReviews().catch((error) => {
                    showMessage(error.message, true);
                });
            }, 300);
        }
    );

    byId("refreshReviews").addEventListener(
        "click",
        () => {
            loadReviews().catch((error) => {
                showMessage(error.message, true);
            });
        }
    );

    byId("refreshAudit").addEventListener(
        "click",
        () => {
            loadAudit().catch((error) => {
                showMessage(error.message, true);
            });
        }
    );

    // Load the signed-in administrator ID for self-deactivation protection.
    request("/admins/me")
        .then((data) => {
            const admin =
                data?.data?.admin || data?.admin;

            currentAdminId = admin?.id ?? null;
        })
        .catch(() => {
            // Keep the rest of the Operations page usable if this lookup fails.
        });

    // Initial catalog load.
    loadCatalog().catch((error) => {
        showMessage(
            error.message ||
                "Could not load catalog data.",
            true
        );
    });
});
