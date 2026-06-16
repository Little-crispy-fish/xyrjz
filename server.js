const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const EXTRA_PORTS = String(process.env.EXTRA_PORTS || "")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isInteger(item) && item > 0 && item !== PORT);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ("D:" + path.sep + "\u6821\u56ed\u8f6f\u4ef6\u7ad9\u6570\u636e");
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const CLIENT_APP_FILE = path.join(PUBLIC_DIR, "app.js");
const SOFTWARE_ROOT = process.env.SOFTWARE_ROOT || ("D:" + path.sep + "\u8f6f\u4ef6");
const MIRROR_ROOT = process.env.MIRROR_ROOT || ("D:" + path.sep + "\u955c\u50cf");
const AVATAR_ROOT = path.join(DATA_DIR, "avatars");
const LOGO_ROOT = path.join(DATA_DIR, "logos");
const USER_STORAGE_ROOT = path.join(DATA_DIR, "user-storage");
const DEFAULT_PASSWORD = "123456";
const USER_STORAGE_QUOTA_BYTES = Number(process.env.USER_STORAGE_QUOTA_MB || 500) * 1024 * 1024;
const SUPERADMIN_PASSWORD_FILE = path.join(DATA_DIR, "superadmin-initial-password.txt");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 900) * 1024 * 1024;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_GB || 20) * 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = Number(process.env.MAX_CHUNK_MB || 8) * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MAX_CONCURRENT_DOWNLOADS || 200);
const DOWNLOAD_STREAM_HIGH_WATER_MARK = Number(process.env.DOWNLOAD_BUFFER_MB || 1) * 1024 * 1024;
const GUEST_DOWNLOAD_LIMIT = Number(process.env.GUEST_DOWNLOAD_LIMIT || 5);
const loginAttempts = new Map();
const requestBuckets = new Map();
const blockedClients = new Map();
const suspiciousStrikes = new Map();
let lastCpuSample = null;
let activeDownloads = 0;
const runtimeSessions = {};

const majorThemes = {
  info_security: { label: "信息安全技术应用", className: "theme-security", accent: "#0f766e" },
  computer_application: { label: "计算机应用技术", className: "theme-computer-app", accent: "#2563eb" },
  ai_application: { label: "人工智能技术应用", className: "theme-ai-app", accent: "#db2777" },
  smart_internet: { label: "智能互联网技术应用", className: "theme-smart-internet", accent: "#7c3aed" },
  cloud_computing: { label: "云计算应用技术", className: "theme-cloud", accent: "#0284c7" },
  default: { label: "通用专业", className: "theme-default", accent: "#334155" }
};

const majorAliases = {
  computer: "computer_application",
  software: "info_security",
  network: "smart_internet",
  ai: "ai_application",
  design: "cloud_computing"
};

const defaultCategories = [
  "办公软件",
  "编程开发",
  "网络安全",
  "数据库工具",
  "虚拟机工具",
  "图像设计",
  "视频剪辑",
  "教学软件",
  "驱动工具",
  "系统工具",
  "浏览器",
  "压缩工具",
  "远程控制",
  "考试软件",
  "校园专用软件",
  "系统镜像"
];

const defaultSettings = {
  siteName: "智慧校园软件资源管理平台",
  logoText: "校园软件站",
  logoUrl: "",
  allowGuestBrowse: false,
  requireLoginDownload: true,
  maxFileGb: Number(process.env.MAX_FILE_GB || 20),
  maxChunkMb: Number(process.env.MAX_CHUNK_MB || 8),
  storageSoftware: SOFTWARE_ROOT,
  storageMirror: MIRROR_ROOT,
  maintenanceMode: false,
  maintenanceMessage: "系统维护中，请稍后再试。"
};

const defaultClasses = [
  "2025级信息安全技术应用班",
  "2025级计算机应用技术班",
  "2025级人工智能技术应用班",
  "2025级智能互联网技术应用班",
  "2025级云计算应用技术班"
];

const adminModuleCatalog = {};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hashPassword(password, salt).split(":")[1]));
}

function validatePasswordPolicy(password) {
  const value = String(password || "");
  if (value.length < 8) return "新密码至少 8 位";
  if (!/[A-Z]/.test(value)) return "新密码必须包含至少一个大写字母";
  if (!/[a-z]/.test(value)) return "新密码必须包含至少一个小写字母";
  if (!/[^A-Za-z0-9]/.test(value)) return "新密码必须包含至少一个特殊符号";
  return "";
}

function seedDb() {
  ensureDir(DATA_DIR);
  ensureDir(SOFTWARE_ROOT);
  ensureDir(MIRROR_ROOT);
  ensureDir(AVATAR_ROOT);
  ensureDir(LOGO_ROOT);
  ensureDir(USER_STORAGE_ROOT);
  if (fs.existsSync(DB_FILE)) return;
  const now = new Date().toISOString();
  const superAdminPassword = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
  if (!process.env.SUPERADMIN_PASSWORD) {
    fs.writeFileSync(SUPERADMIN_PASSWORD_FILE, `superadmin=${superAdminPassword}\n`, { encoding: "utf8", flag: "wx" });
  }
  const db = {
    users: [
      {
        id: crypto.randomUUID(),
        account: "superadmin",
        role: "admin",
        name: "超级管理员",
        major: "default",
        className: "",
        avatar: "",
        passwordHash: hashPassword(superAdminPassword),
        mustChangePassword: false,
        createdAt: now
      },
      {
        id: crypto.randomUUID(),
        account: "20260001",
        role: "student",
        name: "学生演示账号",
        major: "info_security",
        className: "2025级信息安全技术应用班",
        avatar: "",
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        mustChangePassword: true,
        createdAt: now
      },
      {
        id: crypto.randomUUID(),
        account: "T1001",
        role: "teacher",
        name: "教师演示账号",
        major: "computer_application",
        className: "2025级计算机应用技术班",
        avatar: "",
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        mustChangePassword: true,
        createdAt: now
      }
    ],
    classes: defaultClasses.map((name) => ({ id: crypto.randomUUID(), name, createdAt: now })),
    files: [],
    confessions: [],
    sessions: {},
    uploads: [],
    adminModules: Object.fromEntries(Object.keys(adminModuleCatalog).map((key) => [key, []])),
    adminModuleLogs: []
  };
  ensureDbShape(db);
  saveDb(db);
}

function loadDb() {
  seedDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  ensureDbShape(db);
  return db;
}

