require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── 미들웨어 ──────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 업로드 파일 정적 제공
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── 라우터 ───────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/courses',   require('./routes/courses'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api',           require('./routes/misc'));

// ─── 헬스체크 ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `경로를 찾을 수 없습니다: ${req.method} ${req.path}` });
});

// ─── 에러 핸들러 ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

// ─── 시작 ────────────────────────────────────────────────
initDb();
app.listen(PORT, () => {
  console.log(`\n🎓 졸업요건관리 백엔드 실행 중`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   헬스체크: http://localhost:${PORT}/health\n`);
});

module.exports = app;
