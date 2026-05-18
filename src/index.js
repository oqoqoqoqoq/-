import { signJWT, verifyJWT, hashPassword, verifyPassword } from './crypto.js';

// ─── 응답 헬퍼 ────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  },
});

const err = (msg, status = 400) => json({ error: msg }, status);

// ─── JWT 미들웨어 ─────────────────────────────────────────
async function auth(req, env) {
  const h = req.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return await verifyJWT(h.slice(7), env.JWT_SECRET); }
  catch { return null; }
}

// ─── GPA 계산 ─────────────────────────────────────────────
const GRADE_PTS = { 'A+':4.5,'A0':4.0,'B+':3.5,'B0':3.0,'C+':2.5,'C0':2.0,'D+':1.5,'D0':1.0,'F':0 };
function calcGPA(rows) {
  let pts = 0, cr = 0;
  rows.forEach(r => { pts += (GRADE_PTS[r.grade] ?? 0) * r.credits; cr += r.credits; });
  return cr > 0 ? (pts / cr).toFixed(2) : '0.00';
}

// ─── 라우터 ───────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 헬스체크
    if (path === '/health') return json({ status: 'ok', time: new Date().toISOString() });

    // ── 인증 ──────────────────────────────────────────────

    // POST /api/auth/login
    if (path === '/api/auth/login' && method === 'POST') {
      const { sid, name } = await req.json();
      if (!sid || !name) return err('학번과 이름을 입력해주세요.');
      const user = await env.DB.prepare('SELECT * FROM users WHERE sid = ?').bind(sid).first();
      if (!user || user.name !== name) return err('학번 또는 이름이 올바르지 않습니다.', 401);
      const token = await signJWT(
        { id: user.id, sid: user.sid, name: user.name, role: user.role, track: user.track },
        env.JWT_SECRET
      );
      return json({ token, user: { id: user.id, sid: user.sid, name: user.name, role: user.role, track: user.track } });
    }

    // POST /api/auth/register
    if (path === '/api/auth/register' && method === 'POST') {
      const { sid, name, password, track = 1 } = await req.json();
      if (!sid || !name || !password) return err('학번, 이름, 비밀번호를 모두 입력해주세요.');
      if (!/^\d{8}$/.test(sid)) return err('학번은 8자리 숫자여야 합니다.');
      const existing = await env.DB.prepare('SELECT id FROM users WHERE sid = ?').bind(sid).first();
      if (existing) return err('이미 등록된 학번입니다.', 409);
      const hash = await hashPassword(password);
      const result = await env.DB.prepare(
        "INSERT INTO users (sid, name, password_hash, role, track) VALUES (?, ?, ?, 'student', ?)"
      ).bind(sid, name, hash, track).run();
      const uid = result.meta.last_row_id;
      await env.DB.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').bind(uid, '졸업요건관리 시스템에 오신 것을 환영합니다!').run();
      const token = await signJWT({ id: uid, sid, name, role: 'student', track }, env.JWT_SECRET);
      return json({ token, user: { id: uid, sid, name, role: 'student', track } }, 201);
    }

    // 이하 인증 필요
    const user = await auth(req, env);

    // GET /api/auth/me
    if (path === '/api/auth/me' && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const u = await env.DB.prepare('SELECT id,sid,name,role,track,created_at FROM users WHERE id=?').bind(user.id).first();
      return json(u);
    }

    // PUT /api/auth/track
    if (path === '/api/auth/track' && method === 'PUT') {
      if (!user) return err('인증이 필요합니다.', 401);
      const { track } = await req.json();
      if (![1,2,3].includes(Number(track))) return err('트랙은 1, 2, 3 중 하나여야 합니다.');
      await env.DB.prepare('UPDATE users SET track=? WHERE id=?').bind(Number(track), user.id).run();
      return json({ message: '트랙이 변경되었습니다.', track: Number(track) });
    }

    // ── 과목 ──────────────────────────────────────────────

    // GET /api/courses/catalog
    if (path === '/api/courses/catalog' && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const cat = url.searchParams.get('category');
      const rows = cat
        ? await env.DB.prepare('SELECT * FROM courses WHERE category=? ORDER BY code').bind(cat).all()
        : await env.DB.prepare('SELECT * FROM courses ORDER BY category,code').all();
      return json(rows.results);
    }

    // GET /api/courses/completed
    if (path === '/api/courses/completed' && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const rows = await env.DB.prepare(`
        SELECT cc.id, cc.course_id, cc.semester, cc.grade, cc.credits, cc.created_at,
               c.code, c.name, c.category
        FROM completed_courses cc JOIN courses c ON cc.course_id=c.id
        WHERE cc.user_id=? ORDER BY cc.semester DESC, c.code
      `).bind(user.id).all();
      return json(rows.results);
    }

    // GET /api/courses/summary
    if (path === '/api/courses/summary' && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const u = await env.DB.prepare('SELECT track FROM users WHERE id=?').bind(user.id).first();
      const completed = await env.DB.prepare(`
        SELECT cc.grade, cc.credits, c.category
        FROM completed_courses cc JOIN courses c ON cc.course_id=c.id WHERE cc.user_id=?
      `).bind(user.id).all();
      const reqs = await env.DB.prepare('SELECT category,required_credits FROM track_requirements WHERE track=?').bind(u.track).all();

      const byCategory = {};
      let totalCredits = 0;
      completed.results.forEach(c => {
        byCategory[c.category] = (byCategory[c.category] || 0) + c.credits;
        totalCredits += c.credits;
      });

      const gpa = calcGPA(completed.results);
      const reqTotal = reqs.results.reduce((s, r) => s + r.required_credits, 0);
      const progress = reqTotal > 0 ? Math.min((totalCredits / reqTotal) * 100, 100).toFixed(1) : '0.0';

      return json({
        gpa, total_credits: totalCredits, required_total: reqTotal,
        progress_pct: Number(progress), track: u.track,
        by_category: byCategory,
        requirements: reqs.results.map(r => ({
          category: r.category, required: r.required_credits,
          earned: byCategory[r.category] || 0,
          satisfied: (byCategory[r.category] || 0) >= r.required_credits
        }))
      });
    }

    // POST /api/courses/completed
    if (path === '/api/courses/completed' && method === 'POST') {
      if (!user) return err('인증이 필요합니다.', 401);
      const { course_id, semester, grade } = await req.json();
      const validGrades = ['A+','A0','B+','B0','C+','C0','D+','D0','F'];
      if (!course_id || !semester || !grade) return err('과목, 학기, 성적을 모두 입력해주세요.');
      if (!validGrades.includes(grade)) return err('유효하지 않은 성적입니다.');
      const course = await env.DB.prepare('SELECT * FROM courses WHERE id=?').bind(Number(course_id)).first();
      if (!course) return err('존재하지 않는 과목입니다.', 404);
      const dup = await env.DB.prepare('SELECT id FROM completed_courses WHERE user_id=? AND course_id=?').bind(user.id, Number(course_id)).first();
      if (dup) return err('이미 이수내역에 추가된 과목입니다.', 409);
      const result = await env.DB.prepare(
        'INSERT INTO completed_courses (user_id,course_id,semester,grade,credits) VALUES (?,?,?,?,?)'
      ).bind(user.id, Number(course_id), semester, grade, course.credits).run();
      return json({ id: result.meta.last_row_id, course_id: Number(course_id), semester, grade, credits: course.credits, code: course.code, name: course.name, category: course.category }, 201);
    }

    // DELETE /api/courses/completed/:id
    const delCourse = path.match(/^\/api\/courses\/completed\/(\d+)$/);
    if (delCourse && method === 'DELETE') {
      if (!user) return err('인증이 필요합니다.', 401);
      const result = await env.DB.prepare('DELETE FROM completed_courses WHERE id=? AND user_id=?').bind(Number(delCourse[1]), user.id).run();
      if (result.meta.changes === 0) return err('이수내역을 찾을 수 없습니다.', 404);
      return json({ message: '삭제되었습니다.' });
    }

    // PUT /api/courses/completed/:id
    const editCourse = path.match(/^\/api\/courses\/completed\/(\d+)$/);
    if (editCourse && method === 'PUT') {
      if (!user) return err('인증이 필요합니다.', 401);
      const { semester, grade } = await req.json();
      const row = await env.DB.prepare('SELECT * FROM completed_courses WHERE id=? AND user_id=?').bind(Number(editCourse[1]), user.id).first();
      if (!row) return err('이수내역을 찾을 수 없습니다.', 404);
      await env.DB.prepare('UPDATE completed_courses SET semester=COALESCE(?,semester), grade=COALESCE(?,grade) WHERE id=?')
        .bind(semester || null, grade || null, Number(editCourse[1])).run();
      return json({ message: '수정되었습니다.' });
    }

    // ── 증빙자료 ──────────────────────────────────────────

    // GET /api/documents
    if (path === '/api/documents' && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const rows = user.role === 'admin'
        ? await env.DB.prepare(`SELECT d.*,u.name as student_name,u.sid as student_sid FROM documents d JOIN users u ON d.user_id=u.id ORDER BY d.submitted_at DESC`).all()
        : await env.DB.prepare('SELECT * FROM documents WHERE user_id=? ORDER BY submitted_at DESC').bind(user.id).all();
      return json(rows.results);
    }

    // POST /api/documents
    if (path === '/api/documents' && method === 'POST') {
      if (!user) return err('인증이 필요합니다.', 401);
      const body = await req.json();
      const { original_name, doc_type } = body;
      if (!original_name || !doc_type) return err('파일명과 자료 유형을 입력해주세요.');
      const validTypes = ['어학성적','자격증','수상실적','기타'];
      if (!validTypes.includes(doc_type)) return err('유효하지 않은 자료 유형입니다.');
      const result = await env.DB.prepare(
        "INSERT INTO documents (user_id,original_name,doc_type,status) VALUES (?,?,?,'pending')"
      ).bind(user.id, original_name, doc_type).run();
      const admin = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
      if (admin) await env.DB.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').bind(admin.id, `${user.name} 학생이 증빙자료(${doc_type})를 제출했습니다.`).run();
      return json({ id: result.meta.last_row_id, original_name, doc_type, status: 'pending' }, 201);
    }

    // PATCH /api/documents/:id/review
    const reviewDoc = path.match(/^\/api\/documents\/(\d+)\/review$/);
    if (reviewDoc && method === 'PATCH') {
      if (!user || user.role !== 'admin') return err('관리자 권한이 필요합니다.', 403);
      const { status, admin_note } = await req.json();
      if (!['approved','rejected'].includes(status)) return err("status는 'approved' 또는 'rejected'여야 합니다.");
      const doc = await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(Number(reviewDoc[1])).first();
      if (!doc) return err('자료를 찾을 수 없습니다.', 404);
      await env.DB.prepare("UPDATE documents SET status=?,admin_note=?,reviewed_at=datetime('now','localtime') WHERE id=?")
        .bind(status, admin_note || null, Number(reviewDoc[1])).run();
      const msg = status === 'approved'
        ? `증빙자료(${doc.original_name})가 승인되었습니다.`
        : `증빙자료(${doc.original_name})가 반려되었습니다. ${admin_note || ''}`;
      await env.DB.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').bind(doc.user_id, msg).run();
      return json({ message: `${status === 'approved' ? '승인' : '반려'}되었습니다.` });
    }

    // DELETE /api/documents/:id
    const delDoc = path.match(/^\/api\/documents\/(\d+)$/);
    if (delDoc && method === 'DELETE') {
      if (!user) return err('인증이 필요합니다.', 401);
      const doc = await env.DB.prepare('SELECT * FROM documents WHERE id=? AND user_id=?').bind(Number(delDoc[1]), user.id).first();
      if (!doc) return err('자료를 찾을 수 없습니다.', 404);
      if (doc.status !== 'pending') return err('이미 검토된 자료는 삭제할 수 없습니다.');
      await env.DB.prepare('DELETE FROM documents WHERE id=?').bind(Number(delDoc[1])).run();
      return json({ message: '삭제되었습니다.' });
    }

    // ── 알림 ──────────────────────────────────────────────

    // GET /api/notifications
    if (path === '/api/notifications' && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const rows = await env.DB.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
      const unread = rows.results.filter(n => !n.is_read).length;
      return json({ notifications: rows.results, unread_count: unread });
    }

    // PATCH /api/notifications/read-all
    if (path === '/api/notifications/read-all' && method === 'PATCH') {
      if (!user) return err('인증이 필요합니다.', 401);
      await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').bind(user.id).run();
      return json({ message: '전체 읽음 처리되었습니다.' });
    }

    // PATCH /api/notifications/:id/read
    const readNotif = path.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (readNotif && method === 'PATCH') {
      if (!user) return err('인증이 필요합니다.', 401);
      await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').bind(Number(readNotif[1]), user.id).run();
      return json({ message: '읽음 처리되었습니다.' });
    }

    // ── 졸업요건 ──────────────────────────────────────────

    // GET /api/requirements/:track
    const reqTrack = path.match(/^\/api\/requirements\/(\d+)$/);
    if (reqTrack && method === 'GET') {
      if (!user) return err('인증이 필요합니다.', 401);
      const track = Number(reqTrack[1]);
      if (![1,2,3].includes(track)) return err('트랙은 1~3이어야 합니다.');
      const rows = await env.DB.prepare('SELECT * FROM track_requirements WHERE track=?').bind(track).all();
      return json(rows.results);
    }

    // ── 관리자 ────────────────────────────────────────────

    // GET /api/admin/stats
    if (path === '/api/admin/stats' && method === 'GET') {
      if (!user || user.role !== 'admin') return err('관리자 권한이 필요합니다.', 403);
      const totalStudents = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE role='student'").first();
      const pendingDocs = await env.DB.prepare("SELECT COUNT(*) as cnt FROM documents WHERE status='pending'").first();
      const byTrack = await env.DB.prepare("SELECT track, COUNT(*) as cnt FROM users WHERE role='student' GROUP BY track").all();
      const recentDocs = await env.DB.prepare(`SELECT u.name, u.sid, d.doc_type, d.submitted_at as time FROM documents d JOIN users u ON d.user_id=u.id ORDER BY d.submitted_at DESC LIMIT 5`).all();
      return json({ total_students: totalStudents.cnt, pending_docs: pendingDocs.cnt, by_track: byTrack.results, recent_activity: recentDocs.results });
    }

    // GET /api/admin/students
    if (path === '/api/admin/students' && method === 'GET') {
      if (!user || user.role !== 'admin') return err('관리자 권한이 필요합니다.', 403);
      const rows = await env.DB.prepare(`
        SELECT u.id,u.sid,u.name,u.track,u.created_at,
               COUNT(cc.id) as completed_count, COALESCE(SUM(cc.credits),0) as total_credits
        FROM users u LEFT JOIN completed_courses cc ON cc.user_id=u.id
        WHERE u.role='student' GROUP BY u.id ORDER BY u.sid
      `).all();
      return json(rows.results);
    }

    // POST /api/admin/notify
    if (path === '/api/admin/notify' && method === 'POST') {
      if (!user || user.role !== 'admin') return err('관리자 권한이 필요합니다.', 403);
      const { user_id, message } = await req.json();
      if (!message) return err('메시지를 입력해주세요.');
      if (user_id) {
        await env.DB.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').bind(Number(user_id), message).run();
        return json({ message: '알림을 발송했습니다.' });
      } else {
        const students = await env.DB.prepare("SELECT id FROM users WHERE role='student'").all();
        for (const s of students.results) {
          await env.DB.prepare('INSERT INTO notifications (user_id,message) VALUES (?,?)').bind(s.id, message).run();
        }
        return json({ message: `${students.results.length}명에게 알림을 발송했습니다.` });
      }
    }

    return err('경로를 찾을 수 없습니다.', 404);
  }
};
