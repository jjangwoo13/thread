#!/usr/bin/env node
/**
 * Threads 공식 API — 인사이트 자동 기록 / 예약 글 게시 (2026-11-04)
 *
 * 사용법:
 *   node tools/threads-api.js me          토큰 확인 + 사용자 id를 설정 파일에 저장
 *   node tools/threads-api.js insights    팔로워 수·글별 반응을 인사이트기록.md에 추가
 *   node tools/threads-api.js post        예약글.json에서 시간이 된 「대기」 글을 게시
 *   node tools/threads-api.js post --dry  게시하지 않고 올릴 글만 보여줌
 *   node tools/threads-api.js queue       예약글 목록 보기
 *   node tools/threads-api.js exchange    단기 토큰(1시간) → 장기 토큰(60일) 교환 (appSecret 필요)
 *   node tools/threads-api.js refresh     장기 토큰 연장(60일). insights 때 만료 10일 전이면 자동 연장
 *
 * 작업 스케줄러(threads-task.ps1): 30분마다 post, 매일 23:50 insights.
 * 토큰은 tools/threads-config.json (gitignore) — threads-config.example.json 참고.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://graph.threads.net/v1.0';
const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(__dirname, 'threads-config.json');
const QUEUE = path.join(ROOT, '예약글.json');
const REPORT = path.join(ROOT, '인사이트기록.md');
const HISTORY = path.join(__dirname, 'insights-log.json');
const LOG = path.join(__dirname, 'threads-auto.log');

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

function log(msg) {
  const line = `[${stamp(new Date())}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function api(method, urlPath, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: config.accessToken });
  const res = await fetch(`${API}${urlPath}?${qs}`, { method });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${method} ${urlPath} 실패: ${JSON.stringify(json.error || json)}`);
  return json;
}

function saveConfig() {
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
}

// ─── 토큰 ─────────────────────────────────────────────────────────────
async function me() {
  const r = await api('GET', '/me', { fields: 'id,username' });
  config.userId = r.id;
  saveConfig();
  console.log(`연결됨: @${r.username} (id ${r.id})`);
}

async function refresh() {
  const qs = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: config.accessToken });
  const res = await fetch(`https://graph.threads.net/refresh_access_token?${qs}`);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`토큰 연장 실패: ${JSON.stringify(json.error || json)}`);
  config.accessToken = json.access_token;
  config.expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  saveConfig();
  log(`토큰 연장 완료 — 만료 ${config.expiresAt.slice(0, 10)}`);
}

// 단기 토큰(1시간)을 장기 토큰(60일)으로 바꿈 — 설정 파일에 appSecret 필요
async function exchange() {
  const qs = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: config.appSecret, access_token: config.accessToken });
  const res = await fetch(`https://graph.threads.net/access_token?${qs}`);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`장기 토큰 교환 실패: ${JSON.stringify(json.error || json)}`);
  config.accessToken = json.access_token;
  config.expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  saveConfig();
  log(`장기 토큰 교환 완료 — 만료 ${config.expiresAt.slice(0, 10)}`);
}

async function refreshIfNeeded() {
  if (!config.expiresAt) return;
  const daysLeft = (new Date(config.expiresAt) - Date.now()) / 86400000;
  if (daysLeft < 10) await refresh();
}

// ─── 인사이트 ─────────────────────────────────────────────────────────
async function mediaMetrics(id) {
  // views·shares는 문서상 「개발 중」이라 실패하면 기본 지표만 다시 요청
  try {
    const r = await api('GET', `/${id}/insights`, { metric: 'views,likes,replies,reposts,quotes' });
    return Object.fromEntries(r.data.map(m => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
  } catch {
    const r = await api('GET', `/${id}/insights`, { metric: 'likes,replies,reposts,quotes' });
    return Object.fromEntries(r.data.map(m => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
  }
}

async function insights() {
  await refreshIfNeeded();
  const u = await api('GET', '/me/threads_insights', { metric: 'followers_count' });
  const followers = u.data[0]?.total_value?.value ?? 0;

  const list = await api('GET', '/me/threads', { fields: 'id,text,timestamp,permalink', limit: 20 });
  const posts = [];
  for (const p of list.data) {
    posts.push({ id: p.id, date: p.timestamp.slice(0, 10), text: (p.text || '').split('\n')[0], permalink: p.permalink, ...(await mediaMetrics(p.id)) });
  }

  const history = fs.existsSync(HISTORY) ? JSON.parse(fs.readFileSync(HISTORY, 'utf8')) : [];
  const prev = history[history.length - 1];
  const now = stamp(new Date());
  history.push({ at: now, followers, posts });
  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2) + '\n');

  const diff = prev ? followers - prev.followers : null;
  const lines = [
    '',
    `## ${now}`,
    '',
    `팔로워 **${followers}명**` + (diff === null ? '' : ` (직전 기록 ${prev.at} 대비 ${diff >= 0 ? '+' : ''}${diff})`),
    '',
    '| 올린 날 | 첫 줄 | 조회 | 하트 | 답글 | 리포스트 | 인용 |',
    '|---|---|---|---|---|---|---|',
    ...posts.map(p => `| ${p.date} | ${p.text.replace(/\|/g, '/').slice(0, 30)} | ${p.views ?? '-'} | ${p.likes} | ${p.replies} | ${p.reposts} | ${p.quotes} |`),
  ];
  if (!fs.existsSync(REPORT)) fs.writeFileSync(REPORT, '# Threads 인사이트 기록\n\n`node tools/threads-api.js insights`가 매일 23:50 자동으로 추가함.\n');
  fs.appendFileSync(REPORT, lines.join('\n') + '\n');
  log(`인사이트 기록 — 팔로워 ${followers}, 글 ${posts.length}개`);
}

// ─── 예약 게시 ─────────────────────────────────────────────────────────
function readQueue() {
  return fs.existsSync(QUEUE) ? JSON.parse(fs.readFileSync(QUEUE, 'utf8')) : [];
}

function parseAt(at) {
  const [d, t] = at.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = (t || '00:00').split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi);
}

async function post(dry) {
  const queue = readQueue();
  const due = queue.filter(q => q.status === '대기' && parseAt(q.at) <= new Date());
  if (!due.length) return console.log('올릴 글 없음');
  for (const q of due) {
    if (dry) { console.log(`[올릴 예정] ${q.at} — ${q.text.split('\n')[0]}`); continue; }
    try {
      const params = { media_type: 'TEXT', text: q.text };
      if (q.topic_tag) params.topic_tag = q.topic_tag;
      const c = await api('POST', `/${config.userId}/threads`, params);
      await new Promise(r => setTimeout(r, 30000)); // 문서 권장: 컨테이너 만든 뒤 평균 30초 대기
      const p = await api('POST', `/${config.userId}/threads_publish`, { creation_id: c.id });
      const info = await api('GET', `/${p.id}`, { fields: 'permalink' });
      Object.assign(q, { status: '게시됨', postedAt: stamp(new Date()), id: p.id, permalink: info.permalink });
      log(`게시 — ${q.text.split('\n')[0]} ${info.permalink}`);
    } catch (e) {
      Object.assign(q, { status: '실패', error: e.message });
      log(`게시 실패 — ${q.text.split('\n')[0]}: ${e.message}`);
    }
    fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + '\n');
  }
}

function showQueue() {
  for (const q of readQueue()) console.log(`${q.status}\t${q.at}\t${q.text.split('\n')[0]}`);
}

const [cmd, arg] = process.argv.slice(2);
const run = { me, insights, refresh, exchange, queue: showQueue, post: () => post(arg === '--dry') }[cmd];
if (!run) {
  console.log('명령: me | insights | post [--dry] | queue | exchange | refresh');
  process.exit(1);
}
Promise.resolve(run()).catch(e => { log(`오류(${cmd}): ${e.message}`); process.exit(1); });
