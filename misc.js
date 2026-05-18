const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ─── 알림 ──────────────────────────────────────────────

/**
 * GET /api/notifications  — 내 알림 목록
 */
router.get('/notifications', (req, res) => {
  const db = getDb();
  const notifs = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  const unread = notifs.filter(n => !n.is_read).length;
  res.json({ notifications: notifs, unread_count: unread });
});

/**
 * PATCH /api/notifications/:id/read  — 알림 읽음 처리
 */
router.patch('/notifications/:id/read', (req, res) => {
  const db = getDb();
  db.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).run(Number(req.params.id), req.user.id);
  res.json({ message: '읽음 처리되었습니다.' });
});

/**
 * PATCH /api/notifications/read-all  — 전체 읽음
 */
router.patch('/notifications/read-all', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: '전체 읽음 처리되었습니다.' });
});

// ─── 졸업요건 ────────────────────────────────────────────

/**
 * GET /api/requirements/:track  — 트랙별 졸업요건
 */
router.get('/requirements/:track', (req, res) => {
  const track = Number(req.params.track);
  if (![1,2,3].includes(track)) return res.status(400).json({ error: '트랙은 1~3이어야 합니다.' });

  const db = getDb();
  const reqs = db.prepare(
    'SELECT * FROM track_requirements WHERE track = ? ORDER BY id'
  ).all(track);
  res.json(reqs);
});

// ─── 관리자 전용 ──────────────────────────────────────────

/**
 * GET /api/admin/stats  — 전체 통계
 */
router.get('/admin/stats', adminOnly, (req, res) => {
  const db = getDb();

  const totalStudents = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role='student'").get().cnt;
  const pendingDocs = db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE status='pending'").get().cnt;

  // 트랙별 학생 수
  const byTrack = db.prepare(`
    SELECT track, COUNT(*) as cnt FROM users WHERE role='student' GROUP BY track
  `).all();

  // 최근 활동
  const recentActivity = db.prepare(`
    SELECT 'document' as type, d.submitted_at as time, u.name, u.sid, d.doc_type as detail
    FROM documents d JOIN users u ON d.user_id = u.id
    UNION ALL
    SELECT 'completed' as type, cc.created_at as time, u.name, u.sid, c.name as detail
    FROM completed_courses cc JOIN users u ON cc.user_id = u.id JOIN courses c ON cc.course_id = c.id
    ORDER BY time DESC LIMIT 10
  `).all();

  res.json({ total_students: totalStudents, pending_docs: pendingDocs, by_track: byTrack, recent_activity: recentActivity });
});

/**
 * GET /api/admin/students  — 전체 학생 목록
 */
router.get('/admin/students', adminOnly, (req, res) => {
  const db = getDb();
  const students = db.prepare(`
    SELECT u.id, u.sid, u.name, u.track, u.created_at,
           COUNT(cc.id) as completed_count,
           COALESCE(SUM(cc.credits), 0) as total_credits
    FROM users u
    LEFT JOIN completed_courses cc ON cc.user_id = u.id
    WHERE u.role = 'student'
    GROUP BY u.id
    ORDER BY u.sid
  `).all();
  res.json(students);
});

/**
 * GET /api/admin/students/:id  — 특정 학생 상세 (이수내역 포함)
 */
router.get('/admin/students/:id', adminOnly, (req, res) => {
  const db = getDb();
  const student = db.prepare(
    'SELECT id, sid, name, track, created_at FROM users WHERE id = ? AND role = ?'
  ).get(Number(req.params.id), 'student');
  if (!student) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });

  const completed = db.prepare(`
    SELECT cc.*, c.code, c.name as course_name, c.category
    FROM completed_courses cc JOIN courses c ON cc.course_id = c.id
    WHERE cc.user_id = ?
    ORDER BY cc.semester DESC
  `).all(student.id);

  const docs = db.prepare(
    'SELECT * FROM documents WHERE user_id = ? ORDER BY submitted_at DESC'
  ).all(student.id);

  res.json({ student, completed, documents: docs });
});

/**
 * POST /api/admin/notify  — 특정 학생 또는 전체 학생에게 알림 발송
 * body: { user_id?: number, message: string }  (user_id 생략시 전체)
 */
router.post('/admin/notify', adminOnly, (req, res) => {
  const { user_id, message } = req.body;
  if (!message) return res.status(400).json({ error: '메시지를 입력해주세요.' });

  const db = getDb();
  const insert = db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)');

  if (user_id) {
    insert.run(Number(user_id), message);
    res.json({ message: '알림을 발송했습니다.' });
  } else {
    // 전체 학생에게
    const students = db.prepare("SELECT id FROM users WHERE role='student'").all();
    const insertMany = db.transaction(() => students.forEach(s => insert.run(s.id, message)));
    insertMany();
    res.json({ message: `${students.length}명에게 알림을 발송했습니다.` });
  }
});

module.exports = router;
