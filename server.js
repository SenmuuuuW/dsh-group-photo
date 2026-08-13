/**
 * DSH 内测大合影 — server.js
 * 零依赖 Node 服务：GitHub OAuth 授权码回调登录 + 服务端 PAT 成员白名单校验
 * 成员授权零权限（不申请任何 scope）；白名单由 owner 的 read:org PAT 拉取，仅存服务端，绝不下发前端
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

/* ---------------- 配置 ---------------- */
const DEFAULTS = {
  port: 8808,
  clientId: '',
  clientSecret: '',
  org: 'dsh-external',
  pat: '',
  dataFile: 'members.json',
  sessionsFile: 'sessions.json',
  whitelistFile: 'whitelist.json',
  worksFile: 'works.json',
  socialFile: 'social.json',
};
let config = { ...DEFAULTS };
try {
  Object.assign(config, JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')));
} catch { /* 用默认值 */ }
config.clientId = process.env.GH_CLIENT_ID || config.clientId || '';
config.clientSecret = process.env.GH_CLIENT_SECRET || config.clientSecret || '';
config.org = (process.env.GH_ORG || config.org || 'dsh-external');
config.pat = process.env.GH_PAT || config.pat || '';
config.port = Number(process.env.PORT || config.port || 8808);
config.dataFile = path.resolve(ROOT, process.env.GH_DATA_FILE || config.dataFile || 'members.json');
config.sessionsFile = path.resolve(ROOT, process.env.GH_SESSIONS_FILE || config.sessionsFile || 'sessions.json');
config.whitelistFile = path.resolve(ROOT, process.env.GH_WHITELIST_FILE || config.whitelistFile || 'whitelist.json');
config.worksFile = path.resolve(ROOT, process.env.GH_WORKS_FILE || config.worksFile || 'works.json');
config.socialFile = path.resolve(ROOT, process.env.GH_SOCIAL_FILE || config.socialFile || 'social.json');

const GH_HEADERS = {
  'User-Agent': 'dsh-group-photo/2.0',
  Accept: 'application/json',
};

/* ---------------- 数据存储 ---------------- */
let members = [];
try { members = JSON.parse(fs.readFileSync(config.dataFile, 'utf8')); } catch {}
function saveMembers() {
  fs.writeFileSync(config.dataFile, JSON.stringify(members, null, 2));
}

// 点赞/评论：{ likes: { ghId: [login...] }, comments: { ghId: [{login,name,text,at}] } }
let social = { likes: {}, comments: {} };
try { social = JSON.parse(fs.readFileSync(config.socialFile, 'utf8')); } catch {}
function saveSocial() {
  fs.writeFileSync(config.socialFile, JSON.stringify(social, null, 2));
}

let sessions = new Map(); // token -> user
try {
  const s = JSON.parse(fs.readFileSync(config.sessionsFile, 'utf8'));
  for (const [k, v] of Object.entries(s)) sessions.set(k, v);
} catch {}
function saveSessions() {
  fs.writeFileSync(config.sessionsFile, JSON.stringify(Object.fromEntries(sessions), null, 2));
}
function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { ...user, createdAt: Date.now() });
  saveSessions();
  return token;
}

/* ---------------- 冻结白名单（私有期快照，登录只认这份名单） ---------------- */
let frozen = { members: [], frozenAt: null, mtime: 0, ids: new Set(), logins: new Map() };

function loadFrozen() {
  const fp = config.whitelistFile;
  try {
    const st = fs.statSync(fp);
    if (st.mtimeMs === frozen.mtime) return frozen.members.length > 0;
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const ids = new Set();
    const logins = new Map();
    (data.members || []).forEach((m) => { ids.add(m.id); logins.set(String(m.login).toLowerCase(), m.id); });
    frozen = { members: data.members || [], frozenAt: data.frozenAt || null, mtime: st.mtimeMs, ids, logins };
    console.log('[gate] 已加载冻结白名单 · ' + frozen.members.length + ' 名成员（快照于 ' + frozen.frozenAt + '）');
    return true;
  } catch (e) {
    console.log('[gate] 冻结白名单读取失败: ' + e.message);
    return false;
  }
}

/* ---------------- 成员代表作映射（works.json，mtime 热加载） ---------------- */
let works = { map: new Map(), mtime: 0 };

function loadWorks() {
  const fp = config.worksFile;
  try {
    const st = fs.statSync(fp);
    if (st.mtimeMs === works.mtime) return;
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const map = new Map();
    for (const [login, repos] of Object.entries(data)) {
      if (Array.isArray(repos)) map.set(login.toLowerCase(), repos);
    }
    works = { map, mtime: st.mtimeMs };
    console.log('[works] 已加载成员代表作映射 · ' + map.size + ' 名成员');
  } catch (e) {
    console.log('[works] 加载失败: ' + e.message);
  }
}

