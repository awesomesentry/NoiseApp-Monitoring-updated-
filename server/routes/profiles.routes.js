const express = require("express");
const profilesController = require("../controllers/profiles.controller");
const { attachUser, requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(attachUser);

router.get("/", requireAuth, requireAdmin, profilesController.listProfiles);
router.get("/:id", requireAuth, profilesController.getProfile);
router.put("/:id", requireAuth, profilesController.upsertProfile);
router.patch("/:id", requireAuth, profilesController.upsertProfile);

module.exports = router;
