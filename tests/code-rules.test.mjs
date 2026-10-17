// 코드 규칙 표 기반 테스트 — 규칙마다 걸려야 하는 코드(bad) 한 개, 걸리면 안 되는 코드(good) 한 개
//   node --test tests/code-rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate, applyEdit, severityOf } from '../shared/lib/code-rules.mjs';
import { SPRING_RULES, _resetIndex, domainOf } from '../shared/lib/rules-spring.mjs';
import { REACT_RULES, WEB_RULES, consoleLeftovers, relatedTests, CONFIG_FILES } from '../shared/lib/rules-web.mjs';
import { BACKEND_RULES, MIGRATION_PATH, sourceVsTests } from '../shared/lib/rules-backend.mjs';
import { FRONTEND_RULES, APP_PROTECTED } from '../shared/lib/rules-frontend.mjs';
import { DEFAULTS } from '../shared/lib/config.mjs';

// ---------- 가짜 프로젝트 ----------
function project(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'rules-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const springRoot = project({
  'build.gradle': "plugins { id 'org.springframework.boot' version '3.3.0' }\ndependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }\n",
  'src/main/java/com/x/app/domain/user/User.java': 'package a;\n@Entity\npublic class User { @Id @GeneratedValue Long id; }\n',
  'src/main/java/com/x/app/domain/user/UserRepository.java': 'public interface UserRepository extends JpaRepository<User, Long> {}\n',
  'src/main/java/com/x/app/domain/post/PostRepository.java': 'public interface PostRepository extends JpaRepository<Post, Long> {}\n',
});
const reactRoot = project({ 'package.json': JSON.stringify({ dependencies: { react: '18', next: '14' } }) });
const webRoot = project({ 'package.json': JSON.stringify({ dependencies: { vue: '3' } }) });
const plainRoot = project({});

const cfgWith = (extra = {}) => ({ ...DEFAULTS, ...extra });

function run(rules, root, rel, text, { oldText = null, cfg = cfgWith() } = {}) {
  _resetIndex();
  return evaluate(rules, { rel, oldText, newText: text, ctx: { root, abs: path.join(root, rel), cfg } });
}

const J = 'src/main/java/com/x/app/domain/';

