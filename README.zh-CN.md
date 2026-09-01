<div align="center">

# MuVisual

通过钢琴卷帘、简谱和多轨播放交互式探索音乐。

[English](./README.md) | **简体中文**

</div>

## 目录

- [项目简介](#项目简介)
- [界面预览](#界面预览)
- [主要功能](#主要功能)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [Docker 部署](#docker-部署)
- [可用命令](#可用命令)
- [项目结构](#项目结构)

## 项目简介

MuVisual 可以将 MIDI 文件和经过处理的音频曲目转换为交互式音乐工作区。你可以浏览本地曲库，通过实时钢琴卷帘或简谱查看音符，在可用乐器分轨之间切换，并在同一界面中控制播放。

项目包含 React 前端和轻量级 Node.js 后端。MIDI 文件直接在浏览器本地解析；音频文件可选择发送到已配置的 Modal 服务，进行节拍分析、音轨分离和 MIDI 提取。

## 界面预览

### 音乐曲库

![MuVisual 音乐曲库](./public/image/home.png)

### 演奏工作室

![MuVisual 钢琴卷帘工作室](./public/image/studio.png)

## 主要功能

- 搜索预置曲目和已处理曲目的本地曲库
- 在浏览器本地导入 MIDI，无需上传到服务器
- 可选的音频处理流程，并支持处理任务持久化恢复
- 实时钢琴卷帘可视化与和弦识别
- 简谱视图
- 支持 MIDI、独立乐器分轨和原始曲目三种播放音源
- 支持钢琴、人声、贝斯、鼓、吉他和其他乐器分轨切换
- 可调整速度、调号、音量、画面延迟和音符标记
- 存在节拍分析数据时可启用节拍网格增强
- 英文与简体中文界面
- 基于密码的访问控制和签名 HttpOnly 会话

## 技术栈

- React 18 与 TypeScript
- Vite 5
- Tone.js MIDI 与 smplr
- MediaBunny
- Node.js HTTP 服务
- Docker

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- npm

### 安装运行

1. 克隆仓库：

   ```bash
   git clone https://github.com/TecReaGroup/MuVisual.git
   cd MuVisual
   ```

2. 安装依赖：

   ```bash
   npm install
   ```

3. 根据示例创建本地环境变量文件，并填写 `AUTH_PASSWORD`：

   ```bash
   cp .env.example .env
   ```

4. 启动后端：

   ```bash
   npm run backend
   ```

5. 在另一个终端中启动 Vite 开发服务器：

   ```bash
   npm run dev
   ```

6. 打开 Vite 输出的地址，通常为 `http://localhost:5173`，然后使用已配置的密码登录。

开发服务器会将 `/api`、`/auth` 和 `/media` 请求代理到 `http://localhost:8787`。

## 配置说明

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `AUTH_PASSWORD` | 是 | 登录密码，同时用于签名身份验证会话。 |
| `PORT` | 否 | 后端端口，默认为 `8787`。 |
| `MODAL_URL` | 音频上传时必需 | 音频处理服务的基础地址，后端会调用其 `/submit` 和 `/result/:id` 接口。 |
| `MODAL_KEY` | 否 | Modal 代理认证密钥。 |
| `MODAL_SECRET` | 否 | Modal 代理认证凭据。 |

不配置 Modal 也可以正常导入 MIDI。处理音频必须配置 `MODAL_URL`；如果端点启用了代理认证，还需同时配置两个 Modal 认证变量。

运行时曲库文件位于：

- `backend/data/visual`：预置曲目
- `backend/data/modal`：处理后的上传内容与任务状态
- `backend/data/log`：后端日志

## Docker 部署

构建生产镜像：

```bash
docker build -t muvisual .
```

运行容器：

```bash
docker run --rm \
  -p 8787:8787 \
  -e AUTH_PASSWORD=change-me \
  -e MODAL_URL=https://your-modal-service.example \
  -e MODAL_KEY=your-key \
  -e MODAL_SECRET=your-secret \
  -v /absolute/path/to/backend/data:/app/backend/data \
  muvisual
```

随后访问 `http://localhost:8787`。不需要音频上传处理时，可以省略 Modal 相关变量。若需要在容器替换后保留曲库、已处理的上传内容、任务状态和日志，请挂载持久化目录。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器。 |
| `npm run backend` | 启动 Node.js 后端。 |
| `npm run build` | 执行类型检查并构建生产前端。 |
| `npm run preview` | 预览生产前端构建结果。 |

## 项目结构

```text
MuVisual/
├── backend/          # 身份验证、曲库、媒体与音频处理服务
├── public/           # 随项目打包的字体、音频采样、图标和预览图片
├── src/
│   ├── app/          # 应用入口与页面路由
│   ├── entities/     # 音乐领域类型与时间轴逻辑
│   ├── features/     # 导入、播放、钢琴卷帘与简谱功能
│   ├── pages/        # 登录、曲库与工作室页面
│   └── shared/       # 多语言和格式化等共享代码
├── Dockerfile
├── package.json
└── vite.config.ts
```
