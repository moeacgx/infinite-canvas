<p align="center">
  <img src="web/public/logo.svg" width="96" alt="infinite-canvas logo">
</p>

<h1 align="center">无限画布 (infinite-canvas)</h1>

<p align="center">
  <a href="https://linux.do/"><img src="https://img.shields.io/badge/Linux.do-Community-2b6de8?style=flat-square" alt="Linux.do"></a>
  <a href="https://render.com/deploy?repo=https://github.com/basketikun/infinite-canvas"><img src="https://img.shields.io/badge/Render-Deploy-46e3b7?style=flat-square&logo=render&logoColor=111111" alt="Deploy to Render"></a>
  <a href="https://github.com/basketikun/infinite-canvas"><img src="https://img.shields.io/github/stars/basketikun/infinite-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v0.2.0-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker ready"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16.2-000000?style=flat-square&logo=nextdotjs" alt="Next.js"></a>
  <a href="https://go.dev/"><img src="https://img.shields.io/badge/Go-1.25-00add8?style=flat-square&logo=go&logoColor=white" alt="Go"></a>
</p>

无限画布是一款面向图片创作的开源工作台。它把画布编排、AI 图片生成、参考图编辑、对话助手、提示词库和素材沉淀放在同一个界面里，适合用来探索视觉方案并连续迭代图片结果。

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种数据库结构和存储格式都可能直接调整，欢迎关注后续更新，当前更适合个人/本地部署，不建议直接公网多人共用。
>
> 如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。二次开发与 PR 请保留原作者信息和前端页面标识。

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 创作：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑、文本问答和视频生成；Seedance 2.0 可通过火山方舟 Agent Plan 接入。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- 提示词库：抓取多个 GitHub 开源项目，按案例整理数百个图片提示词。

完整功能说明见 [docs/features.md](docs2/features.md)。

如果你在为担心没有合适的生图API来发愁，可以查看该免费生图项目：[chatgpt2api](https://github.com/basketikun/chatgpt2api)

## 技术栈

- 前端：Next.js、React、TypeScript、Tailwind CSS、Ant Design、Zustand、TanStack Query。
- 后端：Go、Gin、GORM。
- 部署：Docker。

## 快速开始

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/basketikun/infinite-canvas)

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas
cp .env.example .env
# 修改默认账号密码等信息
docker-compose up -d
```

本地源码构建运行：

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build
```

运行后默认端口3000，可访问 `http://localhost:3000`。

如需要拉取提示词，可前往:`http://localhost:3000/admin/prompts`

## New API 自动配置

如果使用 New API，可通过登录态免 Key 方式打开画布：

```text
https://infinite-canvas-cpco.onrender.com?mode=newapi&baseUrl={address}/canvas&group={group}
```

跳转后会自动写入 New API Base URL 和分组，画布请求会携带当前 New API 登录态 Cookie，不再需要识别或传递 API Key。
如果自己部署了，可以把 `https://infinite-canvas-cpco.onrender.com` 替换成你部署的地址。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="5" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="image" border="0"></td>
  </tr>
</table>

## 文档

- [功能介绍](docs2/features.md)
- [部署说明](docs2/deployment.md)
- [画布节点操作手册](docs2/canvas-node-manual.md)
- [画布快捷键](docs2/canvas-shortcuts.md)
- [待办事项](docs2/todo.md)
- [后端数据库说明](docs2/backend-database.md)
- [系统配置数据结构](docs2/system-settings.md)
- [接口响应约定](docs2/api-response.md)

## 赞助支持

<div align="center">

如果这个项目对你有帮助，欢迎通过爱发电赞助支持，你的每一份鼓励都是持续更新的动力！

<br>

<a href="https://ifdian.net/a/basketikun">
  <img src="https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-%E8%B5%9E%E5%8A%A9%E4%BD%9C%E8%80%85-946ce6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyMS4zNWwtMS40NS0xLjMyQzUuNCAxNS4zNiAyIDEyLjI4IDIgOC41IDIgNS40MiA0LjQyIDMgNy41IDNjMS43NCAwIDMuNDEuODEgNC41IDIuMDlDMTMuMDkgMy44MSAxNC43NiAzIDE2LjUgMyAxOS41OCAzIDIyIDUuNDIgMjIgOC41YzAgMy43OC0zLjQgNi44Ni04LjU1IDExLjU0TDEyIDIxLjM1eiIvPjwvc3ZnPg==&logoColor=white" alt="爱发电赞助" />
</a>

<br>
<br>

</div>

## 社区支持

学 AI，上 L 站：[LinuxDO](https://linux.do/)

点击链接加入群聊【AI开源交流】：https://qm.qq.com/q/DFnKzZ807u

## 开源协议

本项目使用 GNU Affero General Public License v3.0，见 [LICENSE](LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=basketikun%2Finfinite-canvas&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
 </picture>
</a>
