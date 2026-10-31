(() => {
  "use strict";
  const form = document.getElementById("firstPasswordForm");
  const message = document.getElementById("passwordMessage");
  const button = document.getElementById("changePasswordButton");
  const api = window.FoodDeliveryAuthApi;
  if (!api || !api.getToken()) {
    window.location.replace("login.html");
    return;
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    if (newPassword !== confirmPassword) { message.textContent = "The new passwords do not match."; return; }
    if (newPassword === currentPassword) { message.textContent = "Choose a password different from the temporary password."; return; }
    button.disabled = true;
    message.textContent = "Updating password…";
    try {
      await api.request("/auth/me/password", {
        method: "PATCH",
        body: { currentPassword, newPassword },
        authenticated: true
      });
      const user = api.getCurrentUser();
      if (user) {
        user.must_change_password = false;
        localStorage.setItem("foodDeliveryUser", JSON.stringify(user));
        sessionStorage.setItem("foodDeliveryUser", JSON.stringify(user));
      }
      message.textContent = "Password changed. Redirecting to your portal…";
      window.setTimeout(() => window.location.replace("../admin/dashboard.html"), 700);
    } catch (error) {
      message.textContent = error.message || "Could not change the password.";
      button.disabled = false;
    }
  });
})();
