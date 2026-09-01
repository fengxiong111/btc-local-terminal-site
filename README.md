# BTC 本地终端 · 远程查看页

这是 BTC Local Terminal 的静态远程查看页，部署在 GitHub Pages。它不能运行本地 Next.js API 或读取本机文件，因此使用同一套只读视觉语言，并在浏览器直接读取公开行情与 Deribit 期权；本地文件型 Flow/Options 输出只在本地服务可用。

- BTC：Binance 现货公开行情与日线 EMA200
- HYPE：Hyperliquid 永续实时标记价格
- SPCX / MU / SNDK / NVDA：Hyperliquid HIP-3 `xyz` 股票永续公开行情；单个标的缺失时回退 Binance USDⓈ-M 行情
- Uniswap 快照：仓库保留真实 ExploreStats 数据供本地工作区/API 回退使用，静态首页不展示榜单
- 新闻：公开的律动 `feed.json`
- 页面端轮询、浏览器缓存和失败回退均在 `index.html` 内完成
- Binance 日线 EMA200 / MA120

此仓库只包含静态页面，不包含本地 `.env`、API key、局域网地址或本地文件路径。

仓库内的 `uniswap-fee.json` 仍由 GitHub Actions 每 15 分钟从 Uniswap ExploreStats 公共接口刷新，供本地 Uniswap 工作区/API 回退使用；静态首页不加载或展示该榜单。Solana LP 费率榜单已从页面和导航移除。

费用口径是 `24h volume × pool fee tier`：v2 使用 0.30% 总 swap fee，v3/v4 使用池子 fee tier。这是池子总费用估算，不是扣除 protocol fee 后的 LP 净分成。ExploreStats 返回的是公共池快照，不等同于全网络全部池子的完整排名。

数据生成脚本：`scripts/update-uniswap-fee.mjs`。GitHub Actions：`.github/workflows/update-uniswap-fee.yml`。

静态页仅展示 token 行情，不加载或展示 Uniswap Fee 榜单与 HIP-3 股票资金费率榜。
