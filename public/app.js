const app = document.querySelector('#app');

function installBrowserDebugGuards() {
  const blockedKeys = new Set(['f12']);
  const blockedModifiedKeys = new Set(['i', 'j', 'c', 'u', 's']);

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  }, true);

  document.addEventListener('keydown', (event) => {
    const key = String(event.key || '').toLowerCase();
    const usesCommandKey = event.ctrlKey || event.metaKey;
    const isDevtoolsCombo = usesCommandKey && event.shiftKey && blockedModifiedKeys.has(key);
    const isSourceOrSaveCombo = usesCommandKey && !event.shiftKey && ['u', 's'].includes(key);

    if (blockedKeys.has(key) || isDevtoolsCombo || isSourceOrSaveCombo) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

installBrowserDebugGuards();

const PASSWORD_RULE_TEXT = '新密码至少 8 位，且必须包含至少一个大写字母、一个小写字母和一个特殊符号。';
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,}$/;

const state = {
  user: null,
  files: [],
  categories: [],
  notices: [],
  feedback: [],
  downloadLogs: [],
  users: [],
  majors: {},
  classes: [],
  settings: {},
  storage: {},
  tab: 'home',
  adminTab: 'dashboard',
  keyword: '',
  category: '全部',
  adminStatus: null,
  loading: true,
  message: '',
  error: ''
};

const roleLabel = { guest: '游客', student: '学生', teacher: '教师', admin: '管理员' };
const adminMenus = [
  ['dashboard', '首页控制台'],
  ['software', '软件资源管理'],
  ['category', '软件分类'],
  ['file', '文件资源管理'],
  ['stats', '下载统计中心'],
  ['content', '公告运营管理'],
  ['feedback', '问题反馈管理'],
  ['user', '用户权限管理'],
  ['log', '系统安全中心'],
  ['settings', '系统设置']
];

function majorOptions(selected = '') {
  return Object.entries(state.majors || {})
    .map(([key, item]) => `<option value="${escapeHtml(key)}" ${selected === key ? 'selected' : ''}>${escapeHtml(item.label || key)}</option>`)
    .join('');
}

function classOptions(selected = '') {
  return `<option value="">未设置班级</option>${(state.classes || [])
    .map((item) => item.name || item)
    .filter(Boolean)
    .map((name) => `<option value="${escapeHtml(name)}" ${selected === name ? 'selected' : ''}>${escapeHtml(name)}</option>`)
    .join('')}`;
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 19).replace('T', ' ');
  return date.toLocaleString('zh-CN', { hour12: false });
}

function isAdmin() {
  return state.user?.role === 'admin';
}

function isSuperAdmin() {
  return isAdmin() && state.user?.account === 'superadmin';
}

function canUpload() {
  return ['teacher', 'admin'].includes(state.user?.role);
}

function canRegisterUsers() {
  return ['teacher', 'admin'].includes(state.user?.role);
}

function allowedAdminMenus() {
  if (isSuperAdmin()) return adminMenus;
  if (isAdmin()) return adminMenus.filter(([id]) => !['log', 'settings'].includes(id));
  if (state.user?.role === 'teacher') return adminMenus.filter(([id]) => id === 'user');
  return [];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || '请求失败' };
  }
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function validatePasswordPolicy(password) {
  const value = String(password || '');
  if (PASSWORD_PATTERN.test(value)) return '';
  return PASSWORD_RULE_TEXT;
}

function normalizeData(data = {}) {
  state.user = data.user || { role: 'guest', name: '游客', account: 'guest' };
  state.files = Array.isArray(data.files) ? data.files : [];
  state.categories = Array.isArray(data.categories) ? data.categories : [];
  state.notices = Array.isArray(data.notices) ? data.notices : [];
  state.feedback = Array.isArray(data.feedback) ? data.feedback : [];
  state.downloadLogs = Array.isArray(data.downloadLogs) ? data.downloadLogs : [];
  state.users = Array.isArray(data.users) ? data.users : [];
  state.majors = data.majors || {};
  state.classes = Array.isArray(data.classes) ? data.classes : [];
  state.settings = data.settings || {};
  state.storage = data.storage || {};

  const derived = [...new Set(state.files.map((file) => file.category).filter(Boolean))];
  if (!state.categories.length && derived.length) {
    state.categories = derived.map((name, index) => ({ id: name, name, sort: index + 1, enabled: true }));
  }
}

