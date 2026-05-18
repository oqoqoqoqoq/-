const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'graduation.db');

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  // 사용자 테이블 (학생 + 관리자)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sid TEXT UNIQUE NOT NULL,         -- 학번 or 'admin'
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student', -- 'student' | 'admin'
      track INTEGER DEFAULT 1,          -- 졸업 트랙 (1,2,3)
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // 과목 테이블 (마스터 데이터)
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL,
      category TEXT NOT NULL   -- '전공필수'|'전공선택'|'교양필수'|'교양선택'
    )
  `);

  // 이수내역 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS completed_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      semester TEXT NOT NULL,  -- '2024-1'
      grade TEXT NOT NULL,
      credits INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(user_id, course_id)
    )
  `);

  // 증빙자료 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      doc_type TEXT NOT NULL,   -- '어학성적'|'자격증'|'기타'
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'rejected'
      admin_note TEXT,
      submitted_at TEXT DEFAULT (datetime('now','localtime')),
      reviewed_at TEXT
    )
  `);

  // 알림 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // 졸업요건 테이블 (트랙별)
  db.exec(`
    CREATE TABLE IF NOT EXISTS track_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track INTEGER NOT NULL,
      category TEXT NOT NULL,
      required_credits INTEGER NOT NULL
    )
  `);

  _seedData(db);
  console.log('✅ DB 초기화 완료:', DB_PATH);
}

function _seedData(db) {
  // 이미 데이터 있으면 스킵
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM courses').get();
  if (existing.cnt > 0) return;

  console.log('🌱 초기 데이터 삽입 중...');

  // 과목 데이터
  const insertCourse = db.prepare(
    'INSERT OR IGNORE INTO courses (code, name, credits, category) VALUES (?, ?, ?, ?)'
  );
  const courses = [
    ['CS101','컴퓨터개론',3,'전공필수'],
    ['CS201','자료구조',3,'전공필수'],
    ['CS301','알고리즘',3,'전공필수'],
    ['CS401','운영체제',3,'전공필수'],
    ['CS402','데이터베이스',3,'전공필수'],
    ['CS403','컴퓨터네트워크',3,'전공필수'],
    ['CS501','소프트웨어공학',3,'전공필수'],
    ['CS502','인공지능',3,'전공선택'],
    ['CS503','머신러닝',3,'전공선택'],
    ['CS504','컴퓨터비전',3,'전공선택'],
    ['CS505','자연어처리',3,'전공선택'],
    ['GE101','글쓰기',3,'교양필수'],
    ['GE102','영어회화',3,'교양필수'],
    ['GE103','체육',1,'교양필수'],
    ['GE201','철학개론',3,'교양선택'],
    ['GE202','심리학개론',3,'교양선택'],
    ['GE203','경제학개론',3,'교양선택'],
  ];
  courses.forEach(c => insertCourse.run(...c));

  // 졸업요건 (트랙별)
  const insertReq = db.prepare(
    'INSERT INTO track_requirements (track, category, required_credits) VALUES (?, ?, ?)'
  );
  const requirements = [
    // 논문 트랙
    [1,'전공필수',45],[1,'전공선택',15],[1,'교양필수',18],[1,'교양선택',12],
    // 시험 트랙
    [2,'전공필수',48],[2,'전공선택',12],[2,'교양필수',18],[2,'교양선택',12],
    // 프로젝트 트랙
    [3,'전공필수',42],[3,'전공선택',18],[3,'교양필수',18],[3,'교양선택',12],
  ];
  requirements.forEach(r => insertReq.run(...r));

  // 기본 관리자 계정 (admin / 관리자1234)
  const bcrypt = require('bcryptjs');
  const adminHash = bcrypt.hashSync('관리자1234', 10);
  db.prepare(
    "INSERT OR IGNORE INTO users (sid, name, password_hash, role) VALUES (?, ?, ?, 'admin')"
  ).run('admin', '관리자', adminHash);

  // 테스트 학생 계정 (23114234 / student1234)
  const studentHash = bcrypt.hashSync('student1234', 10);
  const studentResult = db.prepare(
    "INSERT OR IGNORE INTO users (sid, name, password_hash, role, track) VALUES (?, ?, ?, 'student', 1)"
  ).run('23114234', '박영은', studentHash);

  if (studentResult.changes > 0) {
    const student = db.prepare("SELECT id FROM users WHERE sid = '23114234'").get();
    // 테스트 이수내역
    const insertCC = db.prepare(
      'INSERT OR IGNORE INTO completed_courses (user_id, course_id, semester, grade, credits) VALUES (?, ?, ?, ?, ?)'
    );
    [
      [student.id,1,'2023-1','A+',3],[student.id,2,'2023-1','A0',3],
      [student.id,3,'2023-2','B+',3],[student.id,4,'2023-2','A+',3],
      [student.id,5,'2024-1','A0',3],[student.id,8,'2024-1','B+',3],
      [student.id,12,'2023-1','A+',3],[student.id,13,'2023-2','A0',3],
      [student.id,15,'2024-1','B0',3],
    ].forEach(r => insertCC.run(...r));

    // 테스트 알림
    const insertNotif = db.prepare(
      'INSERT INTO notifications (user_id, message, is_read) VALUES (?, ?, ?)'
    );
    insertNotif.run(student.id, '전공필수 학점이 부족합니다. 30학점 추가 이수가 필요합니다.', 0);
    insertNotif.run(student.id, '2024학년도 2학기 수강신청이 시작되었습니다.', 1);
    insertNotif.run(student.id, '증빙자료(TOEIC 성적표)가 승인되었습니다.', 1);

    // 테스트 증빙자료
    db.prepare(
      "INSERT INTO documents (user_id, filename, original_name, doc_type, status) VALUES (?, ?, ?, ?, ?)"
    ).run(student.id, 'toeic_sample.pdf', 'TOEIC_성적표.pdf', '어학성적', 'approved');
    db.prepare(
      "INSERT INTO documents (user_id, filename, original_name, doc_type, status) VALUES (?, ?, ?, ?, ?)"
    ).run(student.id, 'cert_sample.pdf', '정보처리기사_자격증.pdf', '자격증', 'pending');
  }

  console.log('✅ 초기 데이터 삽입 완료');
}

module.exports = { getDb, initDb };
