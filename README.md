# BTC 本地终端 · 远程查看页

这是 BTC Local Terminal 的静态远程查看页，部署在 GitHub Pages。它不能运行本地 Next.js API 或读取本机文件，因此使用同一套只读视觉语言，并在浏览器直接读取公开行情、Deribit 期权和公开成交；本地文件型 Flow/Options 输出只在本地服务可用。

- BTC：Binance 现货公开行情与日线 EMA200
- HYPE：Hyperliquid 永续实时标记价格
- SPCX / MU / SNDK / NVDA：Hyperliquid HIP-3 `xyz` 股票永续公开行情；单个标的缺失时回退 Binance USDⓈ-M 行情
- Uniswap：真实 ExploreStats 快照中的实物资产/USDC 手续费前三与普通代币手续费前三
- Solana：Raydium / Meteora 真实 LP 决策系统快照中的实物资产/USDC 手续费前三与普通代币手续费前三
- 新闻：公开的律动 `feed.json`
- 页面端轮询、浏览器缓存和失败回退均在 `index.html` 内完成
- 1分钟 / 1小时价格图、Binance 日线 EMA200 / MA120、公开成交资金流与 Deribit 卖方观察链

此仓库只包含静态页面，不包含本地 `.env`、API key、局域网地址或本地文件路径。

Uniswap 手续费榜使用仓库内的真实快照 `uniswap-fee.json`。它由 GitHub Actions 每 15 分钟从 Uniswap ExploreStats 公共接口刷新；Solana 手续费榜继续读取 `https://fengxiong111.github.io/lp-decision-os/top3.json`。页面每 60 秒读取 Solana 快照，Uniswap 快照按页面轮询读取；读取失败时仅保留浏览器缓存，不生成模拟数据。两条链分别显示 `实物资产 / USDC` 与排除实物资产后的普通代币费用前三；当前数据不足三条时按真实数量显示，不补占位数据。

费用口径是 `24h volume × pool fee tier`：v2 使用 0.30% 总 swap fee，v3/v4 使用池子 fee tier。这是池子总费用估算，不是扣除 protocol fee 后的 LP 净分成。ExploreStats 返回的是公共池快照，不等同于全网络全部池子的完整排名。

数据生成脚本：`scripts/update-uniswap-fee.mjs`。GitHub Actions：`.github/workflows/update-uniswap-fee.yml`。

token 行情与 LP Fee 使用同一个紧凑容器承载，但不混合价格和费用语义；静态页不加载或展示 HIP-3 股票资金费率榜。