function saveDb(db) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function ensureDbShape(db) {
  let changed = false;
  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  if (!Array.isArray(db.classes)) {
    db.classes = defaultClasses.map((name) => ({ id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }));
    changed = true;
  }
  if (!Array.isArray(db.files)) {
    db.files = [];
    changed = true;
  }
  if (!Array.isArray(db.confessions)) {
    db.confessions = [];
    changed = true;
  }
  if (!db.sessions || typeof db.sessions !== "object") {
    db.sessions = {};
    changed = true;
  }
  if (!Array.isArray(db.uploads)) {
    db.uploads = [];
    changed = true;
  }
  if (!Array.isArray(db.userFiles)) {
    db.userFiles = [];
    changed = true;
  }
  if (!db.adminModules || typeof db.adminModules !== "object") {
    db.adminModules = {};
    changed = true;
  }
  for (const key of Object.keys(adminModuleCatalog)) {
    if (!Array.isArray(db.adminModules[key])) {
      db.adminModules[key] = [];
      changed = true;
    }
  }
  if (!Array.isArray(db.adminModuleLogs)) {
    db.adminModuleLogs = [];
    changed = true;
  }
  if (!db.systemSettings || typeof db.systemSettings !== "object") {
    db.systemSettings = {
      schoolName: "智慧校园软件站",
      loginTitle: "校园软件站",
      loginSubtitle: "学生用学号登录，教师用工号登录。",
      theme: "default",
      emailHost: "",
      emailUser: "",
      smsProvider: "",
      smsSign: "",
      maxFileGb: Number(process.env.MAX_FILE_GB || 20),
      maxChunkMb: Number(process.env.MAX_CHUNK_MB || 8),
      maintenanceMode: false,
      maintenanceMessage: "系统维护中，请稍后再试。",
      dictionaries: [
        { key: "user_status", label: "用户状态", values: ["正常", "停用", "待审核"] },
        { key: "record_status", label: "记录状态", values: ["正常", "待审核", "进行中", "已完成", "停用"] }
      ],
      updatedAt: new Date().toISOString()
    };
    changed = true;
  }
  if (!Array.isArray(db.categories)) {
    db.categories = defaultCategories.map((name, index) => ({
      id: crypto.randomUUID(),
      name,
      icon: "",
      sort: index + 1,
      enabled: true,
      createdAt: new Date().toISOString()
    }));
    changed = true;
  }
  if (!Array.isArray(db.notices)) {
    db.notices = [{
      id: crypto.randomUUID(),
      title: "校园软件资源平台上线",
      content: "平台提供软件下载、镜像下载、安装教程、问题反馈和后台统计能力。",
      pinned: true,
      scope: "全体师生",
      createdAt: new Date().toISOString()
    }];
    changed = true;
  }
  if (!Array.isArray(db.feedback)) {
    db.feedback = [];
    changed = true;
  }
  if (!Array.isArray(db.downloadLogs)) {
    db.downloadLogs = [];
    changed = true;
  }
  if (!db.guestDownloads || typeof db.guestDownloads !== "object") {
    db.guestDownloads = {};
    changed = true;
  }
  if (!Array.isArray(db.operationLogs)) {
    db.operationLogs = [];
    changed = true;
  }
  if (!db.settings || typeof db.settings !== "object") {
    db.settings = { ...defaultSettings, updatedAt: new Date().toISOString() };
    changed = true;
  } else {
    for (const [key, value] of Object.entries(defaultSettings)) {
      if (db.settings[key] === undefined) {
        db.settings[key] = value;
        changed = true;
      }
    }
  }
  for (const file of db.files) {
    if (!file.status) {
      file.status = "published";
      changed = true;
    }
    if (file.downloadCount === undefined) {
      file.downloadCount = 0;
      changed = true;
    }
    if (file.isRecommend === undefined) {
      file.isRecommend = false;
      changed = true;
    }
    if (file.isHot === undefined) {
      file.isHot = false;
      changed = true;
    }
    if (!file.version) {
      file.version = "1.0";
      changed = true;
    }
    if (!file.systemRequire) {
      file.systemRequire = file.zone === "mirror" ? "Windows / Linux" : "Windows";
      changed = true;
    }
    if (!file.tutorial) {
      file.tutorial = "";
      changed = true;
    }
  }
  for (const user of db.users) {
    if (user.className === undefined) {
      user.className = "";
      changed = true;
    }
  }
  return changed;
}

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, ...securityHeaders(), ...headers });
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8", headers);
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join("; ")
  };
}

function cookieHeader(name, value, maxAge) {
  const parts = [`${name}=${value}`, "HttpOnly", "Path=/", "SameSite=Strict"];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (process.env.COOKIE_SECURE === "true") parts.push("Secure");
  return parts.join("; ");
}

function getCookie(req, key) {
  const cookie = req.headers.cookie || "";
  return cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${key}=`))?.split("=")[1];
}

function getCurrentUser(req, db) {
  const sid = getCookie(req, "sid");
  const session = sid && (runtimeSessions[sid] || (db.sessions && db.sessions[sid]));
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function requireUser(req, res, db) {
  const user = getCurrentUser(req, db);
  if (!user) {
    json(res, 401, { error: "请先登录" });
    return null;
  }
  return user;
}

function blocksBeforePasswordChange(req, res, user) {
  const allowed = ["/api/bootstrap", "/api/change-password", "/api/logout"];
  if (user.mustChangePassword && !allowed.includes(new URL(req.url, `http://${req.headers.host}`).pathname)) {
    json(res, 428, { error: "首次登录必须先修改密码" });
    return true;
  }
  return false;
}

function requireRole(req, res, db, roles) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (!roles.includes(user.role)) {
    json(res, 403, { error: "权限不足" });
    return null;
  }
  return user;
}

function requireSuperAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (user.role !== "admin" || user.account !== "superadmin") {
    json(res, 403, { error: "仅超级管理员可访问" });
    return null;
  }
  return user;
}

function requireAdminUser(req, res, db) {
  return requireRole(req, res, db, ["admin"]);
}

function readBody(req, limit = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, MAX_JSON_BYTES);
  if (!body.length) return {};
  if (containsAttackPayload(body.toString("utf8"))) {
    const error = new Error("请求被安全策略拦截");
    error.statusCode = 403;
    throw error;
  }
  return JSON.parse(body.toString("utf8"));
}

function publicUser(user) {
  if (user.role === "guest") {
    return {
      id: user.id,
      account: "guest",
      role: "guest",
      name: "游客",
      major: "default",
      className: "",
      avatar: "",
      mustChangePassword: false,
      theme: majorThemes.default
    };
  }
  const major = normalizeMajor(user.major);
  return {
    id: user.id,
    account: user.account,
    role: user.role,
    name: user.name,
    major,
    className: String(user.className || ""),
    avatar: user.avatar,
    mustChangePassword: user.mustChangePassword,
    theme: majorThemes[major] || majorThemes.default
  };
}

function normalizeMajor(major) {
  if (majorThemes[major]) return major;
  if (majorAliases[major]) return majorAliases[major];
  return "default";
}

function normalizeClassName(db, value) {
  const name = String(value || "").trim().slice(0, 80);
  if (!name) return "";
  return (db.classes || []).some((item) => item.name === name) ? name : "";
}

function classifyFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  if ([".iso", ".img", ".vhd", ".vhdx", ".wim"].includes(ext)) return "系统镜像";
  if ([".exe", ".msi", ".appx"].includes(ext)) return "Windows软件";
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) return "压缩包";
  if ([".dmg", ".pkg"].includes(ext)) return "macOS软件";
  if ([".deb", ".rpm", ".run", ".sh"].includes(ext)) return "Linux软件";
  if ([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(ext)) return "文档资料";
  return "其他";
}

function safeName(name) {
  return String(name || "file").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
}

