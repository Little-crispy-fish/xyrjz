# 校园软件站

校园软件站是一个基于 Node.js 的轻量级软件资源管理平台，面向校园内的软件、系统镜像、教程附件和用户资料管理场景。项目不依赖外部数据库，默认使用本地 JSON 文件保存数据，适合在 Windows 服务器或校园内网环境中快速部署。

## 功能

- 软件资源、系统镜像上传和下载
- 资源分类、推荐、热门和下载统计
- 学生、教师、管理员账号管理
- 班级、专业、公告、反馈管理
- 个人资料、头像和密码修改
- 每个账号 500MB 个人文件空间后端能力
- 系统运行状态、存储状态和操作日志

## 技术栈

- Node.js 18+
- 原生 HTTP 服务
- 原生 HTML、CSS、JavaScript
- 本地 JSON 数据文件

## 目录结构

```text
.
├── server.js              # 后端服务和 API
├── public/
│   ├── index.html         # 前端入口
│   ├── app.js             # 前端业务逻辑
│   └── styles.css         # 页面样式
├── data/                  # 本地开发数据目录
├── run-server.bat         # 后台启动脚本
├── 一键启动.bat           # Windows 一键启动脚本
└── setup-portable-node.ps1
```

## 快速启动

安装依赖：

```bash
npm install
```

启动服务：

```bash
npm start
```

默认访问地址：

```text
http://localhost:3000
```

Windows 下也可以双击：

```text
一键启动.bat
```

或使用后台启动脚本：

```text
run-server.bat
```

## 环境变量

常用环境变量：

```text
PORT=3000
HOST=0.0.0.0
DATA_DIR=D:\校园软件站数据
SOFTWARE_ROOT=D:\软件
MIRROR_ROOT=D:\镜像
MAX_UPLOAD_MB=900
MAX_FILE_GB=20
MAX_CHUNK_MB=8
USER_STORAGE_QUOTA_MB=500
GUEST_DOWNLOAD_LIMIT=5
```

说明：

- `DATA_DIR` 保存数据库、头像、Logo、个人文件等数据。
- `SOFTWARE_ROOT` 保存软件资源文件。
- `MIRROR_ROOT` 保存系统镜像文件。
- `USER_STORAGE_QUOTA_MB` 控制每个账号的个人文件空间，默认 500MB。

## 数据存储

默认数据文件：

```text
D:\校园软件站数据\db.json
```

如果没有设置 `DATA_DIR`，服务会使用 `server.js` 中的默认目录。项目目录里的 `data/db.json` 可能只是开发或历史数据，实际运行时请以 `DATA_DIR` 为准。

个人文件默认存放在：

```text
D:\校园软件站数据\user-storage
```

## 初始账号

首次启动时会自动生成超级管理员账号：

```text
账号：superadmin
密码：查看 DATA_DIR\superadmin-initial-password.txt
```

如果需要指定初始超级管理员密码，可以启动前设置：

```text
SUPERADMIN_PASSWORD=你的密码
```

## Git 分支

当前个人空间后端功能在分支：

```text
feature/user-storage-profile
```

远程仓库：

```text
https://github.com/Little-crispy-fish/xyrjz
```

## 注意事项

- 生产环境请妥善备份 `DATA_DIR`、`SOFTWARE_ROOT` 和 `MIRROR_ROOT`。
- 不要手动编辑正在运行中的 `db.json`，避免 JSON 损坏。
- 大文件上传建议使用分片上传接口，避免浏览器或代理中断。
- 如果开放到公网，请额外配置 HTTPS、反向代理、防火墙和访问控制。
