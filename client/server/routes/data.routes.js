const express = require("express");
const dataController = require("../controllers/data.controller");
const { attachUser, requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(attachUser);

router.get("/noise-events", requireAuth, dataController.listNoiseEvents);
router.delete("/noise-events/:id", requireAuth, requireAdmin, dataController.deleteNoiseEvent);
router.get("/classrooms", requireAuth, dataController.listClassrooms);
router.get("/audit-logs", requireAuth, requireAdmin, dataController.listAuditLogs);
router.post("/audit-logs", requireAuth, dataController.createAuditLog);
router.get("/settings", requireAuth, dataController.getSettings);
router.patch("/settings", requireAuth, requireAdmin, dataController.updateSettings);

module.exports = router;