/* ---------------- GitHub API 工具 ---------------- */
async function ghApi(pathname, token) {
  const r = await fetch('https://api.github.com' + pathname, {
    headers: { ...GH_HEADERS, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

/* ---------------- HTTP 工具 ---------------- */
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionUser(req) {
  const token = parseCookies(req)['dsh_photo_session'];
  if (!token) return null;
  const u = sessions.get(token);
  return u || null;
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/* ---------------- OAuth 授权码回调流程 ---------------- */
const oauthStates = new Map(); // state -> { t, p }

function issueState(p) {
  const s = crypto.randomBytes(16).toString('hex');
  oauthStates.set(s, { t: Date.now(), p: p || '' });
  for (const [k, v] of oauthStates) if (Date.now() - v.t > 600000) oauthStates.delete(k);
  return s;
}

function callbackBase(req) {
  const host = req.headers.host || 'localhost:' + config.port;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https'
    : (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return proto + '://' + host;
}

async function exchangeCode(code, redirectUri) {
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && p === '/healthz') { json(res, 200, { ok: true }); return; }

    // 静态资源（背景图等，仅限 public/ 内已有文件）
    if (req.method === 'GET' && p !== '/') {
      const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
      const fp = path.join(PUBLIC, safe);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
        res.writeHead(200, { 'Content-Type': types[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
        res.end(fs.readFileSync(fp));
        return;
      }
    }

    // 发起登录：跳转 GitHub 授权页（零权限，不申请任何 scope）
    if (req.method === 'GET' && p === '/auth/login') {
      if (!config.clientId || !config.clientSecret) {
        redirect(res, '/?auth=denied&reason=not_configured');
        return;
      }
      const state = issueState(url.searchParams.get('p') || '');
      const redirectUri = callbackBase(req) + '/auth/callback';
      const u = new URL('https://github.com/login/oauth/authorize');
      u.searchParams.set('client_id', config.clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      u.searchParams.set('allow_signup', 'false');
      console.log('[auth] 发起登录 redirect_uri=' + redirectUri);
      redirect(res, u.toString());
      return;
    }

    // GitHub 回调：换 token → 查白名单 → 发会话
    if (req.method === 'GET' && p === '/auth/callback') {
      if (url.searchParams.get('error')) {
        redirect(res, '/?auth=denied&reason=user_denied');
        return;
      }
      const stateParam = url.searchParams.get('state') || '';
      const st = oauthStates.get(stateParam);
      if (!st) {
        redirect(res, '/?auth=denied&reason=bad_state');
        return;
      }
      oauthStates.delete(stateParam);
      const code = url.searchParams.get('code') || '';
      if (!code) { redirect(res, '/?auth=denied&reason=token_error'); return; }

      const redirectUri = callbackBase(req) + '/auth/callback';
      const ex = await exchangeCode(code, redirectUri);
      const token = ex.body && ex.body.access_token;
      if (!token) {
        console.log('[auth] 换 token 失败 → status=' + ex.status + ' error=' + (ex.body && ex.body.error));
        redirect(res, '/?auth=denied&reason=token_error');
        return;
      }
      const me = await ghApi('/user', token);
      if (me.status !== 200 || !me.body || !me.body.login) {
        console.log('[auth] /user 拉取失败 → status=' + me.status);
        redirect(res, '/?auth=denied&reason=token_error');
        return;
      }
      console.log('[gate] 登录用户=' + me.body.login);
      loadFrozen();
      if (frozen.members.length === 0) {
        console.log('[gate] 冻结名单不可用，拒绝入站');
        redirect(res, '/?auth=denied&reason=gate_error');
        return;
      }
      const hit = frozen.ids.has(me.body.id) || frozen.logins.has(String(me.body.login).toLowerCase());
      if (!hit) {
        console.log('[gate] ' + me.body.login + ' 不在冻结名单内，拒绝入站');
        redirect(res, '/?auth=denied&reason=not_member');
        return;
      }
      const user = {
        ghId: me.body.id,
        login: me.body.login,
        name: me.body.name || me.body.login,
        avatar: me.body.avatar_url || '',
      };
      const sessionToken = newSession(user);
      res.setHeader('Set-Cookie', 'dsh_photo_session=' + sessionToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800');
      console.log('[auth] ✓ ' + user.login + ' 验证通过，已入站');
      redirect(res, '/' + (st.p ? '?p=' + encodeURIComponent(st.p) : ''));
      return;
    }

    // 合影数据：仅内测成员可看
    if (req.method === 'GET' && p === '/api/members') {
      const u = sessionUser(req);
      if (!u) { json(res, 401, { error: 'unauthorized' }); return; }
      loadWorks();
      const list = members.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((m) => {
        const w = works.map.get(String(m.login).toLowerCase()) || [];
        const likes = social.likes[m.ghId] || [];
        const comments = social.comments[m.ghId] || [];
        const entry = {
          ...m,
          likes: likes.length,
          liked: likes.includes(u.login),
          comments,
        };
        if (w.length) entry.works = w;
        return entry;
      });
      json(res, 200, { members: list });
      return;
    }

    // 当前会话状态
    if (req.method === 'GET' && p === '/api/me') {
      const u = sessionUser(req);
      if (!u) {
        json(res, 200, { loggedIn: false, org: config.org, count: members.length, clientConfigured: !!(config.clientId && config.clientSecret) });
        return;
      }
      const joined = members.find((m) => m.ghId === u.ghId) || null;
      json(res, 200, { loggedIn: true, user: u, joined, org: config.org, count: members.length, clientConfigured: !!(config.clientId && config.clientSecret) });
      return;
    }

    // 点赞（toggle）
    if (req.method === 'POST' && p === '/api/like') {
      const u = sessionUser(req);
      if (!u) { json(res, 401, { error: 'unauthorized' }); return; }
      const body = await readBody(req).catch(() => '{}');
      let ghId = null;
      try { ghId = Number(JSON.parse(body).ghId); } catch {}
      const target = members.find((m) => m.ghId === ghId);
      if (!target) { json(res, 404, { error: 'no_member' }); return; }
      const list = social.likes[ghId] || (social.likes[ghId] = []);
      const idx = list.indexOf(u.login);
      if (idx >= 0) list.splice(idx, 1); else list.push(u.login);
      saveSocial();
      json(res, 200, { ok: true, likes: list.length, liked: idx < 0 });
      return;
    }

    // 评论
    if (req.method === 'POST' && p === '/api/comment') {
      const u = sessionUser(req);
      if (!u) { json(res, 401, { error: 'unauthorized' }); return; }
      const body = await readBody(req).catch(() => '{}');
      let ghId = null, text = '';
      try {
        const b = JSON.parse(body);
        ghId = Number(b.ghId);
        text = String(b.text || '').trim().slice(0, 140);
      } catch {}
      const target = members.find((m) => m.ghId === ghId);
      if (!target) { json(res, 404, { error: 'no_member' }); return; }
      if (!text) { json(res, 400, { error: 'empty' }); return; }
      const list = social.comments[ghId] || (social.comments[ghId] = []);
      list.push({ login: u.login, name: u.name, text, at: new Date().toISOString() });
      saveSocial();
      json(res, 200, { ok: true, comments: list });
      return;
    }

    // 删除评论（仅作者本人）
    if (req.method === 'POST' && p === '/api/comment/delete') {
      const u = sessionUser(req);
      if (!u) { json(res, 401, { error: 'unauthorized' }); return; }
      const body = await readBody(req).catch(() => '{}');
      let ghId = null, index = -1;
      try { const b = JSON.parse(body); ghId = Number(b.ghId); index = Number(b.index); } catch {}
      const list = social.comments[ghId];
      if (!list || !list[index]) { json(res, 404, { error: 'no_comment' }); return; }
      if (list[index].login !== u.login) { json(res, 403, { error: 'forbidden' }); return; }
      list.splice(index, 1);
      saveSocial();
      json(res, 200, { ok: true, comments: list });
      return;
    }

    // 入镜 / 修改留言
    if (req.method === 'POST' && p === '/api/join') {
      const u = sessionUser(req);
      if (!u) { json(res, 401, { error: 'unauthorized' }); return; }
      const body = await readBody(req).catch(() => '{}');
      let message = '';
      try { message = String(JSON.parse(body).message || '').trim().slice(0, 140); } catch {}
      const existing = members.find((m) => m.ghId === u.ghId);
      if (existing) {
        existing.message = message;
        saveMembers();
        json(res, 200, { member: existing, firstTime: false });
        return;
      }
      const member = {
        ghId: u.ghId,
        login: u.login,
        name: u.name,
        avatar: u.avatar,
        message,
        order: members.length + 1,
        joinedAt: new Date().toISOString(),
      };
      members.push(member);
      saveMembers();
      json(res, 200, { member, firstTime: true });
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[server]', e);
    json(res, 500, { error: 'internal_error' });
  }
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

loadFrozen();
loadWorks();

server.listen(config.port, () => {
  console.log('');
  console.log('  📸  DSH 内测大合影已启动（OAuth 回调流程 + 冻结白名单）');
  console.log('  ─────────────────────────────────────────');
  console.log('  本地:  http://localhost:' + config.port);
  console.log('  组织:  https://github.com/' + config.org);
  console.log('  OAuth: ' + (config.clientId ? 'Client ID ✓' : '⚠️ 缺 Client ID'));
  console.log('         ' + (config.clientSecret ? 'Client Secret ✓' : '⚠️ 缺 Client Secret（config.json 填 clientSecret 后重启）'));
  console.log('  白名单: ' + (frozen.members.length ? '冻结名单已加载 ✓（' + frozen.members.length + ' 人）' : '⚠️ 冻结名单不可用（运行 node freeze-whitelist.js 生成）'));
  console.log('  数据:  ' + config.dataFile);
  console.log('');
});
