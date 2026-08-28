# BTC Local Terminal Web

这是 BTC Local Terminal 的静态远程查看页，部署在 GitHub Pages。

- BTC：Binance 现货公开行情
- HYPE：Hyperliquid 永续实时标记价格
- SPCX / MU / SNDK / NVDA：Binance USDⓈ-M 永续公开行情
- Raydium / Meteora：公开 LP Decision OS 快照中的 24h LP Fee 各前 5
- 新闻：公开的律动 `feed.json`
- 页面端轮询、浏览器缓存和失败回退均在 `index.html` 内完成

此仓库只包含静态页面，不包含本地 `.env`、API key、局域网地址或本地文件路径。

Fee 榜使用同一个公开快照源：

<https://fengxiong111.github.io/lp-decision-os/top3.json>

页面每 60 秒读取一次，并按 `lpFee24h` 分别排序 Raydium 与 Meteora 后显示前 5；读取失败时仅保留浏览器缓存，不生成 mock 数据。当前公开文件是全局 Top50 预览，因此这里的“各协议前 5”范围是已发布快照内的前 5，不等同于上游全量池全集排名。
