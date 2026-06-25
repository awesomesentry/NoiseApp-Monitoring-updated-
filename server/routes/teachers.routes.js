const express = require("express");
const teachersController = require("../controllers/teachers.controller");
const { attachUser, requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(attachUser, requireAuth);

router.get("/schedules/all", (req, res, next) => {
  req.params.teacherId = "";
  return teachersController.listSchedules(req, res, next);
});
router.post("/schedules/check-conflict", teachersController.checkConflict);
router.post("/schedules", teachersController.upsertSchedule);
router.patch("/schedules", teachersController.upsertSchedule);
router.delete("/schedules/:id", teachersController.deleteSchedule);
router.get("/:teacherId/classrooms", teachersController.getTeacherClassrooms);
router.put("/:teacherId/classrooms", teachersController.setTeacherClassrooms);
router.get("/:teacherId/schedules", teachersController.listSchedules);

module.exports = router;
