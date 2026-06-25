const supabase = require("../services/supabase.service");
const { asyncHandler } = require("../middleware/utils");

const getTeacherClassrooms = asyncHandler(async (req, res) => {
  const classrooms = await supabase.fetchTeacherClassrooms(
    req.params.teacherId,
    req.accessToken
  );
  res.json(classrooms);
});

const setTeacherClassrooms = asyncHandler(async (req, res) => {
  const { teacherId } = req.params;
  const classroomIds = Array.isArray(req.body?.classroomIds) ? req.body.classroomIds : [];

  const existing = await supabase
    .get(
      supabase.TABLES.teacherClassrooms,
      `teacher_id=eq.${teacherId}&select=id,classroom_id`,
      req.accessToken
    )
    .catch(() => []);

  for (const row of existing) {
    if (!classroomIds.includes(row.classroom_id)) {
      try {
        await supabase.del(
          supabase.TABLES.teacherClassrooms,
          `id=eq.${row.id}`,
          req.accessToken
        );
      } catch (e) {
        console.warn("Failed to remove classroom link:", e.message);
      }
    }
  }

  const existingIds = existing.map((r) => r.classroom_id);
  const results = [];
  for (const cid of classroomIds) {
    if (!existingIds.includes(cid)) {
      try {
        const r = await supabase.post(
          supabase.TABLES.teacherClassrooms,
          { teacher_id: teacherId, classroom_id: cid },
          req.accessToken
        );
        results.push(r);
      } catch (e) {
        console.warn("Failed to link classroom:", e.message);
      }
    }
  }
  res.json(results);
});

const listSchedules = asyncHandler(async (req, res) => {
  const { teacherId } = req.params;
  const query = teacherId && teacherId !== "all"
    ? `teacher_id=eq.${teacherId}&order=day.asc,start_time.asc`
    : "select=*&order=day.asc,start_time.asc";
  const rows = await supabase.get(supabase.TABLES.teacherSchedules, query, req.accessToken);
  res.json(rows);
});

const upsertSchedule = asyncHandler(async (req, res) => {
  const { id, teacher_id, day, start_time, end_time, subject, room } = req.body || {};
  if (!teacher_id || !day || !start_time || !end_time) {
    return res.status(400).json({ error: "teacher_id, day, start_time, and end_time are required" });
  }

  const body = {
    teacher_id,
    day,
    start_time,
    end_time,
    subject: subject || null,
    room: room || null,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    await supabase.patch(
      supabase.TABLES.teacherSchedules,
      `id=eq.${id}`,
      body,
      req.accessToken
    );
    return res.json({ ...body, id });
  }

  body.created_at = new Date().toISOString();
  const result = await supabase.post(supabase.TABLES.teacherSchedules, body, req.accessToken);
  const row = Array.isArray(result) ? result[0] : result;
  return res.status(201).json(row);
});

const deleteSchedule = asyncHandler(async (req, res) => {
  await supabase.del(
    supabase.TABLES.teacherSchedules,
    `id=eq.${req.params.id}`,
    req.accessToken
  );
  res.json({ ok: true });
});

const checkConflict = asyncHandler(async (req, res) => {
  const { teacherId, day, startTime, endTime, excludeId } = req.body || {};
  if (!teacherId || !day || !startTime || !endTime) {
    return res.status(400).json({ error: "teacherId, day, startTime, and endTime are required" });
  }

  const allSchedules = await supabase.get(
    supabase.TABLES.teacherSchedules,
    "select=*&order=day.asc,start_time.asc",
    req.accessToken
  );

  const newStart = supabase.timeToMinutes(startTime);
  const newEnd = supabase.timeToMinutes(endTime);

  for (const slot of allSchedules || []) {
    if (slot.teacher_id === teacherId) continue;
    if (excludeId && slot.id === excludeId) continue;
    if (slot.day !== day) continue;

    const existingStart = supabase.timeToMinutes(slot.start_time || slot.startTime);
    const existingEnd = supabase.timeToMinutes(slot.end_time || slot.endTime);

    if (newStart < existingEnd && existingStart < newEnd) {
      const teacherProfile = await supabase.getProfileById(slot.teacher_id, req.accessToken);
      const teacherName =
        teacherProfile?.full_name ||
        teacherProfile?.username ||
        `Teacher (ID: ${slot.teacher_id})`;
      return res.json({
        conflict: true,
        teacherName,
        subject: slot.subject || "—",
        day,
        startTime: supabase.formatTime12h(slot.start_time || slot.startTime),
        endTime: supabase.formatTime12h(slot.end_time || slot.endTime),
      });
    }
  }

  res.json({ conflict: false });
});

module.exports = {
  getTeacherClassrooms,
  setTeacherClassrooms,
  listSchedules,
  upsertSchedule,
  deleteSchedule,
  checkConflict,
};
