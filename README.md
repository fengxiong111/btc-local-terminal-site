# BTC Local Terminal Web

这是 BTC Local Terminal 的静态远程查看页，部署在 GitHub Pages。

- BTC：Binance 现货公开行情
- HYPE：Hyperliquid 永续实时标记价格
- SPCX / MU / SNDK / NVDA：Binance USDⓈ-M 永续公开行情
- Uniswap：真实 ExploreStats 快照中的 RWA/USDC Fee 前三与普通币 Fee 前三
- Solana：Raydium / Meteora 真实 LP Decision OS 快照中的 RWA/USDC Fee 前三与普通币 Fee 前三
- 新闻：公开的律动 `feed.json`
- 页面端轮询、浏览器缓存和失败回退均在 `index.html` 内完成

此仓库只包含静态页面，不包含本地 `.env`、API key、局域网地址或本地文件路径。

Uniswap Fee 榜使用仓库内的真实快照 `uniswap-fee.json`。它由 GitHub Actions 每 15 分钟从 Uniswap ExploreStats 公共接口刷新；Solana Fee 榜继续读取 `https://fengxiong111.github.io/lp-decision-os/top3.json`。页面每 60 秒读取 Solana 快照，Uniswap 快照按页面轮询读取；读取失败时仅保留浏览器缓存，不生成 mock 数据。两条链分别显示 `RWA / USDC` 与排除 RWA 后的普通币费用前三；当前数据不足三条时按真实数量显示，不补占位数据。

费用口径是 `24h volume × pool fee tier`：v2 使用 0.30% 总 swap fee，v3/v4 使用池子 fee tier。这是池子总费用估算，不是扣除 protocol fee 后的 LP 净分成。ExploreStats 返回的是公共 top-pool snapshot，不等同于全网络全部池子的完整排名。

数据生成脚本：`scripts/update-uniswap-fee.mjs`。GitHub Actions：`.github/workflows/update-uniswap-fee.yml`。

token 行情与 LP Fee 使用同一个紧凑容器承载，但不混合价格和费用语义；静态页不加载或展示 HIP-3 股票资金费率榜。
