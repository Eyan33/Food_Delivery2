(() => {
"use strict";
// ============================================
//                 ADMIN GLOBAL
// ============================================

const adminSidebar = document.getElementById("adminSidebar");
const adminMenuButton = document.getElementById("adminMenuButton");

// Only expose the Admin Accounts navigation entry to a Super Admin.
// Backend middleware independently enforces access to every management endpoint.
if (adminSidebar) {
    try {
        const rawUser = localStorage.getItem("foodDeliveryUser") || sessionStorage.getItem("foodDeliveryUser");
        const currentUser = rawUser ? JSON.parse(rawUser) : null;
        const navigation = adminSidebar.querySelector(".admin-navigation");
        if (currentUser?.role === "super_admin" && navigation &&
            !navigation.querySelector('a[href="admins.html"]')) {
            const link = document.createElement("a");
            link.href = "admins.html";
            link.className = "admin-nav-link";
            link.innerHTML = '<span class="admin-nav-icon" aria-hidden="true">♙</span><span>Admin Accounts</span>';
            navigation.appendChild(link);
        }
    } catch (error) {
        console.warn("Could not initialize Super Admin navigation:", error);
    }
}
const adminCloseMenuButton = document.getElementById(
    "adminCloseMenuButton",
);

if (adminSidebar && adminMenuButton) {
    adminMenuButton.addEventListener("click", () => {
        adminSidebar.classList.toggle("open");

        const isOpen =
            adminSidebar.classList.contains("open");

        adminMenuButton.setAttribute(
            "aria-expanded",
            String(isOpen),
        );
    });
}

if (adminSidebar && adminCloseMenuButton) {
    adminCloseMenuButton.addEventListener("click", () => {
        adminSidebar.classList.remove("open");

        adminMenuButton?.setAttribute(
            "aria-expanded",
            "false",
        );
    });
}


// Close admin sidebar when clicking outside it.

document.addEventListener("click", (event) => {
    if (!adminSidebar || !adminMenuButton) {
        return;
    }

    const target = event.target;

    const clickedInsideSidebar =
        adminSidebar.contains(target);

    const clickedMenuButton =
        adminMenuButton.contains(target);

    const sidebarIsOpen =
        adminSidebar.classList.contains("open");

    if (
        sidebarIsOpen &&
        !clickedInsideSidebar &&
        !clickedMenuButton
    ) {
        adminSidebar.classList.remove("open");

        adminMenuButton.setAttribute(
            "aria-expanded",
            "false",
        );
    }
});


// Customer mobile navigation is handled by customer/mobile-navigation.js.


// ============================================
//                RIDER GLOBAL
// ============================================

const riderSidebar =
    document.getElementById("riderSidebar");

const riderMenuButton =
    document.getElementById("riderMenuButton");

if (riderMenuButton && riderSidebar) {
    riderMenuButton.addEventListener("click", () => {
        riderSidebar.classList.toggle("open");

        const isOpen =
            riderSidebar.classList.contains("open");

        riderMenuButton.setAttribute(
            "aria-expanded",
            String(isOpen),
        );
    });

    document.addEventListener("click", (event) => {
        const target = event.target;

        const clickedInsideSidebar =
            riderSidebar.contains(target);

        const clickedMenuButton =
            riderMenuButton.contains(target);

        const sidebarIsOpen =
            riderSidebar.classList.contains("open");

        if (
            sidebarIsOpen &&
            !clickedInsideSidebar &&
            !clickedMenuButton
        ) {
            riderSidebar.classList.remove("open");

            riderMenuButton.setAttribute(
                "aria-expanded",
                "false",
            );
        }
    });
}


// ============================================
//              RESTAURANT GLOBAL
// ============================================

const restaurantSidebar =
    document.getElementById("restaurantSidebar");

const restaurantMenuButton =
    document.getElementById(
        "restaurantMenuButton",
    );

if (
    restaurantMenuButton &&
    restaurantSidebar
) {
    restaurantMenuButton.addEventListener(
        "click",
        () => {
            restaurantSidebar.classList.toggle(
                "open",
            );

            const isOpen =
                restaurantSidebar.classList.contains(
                    "open",
                );

            restaurantMenuButton.setAttribute(
                "aria-expanded",
                String(isOpen),
            );
        },
    );

    document.addEventListener("click", (event) => {
        const target = event.target;

        const clickedInsideSidebar =
            restaurantSidebar.contains(target);

        const clickedMenuButton =
            restaurantMenuButton.contains(target);

        const sidebarIsOpen =
            restaurantSidebar.classList.contains(
                "open",
            );

        if (
            sidebarIsOpen &&
            !clickedInsideSidebar &&
            !clickedMenuButton
        ) {
            restaurantSidebar.classList.remove(
                "open",
            );

            restaurantMenuButton.setAttribute(
                "aria-expanded",
                "false",
            );
        }
    });
}

// ============================================
document.addEventListener("DOMContentLoaded", () => {
    const api = window.FoodDeliveryAuthApi;
    document.querySelectorAll('.admin-sidebar-footer a[href="../../index.html"]').forEach((link) => {
        link.addEventListener("click", () => api?.clearSession?.());
    });
});

})();
