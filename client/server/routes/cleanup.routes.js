const express = require("express");
const cleanupController = require("../controllers/cleanup.controller");
const { attachUser } = require("../middleware/auth");

const router = express.Router();

router.post("/expired-events", attachUser, cleanupController.cleanupExpired);

module.exports = router;