function isInsideDir(filePath, dirPath) {
  const file = path.resolve(filePath);
  const dir = path.resolve(dirPath);
  const relative = path.relative(dir, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function storageRootForFile(file) {
  if (file?.zone === "mirror") return MIRROR_ROOT;
  if (file?.zone === "software") return SOFTWARE_ROOT;
  const diskPath = String(file?.diskPath || "");
  if (diskPath && isInsideDir(diskPath, MIRROR_ROOT)) return MIRROR_ROOT;
  return SOFTWARE_ROOT;
}

function deleteStoredFile(file) {
  const rawPath = String(file?.diskPath || "").trim();
  if (!rawPath) return { deleted: false, reason: "empty_path" };
  const diskPath = path.resolve(rawPath);
  const root = storageRootForFile(file);
  if (!isInsideDir(diskPath, root)) {
    throw new Error("文件路径不在允许的存储目录内，已停止删除");
  }
  if (!fs.existsSync(diskPath)) return { deleted: false, reason: "missing" };
  const stat = fs.statSync(diskPath);
  if (!stat.isFile()) throw new Error("目标不是文件，已停止删除");
  fs.unlinkSync(diskPath);

  const parent = path.dirname(diskPath);
  if (parent !== path.resolve(root) && isInsideDir(parent, root)) {
    try {
      if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    } catch {
      // Empty directory cleanup is best effort; the file itself has already been removed.
    }
  }
  return { deleted: true };
}

function getUploadStore(db) {
  if (!Array.isArray(db.uploads)) db.uploads = [];
  return db.uploads;
}

function getUserFileStore(db) {
  if (!Array.isArray(db.userFiles)) db.userFiles = [];
  return db.userFiles;
}

function userStorageDir(userId) {
  return path.join(USER_STORAGE_ROOT, safeName(userId));
}

function userStorageUsage(db, userId) {
  const files = getUserFileStore(db).filter((file) => file.userId === userId);
  return files.reduce((sum, file) => sum + Number(file.size || 0), 0);
}

function publicUserFile(file) {
  return {
    id: file.id,
    originalName: file.originalName,
    title: file.title,
    size: Number(file.size || 0),
    contentType: file.contentType || "application/octet-stream",
    createdAt: file.createdAt,
    downloadUrl: `/api/profile/files/${file.id}/download`
  };
}

function userStoragePayload(db, user) {
  const usedBytes = user.role === "guest" ? 0 : userStorageUsage(db, user.id);
  return {
    quotaBytes: USER_STORAGE_QUOTA_BYTES,
    usedBytes,
    remainingBytes: Math.max(0, USER_STORAGE_QUOTA_BYTES - usedBytes)
  };
}

function deleteUserStorageFile(file) {
  const rawPath = String(file?.diskPath || "").trim();
  if (!rawPath) return { deleted: false, reason: "empty_path" };
  const diskPath = path.resolve(rawPath);
  const root = userStorageDir(file.userId);
  if (!isInsideDir(diskPath, root)) {
    throw new Error("个人文件路径不在允许的存储目录内，已停止删除");
  }
  if (!fs.existsSync(diskPath)) return { deleted: false, reason: "missing" };
  const stat = fs.statSync(diskPath);
  if (!stat.isFile()) throw new Error("目标不是文件，已停止删除");
  fs.unlinkSync(diskPath);
  return { deleted: true };
}

function deleteUserStorageForUser(db, userId) {
  const files = getUserFileStore(db).filter((file) => file.userId === userId);
  for (const file of files) {
    try {
      deleteUserStorageFile(file);
    } catch (error) {
      console.error(`delete user storage failed: ${error.message}`);
    }
  }
  db.userFiles = getUserFileStore(db).filter((file) => file.userId !== userId);
  const dir = userStorageDir(userId);
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Directory cleanup is best effort; file metadata has already been removed.
  }
}

function getAdminModuleStore(db, key) {
  ensureDbShape(db);
  if (!db.adminModules || typeof db.adminModules !== "object") db.adminModules = {};
  if (!Array.isArray(db.adminModules[key])) db.adminModules[key] = [];
  return db.adminModules[key];
}

function isSafeModuleKey(key) {
  return Object.hasOwn(adminModuleCatalog, String(key || ""));
}

function appendAdminLog(db, user, action, key, record) {
  ensureDbShape(db);
  db.adminModuleLogs.push({
    id: crypto.randomUUID(),
    action,
    moduleKey: key,
    moduleGroup: adminModuleCatalog[key]?.groupLabel || "",
    moduleName: adminModuleCatalog[key]?.label || "",
    recordId: record?.id || "",
    recordTitle: record?.title || "",
    operatorId: user.id,
    operatorAccount: user.account,
    operatorName: user.name,
    createdAt: new Date().toISOString()
  });
  db.adminModuleLogs = db.adminModuleLogs.slice(-500);
}

function directorySize(dir, limit = 2000) {
  let total = 0;
  let count = 0;
  const stack = [dir];
  while (stack.length && count < limit) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        total += stat.size;
        count += 1;
      }
      if (count >= limit) break;
    }
  }
  return { bytes: total, files: count, limited: count >= limit };
}

function diskStatus(dir) {
  ensureDir(dir);
  const usage = directorySize(dir);
  try {
    const stat = fs.statfsSync(dir);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    return { path: dir, total, free, used: total - free, resourceBytes: usage.bytes, resourceFiles: usage.files };
  } catch {
    return { path: dir, total: 0, free: 0, used: 0, resourceBytes: usage.bytes, resourceFiles: usage.files };
  }
}

function cpuPercent() {
  const cpus = os.cpus();
  const sample = cpus.reduce((acc, cpu) => {
    const idle = cpu.times.idle;
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: acc.idle + idle, total: acc.total + total };
  }, { idle: 0, total: 0 });
  if (!lastCpuSample) {
    lastCpuSample = sample;
    return 0;
  }
  const idleDelta = sample.idle - lastCpuSample.idle;
  const totalDelta = sample.total - lastCpuSample.total;
  lastCpuSample = sample;
  if (!totalDelta) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

