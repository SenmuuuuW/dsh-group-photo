/**
 * DSH 内测大合影 — 白名单冻结脚本
 * 用法: node freeze-whitelist.js
 * 用 config.json 里的 PAT 一次性拉取组织全量成员（含隐藏），快照为本地白名单 whitelist.json
 * 冻结后服务端登录校验只认这份名单，与组织后续变化无关；PAT 此后可安全 revoke
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const org = cfg.org || 'dsh-external';
const pat = cfg.pat || process.env.GH_PAT || '';
if (!pat) {
  console.error('✗ 缺少 PAT：请在 config.json 的 pat 字段填写（或设置 GH_PAT 环境变量）');
  process.exit(1);
}

(async () => {
  const list = [];
  let page = 1;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(
      'https://api.github.com/orgs/' + encodeURIComponent(org) + '/members?per_page=100&page=' + page,
      {
        headers: {
          'User-Agent': 'dsh-freeze/1.0',
          Accept: 'application/json',
          Authorization: 'Bearer ' + pat,
        },
      }
    );
    if (r.status !== 200) {
      console.error('✗ 拉取成员失败 status=' + r.status);
      process.exit(1);
    }
    const body = await r.json();
    if (!Array.isArray(body) || body.length === 0) break;
    body.forEach((u) => list.push({ id: u.id, login: u.login }));
    const link = r.headers.get('link') || '';
    if (!link.includes('rel="next"')) break;
    page++;
  }
  const out = {
    org,
    frozenAt: new Date().toISOString(),
    count: list.length,
    members: list,
  };
  fs.writeFileSync(path.join(ROOT, 'whitelist.json'), JSON.stringify(out, null, 2));
  console.log('✓ 已冻结 ' + list.length + ' 名成员 → whitelist.json（快照时间 ' + out.frozenAt + '）');
})();
