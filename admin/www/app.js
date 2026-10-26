// 任何脚本错误都显眼地显示出来，避免“按钮没反应”却无提示。
// 注意：本文件必须是外部脚本（<script src="app.js">），因为 lume 的 httpd 默认
// 带 CSP `script-src 'self'`，会拦截一切内联 <script>。
window.addEventListener('error', (e) => {
  const bar = document.getElementById('statusbar');
  if (bar) { bar.className = 'bad'; bar.textContent = '页面脚本出错: ' + (e.message || e.error); }
});

const $ = (id) => document.getElementById(id);

function show(el, cls, text) {
  el.className = 'result ' + cls;
  el.style.display = 'block';
  el.textContent = text;
}
function setStatus(cls, text) {
  const bar = $('statusbar');
  bar.className = cls;
  bar.textContent = text;
}

async function pingHealth() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const data = await r.json();
    setStatus('ok', '✅ 已连接服务端: ' + JSON.stringify(data));
    return true;
  } catch (e) {
    setStatus('bad', '❌ 无法连接 /api/health: ' + e.message + '（请确认 make dev 正在运行，并硬刷新本页 Cmd/Ctrl+Shift+R）');
    return false;
  }
}

$('healthBtn').addEventListener('click', async () => {
  show($('health'), 'info', '请求中…');
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    show($('health'), 'permit', JSON.stringify(await r.json(), null, 2));
  } catch (e) {
    show($('health'), 'err', '请求失败: ' + e.message);
  }
});

$('authBtn').addEventListener('click', async () => {
  const btn = $('authBtn');
  btn.disabled = true;
  show($('result'), 'info', '请求中…');
  const body = {
    project: $('project').value,
    user: $('user').value,
    res: $('res').value,
    action: $('action').value,
    stage: $('stage').value,
  };
  try {
    const r = await fetch('/api/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const cls = data.decision === 'PERMIT' ? 'permit' : 'deny';
    show($('result'), cls, JSON.stringify(data, null, 2));
  } catch (e) {
    show($('result'), 'err', '请求失败: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('resetBtn').addEventListener('click', () => {
  $('project').value = 'demo';
  $('user').value = 'alice';
  $('res').value = 'data';
  $('action').value = 'read';
  $('stage').value = '';
  $('result').style.display = 'none';
});

// 页面加载即探测连通性，让用户第一时间知道 fetch 是否能通。
pingHealth();
