# cglyvip · 工具导航

个人工具导航页（GitHub Pages 站点）：把常用的浏览器脚本、开源项目和站点收在一处。

线上地址：<https://cglyvip.github.io/>

## 结构

```
index.html                        导航页
assets/style.css                  样式
assets/nav.js                     导航数据 + 渲染逻辑  ← 加条目改这里
assets/favicon.svg                图标
scripts/linuxdo-l3-auto-browse.user.js    linux.do L3 自动浏览助手（用户脚本）
```

## 加一个新条目

编辑 `assets/nav.js` 里的 `CATEGORIES`，往对应分类的 `items` 数组加对象：

```js
{
  name: '条目名',
  desc: '一句话说明',
  url: 'https://…',
  tag: '标签',                       // 可选，卡片右上角小标签
  meta: ['JavaScript', '2026-10-19'] // 可选，等宽小字信息
}
```

私有仓库默认不展示（`SHOW_PRIVATE = false`），改成 `true` 即可。

> **改了 `assets/` 下的 css 或 js 之后**，记得把 `index.html` 里两个资源地址的
> `?v=20261019a` 换成任意新值（例如日期+字母）。GitHub Pages 会给资源加 10 分钟
> 缓存，不换这个版本号的话，你自己打开看到的可能还是旧页面。

## 用户脚本的安装与更新

- 安装：打开 <https://cglyvip.github.io/> 点「安装脚本」，或直接把
  `scripts/linuxdo-l3-auto-browse.user.js` 拖进浏览器窗口。
- 自动更新：脚本头部已带 `@updateURL` / `@downloadURL` 指向本仓库 raw 链接，
  以后改了脚本 push 一次，各浏览器 Tampermonkey 会自动升级。
- 大陆网络直连 raw.githubusercontent.com 不稳时，用页面上的「镜像加速」（jsDelivr）。

## 本地预览

```bash
# 在仓库根目录
python -m http.server 8000
# 打开 http://localhost:8000/
```
