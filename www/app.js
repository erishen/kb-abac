// app.js —— kb-abac 落地页
//
// 必须是外部脚本：lume httpd 默认 CSP 是 `script-src 'self'`，内联 <script> 会被拦截。
//
// 本文件做四件事：
//   1. 六个预设场景卡片，一键调 /api/authorize
//   2. 把引擎返回的 reason 解析成「六步决策链」并渲染（哪步通过 / 哪步短路）
//   3. 拉 GET /api/resources 显示生效的资源表与来源（file / fallback）
//   4. 拉 GET /api/audit 显示最近的拒绝记录

window.addEventListener('error', (e) => {
  const el = document.getElementById('status');
  if (el) { el.className = 'bad'; el.textContent = '页面脚本出错: ' + (e.message || e.error); }
});

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 场景：刻意覆盖五条不同的拒绝路径 + 一条放行路径
// ---------------------------------------------------------------------------
const SCENARIOS = [
  { id: 'own-stage',    title: '学生读自己学段',   desc: 'alice · stage-1',        body: { project: 'demo', user: 'alice', res: 'stage', action: 'read',   stage: 'stage-1' } },
  { id: 'other-stage',  title: '学生读他人学段',   desc: 'alice · stage-9',        body: { project: 'demo', user: 'alice', res: 'stage', action: 'read',   stage: 'stage-9' } },
  { id: 'role-gate',    title: '学生调管理接口',   desc: 'alice · admin manage',   body: { project: 'demo', user: 'alice', res: 'admin', action: 'manage', stage: '' } },
  { id: 'unknown-user', title: '未登记的账号',     desc: 'ghost（fail-closed）',   body: { project: 'demo', user: 'ghost', res: 'data',  action: 'read',   stage: '' } },
  { id: 'bad-action',   title: '资源不支持的动作', desc: 'alice · data manage',    body: { project: 'demo', user: 'alice', res: 'data',  action: 'manage', stage: '' } },
  { id: 'auth-off',     title: '认证关闭（未登录）', desc: 'user = null',          body: { project: 'demo', user: null,    res: 'admin', action: 'manage', stage: '' } },
  { id: 'env-day',      title: '管理员在办公时间操作', desc: 'admin · 14:00',      body: { project: 'demo', user: 'admin', res: 'admin', action: 'manage', stage: '', hour: 14 } },
  { id: 'env-night',    title: '管理员在夜间操作',     desc: 'admin · 22:00',      body: { project: 'demo', user: 'admin', res: 'admin', action: 'manage', stage: '', hour: 22 } },
];