function adminStatus(db) {
  ensureDbShape(db);
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const files = db.files || [];
  const sessions = Object.values(runtimeSessions);
  const uploads = getUploadStore(db);
  const today = new Date().toISOString().slice(0, 10);
  const byZone = files.reduce((acc, file) => {
    acc[file.zone] = (acc[file.zone] || 0) + 1;
    return acc;
  }, {});
  return {
    now: new Date().toISOString(),
    server: {
      host: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      uptime: os.uptime(),
      processUptime: process.uptime(),
      node: process.version,
      pid: process.pid
    },
    cpu: {
      percent: cpuPercent(),
      cores: os.cpus().length,
      model: os.cpus()[0]?.model || "unknown"
    },
    memory: {
      total: memoryTotal,
      free: memoryFree,
      used: memoryTotal - memoryFree,
      processRss: process.memoryUsage().rss,
      processHeapUsed: process.memoryUsage().heapUsed
    },
    storage: {
      software: diskStatus(SOFTWARE_ROOT),
      mirror: diskStatus(MIRROR_ROOT),
      data: diskStatus(DATA_DIR)
    },
    counts: {
      users: db.users.length,
      students: db.users.filter((user) => user.role === "student").length,
      teachers: db.users.filter((user) => user.role === "teacher").length,
      admins: db.users.filter((user) => user.role === "admin").length,
      files: files.length,
      software: byZone.software || 0,
      mirror: byZone.mirror || 0,
      confessions: db.confessions.length,
      todayDownloads: db.downloadLogs.filter((log) => log.createdAt?.slice(0, 10) === today).length,
      totalDownloads: db.downloadLogs.length,
      pendingFeedback: db.feedback.filter((item) => item.status !== "已处理").length,
      sessions: sessions.length,
      activeUploads: uploads.length
    },
    uploads: uploads.map((upload) => ({
      id: upload.id,
      title: upload.title,
      zone: upload.zone,
      originalName: upload.originalName,
      size: upload.size,
      receivedBytes: upload.receivedBytes,
      uploaderName: upload.uploaderName,
      createdAt: upload.createdAt
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    logs: db.operationLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    adminModuleLogs: db.adminModuleLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    settings: db.settings,
    categories: db.categories,
    classes: db.classes || [],
    notices: db.notices,
    feedback: db.feedback.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    downloadLogs: db.downloadLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
    recentSessions: Object.entries(runtimeSessions).map(([id, session]) => {
      const user = db.users.find((item) => item.id === session.userId);
      return { id: id.slice(0, 8), account: user?.account || "unknown", name: user?.name || "未知用户", role: user?.role || "", createdAt: session.createdAt };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
  };
}

function isSafeAccount(account) {
  return /^[A-Za-z0-9_-]{3,32}$/.test(account);
}

function cleanUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) ? input.slice(0, 500) : "";
  } catch {
    return "";
  }
}

function hashFile(filePath, algorithm = "md5") {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function containsAttackPayload(value) {
  let input = String(value || "");
  try {
    input = decodeURIComponent(input);
  } catch {
    return true;
  }
  input = input.toLowerCase();
  return [
    /\bsqlmap\b/,
    /\bunion\b[\s\S]{0,40}\bselect\b/,
    /\bselect\b[\s\S]{0,80}\bfrom\b/,
    /\binformation_schema\b/,
    /\bsleep\s*\(/,
    /\bbenchmark\s*\(/,
    /\bload_file\s*\(/,
    /\binto\s+outfile\b/,
    /(?:^|[^a-z])or\s+['"]?\d+['"]?\s*=\s*['"]?\d+/,
    /(?:^|[^a-z])and\s+['"]?\d+['"]?\s*=\s*['"]?\d+/,
    /(?:--|#|\/\*)/,
    /(?:\.\.\/|\.\.\\)/,
    /<\s*script\b/,
    /\bonerror\s*=/
  ].some((pattern) => pattern.test(input));
}

function rejectSuspiciousRequest(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const blockedUntil = blockedClients.get(ip) || 0;
  if (blockedUntil > now) {
    json(res, 429, { error: "请求过于频繁，请稍后再试" }, { "Retry-After": "60" });
    return true;
  }
  if (blockedUntil && blockedUntil <= now) blockedClients.delete(ip);

  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const windowMs = 60 * 1000;
  const current = requestBuckets.get(ip) || { count: 0, apiCount: 0, resetAt: now + windowMs };
  if (now > current.resetAt) {
    current.count = 0;
    current.apiCount = 0;
    current.resetAt = now + windowMs;
  }
  current.count += 1;
  if (pathname.startsWith("/api/")) current.apiCount += 1;
  requestBuckets.set(ip, current);

  const isUploadEndpoint = pathname.startsWith("/api/files/chunk/") || pathname === "/api/files";
  const totalLimit = isUploadEndpoint ? 3000 : 900;
  const apiLimit = isUploadEndpoint ? 2500 : 500;
  if (current.count > totalLimit || current.apiCount > apiLimit) {
    json(res, 429, { error: "请求过于频繁，请稍后再试" }, { "Retry-After": "30" });
    return true;
  }

  const headerProbe = [
    req.url,
    req.headers["user-agent"],
    req.headers.referer,
    req.headers.cookie
  ].join("\n");
  if (containsAttackPayload(headerProbe)) {
    const strike = suspiciousStrikes.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (now > strike.resetAt) {
      strike.count = 0;
      strike.resetAt = now + 10 * 60 * 1000;
    }
    strike.count += 1;
    suspiciousStrikes.set(ip, strike);
    if (strike.count >= 8) blockedClients.set(ip, now + 2 * 60 * 1000);
    json(res, 403, { error: "请求被安全策略拦截" });
    return true;
  }
  return false;
}

function checkLoginRate(req, account) {
  const key = `${clientIp(req)}:${account}`;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const current = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > current.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  loginAttempts.set(key, current);
  return current.count <= 10;
}

function clearLoginRate(req, account) {
  loginAttempts.delete(`${clientIp(req)}:${account}`);
}

function appendOperationLog(db, user, action, target, detail = "") {
  ensureDbShape(db);
  db.operationLogs.push({
    id: crypto.randomUUID(),
    action,
    target,
    detail: String(detail || "").slice(0, 300),
    operatorId: user?.id || "",
    operatorName: user?.name || "系统",
    operatorAccount: user?.account || "system",
    createdAt: new Date().toISOString()
  });
  db.operationLogs = db.operationLogs.slice(-1000);
}

function publicFile(file) {
  return {
    ...file,
    downloadUrl: `/api/files/${file.id}/download`
  };
}

function guestFingerprint(req, guestId) {
  const source = [
    guestId,
    clientIp(req),
    req.headers["user-agent"] || "",
    req.headers["accept-language"] || ""
  ].join("|");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function getGuestId(req) {
  const existing = getCookie(req, "guest_id");
  return /^[a-f0-9]{24,64}$/i.test(existing || "") ? existing : crypto.randomBytes(16).toString("hex");
}

function guestCookieHeader(guestId) {
  return cookieHeader("guest_id", guestId, 365 * 24 * 60 * 60);
}

function reserveGuestDownload(db, req) {
  ensureDbShape(db);
  const guestId = getGuestId(req);
  const key = guestFingerprint(req, guestId);
  const current = db.guestDownloads[key] || {
    count: 0,
    firstAt: new Date().toISOString(),
    ip: clientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 240)
  };
  if (current.count >= GUEST_DOWNLOAD_LIMIT) {
    return { allowed: false, guestId, key, current };
  }
  current.count += 1;
  current.lastAt = new Date().toISOString();
  db.guestDownloads[key] = current;
  return { allowed: true, guestId, key, current };
}

function recordDownloadAsync(fileId, user, req) {
  const ip = clientIp(req);
  setImmediate(() => {
    try {
      const db = loadDb();
      const file = db.files.find((item) => item.id === fileId);
      if (!file) return;
      file.downloadCount = Number(file.downloadCount || 0) + 1;
      db.downloadLogs.push({
        id: crypto.randomUUID(),
        fileId: file.id,
        fileTitle: file.title,
        originalName: file.originalName,
        userId: user.id,
        userName: user.name,
        account: user.account,
        ip,
        createdAt: new Date().toISOString()
      });
      db.downloadLogs = db.downloadLogs.slice(-5000);
      appendOperationLog(db, user, "下载资源", file.title, file.originalName);
      saveDb(db);
    } catch (error) {
      console.error("记录下载日志失败:", error);
    }
  });
}

function streamDownload(res, filePath, options = {}) {
  activeDownloads += 1;
  let counted = true;
  const release = () => {
    if (!counted) return;
    counted = false;
    activeDownloads = Math.max(0, activeDownloads - 1);
  };
  const stream = fs.createReadStream(filePath, {
    ...options,
    highWaterMark: DOWNLOAD_STREAM_HIGH_WATER_MARK
  });
  stream.on("error", (error) => {
    console.error("下载流错误:", error);
    if (!res.headersSent) {
      send(res, 500, "Download failed", "text/plain; charset=utf-8");
    } else {
      res.destroy(error);
    }
  });
  res.on("close", release);
  res.on("finish", release);
  return stream.pipe(res);
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("缺少 multipart boundary");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary) + boundary.length + 2;
  while (cursor > boundary.length) {
    const next = buffer.indexOf(boundary, cursor);
    if (next === -1) break;
    const part = buffer.subarray(cursor, next - 2);
    const sep = part.indexOf(Buffer.from("\r\n\r\n"));
    if (sep > -1) {
      const rawHeaders = part.subarray(0, sep).toString("utf8");
      const data = part.subarray(sep + 4);
      const name = /name="([^"]+)"/.exec(rawHeaders)?.[1];
      const filename = /filename="([^"]*)"/.exec(rawHeaders)?.[1];
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || "application/octet-stream";
      if (name) parts.push({ name, filename, type, data });
    }
    cursor = next + boundary.length + 2;
  }
  return parts;
}

function sendClientRuntime(res) {
  const source = fs.readFileSync(CLIENT_APP_FILE, "utf8");
  const encoded = Buffer.from(source, "utf8").toString("base64");
  const chunks = encoded.match(/.{1,2000}/g) || [];
  const loader = `"use strict";(()=>{const d=[${chunks.map((chunk) => JSON.stringify(chunk)).join(",")}].join("");const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));(0,eval)(new TextDecoder().decode(b));})();`;
  send(res, 200, loader, "text/javascript; charset=utf-8", {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
}

function routeStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/client/runtime.js" || url.pathname === "/app.js") {
    sendClientRuntime(res);
    return true;
  }
  if (url.pathname.startsWith("/avatars/")) {
    const avatarName = path.basename(decodeURIComponent(url.pathname.slice("/avatars/".length)));
    const avatarFile = path.join(AVATAR_ROOT, avatarName);
    if (!avatarFile.startsWith(AVATAR_ROOT) || !fs.existsSync(avatarFile)) return false;
    const ext = path.extname(avatarFile).toLowerCase();
    send(res, 200, fs.readFileSync(avatarFile), mimeTypes[ext] || "application/octet-stream", { "Cache-Control": "no-store" });
    return true;
  }
  if (url.pathname.startsWith("/logos/")) {
    const logoName = path.basename(decodeURIComponent(url.pathname.slice("/logos/".length)));
    const logoFile = path.join(LOGO_ROOT, logoName);
    if (!logoFile.startsWith(LOGO_ROOT) || !fs.existsSync(logoFile)) return false;
    const ext = path.extname(logoFile).toLowerCase();
    send(res, 200, fs.readFileSync(logoFile), mimeTypes[ext] || "application/octet-stream", { "Cache-Control": "no-store" });
    return true;
  }
  let pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (["/admin", "/list", "/hot", "/notice", "/feedback", "/profile"].includes(pathname)) pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  send(res, 200, fs.readFileSync(file), mimeTypes[ext] || "application/octet-stream", {
    "Cache-Control": "no-store"
  });
  return true;
}

function listPayload(db, user) {
  const visibleUsers = user.role === "admin"
    ? db.users.map(publicUser)
    : user.role === "teacher"
      ? db.users.filter((item) => item.role === "student" && item.createdBy === user.id).map(publicUser)
      : undefined;
  return {
    user: publicUser(user),
    majors: majorThemes,
    classes: db.classes || [],
    settings: db.settings,
    categories: db.categories,
    notices: db.notices.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)),
    feedback: user.role === "guest" ? [] : db.feedback.filter((item) => item.userId === user.id || user.role === "admin").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    downloadLogs: user.role === "guest" ? [] : db.downloadLogs.filter((item) => item.userId === user.id || user.role === "admin").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
    files: db.files.map((file) => ({ ...publicFile(file), canDelete: user.role === "admin" || file.uploaderId === user.id })),
    userFiles: user.role === "guest" ? [] : getUserFileStore(db).filter((file) => file.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicUserFile),
    confessions: db.confessions.map((item) => ({
      ...item,
      canDelete: user.role === "admin" || item.userId === user.id
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    users: visibleUsers,
    storage: { softwareRoot: SOFTWARE_ROOT, mirrorRoot: MIRROR_ROOT, user: userStoragePayload(db, user) }
  };
}

async function handleApi(req, res) {
  const db = loadDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || "GET";

  try {
    if (method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      const account = String(body.account || "").trim();
      if (!checkLoginRate(req, account)) {
        return json(res, 429, { error: "登录失败次数过多，请 15 分钟后再试" });
      }
      const user = db.users.find((item) => item.account === account);
      if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
        return json(res, 401, { error: "账号或密码错误" });
      }
      clearLoginRate(req, account);
      const sid = crypto.randomBytes(24).toString("hex");
      runtimeSessions[sid] = { userId: user.id, createdAt: new Date().toISOString(), ip: clientIp(req) };
      return json(res, 200, { user: publicUser(user) }, { "Set-Cookie": cookieHeader("sid", sid) });
    }

    if (method === "POST" && url.pathname === "/api/logout") {
      const sid = getCookie(req, "sid");
      if (sid) {
        delete runtimeSessions[sid];
        if (db.sessions) delete db.sessions[sid];
      }
      res.writeHead(204, { ...securityHeaders(), "Set-Cookie": cookieHeader("sid", "", 0) });
      return res.end();
    }

    if (method === "GET" && url.pathname === "/api/bootstrap") {
      const user = getCurrentUser(req, db) || { id: "guest", account: "guest", role: "guest", name: "游客", major: "default", avatar: "", mustChangePassword: false };
      return json(res, 200, listPayload(db, user));
    }

    if (method === "GET" && url.pathname === "/api/admin/status") {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      return json(res, 200, adminStatus(db));
    }

    if (method === "PUT" && url.pathname.startsWith("/api/admin/software/")) {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      const id = url.pathname.split("/").pop();
      const file = db.files.find((item) => item.id === id);
      if (!file) return json(res, 404, { error: "资源不存在" });
      const body = await readJson(req);
      for (const key of ["title", "description", "version", "systemRequire", "tutorial", "status"]) {
        if (body[key] !== undefined) file[key] = String(body[key]).trim().slice(0, key === "tutorial" ? 2000 : 300);
      }
      if (body.category !== undefined) file.category = String(body.category).trim().slice(0, 80);
      if (body.isRecommend !== undefined) file.isRecommend = Boolean(body.isRecommend);
      if (body.isHot !== undefined) file.isHot = Boolean(body.isHot);
      file.updatedAt = new Date().toISOString();
      appendOperationLog(db, user, "编辑软件资源", file.title, file.originalName);
      saveDb(db);
      return json(res, 200, { file: publicFile(file) });
    }

    if (method === "POST" && url.pathname === "/api/admin/categories") {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { error: "分类名称不能为空" });
      const category = {
        id: crypto.randomUUID(),
        name: name.slice(0, 40),
        icon: String(body.icon || "").trim().slice(0, 80),
        sort: Number(body.sort || db.categories.length + 1),
        enabled: body.enabled !== false,
        createdAt: new Date().toISOString()
      };
      db.categories.push(category);
      appendOperationLog(db, user, "新增分类", category.name);
      saveDb(db);
      return json(res, 201, { category });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/admin/categories/")) {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      const id = url.pathname.split("/").pop();
      const category = db.categories.find((item) => item.id === id);
      db.categories = db.categories.filter((item) => item.id !== id);
      appendOperationLog(db, user, "删除分类", category?.name || id);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/admin/classes") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const body = await readJson(req);
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return json(res, 400, { error: "班级名称不能为空" });
      db.classes = Array.isArray(db.classes) ? db.classes : [];
      if (db.classes.some((item) => item.name === name)) return json(res, 409, { error: "班级已存在" });
      const item = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
      db.classes.push(item);
      appendOperationLog(db, user, "新增班级", name);
      saveDb(db);
      return json(res, 201, { class: item });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/admin/classes/")) {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const id = url.pathname.split("/").pop();
      db.classes = Array.isArray(db.classes) ? db.classes : [];
      const item = db.classes.find((entry) => entry.id === id);
      if (!item) return json(res, 404, { error: "班级不存在" });
      db.classes = db.classes.filter((entry) => entry.id !== id);
      for (const account of db.users) {
        if (account.className === item.name) account.className = "";
      }
      appendOperationLog(db, user, "删除班级", item.name);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/admin/notices") {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      const body = await readJson(req);
      const title = String(body.title || "").trim();
      const content = String(body.content || "").trim();
      if (!title || !content) return json(res, 400, { error: "公告标题和内容不能为空" });
      const notice = {
        id: crypto.randomUUID(),
        title: title.slice(0, 80),
        content: content.slice(0, 1000),
        pinned: Boolean(body.pinned),
        scope: String(body.scope || "全体师生").trim().slice(0, 40),
        createdAt: new Date().toISOString()
      };
      db.notices.push(notice);
      appendOperationLog(db, user, "发布公告", notice.title);
      saveDb(db);
      return json(res, 201, { notice });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/admin/notices/")) {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      const id = url.pathname.split("/").pop();
      const notice = db.notices.find((item) => item.id === id);
      db.notices = db.notices.filter((item) => item.id !== id);
      appendOperationLog(db, user, "删除公告", notice?.title || id);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/admin/feedback/")) {
      const user = requireAdminUser(req, res, db);
      if (!user) return;
      const id = url.pathname.split("/").pop();
      const item = db.feedback.find((entry) => entry.id === id);
      if (!item) return json(res, 404, { error: "反馈不存在" });
      const body = await readJson(req);
      item.status = String(body.status || "已处理").trim().slice(0, 20);
      item.reply = String(body.reply || "").trim().slice(0, 500);
      item.handlerId = user.id;
      item.updatedAt = new Date().toISOString();
      appendOperationLog(db, user, "处理反馈", item.title, item.reply);
      saveDb(db);
      return json(res, 200, { feedback: item });
    }

    if (method === "PUT" && url.pathname === "/api/admin/settings") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const body = await readJson(req);
      db.settings = {
        ...db.settings,
        siteName: String(body.siteName || db.settings.siteName).trim().slice(0, 80),
        logoText: String(body.logoText || db.settings.logoText).trim().slice(0, 20),
        logoUrl: String(db.settings.logoUrl || "").trim().slice(0, 500),
        allowGuestBrowse: Boolean(body.allowGuestBrowse),
        requireLoginDownload: body.requireLoginDownload !== false,
        maxFileGb: Number(body.maxFileGb || db.settings.maxFileGb || 20),
        maxChunkMb: Number(body.maxChunkMb || db.settings.maxChunkMb || 8),
        maintenanceMode: Boolean(body.maintenanceMode),
        maintenanceMessage: String(body.maintenanceMessage || "").trim().slice(0, 200),
        updatedAt: new Date().toISOString()
      };
      appendOperationLog(db, user, "更新系统设置", "系统设置");
      saveDb(db);
      return json(res, 200, { settings: db.settings });
    }

    if (method === "POST" && url.pathname === "/api/admin/logo") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const contentLength = Number(req.headers["content-length"] || 0);
      if (contentLength > 3 * 1024 * 1024) return json(res, 413, { error: "Logo 图片不能超过 3MB" });
      const parts = parseMultipart(await readBody(req, 3 * 1024 * 1024), req.headers["content-type"]);
      const upload = parts.find((part) => part.name === "logo" && part.filename);
      if (!upload || !upload.data.length) return json(res, 400, { error: "请选择 Logo 图片" });
      const ext = path.extname(upload.filename).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return json(res, 400, { error: "Logo 只支持 png、jpg、jpeg、gif、webp" });
      ensureDir(LOGO_ROOT);
      const logoName = `logo-${Date.now()}${ext}`;
      fs.writeFileSync(path.join(LOGO_ROOT, logoName), upload.data);
      db.settings.logoUrl = `/logos/${logoName}`;
      db.settings.updatedAt = new Date().toISOString();
      appendOperationLog(db, user, "上传网站 Logo", "系统设置", db.settings.logoUrl);
      saveDb(db);
      return json(res, 200, { settings: db.settings, logoUrl: db.settings.logoUrl });
    }

    if (method === "GET" && url.pathname === "/api/admin/module-records") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const key = url.searchParams.get("key");
      if (!isSafeModuleKey(key)) return json(res, 400, { error: "模块参数无效" });
      return json(res, 200, { records: getAdminModuleStore(db, key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }

    if (method === "POST" && url.pathname === "/api/admin/module-records") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const body = await readJson(req);
      if (!isSafeModuleKey(body.key)) return json(res, 400, { error: "模块参数无效" });
      const title = String(body.title || "").trim();
      if (!title) return json(res, 400, { error: "标题不能为空" });
      const record = {
        id: crypto.randomUUID(),
        title: title.slice(0, 80),
        owner: String(body.owner || "").trim().slice(0, 40),
        status: String(body.status || "正常").trim().slice(0, 20),
        note: String(body.note || "").trim().slice(0, 300),
        createdBy: user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      getAdminModuleStore(db, body.key).push(record);
      appendAdminLog(db, user, "create", body.key, record);
      saveDb(db);
      return json(res, 201, { record });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/admin/module-records/")) {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      const id = url.pathname.split("/").pop();
      const key = url.searchParams.get("key");
      if (!isSafeModuleKey(key)) return json(res, 400, { error: "模块参数无效" });
      db.adminModules = db.adminModules || {};
      const record = getAdminModuleStore(db, key).find((item) => item.id === id);
      db.adminModules[key] = getAdminModuleStore(db, key).filter((record) => record.id !== id);
      appendAdminLog(db, user, "delete", key, record || { id, title: "未知记录" });
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/admin/settings") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      ensureDbShape(db);
      return json(res, 200, { settings: db.systemSettings });
    }

    if (method === "PUT" && url.pathname === "/api/admin/settings") {
      const user = requireSuperAdmin(req, res, db);
      if (!user) return;
      ensureDbShape(db);
      const body = await readJson(req);
      const current = db.systemSettings;
      const next = {
        ...current,
        schoolName: String(body.schoolName ?? current.schoolName).trim().slice(0, 60),
        loginTitle: String(body.loginTitle ?? current.loginTitle).trim().slice(0, 60),
        loginSubtitle: String(body.loginSubtitle ?? current.loginSubtitle).trim().slice(0, 160),
        theme: ["default", "blue", "green", "purple"].includes(body.theme) ? body.theme : current.theme,
        emailHost: String(body.emailHost ?? current.emailHost).trim().slice(0, 120),
        emailUser: String(body.emailUser ?? current.emailUser).trim().slice(0, 120),
        smsProvider: String(body.smsProvider ?? current.smsProvider).trim().slice(0, 80),
        smsSign: String(body.smsSign ?? current.smsSign).trim().slice(0, 40),
        maxFileGb: Math.max(1, Math.min(100, Number(body.maxFileGb || current.maxFileGb || 20))),
        maxChunkMb: Math.max(1, Math.min(64, Number(body.maxChunkMb || current.maxChunkMb || 8))),
        maintenanceMode: body.maintenanceMode === true || body.maintenanceMode === "true",
        maintenanceMessage: String(body.maintenanceMessage ?? current.maintenanceMessage).trim().slice(0, 200),
        updatedAt: new Date().toISOString()
      };
      if (Array.isArray(body.dictionaries)) {
        next.dictionaries = body.dictionaries.slice(0, 30).map((item) => ({
          key: String(item.key || "").trim().slice(0, 40),
          label: String(item.label || "").trim().slice(0, 40),
          values: Array.isArray(item.values) ? item.values.map((value) => String(value).trim().slice(0, 40)).filter(Boolean).slice(0, 30) : []
        })).filter((item) => item.key && item.label);
      }
      db.systemSettings = next;
      appendAdminLog(db, user, "update_settings", "settings.0", { id: "systemSettings", title: "系统设置" });
      saveDb(db);
      return json(res, 200, { settings: db.systemSettings });
    }

    if (method === "POST" && url.pathname === "/api/change-password") {
      const user = requireUser(req, res, db);
      if (!user) return;
      const body = await readJson(req);
      const passwordError = validatePasswordPolicy(body.newPassword);
      if (passwordError) return json(res, 400, { error: passwordError });
      if (!verifyPassword(String(body.oldPassword || ""), user.passwordHash)) {
        return json(res, 400, { error: "原密码不正确" });
      }
      user.passwordHash = hashPassword(String(body.newPassword));
      user.mustChangePassword = false;
      saveDb(db);
      return json(res, 200, { user: publicUser(user) });
    }

    if (method === "PUT" && url.pathname === "/api/profile") {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const body = await readJson(req);
      user.name = String(body.name || user.name).trim().slice(0, 30);
      if (Object.prototype.hasOwnProperty.call(body, "avatar")) user.avatar = cleanUrl(body.avatar);
      user.major = majorThemes[body.major] ? body.major : normalizeMajor(user.major);
      user.className = normalizeClassName(db, body.className ?? user.className);
      saveDb(db);
      return json(res, 200, { user: publicUser(user) });
    }

    if (method === "POST" && url.pathname === "/api/profile/avatar") {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const contentLength = Number(req.headers["content-length"] || 0);
      if (contentLength > 3 * 1024 * 1024) return json(res, 413, { error: "头像不能超过 3MB" });
      const parts = parseMultipart(await readBody(req, 3 * 1024 * 1024), req.headers["content-type"]);
      const upload = parts.find((part) => part.name === "avatar" && part.filename);
      if (!upload || !upload.data.length) return json(res, 400, { error: "请选择头像图片" });
      const ext = path.extname(upload.filename).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return json(res, 400, { error: "头像只支持 png、jpg、jpeg、gif、webp" });
      ensureDir(AVATAR_ROOT);
      const avatarName = `${user.id}-${Date.now()}${ext}`;
      fs.writeFileSync(path.join(AVATAR_ROOT, avatarName), upload.data);
      user.avatar = `/avatars/${avatarName}`;
      appendOperationLog(db, user, "上传头像", user.account);
      saveDb(db);
      return json(res, 200, { user: publicUser(user) });
    }

    if (method === "POST" && url.pathname === "/api/profile/files") {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const contentLength = Number(req.headers["content-length"] || 0);
      if (contentLength > USER_STORAGE_QUOTA_BYTES + 1024 * 1024) return json(res, 413, { error: "个人文件不能超过 500MB" });
      const parts = parseMultipart(await readBody(req, USER_STORAGE_QUOTA_BYTES + 1024 * 1024), req.headers["content-type"]);
      const upload = parts.find((part) => part.name === "file" && part.filename);
      if (!upload || !upload.data.length) return json(res, 400, { error: "请选择要上传的个人文件" });
      const usedBytes = userStorageUsage(db, user.id);
      if (usedBytes + upload.data.length > USER_STORAGE_QUOTA_BYTES) {
        return json(res, 413, { error: "个人空间不足，每个账号最多 500MB" });
      }
      const originalName = safeName(upload.filename);
      const targetDir = userStorageDir(user.id);
      ensureDir(targetDir);
      const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${originalName}`;
      const diskPath = path.join(targetDir, storedName);
      fs.writeFileSync(diskPath, upload.data);
      const record = {
        id: crypto.randomUUID(),
        userId: user.id,
        account: user.account,
        title: String(path.parse(originalName).name || originalName).trim().slice(0, 80),
        originalName,
        storedName,
        diskPath,
        size: upload.data.length,
        contentType: upload.type || "application/octet-stream",
        md5: crypto.createHash("md5").update(upload.data).digest("hex"),
        createdAt: new Date().toISOString()
      };
      getUserFileStore(db).push(record);
      appendOperationLog(db, user, "上传个人文件", user.account, originalName);
      saveDb(db);
      return json(res, 201, { file: publicUserFile(record), storage: userStoragePayload(db, user) });
    }

    if (method === "GET" && url.pathname.startsWith("/api/profile/files/") && url.pathname.endsWith("/download")) {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const id = url.pathname.split("/")[4];
      const file = getUserFileStore(db).find((item) => item.id === id);
      if (!file || file.userId !== user.id) return json(res, 404, { error: "个人文件不存在" });
      if (!fs.existsSync(file.diskPath)) return json(res, 404, { error: "个人文件已不在磁盘上" });
      const stat = fs.statSync(file.diskPath);
      if (!stat.isFile()) return json(res, 404, { error: "个人文件无效" });
      const encoded = encodeURIComponent(file.originalName);
      res.writeHead(200, {
        ...securityHeaders(),
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`
      });
      return streamDownload(res, file.diskPath);
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/profile/files/")) {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const id = url.pathname.split("/").pop();
      const file = getUserFileStore(db).find((item) => item.id === id);
      if (!file || file.userId !== user.id) return json(res, 404, { error: "个人文件不存在" });
      const diskDelete = deleteUserStorageFile(file);
      db.userFiles = getUserFileStore(db).filter((item) => item.id !== id);
      appendOperationLog(db, user, "删除个人文件", user.account, `${file.originalName} / ${diskDelete.deleted ? "已删除磁盘文件" : "磁盘文件不存在"}`);
      saveDb(db);
      return json(res, 200, { ok: true, storage: userStoragePayload(db, user) });
    }

    if (method === "POST" && url.pathname === "/api/users") {
      const creator = requireRole(req, res, db, ["teacher", "admin"]);
      if (!creator) return;
      if (blocksBeforePasswordChange(req, res, creator)) return;
      const body = await readJson(req);
      const account = String(body.account || "").trim();
      if (!account) return json(res, 400, { error: "账号不能为空" });
      if (!isSafeAccount(account)) return json(res, 400, { error: "账号只能包含字母、数字、下划线和短横线，长度 3-32 位" });
      if (db.users.some((user) => user.account === account)) return json(res, 409, { error: "账号已存在" });
      const role = creator.role === "teacher" ? "student" : (["student", "teacher", "admin"].includes(body.role) ? body.role : "student");
      const user = {
        id: crypto.randomUUID(),
        account,
        role,
        name: String(body.name || account).trim().slice(0, 30),
        major: majorThemes[body.major] ? body.major : "info_security",
        className: normalizeClassName(db, body.className),
        avatar: "",
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        mustChangePassword: true,
        createdBy: creator.id,
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      appendOperationLog(db, creator, "新增账号", account, role);
      saveDb(db);
      return json(res, 201, { user: publicUser(user), initialPassword: DEFAULT_PASSWORD });
    }

    if (method === "PUT" && url.pathname.startsWith("/api/admin/users/")) {
      const operator = requireSuperAdmin(req, res, db);
      if (!operator) return;
      const id = url.pathname.split("/").pop();
      const target = db.users.find((user) => user.id === id);
      if (!target) return json(res, 404, { error: "账号不存在" });
      if (target.account === "superadmin") return json(res, 400, { error: "超级管理员账号权限不能修改" });

      const body = await readJson(req);
      const role = String(body.role || target.role).trim();
      if (!["student", "teacher", "admin"].includes(role)) return json(res, 400, { error: "角色参数无效" });

      const before = `${target.role}/${target.major}/${target.mustChangePassword ? "must" : "normal"}`;
      target.name = String(body.name || target.name).trim().slice(0, 30);
      target.role = role;
      target.major = majorThemes[body.major] ? body.major : normalizeMajor(target.major);
      target.className = normalizeClassName(db, body.className ?? target.className);
      if (body.mustChangePassword !== undefined) {
        target.mustChangePassword = body.mustChangePassword === true || body.mustChangePassword === "true";
      }
      const after = `${target.role}/${target.major}/${target.mustChangePassword ? "must" : "normal"}`;

      appendOperationLog(db, operator, "调整账号权限", target.account, `${before} -> ${after}`);
      saveDb(db);
      return json(res, 200, { user: publicUser(target) });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
      const operator = requireSuperAdmin(req, res, db);
      if (!operator) return;
      const id = url.pathname.split("/").pop();
      const target = db.users.find((user) => user.id === id);
      if (!target) return json(res, 404, { error: "账号不存在" });
      if (target.account === "superadmin") return json(res, 400, { error: "超级管理员账号不能删除" });
      deleteUserStorageForUser(db, id);
      db.users = db.users.filter((user) => user.id !== id);
      for (const [sid, session] of Object.entries(runtimeSessions)) {
        if (session.userId === id) delete runtimeSessions[sid];
      }
      for (const [sid, session] of Object.entries(db.sessions || {})) {
        if (session.userId === id) delete db.sessions[sid];
      }
      appendOperationLog(db, operator, "删除账号", target.account, target.name);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/front/feedback") {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const body = await readJson(req);
      const title = String(body.title || "").trim();
      const content = String(body.content || "").trim();
      if (!title || content.length < 2) return json(res, 400, { error: "反馈标题和内容不能为空" });
      const item = {
        id: crypto.randomUUID(),
        type: String(body.type || "问题反馈").trim().slice(0, 40),
        title: title.slice(0, 80),
        content: content.slice(0, 600),
        softwareId: String(body.softwareId || "").trim(),
        userId: user.id,
        userName: user.name,
        status: "待处理",
        reply: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.feedback.push(item);
      appendOperationLog(db, user, "提交反馈", item.title);
      saveDb(db);
      return json(res, 201, { feedback: item });
    }

    if (method === "POST" && url.pathname === "/api/confessions") {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const body = await readJson(req);
      const content = String(body.content || "").trim();
      if (content.length < 2) return json(res, 400, { error: "内容太短" });
      const item = {
        id: crypto.randomUUID(),
        userId: user.id,
        author: String(body.anonymous) === "true" ? "匿名同学" : user.name,
        content: content.slice(0, 300),
        createdAt: new Date().toISOString()
      };
      db.confessions.push(item);
      saveDb(db);
      return json(res, 201, { confession: item });
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/confessions/")) {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const id = url.pathname.split("/").pop();
      const item = db.confessions.find((entry) => entry.id === id);
      if (!item) return json(res, 404, { error: "内容不存在" });
      if (user.role !== "admin" && item.userId !== user.id) return json(res, 403, { error: "权限不足" });
      db.confessions = db.confessions.filter((entry) => entry.id !== id);
      saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && url.pathname === "/api/files/chunk/init") {
      const user = requireRole(req, res, db, ["teacher", "admin"]);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const body = await readJson(req);
      const size = Number(body.size || 0);
      if (!Number.isSafeInteger(size) || size <= 0) return json(res, 400, { error: "文件大小无效" });
      if (size > MAX_FILE_BYTES) return json(res, 413, { error: `文件超过上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024 / 1024)}GB` });
      const zone = body.zone === "mirror" ? "mirror" : "software";
      const originalName = safeName(body.filename);
      const category = classifyFile(originalName);
      const targetRoot = zone === "mirror" ? MIRROR_ROOT : SOFTWARE_ROOT;
      const targetDir = path.join(targetRoot, category);
      ensureDir(targetDir);
      const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${originalName}`;
      const diskPath = path.join(targetDir, storedName);
      fs.closeSync(fs.openSync(diskPath, "w"));
      const upload = {
        id: crypto.randomUUID(),
        zone,
        category,
        title: String(body.title || path.parse(originalName).name).trim().slice(0, 80),
        description: String(body.description || "").trim().slice(0, 240),
        originalName,
        storedName,
        diskPath,
        size,
        receivedBytes: 0,
        receivedChunks: [],
        uploaderId: user.id,
        uploaderName: user.name,
        createdAt: new Date().toISOString()
      };
      getUploadStore(db).push(upload);
      saveDb(db);
      return json(res, 201, { uploadId: upload.id, chunkSize: MAX_CHUNK_BYTES });
    }

    if (method === "POST" && url.pathname === "/api/files/chunk/upload") {
      const user = requireRole(req, res, db, ["teacher", "admin"]);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const contentLength = Number(req.headers["content-length"] || 0);
      if (contentLength > MAX_CHUNK_BYTES + 1024 * 1024) return json(res, 413, { error: "分片过大" });
      const parts = parseMultipart(await readBody(req, MAX_CHUNK_BYTES + 1024 * 1024), req.headers["content-type"]);
      const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.data.toString("utf8")]));
      const chunk = parts.find((part) => part.name === "chunk" && part.filename);
      const uploads = getUploadStore(db);
      const upload = uploads.find((item) => item.id === fields.uploadId);
      if (!upload) return json(res, 404, { error: "上传任务不存在" });
      if (upload.uploaderId !== user.id && user.role !== "admin") return json(res, 403, { error: "权限不足" });
      const index = Number(fields.index);
      const offset = Number(fields.offset);
      if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(offset) || offset < 0) {
        return json(res, 400, { error: "分片参数无效" });
      }
      if (!chunk || !chunk.data.length || chunk.data.length > MAX_CHUNK_BYTES) return json(res, 400, { error: "分片内容无效" });
      if (offset + chunk.data.length > upload.size) return json(res, 400, { error: "分片超出文件大小" });
      const fd = fs.openSync(upload.diskPath, "r+");
      try {
        fs.writeSync(fd, chunk.data, 0, chunk.data.length, offset);
      } finally {
        fs.closeSync(fd);
      }
      if (!upload.receivedChunks.includes(index)) {
        upload.receivedChunks.push(index);
        upload.receivedBytes = Math.min(upload.size, Number(upload.receivedBytes || 0) + chunk.data.length);
      }
      saveDb(db);
      return json(res, 200, { receivedBytes: upload.receivedBytes, size: upload.size });
    }

    if (method === "POST" && url.pathname === "/api/files/chunk/complete") {
      const user = requireRole(req, res, db, ["teacher", "admin"]);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const body = await readJson(req);
      const uploads = getUploadStore(db);
      const upload = uploads.find((item) => item.id === body.uploadId);
      if (!upload) return json(res, 404, { error: "上传任务不存在" });
      if (upload.uploaderId !== user.id && user.role !== "admin") return json(res, 403, { error: "权限不足" });
      const actualSize = fs.existsSync(upload.diskPath) ? fs.statSync(upload.diskPath).size : 0;
      if (upload.receivedBytes < upload.size || actualSize > upload.size) {
        return json(res, 400, { error: "上传尚未完成" });
      }
      const md5 = await hashFile(upload.diskPath, "md5");
      const record = {
        id: crypto.randomUUID(),
        zone: upload.zone,
        category: upload.category,
        title: upload.title,
        description: upload.description,
        originalName: upload.originalName,
        storedName: upload.storedName,
        diskPath: upload.diskPath,
        size: upload.size,
        uploaderId: upload.uploaderId,
        uploaderName: upload.uploaderName,
        version: "1.0",
        systemRequire: upload.zone === "mirror" ? "Windows / Linux" : "Windows",
        tutorial: "",
        md5,
        status: "published",
        isRecommend: false,
        isHot: false,
        downloadCount: 0,
        createdAt: new Date().toISOString()
      };
      db.files.push(record);
      db.uploads = uploads.filter((item) => item.id !== upload.id);
      appendOperationLog(db, user, "上传资源", record.title, record.originalName);
      saveDb(db);
      return json(res, 201, { file: record });
    }

    if (method === "POST" && url.pathname === "/api/files") {
      const user = requireRole(req, res, db, ["teacher", "admin"]);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const contentLength = Number(req.headers["content-length"] || 0);
      if (contentLength > MAX_UPLOAD_BYTES) return json(res, 413, { error: "上传文件过大" });
      const parts = parseMultipart(await readBody(req, MAX_UPLOAD_BYTES), req.headers["content-type"]);
      const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.data.toString("utf8")]));
      const upload = parts.find((part) => part.name === "file" && part.filename);
      if (!upload || !upload.data.length) return json(res, 400, { error: "请选择文件" });
      const zone = fields.zone === "mirror" ? "mirror" : "software";
      const originalName = safeName(upload.filename);
      const selectedCategory = String(fields.category || "").trim().slice(0, 80);
      const availableCategories = new Set((db.categories || []).map((item) => String(item.name || "").trim()).filter(Boolean));
      const category = selectedCategory && availableCategories.has(selectedCategory) ? selectedCategory : classifyFile(originalName);
      const targetRoot = zone === "mirror" ? MIRROR_ROOT : SOFTWARE_ROOT;
      const targetDir = path.join(targetRoot, category);
      ensureDir(targetDir);
      const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${originalName}`;
      const diskPath = path.join(targetDir, storedName);
      fs.writeFileSync(diskPath, upload.data);
      const md5 = crypto.createHash("md5").update(upload.data).digest("hex");
      const record = {
        id: crypto.randomUUID(),
        zone,
        category,
        title: String(fields.title || path.parse(originalName).name).trim().slice(0, 80),
        description: String(fields.description || "").trim().slice(0, 240),
        originalName,
        storedName,
        diskPath,
        size: upload.data.length,
        uploaderId: user.id,
        uploaderName: user.name,
        version: "1.0",
        systemRequire: zone === "mirror" ? "Windows / Linux" : "Windows",
        tutorial: "",
        md5,
        status: "published",
        isRecommend: false,
        isHot: false,
        downloadCount: 0,
        createdAt: new Date().toISOString()
      };
      db.files.push(record);
      appendOperationLog(db, user, "上传资源", record.title, record.originalName);
      saveDb(db);
      return json(res, 201, { file: record });
    }

    if (method === "GET" && url.pathname.startsWith("/api/files/") && url.pathname.endsWith("/download")) {
      const user = getCurrentUser(req, db);
      let downloadUser = user;
      let guestLimit = null;
      if (user) {
        if (blocksBeforePasswordChange(req, res, user)) return;
      } else {
        guestLimit = reserveGuestDownload(db, req);
        if (!guestLimit.allowed) {
          return json(res, 429, { error: `游客下载次数已用完，每台设备最多 ${GUEST_DOWNLOAD_LIMIT} 次，请登录后下载` }, { "Set-Cookie": guestCookieHeader(guestLimit.guestId) });
        }
        downloadUser = {
          id: `guest:${guestLimit.key}`,
          account: "guest",
          name: "游客",
          role: "guest"
        };
        saveDb(db);
      }
      if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
        return json(res, 503, { error: "当前下载人数较多，请稍后再试" }, { "Retry-After": "30" });
      }
      const id = url.pathname.split("/")[3];
      const file = db.files.find((item) => item.id === id);
      if (!file || !fs.existsSync(file.diskPath)) return json(res, 404, { error: "文件不存在" });
      const encoded = encodeURIComponent(file.originalName);
      const stat = fs.statSync(file.diskPath);
      const range = req.headers.range;
      const baseHeaders = {
        ...securityHeaders(),
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`
      };
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) return send(res, 416, "Range Not Satisfiable", "text/plain");
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${stat.size}`, ...(guestLimit ? { "Set-Cookie": guestCookieHeader(guestLimit.guestId) } : {}) });
          return res.end();
        }
        res.writeHead(206, {
          ...baseHeaders,
          ...(guestLimit ? { "Set-Cookie": guestCookieHeader(guestLimit.guestId) } : {}),
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`
        });
        recordDownloadAsync(file.id, downloadUser, req);
        return streamDownload(res, file.diskPath, { start, end });
      }
      res.writeHead(200, {
        ...baseHeaders,
        ...(guestLimit ? { "Set-Cookie": guestCookieHeader(guestLimit.guestId) } : {}),
        "Content-Length": stat.size
      });
      recordDownloadAsync(file.id, downloadUser, req);
      return streamDownload(res, file.diskPath);
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/files/")) {
      const user = requireUser(req, res, db);
      if (!user) return;
      if (blocksBeforePasswordChange(req, res, user)) return;
      const id = url.pathname.split("/").pop();
      const file = db.files.find((item) => item.id === id);
      if (!file) return json(res, 404, { error: "文件不存在" });
      if (user.role !== "admin" && file.uploaderId !== user.id) return json(res, 403, { error: "权限不足" });
      const diskDelete = deleteStoredFile(file);
      db.files = db.files.filter((item) => item.id !== id);
      appendOperationLog(db, user, "删除资源", file.title, `${file.originalName} / ${diskDelete.deleted ? "已删除磁盘文件" : "磁盘文件不存在"}`);
      saveDb(db);
      return json(res, 200, { ok: true, diskDeleted: diskDelete.deleted });
    }

    return json(res, 404, { error: "接口不存在" });
  } catch (error) {
    console.error(error);
    return json(res, error.statusCode || 500, { error: error.message || "服务器错误" });
  }
}

function requestHandler(req, res) {
  if (rejectSuspiciousRequest(req, res)) return;
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  if (routeStatic(req, res)) return;
  send(res, 404, "Not found", "text/plain; charset=utf-8");
}

seedDb();
for (const port of [PORT, ...EXTRA_PORTS]) {
  const server = http.createServer(requestHandler);
  server.listen(port, HOST, () => {
    console.log(`Campus software site running at http://${HOST}:${port}`);
    console.log(`软件目录: ${SOFTWARE_ROOT}`);
    console.log(`镜像目录: ${MIRROR_ROOT}`);
  });
  server.on("error", (error) => {
    console.error(`端口 ${port} 启动失败: ${error.message}`);
  });
}