// [규칙 묶음, id, 프로젝트, 경로, bad, good, 설정]
const CASES = [
  // ---------- Spring ----------
  [SPRING_RULES, 'S1', springRoot, `${J}order/OrderService.java`,
    'class OrderService {\n  public void a() { place(); }\n  @Transactional\n  public void place() {}\n}\n',
    'class OrderService {\n  public void a() { helper.place(); }\n  @Transactional\n  public void place() {}\n}\n'],
  [SPRING_RULES, 'S2', springRoot, `${J}pay/PayService.java`,
    'class PayService {\n  @Transactional\n  public void pay(P p) {\n    p.markFailed();\n    throw new PayException();\n  }\n}\n',
    'class PayService {\n  @Transactional(propagation = Propagation.REQUIRES_NEW)\n  public void pay(P p) {\n    p.markFailed();\n    throw new PayException();\n  }\n}\n'],
  [SPRING_RULES, 'S3', springRoot, `${J}noti/Noti.java`,
    '@Entity\nclass Noti {\n  @Id\n  private String id;\n}\n',
    '@Entity\nclass Noti implements Persistable<String> {\n  @Id\n  private String id;\n}\n'],
  [SPRING_RULES, 'S4', springRoot, `${J}qr/redis/QrToken.java`,
    'class QrToken {\n  private long expiresAt;\n  public boolean isExpired() { return expiresAt < 0; }\n}\n',
    'class QrToken {\n  private long expiresAt;\n  @JsonIgnore\n  public boolean isExpired() { return expiresAt < 0; }\n}\n'],
  [SPRING_RULES, 'S5', springRoot, `${J}user/Member.java`, 'import javax.persistence.Entity;\n', 'import jakarta.persistence.Entity;\n'],
  [SPRING_RULES, 'S6', springRoot, `${J}user/UserService.java`,
    'class UserService {\n  @Autowired\n  private UserRepository repo;\n}\n',
    'class UserService {\n  private final UserRepository repo;\n  @Autowired\n  UserService(UserRepository r) { this.repo = r; }\n}\n'],
  [SPRING_RULES, 'S7', springRoot, `${J}user/UserController.java`,
    'class UserController {\n  @GetMapping("/{id}")\n  public User get(Long id) { return null; }\n}\n',
    'class UserController {\n  @GetMapping("/{id}")\n  public UserResponse get(Long id) { return null; }\n}\n'],
  [SPRING_RULES, 'S8', springRoot, `${J}user/UserService.java`,
    'class UserService {\n  @Transactional\n  private void save() {}\n}\n',
    'class UserService {\n  @Transactional\n  public void save() {}\n}\n'],
  [SPRING_RULES, 'S9', springRoot, `${J}user/Profile.java`, '@OneToMany(fetch = FetchType.EAGER)\nList<A> a;\n', '@OneToMany(fetch = FetchType.LAZY)\nList<A> a;\n'],
  [SPRING_RULES, 'S10', springRoot, `${J}user/UserService.java`,
    'class UserService {\n  private final PostRepository postRepository;\n}\n',
    'class UserService {\n  private final UserRepository userRepository;\n}\n'],
  [SPRING_RULES, 'S11', springRoot, `${J}noti/NotiListener.java`,
    'class NotiListener {\n  @EventListener\n  public void on(E e) { publisher.publishEvent(new X()); }\n}\n',
    'class NotiListener {\n  @EventListener\n  public void on(E e) { sender.send(e); }\n}\n'],
  [SPRING_RULES, 'S12', springRoot, `${J}pay/PayService.java`,
    'class PayService {\n  @Transactional\n  public void pay() { tossClient.confirm(x); }\n}\n',
    'class PayService {\n  @Transactional(readOnly = true)\n  public void pay() { tossClient.confirm(x); }\n}\n'],
  [SPRING_RULES, 'S13', springRoot, `${J}user/AuthService.java`, 'log.info("login {} {}", email, password);\n', 'log.info("login {}", email);\n'],
  [SPRING_RULES, 'S14', springRoot, `${J}user/Metrics.java`, 'Tag.of("userId", id);\n', 'Tag.of("status", s);\n'],
  [SPRING_RULES, 'S15', springRoot, 'src/main/resources/application-prod.yml', 'spring:\n  jpa:\n    hibernate:\n      ddl-auto: update\n', 'spring:\n  jpa:\n    hibernate:\n      ddl-auto: validate\n'],
  [SPRING_RULES, 'S16', springRoot, 'src/main/resources/application.yml', 'spring:\n  jpa:\n    show-sql: true\n', 'spring:\n  jpa:\n    open-in-view: false\n'],
  [SPRING_RULES, 'S17', springRoot, `${J}user/Dto.java`, 'import lombok.Getter;\n', 'import java.util.List;\n'],

  // ---------- React / 웹 공통 ----------
  [REACT_RULES, 'R3', reactRoot, 'src/pages/A.tsx', '// @ts-ignore\nconst a = b;\n', '// @ts-expect-error: 라이브러리 타입 누락 (#12)\nconst a = b;\n'],
  [REACT_RULES, 'R3', reactRoot, 'src/pages/B.tsx', '// eslint-disable-next-line react-hooks/exhaustive-deps\n', '// eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만\n'],
  [REACT_RULES, 'R4', reactRoot, 'src/lib/a.ts', 'export const f = (x: any) => x;\n', 'export const f = (x: unknown) => x;\n'],
  [REACT_RULES, 'R6', reactRoot, 'src/lib/http.ts', 'const BASE = "http://localhost:8080";\n', 'const BASE = import.meta.env.VITE_API_URL;\n'],
  [REACT_RULES, 'R7', reactRoot, '.env.local', 'VITE_DB_PASSWORD=abc\n', 'VITE_API_URL=https://x\n'],
  [REACT_RULES, 'R8', reactRoot, 'src/components/List.tsx', 'useEffect(() => { fetch("/api/x"); }, []);\n', 'useEffect(() => { getList(); }, []);\n'],
  [REACT_RULES, 'R9', reactRoot, 'app/a/Client.tsx', "'use client';\nimport fs from 'fs';\n", "'use client';\nimport { useState } from 'react';\nconst u = process.env.NEXT_PUBLIC_URL;\n"],

  // ---------- 다른 백엔드 ----------
  [BACKEND_RULES, 'B1', plainRoot, 'src/repo.ts', 'db.query("SELECT * FROM users WHERE id = " + id);\n', 'db.query("SELECT * FROM users WHERE id = $1", [id]);\n'],
  [BACKEND_RULES, 'B1', plainRoot, 'app/repo.py', 'cur.execute(f"SELECT * FROM users WHERE id = {uid}")\n', 'cur.execute("SELECT * FROM users WHERE id = %s", (uid,))\n'],
  [BACKEND_RULES, 'B1', plainRoot, 'internal/repo.go', 'q := fmt.Sprintf("SELECT * FROM users WHERE id = %s", id)\n', 'row := db.QueryRow("SELECT * FROM users WHERE id = $1", id)\n'],
  [BACKEND_RULES, 'B3', plainRoot, 'src/config.ts', 'const key = "AKIAABCDEFGHIJKLMNOP";\n', 'const key = process.env.AWS_KEY;\n'],
  [BACKEND_RULES, 'B3', plainRoot, 'app/settings.py', 'SECRET_KEY = "s3cr3t-valu3-xyz"\n', 'SECRET_KEY = os.environ["SECRET_KEY"]\n'],
  [BACKEND_RULES, 'B4', plainRoot, 'src/auth.ts', 'console.log("login", user.email, password);\n', 'console.log("login", user.email);\n'],
  [BACKEND_RULES, 'B5', plainRoot, 'app/run.py', 'subprocess.run(cmd, shell=True)\n', 'subprocess.run(["ls", path])\n'],
  [BACKEND_RULES, 'B5', plainRoot, 'app/conf.py', 'data = yaml.load(f)\n', 'data = yaml.safe_load(f)\n'],
  [BACKEND_RULES, 'B6', plainRoot, 'app/svc.py', 'try:\n    a()\nexcept:\n    pass\n', 'try:\n    a()\nexcept ValueError:\n    pass\n'],
  [BACKEND_RULES, 'B6', plainRoot, 'app/svc2.py', 'def add(x, items=[]):\n    pass\n', 'def add(x, items=None):\n    pass\n'],
  [BACKEND_RULES, 'B7', plainRoot, 'internal/svc.go', '\t_ = os.Remove(p)\n', '\tif err := os.Remove(p); err != nil {\n\t\treturn err\n\t}\n'],
  [BACKEND_RULES, 'B8', plainRoot, 'src/app.ts', 'app.use(cors());\n', 'app.use(cors({ origin: ["https://a.com"] }));\n'],
  [BACKEND_RULES, 'B8', plainRoot, 'src/err.ts', 'res.status(500).json({ error: err.stack });\n', 'res.status(500).json({ code: "INTERNAL" });\n'],
  [BACKEND_RULES, 'B9', plainRoot, 'mysite/settings.py', 'DEBUG = True\n', 'DEBUG = os.environ.get("DEBUG") == "1"\n'],
  [BACKEND_RULES, 'B11', plainRoot, 'src/main/kotlin/Svc.kt', 'val n = user!!.name\n', 'val n = user?.name ?: "-"\n'],

  // ---------- 다른 프론트 ----------
  [FRONTEND_RULES, 'V1', webRoot, 'src/components/Post.vue', '<template>\n  <div v-html="body"></div>\n</template>\n', '<template>\n  <div>{{ body }}</div>\n</template>\n'],
  [FRONTEND_RULES, 'V2', webRoot, 'src/components/List.vue', '<template>\n  <li v-for="x in items">{{ x }}</li>\n</template>\n', '<template>\n  <li v-for="x in items" :key="x.id">{{ x }}</li>\n</template>\n'],
  [FRONTEND_RULES, 'V3', webRoot, 'src/components/Form.vue', '<script setup>\nprops.value = 1\n</script>\n', "<script setup>\nemit('update:value', 1)\n</script>\n"],
  [FRONTEND_RULES, 'W7', webRoot, 'src/env.ts', 'const s = import.meta.env.VITE_CLIENT_SECRET;\n', 'const s = import.meta.env.VITE_API_URL;\n'],
  [FRONTEND_RULES, 'A1', plainRoot, 'app/src/main/java/com/x/MainActivity.kt', 'val n = user!!.name\n', 'val n = user?.name\n'],
  [FRONTEND_RULES, 'A2', plainRoot, 'app/src/main/java/com/x/Sync.kt', 'GlobalScope.launch { sync() }\n', 'viewModelScope.launch { sync() }\n'],
  [FRONTEND_RULES, 'A3', plainRoot, 'app/src/main/java/com/x/Repo.kt', 'val u = runBlocking { api.me() }\n', 'suspend fun me() = api.me()\n'],
  [FRONTEND_RULES, 'A4', plainRoot, 'app/src/main/java/com/x/Auth.kt', 'Log.d("auth", "token=$accessToken")\n', 'Log.d("auth", "login ok")\n'],
  [FRONTEND_RULES, 'A5', plainRoot, 'app/src/main/java/com/x/Api.kt', 'const val BASE = "http://10.0.2.2:8080"\n', 'val base = BuildConfig.API_URL\n'],
  [FRONTEND_RULES, 'I1', plainRoot, 'App/Views/HomeView.swift', 'let n = user!.name\nlet d = try! decode()\n', 'guard let n = user?.name else { return }\nlet msg = "Hello! world"\n'],
  [FRONTEND_RULES, 'I2', plainRoot, 'App/Auth.swift', 'print("token: \\(accessToken)")\n', 'print("login ok")\n'],
  [FRONTEND_RULES, 'I3', plainRoot, 'App/Sync.swift', 'DispatchQueue.main.sync { reload() }\n', 'DispatchQueue.main.async { reload() }\n'],
  [FRONTEND_RULES, 'X3', plainRoot, 'app/src/main/java/com/x/Keys.kt', 'val mapsKey = "AIzaSyA1234567890abcdefghijklmnopqrstuv"\n', 'val mapsKey = BuildConfig.MAPS_KEY\n'],
];