function tabFromLocation() {
  const path = window.location.pathname.replace(/^\//, '');
  const hash = window.location.hash.replace('#', '');
  const value = hash || path || 'home';
  return ['home', 'list', 'hot', 'notice', 'feedback', 'profile', 'upload', 'admin', 'login'].includes(value) ? value : 'home';
}

function setTab(tab) {
  state.tab = tab;
  window.location.hash = tab;
  state.error = '';
  state.message = '';
  render();
  if (tab === 'admin' && isAdmin()) loadAdminStatus();
}

async function bootstrap() {
  state.loading = true;
  try {
    normalizeData(await api('/api/bootstrap'));
  } catch (error) {
    state.error = error.message;
    state.user = { role: 'guest', name: '游客', account: 'guest' };
  } finally {
    state.tab = tabFromLocation();
    state.loading = false;
    render();
    if (state.tab === 'admin' && isAdmin()) loadAdminStatus();
  }
}

function visibleNotices() {
  return state.notices.filter((notice) => {
    const scope = notice.scope || '全体师生';
    if (scope === '全体师生') return true;
    if (scope === '仅学生') return state.user?.role === 'student';
    if (scope === '仅教师') return state.user?.role === 'teacher';
    if (scope === '仅管理员') return isAdmin();
    if (scope === '仅超级管理员') return isSuperAdmin();
    return true;
  });
}

function visibleFiles() {
  return state.files
    .filter((file) => file.status !== 'offline')
    .filter((file) => state.category === '全部' || file.category === state.category)
    .filter((file) => {
      const q = state.keyword.trim().toLowerCase();
      if (!q) return true;
      return `${file.title || ''} ${file.description || ''} ${file.category || ''} ${file.originalName || ''} ${file.systemRequire || ''}`.toLowerCase().includes(q);
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function navButton(id, text) {
  return `<button type="button" class="nav-btn ${state.tab === id ? 'active' : ''}" data-tab="${id}">${text}</button>`;
}

function render() {
  if (state.loading) {
    app.innerHTML = `<section class="loading-page"><div class="loader"></div><p>正在加载校园软件站...</p></section>`;
    return;
  }
  app.className = 'platform';
  app.innerHTML = `
    <header class="top-shell">
      <div class="brand-line">
        <span class="brand-mark">${state.settings.logoUrl ? `<img src="${escapeHtml(state.settings.logoUrl)}" alt="Logo">` : escapeHtml((state.settings.logoText || '软').slice(0, 1))}</span>
        <div>
          <strong>${escapeHtml(state.settings.siteName || '智慧校园软件资源管理平台')}</strong>
          <span>软件资源站 · 安装教程 · 版本管理 · 下载统计</span>
        </div>
      </div>
      <nav class="top-nav">
        ${navButton('home', '首页')}
        ${navButton('list', '软件列表')}
        ${navButton('hot', '热门最新')}
        ${navButton('notice', '公告中心')}
        ${state.user?.role !== 'guest' ? navButton('feedback', '问题反馈') : ''}
        ${state.user?.role !== 'guest' ? navButton('profile', '个人中心') : ''}
        ${canUpload() ? navButton('upload', '资源上传') : ''}
        ${navButton('admin', '后台管理')}
      </nav>
      <div class="user-area">
        <span>${escapeHtml(state.user?.name || '游客')} · ${roleLabel[state.user?.role] || state.user?.role || '游客'}</span>
        ${state.user?.role === 'guest' ? `<button type="button" class="small" data-tab="login">登录</button>` : `<button type="button" class="secondary small" id="logoutBtn">退出</button>`}
      </div>
    </header>
    <main>
      ${state.message ? `<div class="toast success">${escapeHtml(state.message)}</div>` : ''}
      ${state.error ? `<div class="toast danger">${escapeHtml(state.error)}</div>` : ''}
      ${renderCurrent()}
    </main>
    ${state.user?.mustChangePassword ? renderPasswordModal() : ''}
  `;
}

function renderCurrent() {
  if (state.tab === 'login') return renderLoginPage();
  if (state.tab === 'list') return renderSoftwareList();
  if (state.tab === 'hot') return renderHotLatest();
  if (state.tab === 'notice') return renderNotices();
  if (state.tab === 'feedback') return renderFeedbackPage();
  if (state.tab === 'profile') return renderProfile();
  if (state.tab === 'upload') return canUpload() ? renderUploadCenter() : renderPermission('只有教师或管理员可以上传资源。');
  if (state.tab === 'admin') return canRegisterUsers() ? renderAdmin() : renderAdminGate();
  return renderHome();
}

function miniStat(label, value, hint = '') {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`;
}

function renderHome() {
  const files = visibleFiles();
  const recommend = state.files.filter((file) => file.isRecommend || file.isHot).slice(0, 6);
  const latest = state.files.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 6);
  return `
    <section class="hero-platform">
      <div class="hero-copy">
        <span class="tag">智慧校园软件资源站</span>
        <h1>统一下载软件、镜像和安装教程</h1>
        <p>面向学校师生的软件资源下载与后台管理系统，支持分类检索、版本维护、下载统计、公告反馈和安全审计。</p>
        <div class="search-bar">
          <input id="keywordInput" value="${escapeHtml(state.keyword)}" placeholder="搜索软件名称、教程、系统或文件名">
          <button type="button" id="searchBtn">搜索</button>
        </div>
      </div>
      <div class="hero-metrics">
        ${miniStat('软件资源', state.files.length, '可维护')}
        ${miniStat('今日下载', todayDownloads(), '实时统计')}
        ${miniStat('分类数量', state.categories.length, '清晰检索')}
        ${miniStat('公告反馈', visibleNotices().length + state.feedback.length, '可追踪')}
      </div>
    </section>
    <section class="content-grid">
      <div class="panel wide">
        <div class="panel-title-row"><h2>软件分类入口</h2><button type="button" class="secondary small" data-tab="list">查看全部</button></div>
        <div class="category-grid">${renderCategoryButtons()}</div>
      </div>
      <aside class="panel">
        <h2>系统公告</h2>
        ${visibleNotices().slice(0, 4).map(renderNoticeCompact).join('') || `<p class="muted">暂无公告</p>`}
      </aside>
    </section>
    <section class="panel">
      <div class="panel-title-row"><h2>推荐软件</h2><span class="muted">${files.length} 个可用资源</span></div>
      <div class="software-grid">${(recommend.length ? recommend : latest).map(renderSoftwareCard).join('') || `<p class="muted">暂无资源</p>`}</div>
    </section>
  `;
}

function renderCategoryButtons() {
  return ['全部', ...state.categories.filter((item) => item.enabled !== false).map((item) => item.name)]
    .map((name) => {
      const tone = categoryTone(name);
      return `<button type="button" class="category-card ${state.category === name ? 'active' : ''}" data-category="${escapeHtml(name)}" style="--category-accent:${tone.accent}; --category-soft:${tone.soft}">
        <span class="category-icon">${escapeHtml(categoryIcon(name))}</span>
        <span><b>${escapeHtml(name)}</b><small>${categorySummary(name)}</small></span>
      </button>`;
    })
    .join('');
}

function categoryIcon(name = '') {
  if (name === '全部') return '全';
  if (/安全|网络|防护|CTF/i.test(name)) return '安';
  if (/镜像|系统|ISO|Windows|Linux/i.test(name)) return '镜';
  if (/开发|编程|代码|IDE|工具/i.test(name)) return '码';
  if (/办公|文档|PDF|Office/i.test(name)) return '办';
  if (/人工智能|AI|模型/i.test(name)) return '智';
  if (/云|虚拟|服务器/i.test(name)) return '云';
  return String(name || '类').slice(0, 1);
}

function categoryTone(name = '') {
  const tones = [
    ['全部', '#2563eb', '#eff6ff'],
    ['安全|网络|防护|CTF', '#0f766e', '#ecfdf5'],
    ['镜像|系统|ISO|Windows|Linux', '#0891b2', '#ecfeff'],
    ['开发|编程|代码|IDE|工具', '#7c3aed', '#f5f3ff'],
    ['办公|文档|PDF|Office', '#ea580c', '#fff7ed'],
    ['人工智能|AI|模型', '#db2777', '#fdf2f8'],
    ['云|虚拟|服务器', '#0284c7', '#f0f9ff']
  ];
  const found = tones.find(([pattern]) => new RegExp(pattern, 'i').test(name));
  return { accent: found?.[1] || '#334155', soft: found?.[2] || '#f8fafc' };
}

function categorySummary(name) {
  if (name === '全部') return `${visibleFiles().length} 个资源`;
  return `${state.files.filter((file) => file.category === name && file.status !== 'offline').length} 个资源`;
}

function renderCategoryPicker() {
  const names = ['全部', ...state.categories.filter((item) => item.enabled !== false).map((item) => item.name)];
  return `
    <div class="category-picker" id="categoryPicker">
      <div class="category-picker-head">
        <div>
          <span class="eyebrow">分类筛选</span>
          <strong>${escapeHtml(state.category || '全部')}</strong>
        </div>
        <input id="categorySearch" placeholder="搜索分类或专业" autocomplete="off">
      </div>
      <div class="category-picker-grid">
        ${names.map((name) => {
          const tone = categoryTone(name);
          return `<button type="button" class="category-option ${state.category === name ? 'active' : ''}" data-picker-category="${escapeHtml(name)}" data-filter-text="${escapeHtml(name)}" style="--category-accent:${tone.accent}; --category-soft:${tone.soft}">
            <span class="category-icon">${escapeHtml(categoryIcon(name))}</span>
            <span><b>${escapeHtml(name)}</b><small>${categorySummary(name)}</small></span>
          </button>`;
        }).join('')}
      </div>
      <select id="categorySelect" class="native-category-select" aria-label="分类选择">${names.map((name) => `<option ${state.category === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
    </div>
  `;
}

function renderSoftwareList() {
  const files = visibleFiles();
  return `
    <section class="panel">
      <div class="toolbar">
        <input id="keywordInput" value="${escapeHtml(state.keyword)}" placeholder="搜索软件、版本、教程、文件名">
        <button type="button" id="searchBtn">筛选</button>
      </div>
      ${renderCategoryPicker()}
      <div class="software-grid">${files.map(renderSoftwareCard).join('') || `<div class="empty-state"><strong>没有匹配的软件资源</strong><span>换一个关键词或分类再试试。</span></div>`}</div>
    </section>
  `;
}

function renderSoftwareCard(file) {
  const tone = categoryTone(file.category || '');
  return `
    <article class="software-card" style="--category-accent:${tone.accent}; --category-soft:${tone.soft}">
      <div class="software-preview">
        <span>${escapeHtml(categoryIcon(file.category || file.title || '软'))}</span>
      </div>
      <div class="software-head">
        <strong class="software-icon">${escapeHtml((file.title || file.originalName || '软').slice(0, 1))}</strong>
        <div>
          <h3>${escapeHtml(file.title || '未命名资源')}</h3>
          <p>${escapeHtml(file.category || '其他')} · ${escapeHtml(file.version || '1.0')} · ${formatSize(file.size)}</p>
        </div>
      </div>
      <p class="software-desc">${escapeHtml(file.description || '暂无简介，管理员可在后台补充软件说明、安装教程和版本信息。')}</p>
      <div class="badge-row">
        ${file.isRecommend ? `<span class="tag green">推荐</span>` : ''}
        ${file.isHot ? `<span class="tag red">热门</span>` : ''}
        <span class="tag">${escapeHtml(file.systemRequire || 'Windows')}</span>
        <span class="tag">下载 ${Number(file.downloadCount || 0)}</span>
      </div>
      ${file.tutorial ? `<details><summary>安装教程</summary><p>${escapeHtml(file.tutorial)}</p></details>` : ''}
      <div class="card-actions">
        <a class="button download-button" href="${escapeHtml(file.downloadUrl || `/api/files/${file.id}/download`)}">下载资源</a>
        ${isAdmin() || file.canDelete ? `<button type="button" class="danger small" data-delete-file="${escapeHtml(file.id)}">删除</button>` : ''}
      </div>
    </article>
  `;
}

function renderHotLatest() {
  const hot = state.files.slice().sort((a, b) => Number(b.downloadCount || 0) - Number(a.downloadCount || 0)).slice(0, 10);
  const latest = state.files.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10);
  return `
    <section class="content-grid">
      <div class="panel"><h2>热门软件排行</h2>${hot.map((file, index) => renderRankRow(file, index)).join('') || `<p class="muted">暂无下载记录</p>`}</div>
      <div class="panel"><h2>最新上传资源</h2>${latest.map((file, index) => renderRankRow(file, index)).join('') || `<p class="muted">暂无资源</p>`}</div>
    </section>
  `;
}

function renderRankRow(file, index) {
  return `<article class="rank-row"><strong>${index + 1}</strong><div><b>${escapeHtml(file.title || file.originalName)}</b><span>${escapeHtml(file.category || '其他')} · 下载 ${Number(file.downloadCount || 0)} · ${formatSize(file.size)}</span></div><a class="small button" href="${escapeHtml(file.downloadUrl || `/api/files/${file.id}/download`)}">下载</a></article>`;
}

function renderNoticeCompact(notice) {
  return `<article class="notice-row"><strong>${escapeHtml(notice.title)}</strong><span>${escapeHtml(notice.content || '')}</span><small>${formatDate(notice.createdAt)}</small></article>`;
}

function renderNotices() {
  return `<section class="panel"><div class="panel-title-row"><h2>公告中心</h2><span class="muted">${visibleNotices().length} 条公告</span></div>${visibleNotices().map(renderNoticeCompact).join('') || `<p class="muted">暂无公告</p>`}</section>`;
}

function renderLoginPage() {
  return `
    <section class="login-page in-app">
      <form class="login-panel form" id="loginForm">
        <div class="brand center">
          <span class="brand-mark big">软</span>
          <h1>登录智慧校园软件资源管理平台</h1>
          <p class="muted">学生、教师、管理员统一入口；超级管理员账号和密码保持原数据库内容不变。</p>
        </div>
        <label>账号<input name="account" autocomplete="username" required placeholder="学号 / 工号 / superadmin"></label>
        <label>密码<input name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"></label>
        <button type="submit">登录平台</button>
        <div class="notice">如果要进入后台，请使用原来的 superadmin 或管理员账号登录。</div>
        <div class="error" id="loginError"></div>
      </form>
    </section>
  `;
}

function renderAdminGate() {
  return `
    <section class="panel permission-panel">
      <span class="tag red">后台管理入口</span>
      <h2>需要管理员权限</h2>
      <p class="muted">后台管理已启用。请先使用原数据库里的超级管理员或管理员账号登录，登录后点击这里会直接进入后台控制台，不会再出现点了没反应的问题。</p>
      <button type="button" data-tab="login">去登录</button>
    </section>
  `;
}

function renderPermission(text) {
  return `<section class="panel permission-panel"><h2>权限不足</h2><p class="muted">${escapeHtml(text)}</p></section>`;
}

function renderFeedbackPage() {
  return `
    <section class="content-grid">
      <form class="panel form" id="feedbackForm">
        <h2>提交问题反馈</h2>
        <label>问题类型<select name="type"><option>下载失败</option><option>安装失败</option><option>链接失效</option><option>教程错误</option><option>其他问题</option></select></label>
        <label>标题<input name="title" required placeholder="例如：VMware 下载链接失效"></label>
        <label>内容<textarea name="content" required placeholder="请说明软件名称、问题现象、截图位置等"></textarea></label>
        <button type="submit">提交反馈</button>
      </form>
      <div class="panel"><h2>我的反馈</h2>${state.feedback.map(renderFeedbackItem).join('') || `<p class="muted">暂无反馈</p>`}</div>
    </section>
  `;
}

function renderFeedbackItem(item) {
  return `<article class="notice-row"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.content)}</span><small>${escapeHtml(item.status || '待处理')} ${item.reply ? ` · 回复：${escapeHtml(item.reply)}` : ''}</small></article>`;
}

function renderProfile() {
  const avatar = state.user?.avatar || '';
  return `
    <section class="content-grid">
      <form class="panel form" id="profileForm">
        <h2>个人中心</h2>
        <label>姓名<input name="name" value="${escapeHtml(state.user?.name || '')}"></label>
        <label>专业<select name="major">${Object.entries(state.majors || {}).map(([key, item]) => `<option value="${escapeHtml(key)}" ${state.user?.major === key ? 'selected' : ''}>${escapeHtml(item.label || key)}</option>`).join('')}</select></label>
        <label>班级<select name="className">${classOptions(state.user?.className || '')}</select></label>
        <button type="submit">保存资料</button>
      </form>
      <form class="panel form avatar-panel" id="avatarForm">
        <h2>头像上传</h2>
        <div class="avatar-preview">${avatar ? `<img src="${escapeHtml(avatar)}" alt="头像">` : `<span>${escapeHtml((state.user?.name || state.user?.account || '用').slice(0, 1))}</span>`}</div>
        <label>选择头像图片<input name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required></label>
        <button type="submit">上传头像</button>
        <p class="muted">支持 png、jpg、jpeg、gif、webp，大小不超过 3MB。</p>
      </form>
      <form class="panel form" id="passwordForm">
        <h2>修改密码</h2>
        <label>原密码<input name="oldPassword" type="password" required></label>
        <label>新密码<input name="newPassword" type="password" minlength="8" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,}" title="${PASSWORD_RULE_TEXT}" required></label>
        <p class="muted">${PASSWORD_RULE_TEXT}</p>
        <button type="submit">修改密码</button>
      </form>
      <div class="panel wide"><h2>下载记录</h2>${state.downloadLogs.map((log) => `<article class="rank-row"><strong>下</strong><div><b>${escapeHtml(log.fileTitle || log.originalName || '资源')}</b><span>${formatDate(log.createdAt)}</span></div></article>`).join('') || `<p class="muted">暂无下载记录</p>`}</div>
    </section>
  `;
}

function renderPasswordModal() {
  return `<div class="modal-mask"><form class="modal form" id="mustPasswordForm"><h2>首次登录请修改密码</h2><label>原密码<input name="oldPassword" type="password" required></label><label>新密码<input name="newPassword" type="password" minlength="8" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,}" title="${PASSWORD_RULE_TEXT}" required></label><p class="muted">${PASSWORD_RULE_TEXT}</p><button type="submit">确认修改</button><div class="error"></div></form></div>`;
}

function renderUploadCenter() {
  return `
    <section class="content-grid">
      <form class="panel form" id="uploadForm">
        <h2>资源上传</h2>
        <label>资源名称<input name="title" placeholder="留空则使用文件名"></label>
        <label>资源区<select name="zone"><option value="software">软件安装包</option><option value="mirror">系统镜像</option></select></label>
        <label>资源说明<textarea name="description" placeholder="版本、课程、安装提示"></textarea></label>
        <label>选择文件<input name="file" type="file" required multiple></label>
        <button type="submit">开始上传</button>
        <div class="progress" id="uploadProgress"><div class="progress-bar"></div><span>0%</span></div>
        <div class="error" id="uploadError"></div>
      </form>
      <div class="panel"><h2>上传说明</h2><p class="muted">支持安装包、压缩包、教程附件和镜像文件。大文件建议放在服务器软件目录后再登记，避免浏览器上传中断。</p></div>
    </section>
  `;
}

async function loadAdminStatus() {
  try {
    state.adminStatus = await api('/api/admin/status');
    state.error = '';
  } catch (error) {
    state.error = error.message;
  } finally {
    render();
  }
}

function fallbackStatus() {
  return {
    counts: {
      files: state.files.length,
      todayDownloads: todayDownloads(),
      totalDownloads: state.downloadLogs.length,
      users: state.users.length,
      pendingFeedback: state.feedback.filter((item) => item.status !== '已处理').length,
      sessions: 0
    },
    storage: { software: {}, mirror: {}, data: {} },
    downloadLogs: state.downloadLogs,
    logs: [],
    feedback: state.feedback,
    recentSessions: []
  };
}

function todayDownloads() {
  const today = new Date().toISOString().slice(0, 10);
  return state.downloadLogs.filter((log) => String(log.createdAt || '').slice(0, 10) === today).length;
}

function renderAdmin() {
  const menus = allowedAdminMenus();
  if (!menus.some(([id]) => id === state.adminTab)) state.adminTab = menus[0]?.[0] || 'dashboard';
  const status = state.adminStatus || fallbackStatus();
  return `
    <section class="admin-layout">
      <aside class="admin-sidebar">
        <strong>后台管理系统</strong>
        <small>当前账号：${escapeHtml(state.user.account)} ${isSuperAdmin() ? '· 超级管理员' : ''}</small>
        ${menus.map(([id, name]) => `<button type="button" class="admin-menu-item ${state.adminTab === id ? 'active' : ''}" data-admin-tab="${id}">${escapeHtml(name)}</button>`).join('')}
      </aside>
      <div class="admin-workspace">
        <div class="panel dashboard-head">
          <div><h2>${escapeHtml(menus.find(([id]) => id === state.adminTab)?.[1] || '后台管理')}</h2><p class="muted">软件资源、文件上传、下载统计、反馈处理、权限与安全审计集中管理。</p></div>
          ${isAdmin() ? '<button type="button" class="secondary small" id="refreshStatusBtn">刷新数据</button>' : ''}
        </div>
        ${renderAdminTab(status)}
      </div>
    </section>
  `;
}

function renderAdminTab(status) {
  if (state.adminTab === 'software') return renderAdminSoftware();
  if (state.adminTab === 'category') return renderAdminCategory();
  if (state.adminTab === 'file') return renderAdminFiles(status);
  if (state.adminTab === 'stats') return renderAdminStats(status);
  if (state.adminTab === 'content') return renderAdminContent();
  if (state.adminTab === 'feedback') return renderAdminFeedback();
  if (state.adminTab === 'user') return renderAdminUsers();
  if (state.adminTab === 'log') return renderAdminLogs(status);
  if (state.adminTab === 'settings') return renderAdminSettings();
  return renderAdminDashboard(status);
}

function renderAdminDashboard(status) {
  const top = state.files.slice().sort((a, b) => Number(b.downloadCount || 0) - Number(a.downloadCount || 0)).slice(0, 6);
  const recent = state.files.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 8);
  const categories = dashboardCategories();
  const storageRows = dashboardStorageRows(status);
  const memoryRate = status.memory?.total ? Math.round(Number(status.memory.used || 0) / Number(status.memory.total || 1) * 100) : 0;
  return `
    <section class="system-dashboard">
      <div class="dashboard-title">
        <div>
          <h2>系统整体仪表盘</h2>
          <p>资源运行、用户规模、下载活跃、存储占用和待处理事项集中查看。</p>
        </div>
        <button type="button" class="secondary small" id="refreshStatusBtn">刷新数据</button>
      </div>
    </section>
    <section class="metric-grid">
      ${miniStat('软件资源', status.counts.files, `软件 ${status.counts.software || 0} · 镜像 ${status.counts.mirror || 0}`)}
      ${miniStat('今日下载', status.counts.todayDownloads, '当天')}
      ${miniStat('总下载量', status.counts.totalDownloads, '累计')}
      ${miniStat('注册用户', status.counts.users, `学生 ${status.counts.students || 0} · 教师 ${status.counts.teachers || 0}`)}
      ${miniStat('待处理反馈', status.counts.pendingFeedback, '工单')}
      ${miniStat('在线会话', status.counts.sessions, '当前')}
    </section>
    <section class="dashboard-grid-pro">
      <div class="panel dashboard-panel">
        <h3>系统健康</h3>
        <div class="health-grid">
          <div><span>CPU</span><strong>${Number(status.cpu?.percent || 0)}%</strong><small>${escapeHtml(status.cpu?.cores || 0)} 核</small></div>
          <div><span>内存</span><strong>${memoryRate}%</strong><small>${formatSize(status.memory?.used || 0)} / ${formatSize(status.memory?.total || 0)}</small></div>
          <div><span>上传任务</span><strong>${Number(status.counts.activeUploads || 0)}</strong><small>进行中</small></div>
          <div><span>运行时长</span><strong>${formatDuration(status.server?.processUptime || 0)}</strong><small>${escapeHtml(status.server?.node || '')}</small></div>
        </div>
      </div>
      <div class="panel dashboard-panel">
        <h3>存储占用</h3>
        <div class="storage-meter-list">${storageRows.map((row) => `<div class="storage-meter"><div><b>${escapeHtml(row.label)}</b><span>${formatSize(row.used)} / ${formatSize(row.total)}</span></div><i><em style="width:${row.rate}%"></em></i></div>`).join('')}</div>
      </div>
      <div class="panel dashboard-panel wide">
        <h3>近 7 日下载趋势</h3>
        ${renderTrend(status.downloadLogs || [])}
      </div>
      <div class="panel dashboard-panel">
        <h3>热门软件下载排行</h3>
        ${top.map(renderTopSoftware).join('') || `<p class="muted">暂无资源</p>`}
      </div>
      <div class="panel dashboard-panel">
        <h3>软件分类统计</h3>
        <div class="compact-list">${categories.slice(0, 8).map((item) => `<div><span>${escapeHtml(item.name)}</span><b>${item.value}</b></div>`).join('') || `<p class="muted">暂无分类数据</p>`}</div>
      </div>
      <div class="panel dashboard-panel">
        <h3>系统提醒</h3>
        <article class="notice-row"><strong>安全建议</strong><span>上传文件已限制后缀和大小，建议后续接入病毒扫描。</span></article>
        <article class="notice-row"><strong>待处理反馈</strong><span>当前还有 ${Number(status.counts.pendingFeedback || 0)} 条反馈需要处理。</span></article>
        <article class="notice-row"><strong>存储清理</strong><span>删除资源时会同步删除磁盘文件，避免占用空间。</span></article>
      </div>
      <div class="panel wide dashboard-panel">
        <h3>最新资源记录</h3>
        <div class="dashboard-record-list">${recent.map((file) => `<article><strong>${escapeHtml(file.title || file.originalName)}</strong><span>${escapeHtml(file.category || '其他')}</span><span>${escapeHtml(file.uploaderName || '管理员')}</span><span>${formatSize(file.size)}</span><time>${formatDate(file.createdAt)}</time></article>`).join('') || `<p class="muted">暂无资源记录</p>`}</div>
      </div>
    </section>
  `;
}

function dashboardStorageRows(status) {
  return [
    { label: '软件目录', info: status.storage?.software || {} },
    { label: '镜像目录', info: status.storage?.mirror || {} },
    { label: '数据目录', info: status.storage?.data || {} }
  ].map((item) => {
    const used = Number(item.info.resourceBytes || item.info.used || 0);
    const total = Number(item.info.total || 0);
    return { label: item.label, used, total, rate: total ? Math.min(100, Math.round(used / total * 100)) : 0 };
  });
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}天`;
  if (hours) return `${hours}小时`;
  return `${minutes}分钟`;
}

function dashboardCategories() {
  const map = new Map();
  for (const file of state.files) map.set(file.category || '其他资源', (map.get(file.category || '其他资源') || 0) + 1);
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
}

function dashboardStorageBreakdown() {
  const groups = [
    { name: '安装包', test: (ext) => ['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm'].includes(ext), value: 0 },
    { name: '文档', test: (ext) => ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(ext), value: 0 },
    { name: '镜像', test: (ext, file) => file.zone === 'mirror' || ['.iso', '.img'].includes(ext), value: 0 },
    { name: '压缩包', test: (ext) => ['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext), value: 0 },
    { name: '其他', test: () => true, value: 0 }
  ];
  for (const file of state.files) {
    const ext = `.${String(file.originalName || '').split('.').pop() || ''}`.toLowerCase();
    const group = groups.find((item) => item.test(ext, file));
    group.value += Number(file.size || 0);
  }
  return groups.filter((item) => item.value > 0);
}

function latestResourceRecords() {
  return state.files.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 8).map((file) => ({
    name: file.title || file.originalName || '资源',
    type: file.category || '其他资源',
    user: file.uploaderName || '管理员',
    status: file.status === 'published' ? '已通过' : '待审核',
    time: formatDate(file.createdAt)
  }));
}

function renderTrend(logs) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(5, 10);
  });
  const counts = days.map((day) => logs.filter((log) => String(log.createdAt || '').slice(5, 10) === day).length);
  const max = Math.max(1, ...counts);
  return `<div class="bar-chart">${days.map((day, index) => `<div><span style="height:${Math.max(8, counts[index] / max * 120)}px"></span><b>${counts[index]}</b><small>${day}</small></div>`).join('')}</div>`;
}

function renderTopSoftware(file) {
  return `<article class="rank-row"><strong>${escapeHtml((file.title || '软').slice(0, 1))}</strong><div><b>${escapeHtml(file.title || file.originalName)}</b><span>${escapeHtml(file.category || '其他')} · 下载 ${Number(file.downloadCount || 0)}</span></div></article>`;
}

function categoryOptions(current = '') {
  const names = [...new Set([
    ...state.categories.map((item) => item.name).filter(Boolean),
    ...state.files.map((file) => file.category).filter(Boolean),
    current
  ].filter(Boolean))];
  return names.map((name) => `<option value="${escapeHtml(name)}" ${String(current || '') === String(name) ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

function renderAdminSoftware() {
  return `
    <section class="content-grid admin-software-grid">
      <form class="panel form" id="uploadForm">
        <h3>新增软件 / 镜像资源</h3>
        <label>资源名称<input name="title" placeholder="留空则使用文件名"></label>
        <label>资源区<select name="zone"><option value="software">软件</option><option value="mirror">镜像</option></select></label>
        <label>软件分类<select name="category" required>${categoryOptions(state.categories[0]?.name || '办公软件')}</select></label>
        <label>说明<textarea name="description" placeholder="版本、课程、安装提示"></textarea></label>
        <label>文件<input name="file" type="file" required multiple></label>
        <button type="submit">上传资源</button>
        <div class="progress" id="uploadProgress"><div class="progress-bar"></div><span>0%</span></div>
        <div class="error" id="uploadError"></div>
      </form>
      <div class="panel wide">
        <div class="panel-title-row"><h3>软件列表</h3><span class="muted">${state.files.length} 个资源</span></div>
        <div class="admin-table software-admin-table">
          <b>名称</b><b>分类</b><b>版本</b><b>状态</b><b>操作</b>
          ${state.files.map(renderSoftwareEditRow).join('') || `<div class="muted">暂无资源</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderSoftwareEditRow(file) {
  return `
    <form class="software-edit-row" data-id="${escapeHtml(file.id)}">
      <input name="title" value="${escapeHtml(file.title || '')}">
      <select name="category">${categoryOptions(file.category || '')}</select>
      <input name="version" value="${escapeHtml(file.version || '1.0')}">
      <select name="status"><option value="published" ${file.status !== 'offline' ? 'selected' : ''}>上架</option><option value="offline" ${file.status === 'offline' ? 'selected' : ''}>下架</option></select>
      <div class="row-actions">
        <label class="check"><input type="checkbox" name="isRecommend" ${file.isRecommend ? 'checked' : ''}>推荐</label>
        <label class="check"><input type="checkbox" name="isHot" ${file.isHot ? 'checked' : ''}>热门</label>
        <button type="submit" class="small">保存</button>
        <button type="button" class="danger small" data-delete-file="${escapeHtml(file.id)}">删除</button>
      </div>
      <textarea name="description" placeholder="软件简介">${escapeHtml(file.description || '')}</textarea>
      <textarea name="tutorial" placeholder="安装教程">${escapeHtml(file.tutorial || '')}</textarea>
      <input name="systemRequire" value="${escapeHtml(file.systemRequire || 'Windows')}" placeholder="适用系统">
    </form>
  `;
}

function renderAdminCategory() {
  return `
    <section class="content-grid">
      <form class="panel form" id="categoryForm">
        <h3>新增分类</h3>
        <label>分类名称<input name="name" required placeholder="办公软件 / 编程开发"></label>
        <label>图标文字<input name="icon" placeholder="可选"></label>
        <label>排序<input name="sort" type="number" value="${state.categories.length + 1}"></label>
        <button type="submit">新增分类</button>
      </form>
      <div class="panel"><h3>分类列表</h3>${state.categories.map((item) => `<article class="rank-row"><strong>${escapeHtml(item.sort || '')}</strong><div><b>${escapeHtml(item.name)}</b><span>${item.enabled === false ? '停用' : '启用'} · ${state.files.filter((file) => file.category === item.name).length} 个资源</span></div><button type="button" class="danger small" data-delete-category="${escapeHtml(item.id)}">删除</button></article>`).join('') || `<p class="muted">暂无分类</p>`}</div>
    </section>
  `;
}

function renderAdminFiles(status) {
  return `
    <section class="content-grid">
      <div class="panel"><h3>文件存储统计</h3>${renderStorage('软件目录', status.storage?.software)}${renderStorage('镜像目录', status.storage?.mirror)}${renderStorage('数据目录', status.storage?.data)}</div>
      <div class="panel"><h3>文件列表</h3>${state.files.map((file) => `<article class="notice-row"><strong>${escapeHtml(file.originalName || file.title)}</strong><span>${escapeHtml(file.diskPath || '')}</span><small>${formatSize(file.size)} · MD5：${escapeHtml(file.md5 || '-')}</small></article>`).join('') || `<p class="muted">暂无文件</p>`}</div>
    </section>
  `;
}

function renderStorage(label, info = {}) {
  const used = Number(info.resourceBytes || info.used || 0);
  const total = Number(info.total || 0);
  const rate = total ? Math.round(used / total * 100) : 0;
  return `<div class="storage-row"><div><b>${escapeHtml(label)}</b><span>${escapeHtml(info.path || '')}</span></div><strong>${formatSize(used)}</strong><div class="progress mini"><div class="progress-bar" style="width:${Math.min(100, rate)}%"></div></div></div>`;
}

function renderAdminStats(status) {
  return `
    <section class="content-grid">
      <div class="panel"><h3>近 7 日下载趋势</h3>${renderTrend(status.downloadLogs || [])}</div>
      <div class="panel"><h3>用户下载记录</h3>${(status.downloadLogs || []).slice(0, 20).map((log) => `<article class="rank-row"><strong>下</strong><div><b>${escapeHtml(log.fileTitle || log.originalName || '资源')}</b><span>${escapeHtml(log.userName || log.account || '')} · ${formatDate(log.createdAt)}</span></div></article>`).join('') || `<p class="muted">暂无下载记录</p>`}</div>
    </section>
  `;
}

function renderAdminContent() {
  return `
    <section class="content-grid">
      <form class="panel form" id="noticeForm">
        <h3>发布公告</h3>
        <label>标题<input name="title" required></label>
        <label>发布范围<select name="scope"><option>全体师生</option><option>仅学生</option><option>仅教师</option><option>仅管理员</option><option>仅超级管理员</option></select></label>
        <label class="check"><input type="checkbox" name="pinned">置顶公告</label>
        <label>内容<textarea name="content" required></textarea></label>
        <button type="submit">发布公告</button>
      </form>
      <div class="panel"><h3>公告列表</h3>${state.notices.map((notice) => `<article class="notice-row"><strong>${notice.pinned ? '📌 ' : ''}${escapeHtml(notice.title)}</strong><span>${escapeHtml(notice.content)}</span><small>${escapeHtml(notice.scope || '全体师生')} · ${formatDate(notice.createdAt)}</small><button type="button" class="danger small" data-delete-notice="${escapeHtml(notice.id)}">删除</button></article>`).join('') || `<p class="muted">暂无公告</p>`}</div>
    </section>
  `;
}

function renderAdminFeedback() {
  return `<section class="panel"><h3>问题反馈管理</h3>${state.feedback.map((item) => `<form class="feedback-handle-row" data-id="${escapeHtml(item.id)}"><div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.type || '问题反馈')} · ${escapeHtml(item.userName || '')} · ${formatDate(item.createdAt)}</span><p>${escapeHtml(item.content)}</p></div><select name="status"><option ${item.status === '待处理' ? 'selected' : ''}>待处理</option><option ${item.status === '处理中' ? 'selected' : ''}>处理中</option><option ${item.status === '已处理' ? 'selected' : ''}>已处理</option></select><input name="reply" value="${escapeHtml(item.reply || '')}" placeholder="处理回复"><button type="submit" class="small">保存</button></form>`).join('') || `<p class="muted">暂无反馈</p>`}</section>`;
}

function renderAdminUsers() {
  if (!canRegisterUsers()) return renderPermission('只有管理员或教师可以注册账号。');
  const canEditUsers = isSuperAdmin();
  const canChooseRole = isAdmin();
  const userRows = (state.users || []).map((user) => {
    const isBuiltIn = user.account === 'superadmin';
    const roleOptions = ['student', 'teacher', 'admin']
      .map((role) => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${escapeHtml(roleLabel[role] || role)}</option>`)
      .join('');
    if (!canEditUsers) {
      return `
        <div class="user-permission-row">
          <label>姓名<input value="${escapeHtml(user.name)}" readonly></label>
          <div class="account-cell"><span>账号</span><b>${escapeHtml(user.account)}</b></div>
          <label>角色<input value="${escapeHtml(roleLabel[user.role] || user.role)}" readonly></label>
          <label>专业<input value="${escapeHtml(state.majors[user.major]?.name || user.major || '-')}" readonly></label>
          <label>班级<input value="${escapeHtml(user.className || '-')}" readonly></label>
          <label>状态<input value="${user.mustChangePassword ? '需改密' : '正常'}" readonly></label>
          <div class="row-actions"><span class="muted">仅超级管理员可调整权限</span></div>
        </div>
      `;
    }
    return `
      <form class="user-permission-row" data-id="${escapeHtml(user.id)}">
        <label>姓名<input name="name" value="${escapeHtml(user.name)}" ${isBuiltIn ? 'readonly' : ''}></label>
        <div class="account-cell"><span>账号</span><b>${escapeHtml(user.account)}</b></div>
        <label>角色<select name="role" ${isBuiltIn ? 'disabled' : ''}>${roleOptions}</select></label>
        <label>专业<select name="major" ${isBuiltIn ? 'disabled' : ''}>${majorOptions(user.major)}</select></label>
        <label>班级<select name="className" ${isBuiltIn ? 'disabled' : ''}>${classOptions(user.className || '')}</select></label>
        <label>状态<select name="mustChangePassword" ${isBuiltIn ? 'disabled' : ''}><option value="false" ${!user.mustChangePassword ? 'selected' : ''}>正常</option><option value="true" ${user.mustChangePassword ? 'selected' : ''}>需改密</option></select></label>
        <div class="row-actions">
          ${isBuiltIn ? '<span class="muted">内置账号</span>' : `<button type="submit" class="small">保存权限</button><button type="button" class="danger small" data-delete-user="${escapeHtml(user.id)}">删除</button>`}
        </div>
      </form>
    `;
  }).join('');
  return `
    <section class="content-grid">
      <form class="panel form" id="userForm">
        <h3>注册账号</h3>
        <label>账号<input name="account" required placeholder="学号 / 工号"></label>
        <label>姓名<input name="name" required></label>
        ${canChooseRole ? '<label>角色<select name="role"><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label>' : '<input type="hidden" name="role" value="student"><label>角色<input value="学生" readonly></label>'}
        <label>专业<select name="major">${majorOptions()}</select></label>
        <label>班级<select name="className">${classOptions()}</select></label>
        <button type="submit">注册账号</button>
        <p class="muted">${canChooseRole ? '管理员可以注册学生、教师和管理员账号。' : '教师只能注册学生账号。'}新账号默认密码为 123456，首次登录强制修改。</p>
      </form>
      ${isSuperAdmin() ? `
      <form class="panel form" id="classForm">
        <h3>新增班级</h3>
        <label>班级全称<input name="name" required placeholder="例如：2025级信息安全技术应用班"></label>
        <button type="submit">新增班级</button>
        <p class="muted">注册账号和编辑用户时会从这里选择完整班级名。</p>
      </form>
      <div class="panel wide">
        <h3>班级列表</h3>
        <div class="class-list">${(state.classes || []).map((item) => `<div class="class-chip"><span>${escapeHtml(item.name || item)}</span><button type="button" class="danger small" data-delete-class="${escapeHtml(item.id || item)}">删除</button></div>`).join('') || '<p class="muted">暂无班级</p>'}</div>
      </div>` : ''}
      <div class="panel wide">
        <div class="section-head">
          <div>
            <h3>用户列表</h3>
            <p class="muted">${canEditUsers ? '可直接调整已有账号的角色、专业和首次登录改密状态。' : '当前仅显示你有权限查看的账号。'}</p>
          </div>
        </div>
        <div class="permission-list">${userRows || `<p class="muted">暂无账号</p>`}</div>
      </div>
    </section>
  `;
}

function renderAdminLogs(status) {
  if (!isSuperAdmin()) return renderPermission('系统安全日志仅超级管理员可用。');
  return `<section class="content-grid"><div class="panel"><h3>操作日志</h3>${(status.logs || []).map((log) => `<article class="notice-row"><strong>${escapeHtml(log.action)}</strong><span>${escapeHtml(log.target || '')} ${escapeHtml(log.detail || '')}</span><small>${escapeHtml(log.operatorName || '')} · ${formatDate(log.createdAt)}</small></article>`).join('') || `<p class="muted">暂无日志</p>`}</div><div class="panel"><h3>在线会话</h3>${(status.recentSessions || []).map((session) => `<article class="rank-row"><strong>会</strong><div><b>${escapeHtml(session.name)}</b><span>${escapeHtml(session.account)} · ${formatDate(session.createdAt)}</span></div></article>`).join('') || `<p class="muted">暂无会话</p>`}</div></section>`;
}

function renderAdminSettings() {
  if (!isSuperAdmin()) return renderPermission('系统设置仅超级管理员可用。');
  const logoUrl = state.settings.logoUrl || '';
  return `
    <section class="content-grid">
      <form class="panel form settings-form" id="settingsForm">
        <h3>系统设置</h3>
        <label>网站名称<input name="siteName" value="${escapeHtml(state.settings.siteName || '智慧校园软件资源管理平台')}"></label>
        <label>Logo 文字<input name="logoText" value="${escapeHtml(state.settings.logoText || '校园软件站')}"></label>
        <label>最大文件 GB<input name="maxFileGb" type="number" value="${escapeHtml(state.settings.maxFileGb || 20)}"></label>
        <label>分片大小 MB<input name="maxChunkMb" type="number" value="${escapeHtml(state.settings.maxChunkMb || 8)}"></label>
        <label class="check"><input type="checkbox" name="requireLoginDownload" ${state.settings.requireLoginDownload !== false ? 'checked' : ''}>下载需要登录</label>
        <label class="check"><input type="checkbox" name="maintenanceMode" ${state.settings.maintenanceMode ? 'checked' : ''}>维护模式</label>
        <label>维护提示<textarea name="maintenanceMessage">${escapeHtml(state.settings.maintenanceMessage || '')}</textarea></label>
        <button type="submit">保存设置</button>
      </form>
      <form class="panel form settings-form logo-settings-form" id="logoForm">
        <h3>Logo 上传</h3>
        <div class="logo-preview">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="当前 Logo">` : `<span>${escapeHtml((state.settings.logoText || '软').slice(0, 1))}</span>`}</div>
        <label>选择 Logo 图片<input name="logo" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required></label>
        <button type="submit">上传 Logo</button>
        <p class="muted">支持 png、jpg、jpeg、gif、webp，大小不超过 3MB。上传后顶部导航优先显示图片 Logo。</p>
      </form>
    </section>
  `;
}

function setProgress(value) {
  const progress = document.querySelector('#uploadProgress');
  if (!progress) return;
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  progress.querySelector('.progress-bar').style.width = `${percent}%`;
  progress.querySelector('span').textContent = `${percent}%`;
}

async function uploadFileWithProgress(form, file, uploadedBefore, totalBytes) {
  const initPayload = Object.fromEntries(new FormData(form));
  delete initPayload.file;
  initPayload.filename = file.name;
  initPayload.size = file.size;

  const init = await api('/api/files/chunk/init', { method: 'POST', body: JSON.stringify(initPayload) });
  const uploadId = init.uploadId;
  const chunkSize = Number(init.chunkSize || 8 * 1024 * 1024);
  if (!uploadId || !Number.isFinite(chunkSize) || chunkSize <= 0) throw new Error('上传初始化失败');

  let sent = 0;
  let index = 0;
  while (sent < file.size) {
    const end = Math.min(sent + chunkSize, file.size);
    const data = new FormData();
    data.set('uploadId', uploadId);
    data.set('index', String(index));
    data.set('offset', String(sent));
    data.set('chunk', file.slice(sent, end), file.name);
    const result = await api('/api/files/chunk/upload', { method: 'POST', body: data });
    sent = Math.max(end, Number(result.receivedBytes || 0));
    index += 1;
    setProgress(((uploadedBefore + sent) / totalBytes) * 100);
  }

  await api('/api/files/chunk/complete', { method: 'POST', body: JSON.stringify({ uploadId }) });
}

function formToJson(form) {
  const data = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => { data[input.name] = input.checked; });
  return data;
}

document.addEventListener('click', async (event) => {
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    event.preventDefault();
    setTab(tabButton.dataset.tab);
    return;
  }

  const adminButton = event.target.closest('[data-admin-tab]');
  if (adminButton) {
    state.adminTab = adminButton.dataset.adminTab;
    render();
    return;
  }

  const categoryButton = event.target.closest('[data-category]');
  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    setTab('list');
    return;
  }

  const pickerCategory = event.target.closest('[data-picker-category]');
  if (pickerCategory) {
    state.category = pickerCategory.dataset.pickerCategory;
    state.keyword = document.querySelector('#keywordInput')?.value || state.keyword;
    render();
    return;
  }

  if (event.target.closest('#searchBtn')) {
    state.keyword = document.querySelector('#keywordInput')?.value || '';
    state.category = document.querySelector('#categorySelect')?.value || state.category;
    setTab('list');
    return;
  }

  if (event.target.closest('#logoutBtn')) {
    await api('/api/logout', { method: 'POST' });
    state.message = '已退出登录';
    await bootstrap();
    setTab('home');
    return;
  }

  const refresh = event.target.closest('#refreshStatusBtn');
  if (refresh) {
    await bootstrap();
    await loadAdminStatus();
    return;
  }

  const deleteFile = event.target.closest('[data-delete-file]');
  if (deleteFile) {
    if (!confirm('确定删除这个资源吗？')) return;
    await api(`/api/files/${deleteFile.dataset.deleteFile}`, { method: 'DELETE' });
    state.message = '资源已删除';
    await bootstrap();
    return;
  }

  const deleteCategory = event.target.closest('[data-delete-category]');
  if (deleteCategory) {
    if (!confirm('确定删除这个分类吗？')) return;
    await api(`/api/admin/categories/${deleteCategory.dataset.deleteCategory}`, { method: 'DELETE' });
    state.message = '分类已删除';
    await bootstrap();
    state.tab = 'admin';
    state.adminTab = 'category';
    render();
    return;
  }

  const deleteNotice = event.target.closest('[data-delete-notice]');
  if (deleteNotice) {
    if (!confirm('确定删除这条公告吗？')) return;
    await api(`/api/admin/notices/${deleteNotice.dataset.deleteNotice}`, { method: 'DELETE' });
    state.message = '公告已删除';
    await bootstrap();
    state.tab = 'admin';
    state.adminTab = 'content';
    render();
    return;
  }

  const deleteUser = event.target.closest('[data-delete-user]');
  if (deleteUser) {
    if (!confirm('确定删除这个用户吗？超级管理员不会被删除。')) return;
    await api(`/api/admin/users/${deleteUser.dataset.deleteUser}`, { method: 'DELETE' });
    state.message = '用户已删除';
    await bootstrap();
    state.tab = 'admin';
    state.adminTab = 'user';
    render();
    return;
  }

  const deleteClass = event.target.closest('[data-delete-class]');
  if (deleteClass) {
    if (!confirm('确定删除这个班级吗？已有用户的班级信息会清空。')) return;
    await api(`/api/admin/classes/${deleteClass.dataset.deleteClass}`, { method: 'DELETE' });
    state.message = '班级已删除';
    await bootstrap();
    state.tab = 'admin';
    state.adminTab = 'user';
    render();
    return;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  try {
    if (form.id === 'loginForm') {
      event.preventDefault();
      await api('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = '登录成功';
      await bootstrap();
      setTab(isAdmin() ? 'admin' : 'home');
      return;
    }

    if (form.id === 'passwordForm' || form.id === 'mustPasswordForm') {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      const passwordError = validatePasswordPolicy(payload.newPassword);
      if (passwordError) throw new Error(passwordError);
      await api('/api/change-password', { method: 'POST', body: JSON.stringify(payload) });
      state.message = '密码已修改';
      await bootstrap();
      return;
    }

    if (form.id === 'profileForm') {
      event.preventDefault();
      await api('/api/profile', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = '资料已保存';
      await bootstrap();
      state.tab = 'profile';
      render();
      return;
    }

    if (form.id === 'avatarForm') {
      event.preventDefault();
      const data = new FormData(form);
      await api('/api/profile/avatar', { method: 'POST', body: data });
      state.message = '头像已上传';
      await bootstrap();
      state.tab = 'profile';
      render();
      return;
    }

    if (form.id === 'feedbackForm') {
      event.preventDefault();
      await api('/api/front/feedback', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = '反馈已提交';
      await bootstrap();
      state.tab = 'feedback';
      render();
      return;
    }

    if (form.id === 'uploadForm') {
      event.preventDefault();
      const files = [...form.querySelector('input[type="file"]').files];
      if (!files.length) throw new Error('请选择文件');
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
      let uploadedBytes = 0;
      setProgress(0);
      for (let i = 0; i < files.length; i += 1) {
        await uploadFileWithProgress(form, files[i], uploadedBytes, totalBytes);
        uploadedBytes += files[i].size;
        setProgress((uploadedBytes / totalBytes) * 100);
      }
      setProgress(100);
      state.message = '资源上传成功';
      await bootstrap();
      state.tab = isAdmin() ? 'admin' : 'upload';
      state.adminTab = 'software';
      render();
      return;
    }

    if (form.classList.contains('software-edit-row')) {
      event.preventDefault();
      await api(`/api/admin/software/${form.dataset.id}`, { method: 'PUT', body: JSON.stringify(formToJson(form)) });
      state.message = '软件信息已保存';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'software';
      render();
      return;
    }

    if (form.id === 'categoryForm') {
      event.preventDefault();
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = '分类已新增';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'category';
      render();
      return;
    }

    if (form.id === 'noticeForm') {
      event.preventDefault();
      await api('/api/admin/notices', { method: 'POST', body: JSON.stringify(formToJson(form)) });
      state.message = '公告已发布';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'content';
      render();
      return;
    }

    if (form.classList.contains('feedback-handle-row')) {
      event.preventDefault();
      await api(`/api/admin/feedback/${form.dataset.id}`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = '反馈处理状态已保存';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'feedback';
      render();
      return;
    }

    if (form.classList.contains('user-permission-row')) {
      event.preventDefault();
      await api(`/api/admin/users/${form.dataset.id}`, { method: 'PUT', body: JSON.stringify(formToJson(form)) });
      state.message = '账号权限已更新';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'user';
      render();
      return;
    }

    if (form.id === 'userForm') {
      event.preventDefault();
      const result = await api('/api/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = `账号已新增，初始密码：${result.initialPassword || '123456'}`;
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'user';
      render();
      return;
    }

    if (form.id === 'settingsForm') {
      event.preventDefault();
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(formToJson(form)) });
      state.message = '系统设置已保存';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'settings';
      render();
      return;
    }

    if (form.id === 'logoForm') {
      event.preventDefault();
      const data = new FormData(form);
      await api('/api/admin/logo', { method: 'POST', body: data });
      state.message = 'Logo 已上传';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'settings';
      render();
      return;
    }

    if (form.id === 'classForm') {
      event.preventDefault();
      await api('/api/admin/classes', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      state.message = '班级已新增';
      await bootstrap();
      state.tab = 'admin';
      state.adminTab = 'user';
      render();
      return;
    }
  } catch (error) {
    event.preventDefault();
    state.error = error.message;
    render();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'categorySearch') {
    const q = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-filter-text]').forEach((item) => {
      item.hidden = q && !item.dataset.filterText.toLowerCase().includes(q);
    });
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'categorySelect') {
    state.category = event.target.value || '全部';
    render();
  }
});

window.addEventListener('hashchange', () => {
  state.tab = tabFromLocation();
  render();
  if (state.tab === 'admin' && isAdmin()) loadAdminStatus();
});

bootstrap();
