const express = require("express");

const adminController = require("../../controllers/admin/adminController");
const deletedAccountsController = require("../../controllers/admin/deletedAccountsController");
const permanentAccountDeletionController = require("../../controllers/admin/permanentAccountDeletionController");
const authenticateToken = require("../../middleware/auth/authMiddleware");
const authorizeRoles = require("../../middleware/auth/roleMiddleware");
const auditAdminAction = require("../../middleware/adminAuditMiddleware");
const requireSuperAdmin = require("../../middleware/auth/superAdminMiddleware");

const router = express.Router();

router.use(
    authenticateToken,
    authorizeRoles("admin", "super_admin"),
    auditAdminAction
);

// Static paths must come before /:id
router.get("/me", adminController.getMe);
router.patch("/me/avatar", adminController.updateMyAvatar);
router.get("/dashboard", adminController.getDashboard);
router.get("/reports", adminController.getReports);
router.get("/settings", adminController.getSettings);
router.put("/settings", adminController.updateSettings);
router.get("/notifications", adminController.getNotifications);
router.patch("/notifications/read-all", adminController.markAllNotificationsRead);
router.patch("/notifications/:id/read", adminController.markNotificationRead);
router.get("/audit-logs", adminController.getAuditLogs);
router.get("/deleted-accounts", deletedAccountsController.listDeletedAccounts);
router.delete("/deleted-accounts/:type/:id", permanentAccountDeletionController.permanentlyDeleteAccount);
router.get("/reviews", adminController.getReviews);
router.patch("/reviews/:id/visibility", adminController.updateReviewVisibility);

router.get("/", requireSuperAdmin, adminController.getAdmins);
router.post("/", requireSuperAdmin, adminController.createAdmin);

router.get("/:id", requireSuperAdmin, adminController.getAdmin);
router.put("/:id", requireSuperAdmin, adminController.updateAdmin);
router.patch("/:id/activate", requireSuperAdmin, adminController.activateAdmin);
router.delete("/:id", requireSuperAdmin, adminController.deactivateAdmin);

module.exports = router;