for (const [rules, id, root, rel, bad, good] of CASES) {
  test(`${id} ${rel}: 걸려야 할 코드 / 걸리면 안 되는 코드`, () => {
    const hit = run(rules, root, rel, bad).filter((v) => v.id === id);
    assert.ok(hit.length >= 1, `${id} 가 bad 를 못 잡음: ${bad}`);
    const miss = run(rules, root, rel, good).filter((v) => v.id === id);
    assert.deepEqual(miss, [], `${id} 오탐: ${good}\n${JSON.stringify(miss)}`);
  });
}

test('신규 위반만: 수정 전부터 있던 위반은 다시 문제 삼지 않음', () => {
  const rel = `${J}user/Profile.java`;
  const old = '@OneToMany(fetch = FetchType.EAGER)\nList<A> a;\n';
  const same = run(SPRING_RULES, springRoot, rel, old + 'int x;\n', { oldText: old }).filter((v) => v.id === 'S9');
  assert.deepEqual(same, []);
  const more = run(SPRING_RULES, springRoot, rel, old + '@ManyToOne(fetch = FetchType.EAGER)\nB b;\n', { oldText: old }).filter((v) => v.id === 'S9');
  assert.equal(more.length, 1);
});

test('규칙 강도 덮어쓰기: off 는 건너뛰고 warn↔block 전환', () => {
  const rel = `${J}user/Member.java`;
  const bad = 'import javax.persistence.Entity;\n';
  assert.equal(run(SPRING_RULES, springRoot, rel, bad, { cfg: cfgWith({ rules: { S5: 'off' } }) }).filter((v) => v.id === 'S5').length, 0);
  assert.equal(run(SPRING_RULES, springRoot, rel, bad, { cfg: cfgWith({ rules: { S5: 'warn' } }) }).find((v) => v.id === 'S5').severity, 'warn');
  assert.equal(severityOf({ id: 'R4', severity: 'warn' }, { rules: { R4: 'block' } }), 'block');
  assert.equal(severityOf({ id: 'R4', severity: 'warn' }, { rules: { R4: 'bogus' } }), 'warn');
});

