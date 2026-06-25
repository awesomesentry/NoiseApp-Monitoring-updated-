const express = require("express");
const authController = require("../controllers/auth.controller");
const { attachUser, requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/utils");

const router = express.Router();

router.post("/login", authController.login);
router.post("/signup", authController.signup);
router.post("/logout", attachUser, requireAuth, authController.logout);
router.patch("/password", attachUser, requireAuth, authController.updatePassword);
router.get("/me", attachUser, authController.me);

module.exports = router;