// ---------------------------------------------------------------------------
// 六步决策链。顺序必须与 shared/abac.lume 的 decide_with 一致。
// 每步给出「通过 / 失败」的判定正则（对引擎 reason 里的方括号片段）。
// ---------------------------------------------------------------------------
const STEPS = [
  {
    key: 'auth',
    label: '认证状态',
    passTest: (r) => /\[auth off, unrestricted\]|auth off: unrestricted/.test(r),
  },
  {
    key: 'resource',
    label: '资源类型已知',
    failTest: (r) => /\[resource '[^']*' unknown\]/.test(r),
  },
  {
    key: 'action',
    label: '动作在资源允许集内',
    failTest: (r) => /\[action '[^']*' not allowed on '[^']*'\]/.test(r),
  },
  {
    key: 'subject',
    label: '账号属性可用且已登记',
    failTest: (r) => /\[subject attributes unavailable|\[subject '[^']*' unknown/.test(r),
  },
  {
    key: 'role',
    label: '角色达到资源最低要求',
    failTest: (r) => /\[role '[^']*' below minimum '[^']*'\]/.test(r),
  },
  {
    key: 'stage',
    label: '学段在授权白名单内',
    failTest: (r) => /\[no local stage grant|\[stage '[^']*' not in whitelist\]/.test(r),
  },
  {
    // 第 7 步：环境属性。资源表里声明的 env.deny_when 规则，用运行期事实判定。
    key: 'env',
    label: '环境属性满足规则',
    failTest: (r) => /\[env\.\w+=[^\]]* violates/.test(r),
  },
];

// 从 reason 里取方括号片段，用作每步的「证据」
function fragments(reason) {
  return (reason || '').match(/\[[^\]]*\]/g) || [];
}

// 按步骤语义取出对应片段——不能按下标取：失败时引擎只输出一条片段，
// 按下标会让第 1 步错贴第 6 步的证据。
const STEP_PATTERNS = {
  auth:    /\[auth off/,
  resource:/\[resource '/,
  action:  /\[action '/,
  subject: /\[subject /,
  role:    /\[role '/,
  stage:   /\[no local stage grant|\[stage '/,
  env:     /\[env\.\w+=|\[env ok:/,
};
function evidenceFor(stepKey, frags) {
  const re = STEP_PATTERNS[stepKey];
  if (!re) return '';
  return frags.find((f) => re.test(f)) || '';
}

// 判断每一步的状态：pass / fail / skip / na
function evaluateChain(reason, decision) {
  const isPermit = decision === 'PERMIT';
  const frags = fragments(reason);

  // 认证关闭：引擎在第 1 步直接 PERMIT，后面五步不执行
  const authOff = frags.some((f) => /auth off/.test(f));
  if (authOff) {
    return STEPS.map((s, i) => ({
      ...s,
      state: i === 0 ? 'pass' : 'skip',
      evidence: i === 0 ? '[auth off: unrestricted]' : '未执行（认证关闭已在第 1 步返回）',
    }));
  }

  // 找出失败发生在第几步
  let failIdx = -1;
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    if (s.failTest && s.failTest(reason)) { failIdx = i; break; }
  }

  return STEPS.map((s, i) => {
    const ev = evidenceFor(s.key, frags);
    if (failIdx === -1) {
      // 没有失败：全部通过（PERMIT）。引擎在放行时不逐步输出片段，
      // 只给最后两句总结，故此处不强求每步都有证据。
      return { ...s, state: isPermit ? 'pass' : 'na', evidence: ev };
    }
    if (i < failIdx) return { ...s, state: 'pass', evidence: ev };
    if (i === failIdx) return { ...s, state: 'fail', evidence: ev || '不通过' };
    return { ...s, state: 'skip', evidence: '未执行（已短路）' };
  });
}

const STATE_LABEL = { pass: '通过', fail: '失败', skip: '', na: '—' };

function renderChain(reason, decision) {
  const ol = $('chain');
  ol.innerHTML = '';
  const steps = evaluateChain(reason, decision);

  // 连续的 skip 步骤合并成一行，避免「未执行」占据多行却信息量很低。
  // 例：认证关闭时第 1 步放行，②–⑥ 全部未执行 → 只渲染一行。
  const view = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.state !== 'skip') { view.push({ ...st, index: i }); continue; }
    let j = i;
    while (j + 1 < steps.length && steps[j + 1].state === 'skip') j++;
    // 合并行只给一句归因：判据是「为什么后面都不执行了」，
    // 而不是把每个 skip 行的 evidence 再复述一遍。
    const stoppedByAuth = /auth off|认证关闭/.test(st.evidence || '');
    const why = stoppedByAuth
      ? '认证关闭已在第 1 步放行，后续检查不再执行'
      : '前一步已返回 DENY，后续检查不再执行';
    view.push({ ...st, index: i, spanEnd: j, merged: true, why });
    i = j;
  }

  view.forEach((st) => {
    const li = document.createElement('li');
    li.className = st.state;

    const k = document.createElement('span');
    k.className = 'k';
    if (st.merged && st.spanEnd > st.index) {
      // ② – ⑥ 合并行
      k.textContent = `${cnNum(st.index + 1)} – ${cnNum(st.spanEnd + 1)} 未执行`;
    } else {
      k.textContent = `${st.index + 1}. ${st.label}`;
    }
    li.appendChild(k);

    const rawEv = (st.evidence || '').replace(/^\[|\]$/g, '').trim();
    // 合并行用去重后的归因；单行 skip 用原始证据
    const evText = st.merged && st.spanEnd > st.index ? (st.why || '') : rawEv;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = evText ? ' — ' + evText : '';
    li.appendChild(v);

    if (st.state === 'fail') {
      const stop = document.createElement('span');
      stop.className = 'stop';
      stop.textContent = 'DENY 在此短路';
      li.appendChild(stop);
    }
    ol.appendChild(li);
  });
}

// 1..6 → ①②③④⑤⑥，用于合并行的范围显示
const CN_NUM = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
function cnNum(n) { return CN_NUM[n] || String(n); }

// ---------------------------------------------------------------------------
// 调用决策
// ---------------------------------------------------------------------------
async function runScenario(sc) {
  const card = $('resultCard');
  card.style.display = 'block';
  $('pill').className = 'pill';
  $('pill').textContent = '…';
  $('req').textContent = '';
  $('chain').innerHTML = '';
  $('raw').textContent = '';

  document.querySelectorAll('.sc').forEach((b) => { b.classList.remove('active'); });
  const btn = document.querySelector(`.sc[data-id="${sc.id}"]`);
  if (btn) btn.classList.add('active');

  const body = { ...sc.body };
  // 认证关闭场景要真的传 null，JSON.stringify 会保留 null；这里显式保证
  if (body.user === undefined) body.user = null;

  try {
    const r = await fetch('/api/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const decision = data.decision || (data.err ? 'ERROR' : 'DENY');
    const reason = data.reason || data.err || '';

    $('pill').className = 'pill ' + (decision === 'PERMIT' ? 'permit' : 'deny');
    $('pill').textContent = decision;
    $('req').textContent =
      `user=${body.user === null ? 'null' : body.user} · res=${body.res} · action=${body.action}` +
      (body.stage ? ` · stage=${body.stage}` : '');
    // 把本次使用的环境事实显示出来，让「第 7 步看的是什么」一目了然
    if (data.env) {
      $('envInfo').textContent =
        `环境事实：hour=${data.env.hour} · weekday=${data.env.weekday}`;
      $('envInfo').style.display = 'block';
    } else {
      $('envInfo').style.display = 'none';
    }
    $('raw').textContent = JSON.stringify(data, null, 2);

    if (decision === 'ERROR') {
      $('chain').innerHTML = '<li class="fail"><span class="k">请求失败</span></li>';
      $('raw').textContent = reason;
      return;
    }
    renderChain(reason, decision);
    // 决策可能新增审计记录，稍等一下再刷新
    setTimeout(loadAudit, 250);
  } catch (e) {
    $('pill').className = 'pill deny';
    $('pill').textContent = 'ERROR';
    $('chain').innerHTML = '';
    $('raw').textContent = String(e);
  }
}

function buildScenarios() {
  const box = $('scenarios');
  box.innerHTML = '';
  SCENARIOS.forEach((sc) => {
    const b = document.createElement('button');
    b.className = 'sc';
    b.dataset.id = sc.id;
    b.innerHTML = `<span class="t"></span><span class="d"></span>`;
    b.querySelector('.t').textContent = sc.title;
    b.querySelector('.d').textContent = sc.desc;
    b.addEventListener('click', () => runScenario(sc));
    box.appendChild(b);
  });
}

// ---------------------------------------------------------------------------
// 资源注册表
// ---------------------------------------------------------------------------
async function loadRegistry() {
  const tb = $('regBody');
  try {
    const r = await fetch('/api/resources', { cache: 'no-store' });
    const data = await r.json();
    const projects = data.projects || {};
    const rows = [];
    Object.keys(projects).forEach((p) => {
      const info = projects[p] || {};
      const res = info.resources || {};
      Object.keys(res).forEach((name) => {
        const meta = res[name] || {};
        rows.push({
          project: p,
          name,
          actions: (meta.actions || []).join(', '),
          minRole: meta.min_role || '—',
          source: info.source || 'file',
        });
      });
    });
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">注册表为空</td></tr>';
      return;
    }
    tb.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="mono">${row.name}</td>` +
        `<td class="mono">${row.actions}</td>` +
        `<td class="mono">${row.minRole}</td>` +
        `<td><span class="badge ${row.source === 'file' ? 'file' : 'fallback'}">${row.source}</span></td>`;
      tb.appendChild(tr);
    });
    $('regMeta').textContent = data.from_file
      ? '当前生效来源：data/resources.json（读取成功）'
      : '当前生效来源：代码内置兜底表（data/resources.json 缺失或解析失败）';
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="4" style="color:var(--deny)">加载失败: ${e.message}</td></tr>`;
  }
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------
async function loadAudit() {
  const ul = $('auditList');
  try {
    const r = await fetch('/api/audit', { cache: 'no-store' });
    const data = await r.json();
    const events = Array.isArray(data.events) ? data.events : [];
    if (!events.length) {
      ul.innerHTML = '<li style="color:var(--muted)">暂无记录 —— 点上面的场景制造一次拒绝</li>';
      return;
    }
    ul.innerHTML = '';
    // 只显示 DENY（引擎只在 DENY 与管理动作时写审计），最新的在前
    events.slice().reverse().slice(0, 40).forEach((ev) => {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = ev.subject || ev.actor || '?';

      const res = document.createElement('span');
      res.className = 'res';
      res.textContent = `${ev.resource || ev.action || ''}${ev.action && ev.resource ? '/' + ev.action : ''}`;

      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = (ev.reason || '').replace(/^\[|\]\s*$/g, '').trim() || ev.decision || '';

      li.appendChild(who); li.appendChild(res); li.appendChild(why);
      ul.appendChild(li);
    });
  } catch (e) {
    ul.innerHTML = `<li style="color:var(--deny)">加载失败: ${e.message}</li>`;
  }
}

// ---------------------------------------------------------------------------
// 连通性
// ---------------------------------------------------------------------------
async function ping() {
  const el = $('status');
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const d = await r.json();
    el.className = 'ok';
    el.textContent = `已连接 · service=${d.service} · engine=${d.engine} · 决策在进程内完成（零网络）`;
    return true;
  } catch (e) {
    el.className = 'bad';
    el.textContent = '无法连接 /api/health（请确认服务已启动，并硬刷新本页）: ' + e.message;
    return false;
  }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
buildScenarios();
$('refreshAudit').addEventListener('click', loadAudit);

ping().then((ok) => {
  if (!ok) return;
  loadRegistry();
  loadAudit();
  // 首屏自动演示一次「应该被拒绝」的场景，让页面立刻有内容
  runScenario(SCENARIOS[1]);
});
