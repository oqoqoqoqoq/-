# 졸업요건관리 시스템 — 백엔드 API

**Node.js + Express + SQLite (내장) + JWT**

---

## 실행 방법

```bash
# 1. 패키지 설치
npm install --ignore-scripts

# 2. 환경변수 설정 (.env 파일 수정)
cp .env .env.local   # 필요 시

# 3. 서버 시작
node server.js       # 포트 3000
```

서버 첫 실행 시 `graduation.db`가 자동 생성되고 초기 데이터가 삽입됩니다.

### 기본 계정

| 역할 | 학번/ID | 이름 | 비밀번호 |
|------|---------|------|---------|
| 학생 | 23114234 | 박영은 | student1234 |
| 관리자 | admin | 관리자 | 관리자1234 |

---

## API 엔드포인트

### 인증 (`/api/auth`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/api/auth/login` | 로그인 → JWT 발급 | ❌ |
| POST | `/api/auth/register` | 학생 회원가입 | ❌ |
| GET | `/api/auth/me` | 내 정보 조회 | ✅ |
| PUT | `/api/auth/track` | 졸업 트랙 변경 | ✅ |

#### 로그인 요청/응답 예시
```json
// POST /api/auth/login
{ "sid": "23114234", "name": "박영은" }

// 응답
{
  "token": "eyJhbGci...",
  "user": { "id": 1, "sid": "23114234", "name": "박영은", "role": "student", "track": 1 }
}
```

> **프론트 연동**: `Authorization: Bearer <token>` 헤더로 모든 인증 요청 전송

---

### 과목 / 이수내역 (`/api/courses`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/courses/catalog` | 전체 과목 목록 (`?category=전공필수`) |
| GET | `/api/courses/completed` | 내 이수내역 |
| POST | `/api/courses/completed` | 이수내역 추가 |
| PUT | `/api/courses/completed/:id` | 이수내역 수정 (성적/학기) |
| DELETE | `/api/courses/completed/:id` | 이수내역 삭제 |
| GET | `/api/courses/summary` | **대시보드용** GPA·학점·요건 요약 |

#### summary 응답 예시
```json
{
  "gpa": "3.94",
  "total_credits": 27,
  "required_total": 90,
  "progress_pct": 30.0,
  "track": 1,
  "by_category": { "전공필수": 15, "전공선택": 3, "교양필수": 6, "교양선택": 3 },
  "requirements": [
    { "category": "전공필수", "required": 45, "earned": 15, "satisfied": false },
    ...
  ]
}
```

---

### 증빙자료 (`/api/documents`)

| 메서드 | 경로 | 설명 | 관리자 |
|--------|------|------|--------|
| GET | `/api/documents` | 내 자료 목록 (관리자는 전체) | — |
| GET | `/api/documents/pending` | 검토 대기 목록 | ✅ |
| POST | `/api/documents` | 파일 업로드 (`multipart/form-data`) | — |
| PATCH | `/api/documents/:id/review` | 승인/반려 | ✅ |
| DELETE | `/api/documents/:id` | 삭제 (pending 상태만) | — |

#### 파일 업로드
```
POST /api/documents
Content-Type: multipart/form-data

file: <파일>
doc_type: "어학성적" | "자격증" | "수상실적" | "기타"
```

---

### 알림 (`/api/notifications`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/notifications` | 내 알림 목록 + 미읽음 수 |
| PATCH | `/api/notifications/:id/read` | 읽음 처리 |
| PATCH | `/api/notifications/read-all` | 전체 읽음 |

---

### 졸업요건 (`/api/requirements`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/requirements/:track` | 트랙별 졸업요건 (1~3) |

---

### 관리자 (`/api/admin`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/admin/stats` | 시스템 통계 |
| GET | `/api/admin/students` | 전체 학생 목록 |
| GET | `/api/admin/students/:id` | 학생 상세 (이수내역+자료) |
| POST | `/api/admin/notify` | 알림 발송 (전체 or 특정 학생) |

---

## 프론트엔드 연동 가이드

### 1. 로그인 후 토큰 저장
```javascript
const res = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sid, name })
});
const { token, user } = await res.json();
localStorage.setItem('token', token);
```

### 2. 인증 헤더 포함 요청
```javascript
const token = localStorage.getItem('token');
const res = await fetch('http://localhost:3000/api/courses/summary', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const summary = await res.json();
```

### 3. 이수내역 추가
```javascript
await fetch('http://localhost:3000/api/courses/completed', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ course_id: 1, semester: '2024-2', grade: 'A+' })
});
```

---

## 파일 구조

```
graduation-backend/
├── server.js          # 진입점
├── .env               # 환경변수
├── graduation.db      # SQLite DB (자동생성)
├── uploads/           # 업로드 파일 저장
├── db/
│   └── init.js        # DB 스키마 + 초기 데이터
├── middleware/
│   └── auth.js        # JWT 미들웨어
└── routes/
    ├── auth.js        # 인증
    ├── courses.js     # 과목/이수내역
    ├── documents.js   # 증빙자료
    └── misc.js        # 알림/요건/관리자
```

## DB 스키마

```
users ─────────────┬── completed_courses ── courses
                   ├── documents
                   └── notifications

track_requirements (독립 테이블)
```
