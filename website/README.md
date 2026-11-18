# Worldweave 官网

Worldweave（织界）的独立静态官网，放在 `website/` 文件夹里，不参与主前端构建。

## 结构

```text
website/
  index.html          落地页：真实与想象、世界时间、界面、CTA
  how-it-works.html   详情页：能力、流程、架构、快速开始、路线图
  styles.css          设计系统、布局、动效与响应式
  main.js             导航、倾斜、世界时间、画廊、主题切换
  assets/             logo、favicon 与产品截图
```

## 本地预览

不需要安装依赖，任选一种：

```bash
# Python
python -m http.server 4173 --directory website

# Node（npx）
npx serve website -l 4173
```

打开 <http://localhost:4173/>。

## 部署

这是纯静态站点，可以把 `website/` 目录直接发布到 GitHub Pages、Cloudflare Pages、Vercel、Netlify 或任意 Nginx 静态目录。

### GitHub Pages

仓库已包含 `.github/workflows/pages.yml`：在仓库 Settings → Pages 里把 Source 选为 **GitHub Actions**，之后 `website/` 的改动推送到 `main` 就会自动发布。

发布地址通常是：

```text
https://southyouth-team.github.io/worldweave/
```

工作流核心步骤：

```yaml
- uses: actions/upload-pages-artifact@v3
  with:
    path: website
```

### Nginx

```nginx
location / {
    root /var/www/worldweave-website;
    try_files $uri $uri/ /index.html;
}
```

## 说明

- 默认亮色主题（产品首页同系的鼠尾草绿 + 玻璃），右上角可切换暗色；选择会写入 `localStorage`。
- 图片按需懒加载：首屏截图优先加载，其余产品图和页脚 logo 使用 `loading="lazy"`。
- 首屏浏览器框会跟随鼠标方向倾斜；世界时间、画廊、快速开始都是可交互的。
- 品牌叙事：真实或想象，都可以成为一个世界。
- 两层结构：首页负责“真实或想象”的品牌叙事，`how-it-works.html` 负责地块、道路、Agent 构建循环、架构与路线图等机制内容。
- 页面字体从 Google Fonts 加载（Space Grotesk、Noto Sans SC、Noto Serif SC）；如果部署环境无法访问 Google Fonts，会回退到系统中文字体，布局仍然可用。若需要完全离线，可把字体文件下载到 `assets/fonts/` 并改成 `@font-face`。
- 产品截图为 demo 数据，仅用于展示界面。
- 官网内容与主仓库保持一致；修改项目定位、版本号或链接时，记得同步 `index.html` 和根目录 `README.md`。
