/* Shared admin identity loader for every admin portal page. */
(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", async () => {
    const api = window.FoodDeliveryAuthApi;
    const nameNodes = document.querySelectorAll(
      ".admin-profile-info strong, .admin-topbar-profile-info strong"
    );
    const roleNodes = document.querySelectorAll(
      ".admin-profile-info span, .admin-topbar-profile-info span"
    );
    const avatarNodes = document.querySelectorAll(
      ".admin-profile-avatar, .admin-topbar-avatar"
    );

    if (!nameNodes.length && !roleNodes.length && !avatarNodes.length) return;
    if (!api?.request || !api.getToken?.()) {
      nameNodes.forEach((node) => { node.textContent = "Unavailable"; });
      roleNodes.forEach((node) => { node.textContent = "Administrator"; });
      return;
    }

    try {
      const response = await api.request("/admins/me", { authenticated: true });
      const admin = response?.admin || response?.data?.admin || response?.data || null;
      if (!admin) throw new Error("Administrator profile was not returned.");

      const first = String(admin.first_name || admin.firstName || "").trim();
      const last = String(admin.last_name || admin.lastName || "").trim();
      const name = String(admin.name || admin.full_name || [first, last].filter(Boolean).join(" ") || admin.email || "Administrator").trim();
      const normalizedRole = String(admin.role || "admin").toLowerCase();
      const role = normalizedRole === "super_admin"
        ? "Super Admin"
        : normalizedRole === "admin"
          ? "Administrator"
          : String(admin.role || "Administrator");
      if (normalizedRole === "super_admin") {
        document.querySelectorAll('a[href="dashboard.html"]').forEach((link) => {
          link.setAttribute("href", "super-admin-dashboard.html");
        });
      }

      nameNodes.forEach((node) => { node.textContent = name; });
      roleNodes.forEach((node) => { node.textContent = role; });
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "A";
      avatarNodes.forEach((node) => {
        if (admin.avatar_url) {
          node.textContent = "";
          node.style.backgroundImage = `url("${admin.avatar_url}")`;
          node.style.backgroundSize = "cover";
          node.style.backgroundPosition = "center";
        } else {
          node.style.backgroundImage = "";
          node.textContent = initials;
        }
      });
    } catch (error) {
      console.error("Could not load shared admin header identity:", error);
      nameNodes.forEach((node) => { node.textContent = "Profile unavailable"; });
      roleNodes.forEach((node) => { node.textContent = "Administrator"; });
    }
  });
})();
