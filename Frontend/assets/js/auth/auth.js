const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberMeInput = document.getElementById("rememberMe");
const loginMessage = document.getElementById("loginMessage");
const loginButton = document.getElementById("loginButton");

function setLoginMessage(message, type) {
    loginMessage.textContent = message;
    loginMessage.classList.toggle("success", type === "success");
    loginMessage.classList.toggle("error", type === "error");
}

function destinationForRole(role) {
    const destinations = {
        customer: "../customer/home.html",
        restaurant: "../restaurant/dashboard.html",
        rider: "../rider/dashboard.html",
        admin: "../admin/dashboard.html",
        super_admin: "../admin/super-admin-dashboard.html",
    };

    return destinations[String(role || "").toLowerCase()] || "../../index.html";
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginMessage("", "");
    loginButton.disabled = true;
    loginButton.textContent = "Signing in…";

    try {
        const session = await window.FoodDeliveryAuthApi.request("/auth/login", {
            method: "POST",
            body: {
                email: emailInput.value.trim(),
                password: passwordInput.value,
            },
        });

        window.FoodDeliveryAuthApi.saveSession(session, rememberMeInput.checked);
        setLoginMessage("Login successful. Redirecting…", "success");
        window.setTimeout(() => {
            window.location.href = session.user.must_change_password ? "change-first-password.html" : destinationForRole(session.user.role);
        }, 500);
    } catch (error) {
        setLoginMessage(error.message || "Unable to log in. Please try again.", "error");
        loginButton.disabled = false;
        loginButton.textContent = "Login";
    }
});

async function initializeGoogleSignIn() {
    const container = document.getElementById("googleSignInButton");
    if (!container) return;
    try {
        const apiBase = String(window.FOOD_DELIVERY_API_BASE || "https://food-delivery-tcwn.onrender.com/api").replace(/\/+$/, "");
        const configResponse = await fetch(apiBase + "/auth/google-config", { headers: { Accept: "application/json" } });
        const config = await configResponse.json();
        const clientId = config && config.data && config.data.clientId;
        if (!configResponse.ok || !clientId) throw new Error("Google sign-in is not configured for this site.");
        let attempts = 0;
        while ((!window.google || !window.google.accounts || !window.google.accounts.id) && attempts < 50) {
            await new Promise(resolve => window.setTimeout(resolve, 100)); attempts += 1;
        }
        if (!window.google || !window.google.accounts || !window.google.accounts.id) throw new Error("Google sign-in could not load. Check your connection and try again.");
        window.google.accounts.id.initialize({
            client_id: clientId,
            callback: async (response) => {
                setLoginMessage("", "");
                try {
                    const session = await window.FoodDeliveryAuthApi.request("/auth/google", { method: "POST", body: { credential: response.credential } });
                    window.FoodDeliveryAuthApi.saveSession(session, true);
                    if (session.newGoogleAccount === true) sessionStorage.setItem("foodDeliveryGooglePasswordSetupPending", "true");
                    setLoginMessage("Google sign-in successful. Redirecting…", "success");
                    window.setTimeout(() => { window.location.href = session.user.must_change_password ? "change-first-password.html" : destinationForRole(session.user.role); }, 400);
                } catch (error) { setLoginMessage(error.message || "Google sign-in failed. Please try again.", "error"); }
            }
        });
        window.google.accounts.id.renderButton(container, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left", width: Math.min(360, Math.max(240, Math.floor(container.getBoundingClientRect().width || 320))) });
    } catch (error) {
        container.innerHTML = '<p class="google-signin-note"></p>';
        container.querySelector("p").textContent = error.message;
    }
}
window.addEventListener("load", initializeGoogleSignIn);
