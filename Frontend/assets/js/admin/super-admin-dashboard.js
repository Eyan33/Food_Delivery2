(() => {
  "use strict";
  const showDashboardMessage = (message) => {
    document.documentElement.style.visibility = "visible";
    let notice = document.getElementById("superAdminAccessMessage");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "superAdminAccessMessage";
      notice.setAttribute("role", "alert");
      notice.style.cssText = "margin:24px;padding:16px;border:1px solid #d97706;border-radius:8px;background:#fffbeb;color:#78350f";
      const main = document.querySelector("main");
      if (main) main.prepend(notice);
      else document.body.prepend(notice);
    }
    notice.textContent = message;
  };
  document.documentElement.style.visibility = "hidden";
  document.addEventListener("DOMContentLoaded", async () => {
    const api = window.FoodDeliveryAuthApi;
    if (!api || !api.getToken || !api.getToken()) {
      window.location.replace("../../pages/auth/login.html");
      return;
    }
    const cachedUser = api.getCurrentUser ? api.getCurrentUser() : null;
    if (cachedUser && cachedUser.role && cachedUser.role !== "super_admin") {
      window.location.replace(cachedUser.role === "admin" ? "dashboard.html" : "../../pages/auth/login.html");
      return;
    }
    try {
      const response = await api.request("/auth/me", { authenticated: true });
      const user = response && (response.user || response.data?.user);
      if (!user || user.role !== "super_admin") {
        window.location.replace(user?.role === "admin" ? "dashboard.html" : "../../pages/auth/login.html");
        return;
      }
      document.documentElement.style.visibility = "visible";
    } catch (error) {
      const message = String(error && error.message || "");
      if (/change your temporary password|password change required/i.test(message)) {
        window.location.replace("../../pages/auth/change-first-password.html");
        return;
      }
      // auth-api.js already clears and redirects for an actual 401. Do not
      // discard a valid login because of a 403, API outage, or server error.
      showDashboardMessage(message || "Could not verify your super-admin access. Please refresh or try again.");
    }
  });
})();