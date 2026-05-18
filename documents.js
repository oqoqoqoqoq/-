const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/init');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// 업로드 디렉토리
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${req.user?.id ?? 'anon'}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('PDF, JPG, PNG 파일만 업로드 가능합니다.'));
  }
});

router.use(authMiddleware);

/**
 * GET /api/documents  — 내 증빙자료 목록 (학생) / 전체 목록 (관리자)
 */
router.get('/', (req, res) => {
  const db = getDb();
  let docs;
  if (req.user.role === 'admin') {
    docs = db.prepare(`
      SELECT d.*, u.name as student_name, u.sid as student_sid
      FROM documents d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.submitted_at DESC
    `).all();
  } else {
    docs = db.prepare(
      'SELECT * FROM documents WHERE user_id = ? ORDER BY submitted_at DESC'
    ).all(req.user.id);
  }
  res.json(docs);
});

/**
 * GET /api/documents/pending  — 관리자: 검토 대기 목록
 */
router.get('/pending', adminOnly, (req, res) => {
  const db = getDb();
  const docs = db.prepare(`
    SELECT d.*, u.name as student_name, u.sid as student_sid
    FROM documents d
    JOIN users u ON d.user_id = u.id
    WHERE d.status = 'pending'
    ORDER BY d.submitted_at ASC
  `).all();
  res.json(docs);
});

/**
 * POST /api/documents  — 파일 업로드 및 자료 등록
 * multipart/form-data: file, doc_type
 */
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    if (!req.file) return res.status(400).json({ error: '파일을 선택해주세요.' });
    const { doc_type } = req.body;
    if (!doc_type) return res.status(400).json({ error: '자료 유형을 선택해주세요.' });

    const validTypes = ['어학성적', '자격증', '수상실적', '기타'];
    if (!validTypes.includes(doc_type)) {
      return res.status(400).json({ error: '유효하지 않은 자료 유형입니다.' });
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO documents (user_id, filename, original_name, doc_type, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(req.user.id, req.file.filename, req.file.originalname, doc_type);

    // 관리자에게 알림 (관리자 계정에 알림 삽입)
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (admin) {
      db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(
        admin.id, `${req.user.name} 학생이 증빙자료(${doc_type})를 제출했습니다.`
      );
    }

    res.status(201).json({
      id: result.lastInsertRowid,
      filename: req.file.filename,
      original_name: req.file.originalname,
      doc_type, status: 'pending',
      submitted_at: new Date().toISOString()
    });
  });
});

/**
 * PATCH /api/documents/:id/review  — 관리자: 승인/반려
 * body: { status: 'approved'|'rejected', admin_note? }
 */
router.patch('/:id/review', adminOnly, (req, res) => {
  const { status, admin_note } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "status는 'approved' 또는 'rejected'여야 합니다." });
  }

  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: '자료를 찾을 수 없습니다.' });

  db.prepare(`
    UPDATE documents
    SET status = ?, admin_note = ?, reviewed_at = datetime('now','localtime')
    WHERE id = ?
  `).run(status, admin_note || null, Number(req.params.id));

  // 학생에게 결과 알림
  const msg = status === 'approved'
    ? `증빙자료(${doc.original_name})가 승인되었습니다.`
    : `증빙자료(${doc.original_name})가 반려되었습니다. ${admin_note || ''}`;
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(doc.user_id, msg);

  res.json({ message: `${status === 'approved' ? '승인' : '반려'}되었습니다.` });
});

/**
 * DELETE /api/documents/:id  — 본인 자료 삭제 (pending 상태만)
 */
router.delete('/:id', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.user.id);

  if (!doc) return res.status(404).json({ error: '자료를 찾을 수 없습니다.' });
  if (doc.status !== 'pending') {
    return res.status(400).json({ error: '이미 검토된 자료는 삭제할 수 없습니다.' });
  }

  // 실제 파일 삭제
  const filePath = path.join(UPLOAD_DIR, doc.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM documents WHERE id = ?').run(Number(req.params.id));
  res.json({ message: '삭제되었습니다.' });
});

module.exports = router;
