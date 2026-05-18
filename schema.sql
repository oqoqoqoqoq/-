-- 사용자
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  track INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 과목
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  category TEXT NOT NULL
);

-- 이수내역
CREATE TABLE IF NOT EXISTS completed_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  semester TEXT NOT NULL,
  grade TEXT NOT NULL,
  credits INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, course_id)
);

-- 증빙자료
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  submitted_at TEXT DEFAULT (datetime('now','localtime')),
  reviewed_at TEXT
);

-- 알림
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 졸업요건
CREATE TABLE IF NOT EXISTS track_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track INTEGER NOT NULL,
  category TEXT NOT NULL,
  required_credits INTEGER NOT NULL
);

-- 과목 데이터
INSERT OR IGNORE INTO courses (code, name, credits, category) VALUES
('CS101','컴퓨터개론',3,'전공필수'),
('CS201','자료구조',3,'전공필수'),
('CS301','알고리즘',3,'전공필수'),
('CS401','운영체제',3,'전공필수'),
('CS402','데이터베이스',3,'전공필수'),
('CS403','컴퓨터네트워크',3,'전공필수'),
('CS501','소프트웨어공학',3,'전공필수'),
('CS502','인공지능',3,'전공선택'),
('CS503','머신러닝',3,'전공선택'),
('CS504','컴퓨터비전',3,'전공선택'),
('CS505','자연어처리',3,'전공선택'),
('GE101','글쓰기',3,'교양필수'),
('GE102','영어회화',3,'교양필수'),
('GE103','체육',1,'교양필수'),
('GE201','철학개론',3,'교양선택'),
('GE202','심리학개론',3,'교양선택'),
('GE203','경제학개론',3,'교양선택');

-- 졸업요건 데이터
INSERT OR IGNORE INTO track_requirements (track, category, required_credits) VALUES
(1,'전공필수',45),(1,'전공선택',15),(1,'교양필수',18),(1,'교양선택',12),
(2,'전공필수',48),(2,'전공선택',12),(2,'교양필수',18),(2,'교양선택',12),
(3,'전공필수',42),(3,'전공선택',18),(3,'교양필수',18),(3,'교양선택',12);