test('S5·R9 는 해당 프로젝트에서만 (Boot 2 / Next 아님)', () => {
  const boot2 = project({ 'build.gradle': "plugins { id 'org.springframework.boot' version '2.7.18' }\n" });
  assert.equal(run(SPRING_RULES, boot2, `${J}a/A.java`, 'import javax.persistence.Entity;\n').filter((v) => v.id === 'S5').length, 0);
  const vite = project({ 'package.json': JSON.stringify({ dependencies: { react: '18' } }) });
  assert.equal(run(REACT_RULES, vite, 'src/A.tsx', "'use client';\nimport fs from 'fs';\n").filter((v) => v.id === 'R9').length, 0);
});

test('Edit/MultiEdit 결과 미리 계산', () => {
  assert.equal(applyEdit('a b a', 'Edit', { old_string: 'a', new_string: 'c' }), 'c b a');
  assert.equal(applyEdit('a b a', 'Edit', { old_string: 'a', new_string: 'c', replace_all: true }), 'c b c');
  assert.equal(applyEdit('a b', 'MultiEdit', { edits: [{ old_string: 'a', new_string: 'x' }, { old_string: 'b', new_string: 'y' }] }), 'x y');
  assert.equal(applyEdit('a', 'Edit', { old_string: 'zz', new_string: 'y' }), null);
  assert.equal(applyEdit(null, 'Write', { content: 'new' }), 'new');
});

