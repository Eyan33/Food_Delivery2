/**
 * FoodDelivery / Market Delivery — shared platform name
 *
 * Loads the platform name from admin general settings via the public
 * /api/public/support endpoint and applies it to branding elements
 * across the admin portal (and any other page that includes this script).
 *
 * Default when no name has been saved: "Market Delivery"
 */
(() => {
  "use strict";

  const DEFAULT_PLATFORM_NAME = "Market Delivery";
  const CACHE_KEY = "fd_platform_name";
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function getApiBase() {
    if (typeof window.FOOD_DELIVERY_API_BASE === "string" && window.FOOD_DELIVERY_API_BASE) {
      return window.FOOD_DELIVERY_API_BASE.replace(/\/+$/, "");
    }
    const meta = document.querySelector('meta[name="api-base-url"]');
    if (meta?.content?.trim()) {
      return meta.content.trim().replace(/\/+$/, "");
    }
    return "/api";
  }

  function readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.name !== "string") return null;
      if (Date.now() - (parsed.fetchedAt || 0) > CACHE_TTL_MS) return null;
      return String(parsed.name).trim() || null;
    } catch {
      return null;
    }
  }

  function writeCache(name) {
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ name, fetchedAt: Date.now() }),
      );
    } catch {
      // ignore quota / private mode
    }
  }

  /**
   * Apply a platform name to the current page.
   * - .admin-logo elements get the full name as text
   * - document.title replaces the brand segment after " | "
   * - elements with [data-platform-name] get textContent set
   */
  function applyPlatformName(name) {
    const platformName = String(name || "").trim() || DEFAULT_PLATFORM_NAME;

    window.__PLATFORM_NAME__ = platformName;

    document.querySelectorAll(".admin-logo").forEach((logo) => {
      logo.textContent = platformName;
      logo.setAttribute("aria-label", platformName);
      logo.setAttribute("title", platformName);
    });

    document.querySelectorAll("[data-platform-name]").forEach((el) => {
      el.textContent = platformName;
    });

    // Title patterns: "Page | Brand" or "Page | Brand Admin"
    const title = document.title || "";
    if (title.includes("|")) {
      const pagePart = title.split("|")[0].trim();
      const isAdmin = /\badmin\b/i.test(title);
      document.title = isAdmin
        ? `${pagePart} | ${platformName} Admin`
        : `${pagePart} | ${platformName}`;
    }
  }

  async function fetchPlatformName() {
    const cached = readCache();
    if (cached) {
      applyPlatformName(cached);
      return cached;
    }

    // Show default immediately so the UI is never stuck on the old hardcoded name
    applyPlatformName(DEFAULT_PLATFORM_NAME);

    try {
      const base = getApiBase();
      const response = await fetch(`${base}/public/support`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      const name =
        String(payload?.data?.platformName || "").trim() || DEFAULT_PLATFORM_NAME;

      writeCache(name);
      applyPlatformName(name);
      return name;
    } catch (error) {
      console.warn("Could not load platform name; using default.", error);
      applyPlatformName(DEFAULT_PLATFORM_NAME);
      return DEFAULT_PLATFORM_NAME;
    }
  }

  // Expose a small API so settings.js (and others) can force a refresh after save
  window.FoodDeliveryPlatform = {
    DEFAULT_NAME: DEFAULT_PLATFORM_NAME,
    apply: applyPlatformName,
    refresh: () => {
      try {
        sessionStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
      return fetchPlatformName();
    },
    get: () => window.__PLATFORM_NAME__ || DEFAULT_PLATFORM_NAME,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchPlatformName);
  } else {
    fetchPlatformName();
  }
})();
