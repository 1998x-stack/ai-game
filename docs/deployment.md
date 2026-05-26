# 部署指南

## 本地开发

### 前置条件

- Node.js 18+
- DeepSeek API Key ([获取](https://platform.deepseek.com/))

### 启动

```bash
git clone https://github.com/1998x-stack/ai-game.git
cd ai-game
npm install
npm run dev
# 打开 http://localhost:3000
# 在设置中配置 DeepSeek API Key
# 开始创建游戏
```

### 常用命令

```bash
npm run dev      # 开发服务器 (热更新)
npm run build    # 生产构建
npm run start    # 启动生产服务器
npx vitest run   # 运行 API 测试
```

### ⚠️ .next 缓存

开发和生产构建使用不同的 webpack 编译策略，切换时必须清除缓存：

```bash
# 从 build 切换到 dev:
rm -rf .next && npm run dev

# 从 dev 切换到 build:
rm -rf .next && npm run build
```

否则会出现 `MODULE_NOT_FOUND` 错误。

## 生产部署

### Vercel (推荐)

```bash
npm i -g vercel
vercel
```

环境变量无需配置 — 用户自带 API Key，服务端不存储密钥。

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t ai-game .
docker run -p 3000:3000 ai-game
```

### 传统服务器

```bash
npm run build
npm start
# 使用 PM2 持久化:
pm2 start npm --name "ai-game" -- start
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |

无需配置 API Key 环境变量 — 用户在浏览器端配置，每次请求携带。

## GitHub Pages

项目包含 GitHub Pages 落地页 (`assets/index.html`)。推送到 `main` 分支后自动部署：

```yaml
# .github/workflows/deploy.yml
on: push → branches: [main]
jobs:
  deploy:
    - peaceiris/actions-gh-pages@v3
      publish_dir: ./assets
      publish_branch: gh-pages
```

部署后访问: `https://1998x-stack.github.io/ai-game/`

## 安全注意事项

### 生产环境检查清单

- [ ] 确保 iframe 沙箱仅使用 `allow-scripts` (不使用 `allow-same-origin`)
- [ ] 确保 CSP 头包含必要的 `data:` 和 `blob:` 源
- [ ] 确认路径校验已启用 (UUID 验证 + `..` 拒绝)
- [ ] 确认 API Key 不在日志中打印
- [ ] 确认工作区目录权限正确
- [ ] 设置合理的会话上限 (默认 100)
- [ ] 配置反向代理的请求大小限制 (如 nginx `client_max_body_size`)

### 暂不推荐多租户部署

当前使用逻辑路径校验而非 OS 级容器隔离。多租户生产环境请等待 v2 的容器化支持。

## 目录结构

```
~/ai-game/
├── app/              # Next.js 应用代码
├── components/       # React 组件
├── lib/              # 核心库
├── workspace/        # 脚手架 (Git 追踪)
├── user_space/       # 用户工作区 (运行时, .gitignore)
├── public/           # 静态资源
├── assets/           # GitHub Pages 落地页
├── docs/             # 文档
├── __tests__/        # API 测试
└── .github/          # CI/CD 工作流
```