test('보조 함수: 도메인, 테스트 짝, 설정 파일, 마이그레이션 경로, 보호 파일', () => {
  assert.equal(domainOf('src/main/java/com/x/app/domain/user/UserService.java'), 'user');
  assert.ok(relatedTests('src/components/List.tsx').includes('src/components/List.test.tsx'));
  assert.ok(CONFIG_FILES.test('eslint.config.js') && CONFIG_FILES.test('tsconfig.app.json') && !CONFIG_FILES.test('src/config.ts'));
  for (const p of ['prisma/migrations/20240101_init/migration.sql', 'alembic/versions/abc_add.py', 'users/migrations/0002_auto.py', 'migrations/20240101120000_create.ts', 'db/migrations/000001_init.up.sql'])
    assert.ok(MIGRATION_PATH.test(p), p);
  assert.ok(!MIGRATION_PATH.test('src/migrations.ts'));
  assert.ok(APP_PROTECTED.test('app/google-services.json') && APP_PROTECTED.test('Config/Release.xcconfig') && !APP_PROTECTED.test('app/build.gradle.kts'));
  assert.deepEqual(sourceVsTests(['src/a.ts', 'src/a.test.ts', 'app/x.py']).tests, ['src/a.test.ts']);
  assert.deepEqual(consoleLeftovers(['src/a.ts', 'src/a.test.ts'], (f) => (f === 'src/a.ts' ? 'x\nconsole.log(1)\n' : 'console.log(2)')), ['src/a.ts:2']);
  assert.ok(WEB_RULES.every((r) => r.id.startsWith('W')));
});
