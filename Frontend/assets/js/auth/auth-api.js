(() => {
    const normalizeBaseUrl = (value) =>
        String(value || "").trim().replace(/\/+$/, "");

    const configuredBaseUrl = document
        .querySelector('meta[name="api-base-url"]')
        ?.content
        .trim();

    const baseUrl = normalizeBaseUrl(
        window.FOOD_DELIVERY_API_BASE || configuredBaseUrl || "http://localhost:5000/api"
    );
    const apiBaseUrl = baseUrl || "http://localhost:5000/api";
    const tokenKey = "foodDeliveryAccessToken";
    const userKey = "foodDeliveryUser";
    const loginPagePath = "/pages/auth/login.html";
    const EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;
    let expiryTimer = null;
    let expiryRedirecting = false;

    function showGlobalMessage(message, type = "error") {
        const messageBox = document.getElementById("adminMessage");

        if (!messageBox) {
            return false;
        }

        messageBox.textContent = message;
        messageBox.className = `admin-message show ${type}`;
        messageBox.setAttribute("role", "alert");
        messageBox.setAttribute("aria-live", "polite");

        return true;
    }

    function clearSession() {
        sessionStorage.removeItem("foodDeliveryGooglePasswordSetupPending");
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(userKey);
        sessionStorage.removeItem(tokenKey);
        sessionStorage.removeItem(userKey);
        if (expiryTimer !== null) {
            window.clearTimeout(expiryTimer);
            expiryTimer = null;
        }
    }

    function getTokenExpiryMs(token) {
        try {
            const parts = String(token || "").split(".");
            if (parts.length !== 3) return null;
            const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const decoded = atob(payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), "="));
            const claims = JSON.parse(decoded);
            return Number.isFinite(Number(claims.exp)) ? Number(claims.exp) * 1000 : null;
        } catch {
            return null;
        }
    }

    function expireSession() {
        if (expiryRedirecting) return;
        expiryRedirecting = true;
        clearSession();
        window.alert("Your session has expired. Please log in again.");
        redirectToLogin();
    }

    function scheduleSessionExpiryCheck() {
        if (expiryTimer !== null) {
            window.clearTimeout(expiryTimer);
            expiryTimer = null;
        }

        const token = getToken();
        if (!token) return;

        const expiryMs = getTokenExpiryMs(token);
        // The server remains authoritative for tokens without a readable JWT expiry.
        if (expiryMs === null) return;

        const remaining = expiryMs - Date.now();
        if (remaining <= 0) {
            expireSession();
            return;
        }

        expiryTimer = window.setTimeout(
            scheduleSessionExpiryCheck,
            Math.min(remaining, EXPIRY_CHECK_INTERVAL_MS)
        );
    }

    const ADMIN_TIMEOUT_STORAGE_KEY = "foodDeliveryAdminSessionTimeout";
    const ACTIVITY_EVENTS = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];

    let inactivityTimer = null;
    let adminTimeoutMinutes = 30;
    let adminSettingsLoaded = false;

    function isAdminPage() {
        return /\/pages\/admin\//i.test(window.location.pathname);
    }

    function isAuthenticatedPortalPage() {
        return /\/pages\/(?:admin|customer|restaurant|rider)\//i.test(window.location.pathname);
    }

    function parseTimeoutMinutes(value) {
        const normalized = String(value ?? "").trim().toLowerCase();
        if (normalized === "never" || normalized === "0") return 0;
        // Accept both the labels used by the Settings UI and numeric values
        // returned by older saved settings.
        if (["15", "15 minutes"].includes(normalized)) return 15;
        if (["30", "30 minutes"].includes(normalized)) return 30;
        if (["60", "1 hour", "1 hours"].includes(normalized)) return 60;
        if (["240", "4 hours"].includes(normalized)) return 240;
        return 30;
    }

    function clearInactivityTimer() {
        if (inactivityTimer !== null) {
            window.clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
    }

    function scheduleInactivityLogout() {
        clearInactivityTimer();
        if (!isAuthenticatedPortalPage() || !getToken() || adminTimeoutMinutes <= 0) return;
        inactivityTimer = window.setTimeout(() => {
            clearSession();
            window.alert("You have been logged out due to inactivity.");
            redirectToLogin();
        }, adminTimeoutMinutes * 60 * 1000);
    }

    function notePortalActivity() {
        if (isAuthenticatedPortalPage()) scheduleInactivityLogout();
    }

    async function loadAdminSessionTimeout() {
        if (!isAdminPage() || !getToken() || adminSettingsLoaded) return;
        adminSettingsLoaded = true;
        try {
            const response = await fetch(`${apiBaseUrl}/admins/settings`, {
                headers: { Accept: "application/json", Authorization: `Bearer ${getToken()}` }
            });
            if (!response.ok) return;
            const result = await response.json();
            const settings = result?.data?.settings || result?.settings || {};
            const timeoutValue = settings?.security?.sessionTimeout;
            if (timeoutValue !== undefined && timeoutValue !== null && timeoutValue !== "") {
                adminTimeoutMinutes = parseTimeoutMinutes(timeoutValue);
                localStorage.setItem(ADMIN_TIMEOUT_STORAGE_KEY, String(adminTimeoutMinutes));
            } else {
                const stored = localStorage.getItem(ADMIN_TIMEOUT_STORAGE_KEY);
                if (stored !== null && Number.isFinite(Number(stored))) adminTimeoutMinutes = Number(stored);
            }
            scheduleInactivityLogout();
        } catch (error) {
            console.warn("Could not load admin session timeout setting:", error);
        }
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, notePortalActivity, { passive: true });
    });

    window.addEventListener("admin-session-timeout-updated", (event) => {
        adminTimeoutMinutes = parseTimeoutMinutes(event.detail?.value);
        localStorage.setItem(ADMIN_TIMEOUT_STORAGE_KEY, String(adminTimeoutMinutes));
        scheduleInactivityLogout();
    });

    function redirectToLogin() {
        const currentPath = window.location.pathname || "/";

        if (
            currentPath.endsWith("/login.html") ||
            currentPath.endsWith("/register.html")
        ) {
            return;
        }

        window.location.href = loginPagePath;
    }

    function isProtectedPortalPage() {
        const path = (window.location.pathname || "").toLowerCase();
        return /\/pages\/rider\//.test(path) ||
            /\/pages\/customer\/(?:cart|checkout|orders|profile|settings)(?:[/.]|$)/.test(path);
    }

    function enforceSessionOnProtectedPage() {
        // Every portal route is private, not only the rider and selected
        // customer pages. Never leave a protected screen visible without a
        // valid session.
        if (!isAuthenticatedPortalPage()) return;

        const token = getToken();
        if (!token) {
            clearSession();
            redirectToLogin();
            return;
        }

        const expiryMs = getTokenExpiryMs(token);
        if (expiryMs !== null && expiryMs <= Date.now()) {
            expireSession();
            return;
        }

        scheduleSessionExpiryCheck();
        scheduleInactivityLogout();
    }

    // Re-check when a suspended tab becomes active. Timers can be delayed by
    // browsers, and API calls may not happen while a dashboard is idle.
    window.addEventListener("pageshow", enforceSessionOnProtectedPage);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            scheduleSessionExpiryCheck();
            enforceSessionOnProtectedPage();
        }
    });
    window.addEventListener("focus", () => {
        scheduleSessionExpiryCheck();
        enforceSessionOnProtectedPage();
    });

    function getToken() {
        return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey);
    }

    async function request(path, { method = "GET", body, authenticated = false } = {}) {
        const headers = { Accept: "application/json" };
        const options = { method, headers };

        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        if (authenticated) {
            const token = getToken();

            if (!token) {
                redirectToLogin();
                throw new Error("Please log in to continue.");
            }

            const expiryMs = getTokenExpiryMs(token);
            if (expiryMs !== null && expiryMs <= Date.now()) {
                expireSession();
                throw new Error("Your session has expired. Please log in again.");
            }

            headers.Authorization = `Bearer ${token}`;
        }

        let response;

        try {
            response = await fetch(`${apiBaseUrl}${path}`, options);
        } catch (error) {
            if (error instanceof TypeError) {
                const friendly = "Could not reach the FoodDelivery API. Please check your connection and try again.";
                showGlobalMessage(friendly, "error");
                throw new Error(friendly);
            }

            throw error;
        }

        let result = {};

        try {
            result = await response.json();
        } catch {
            result = {};
        }

        if (!response.ok) {
            const errorMessage =
                result.error || result.message || `Request failed (${response.status}).`;

            // A 401 from the login endpoint means the credentials were rejected,
            // not that an existing session expired. Only clear a session when an
            // authenticated request is rejected.
            if (response.status === 401 && authenticated) {
                clearSession();
                showGlobalMessage("Your session has expired. Please log in again.", "error");
                redirectToLogin();
                throw new Error("Your session has expired. Please log in again.");
            }

            // A 403 is an authorization failure (for example, the wrong role).
            // Preserve the session and show the server's actual message.
            if (response.status === 403) {
                showGlobalMessage(errorMessage || "You do not have permission to access this page.", "error");
                throw new Error(errorMessage || "You do not have permission to access this page.");
            }

            showGlobalMessage(errorMessage, "error");
            throw new Error(errorMessage);
        }

        if (result.data !== undefined) return result.data;
        if (result.review !== undefined) return result.review;
        return result;
    }

    function saveSession(session, rememberMe = false) {
        if (!session?.token || !session?.user) {
            throw new Error("The server did not return a valid login session.");
        }

        localStorage.removeItem(tokenKey);
        localStorage.removeItem(userKey);
        sessionStorage.removeItem(tokenKey);
        sessionStorage.removeItem(userKey);

        const storage = rememberMe ? localStorage : sessionStorage;
        storage.setItem(tokenKey, session.token);
        storage.setItem(userKey, JSON.stringify(session.user));
        expiryRedirecting = false;
        scheduleSessionExpiryCheck();
    }

    function getCurrentUser() {
        const raw = localStorage.getItem(userKey) || sessionStorage.getItem(userKey);

        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    window.addEventListener("storage", (event) => {
        if (event.key === tokenKey || event.key === null) {
            expiryRedirecting = false;
            scheduleSessionExpiryCheck();
        }
    });

    scheduleSessionExpiryCheck();


    function mountGooglePasswordSetup() {
        if (sessionStorage.getItem("foodDeliveryGooglePasswordSetupPending") !== "true") return;
        if (!/\/pages\/(?:admin|customer|restaurant|rider)\//i.test(window.location.pathname)) return;
        if (document.getElementById("googlePasswordSetupNotice")) return;
        const notice = document.createElement("section");
        notice.id = "googlePasswordSetupNotice";
        notice.setAttribute("role", "region");
        notice.style.cssText = "margin:16px auto;padding:18px;max-width:900px;border:1px solid #ff5a1f;border-radius:10px;background:#fff7f2;color:#222";
        notice.innerHTML = '<h2 style="margin-top:0">Secure your new account</h2><p>Create a Food Delivery password if you want to sign in without Google in the future. This setup option is available until your first logout.</p><form id="googlePasswordSetupForm"><label for="googleNewPassword">New password (at least 8 characters)</label><input id="googleNewPassword" type="password" minlength="8" autocomplete="new-password" required style="display:block;width:100%;max-width:420px;padding:10px;margin:8px 0 12px"><label for="googleConfirmPassword">Confirm password</label><input id="googleConfirmPassword" type="password" minlength="8" autocomplete="new-password" required style="display:block;width:100%;max-width:420px;padding:10px;margin:8px 0 12px"><button type="submit" style="padding:10px 16px;cursor:pointer">Set Password</button><p id="googlePasswordSetupMessage" aria-live="polite"></p></form>';
        const main = document.querySelector("main");
        if (main) main.prepend(notice); else document.body.prepend(notice);
        notice.querySelector("form").addEventListener("submit", async event => {
            event.preventDefault();
            const password = notice.querySelector("#googleNewPassword").value;
            const confirmation = notice.querySelector("#googleConfirmPassword").value;
            const message = notice.querySelector("#googlePasswordSetupMessage");
            if (password !== confirmation) { message.textContent = "Passwords do not match."; return; }
            try {
                await request("/auth/google/set-password", { method: "POST", body: { newPassword: password }, authenticated: true });
                sessionStorage.removeItem("foodDeliveryGooglePasswordSetupPending");
                notice.remove();
                window.alert("Your Food Delivery password has been created.");
            } catch (error) {
                message.textContent = error.message || "Unable to set password.";
            }
        });
    }

    document.addEventListener("click", async event => {
        if (sessionStorage.getItem("foodDeliveryGooglePasswordSetupPending") !== "true") return;
        const link = event.target.closest("a");
        if (!link || !/logout|sign out/i.test(link.textContent || "")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const destination = link.href || "/pages/auth/login.html";
        try {
            await request("/auth/google/finish-first-session", { method: "POST", authenticated: true });
        } catch (error) {
            console.warn("Could not clear Google first-session status:", error);
        } finally {
            sessionStorage.removeItem("foodDeliveryGooglePasswordSetupPending");
            clearSession();
            window.location.assign(destination);
        }
    }, true);

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountGooglePasswordSetup);
    else mountGooglePasswordSetup();

    // Reuse the last saved administrator-configured timeout on all portals
    // in this browser. Fall back to 30 minutes if no setting is cached yet.
    const cachedTimeout = localStorage.getItem(ADMIN_TIMEOUT_STORAGE_KEY);
    if (cachedTimeout !== null && Number.isFinite(Number(cachedTimeout))) {
        adminTimeoutMinutes = Number(cachedTimeout);
    }

    if (isAuthenticatedPortalPage()) {
        enforceSessionOnProtectedPage();
        scheduleInactivityLogout();
    }
    loadAdminSessionTimeout();

    window.FoodDeliveryAuthApi = {
        request,
        saveSession,
        clearSession,
        getToken,
        getCurrentUser,
        showGlobalMessage,
    };
})();
