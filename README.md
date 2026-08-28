# BTC Local Terminal Web

这是 BTC Local Terminal 的静态远程查看页，部署在 GitHub Pages。

- BTC：Binance 现货公开行情
- HYPE：Hyperliquid 永续实时标记价格
- SPCX / MU / SNDK / NVDA：Binance USDⓈ-M 永续公开行情
- Raydium / Meteora：公开 LP Decision OS 快照中合并后的 24h LP Fee Top 5
- Hyperliquid HIP-3 股票：公共 `info` 接口中过滤出的正资金费率最高 Top 5
- 新闻：公开的律动 `feed.json`
- 页面端轮询、浏览器缓存和失败回退均在 `index.html` 内完成

此仓库只包含静态页面，不包含本地 `.env`、API key、局域网地址或本地文件路径。

Fee 榜使用同一个公开快照源：

<https://fengxiong111.github.io/lp-decision-os/top3.json>

页面每 60 秒读取一次，先从公开快照分别取 Raydium 与 Meteora 前 5，再按 `lpFee24h` 合并排序显示最高 5；读取失败时仅保留浏览器缓存，不生成 mock 数据。当前公开文件是全局 Top50 预览，因此这里的合并 Top5 范围是已发布快照，不等同于上游全量池全集排名。

页面每 30 秒发现 Hyperliquid 的 HIP-3 DEX 与 `stocks` 分类，再调用带 `dex` 的 `metaAndAssetCtxs`，只显示正资金费率股票永续的最高 5 个市场，并链接到 [Hyperliquid Trade](https://app.hyperliquid.xyz/trade)。该只读接口不需要 API key；请求失败时保留浏览器缓存，不生成 mock 数据。
