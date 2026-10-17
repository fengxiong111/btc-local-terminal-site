# BTC 本地终端 · 远程查看页

这是只用于 GitHub Pages 远程查看的静态价格 / 市场监控终端，不依赖本地服务或本机文件。页面以 BTC 为视觉锚点，其他行情按响应式网格排列；手机与 iPad 使用原生页面滚动，不设置内部滚动容器。

- BTC：Binance 现货 WebSocket 优先，OKX WebSocket / Hyperliquid REST 回退；日线 EMA200 / MA120
- HYPE / UNI：Hyperliquid WebSocket 优先，REST 回退
- SPCX / MU / SNDK / NVDA / IREN：Hyperliquid HIP-3 `xyz` WebSocket 优先；单个标的缺失时回退 Binance USDⓈ-M 行情（IREN 备用合约 `IRENUSDT`）
- 股票板块展示的是跟踪美股的永续合约报价，不是纳斯达克 / 纽交所股票现货成交价；合约可在美股休市时继续波动
- Uniswap 快照：仓库保留真实 ExploreStats 数据，静态首页不展示榜单
- WebSocket 优先、REST 回退、浏览器缓存和失败回退均在 `index.html` 内完成
- Binance 日线 EMA200 / MA120
- BTC 使用更高视觉权重，确保打开页面即可先读到价格和 24h 涨跌
- 全部实时价格使用同一套数字滚轮；仅变化的数字位执行 450ms 最短路径滚动，逗号和小数点保持静止，窗口尺寸变化时重新测量字高

此仓库只包含静态页面，不包含本地 `.env`、API key、局域网地址或本地文件路径。

仓库内的 `uniswap-fee.json` 仍由 GitHub Actions 每 15 分钟从 Uniswap ExploreStats 公共接口刷新；静态首页不加载或展示该榜单。Solana LP 费率榜单已从页面和导航移除。

费用口径是 `24h volume × pool fee tier`：v2 使用 0.30% 总 swap fee，v3/v4 使用池子 fee tier。这是池子总费用估算，不是扣除 protocol fee 后的 LP 净分成。ExploreStats 返回的是公共池快照，不等同于全网络全部池子的完整排名。

数据生成脚本：`scripts/update-uniswap-fee.mjs`。GitHub Actions：`.github/workflows/update-uniswap-fee.yml`。

静态页展示 token 行情，并在同一页下方展示前三名币安 USDT 加密期权 Put。筛选仍比较买 Put、逐仓永续、现货对冲和反向 RWA；页面每行只显示标的、天数、最小下单成本和 50% 跌幅倍数，不显示标题、表头或卖一价格，也不提交委托。

数据生成脚本：`scripts/update-tail-convexity.mjs`。结果：`tail-convexity.json`。账本：`tail-ledger.json`。GitHub Actions：`.github/workflows/update-tail-convexity.yml`，每 30 分钟用公开数据刷新一次快照。最小下单成本为最小数量的权利金与费用之和；倍数为标的下跌 50% 时的估算回报倍数。

静态页不加载或展示 Uniswap Fee 榜单与 HIP-3 股票资金费率榜。


## Tail Research V2（只读候选，禁止自动执行）

- 扫描/页面/定时任务继续使用 GitHub Actions 与 GitHub Pages，不依赖本地 Mac。
- GitHub Actions 先执行 Node 测试；扫描失败写入 `BLOCKED_DATA` 快照、作业保持失败，不能将报错伪装成成功。每小时独立检查快照是否超过 120 分钟；调度可能延迟，不能保证严格 30 分钟。
- 浏览器每 60 秒重新读取 JSON；超过 45 分钟、状态 `BLOCKED_DATA` 或 `BLOCKED_EVIDENCE` 时显示过期状态，不能冒充最新报价。
- 筛选依旧使用币安 USDT 加密 Put、21–120D、|Delta| 0.01–0.08、最大 5 USDT、价差不超过 10% 等硬门。
- 先 Pareto 淘汰，再按候选群体分位数、旧权重 (6/5/4/3/2/1) 计算 `ranking_score`，避免不同单位直接相加；只把 IV 便宜至少 1 个百分点、买卖双边深度各至少 5 倍最小下单量、买一档挂单价值至少 20 U、且同期限 IV 参照不是外推的品种标为 `RELATIVE_DISCOUNT_REVIEW`。其余是 `RESEARCH_ONLY`。这不是经过市场兑现验证的交易优势，不能直接下单。
- `crash_scenarios` 仅提供价格在第 7/30/60 天下跌 50%、IV 不变/+20/+50 个百分点时的零 carry 欧式 Black-Scholes 模型估算，并给出保守退出折价。不代表真实可成交卖价、已实现收益、市场深度或真实保险成本；未经历史盘口回放不能拿它作实盘最优解。
- Aave、Morpho、Pendle 来源跨协议去重：同一个协议内多个异常市场 **不算两条独立机制**。权威协议可用数低于 2 时用 `UNKNOWN` / `BLOCKED_EVIDENCE` 而不是静默 NORMAL。
- `tail-ledger.json` 是公开研究政策记录，**不是** Binance 真正持仓、总花费或真实剩余资金。公开账本不能授权提高年度额度，`holdings.state=UNKNOWN`、`comparison_state=BLOCKED_LEDGER`。买入去重/优于最差持仓的比较只能基于单独可信、最近 120 秒内验证的私有只读持仓事实源，输出仍限于 `DISPLAY_ONLY`。
- 任何排名、模拟、警报都不自动下单、划转、签名或使用密钥。策略优化须先通过 PR、单测、历史回放和 Shadow 验证，再讨论是否提升策略级别。

验收命令：
```bash
node --test scripts/tail-convexity.test.mjs scripts/market-page.test.mjs
node --check tail-convexity-lib.js
node scripts/check-tail-health.mjs
```

部署检查：`Actions → Test tail research` 通过后审阅 PR；合并后核对 `Refresh tail convexity board`、`Check tail snapshot freshness` 和 `pages build and deployment` 的状态，以及线上 `tail-convexity.json` 时间戳。注意健康检查有意拒绝旧快照和证据缺失。


## Kindle Oasis 3：按变化阅读，重要事件邮件送达

- iPhone 手机推送已经由用户取消：`.github/workflows/tail-notify.yml` 无定时触发、无工作分支发送权限；不得重新启用。
- GitHub Actions 每次期权云端扫描后同步生成 `btc-metrics.json` 与 `kindle.html`。BTC 指标来自 Binance 公开现货 BTCUSDT 价格、24h 涨跌和 365 根 UTC 日线：EMA200 的种子为首 200 日简单平均，随后用 2/(200+1) 递推；MA120 为最后 120 日收盘价均值。计算包括当前未收盘日线，与现有网页计算口径一致。行情错误或 >90 分钟没有刷新则显示「未知」，不使用猜测或旧指标伪装实时行情。
- Kindle 黑白静态页：https://fengxiong111.github.io/btc-local-terminal-site/kindle.html 。无需 JS、无需 Mac mini。用户可不定时高频联网打开；**每次打开/刷新取云端最新页面**，并非主动到设备。
- Kindle 邮箱推送由用户的已授权 Gmail 通道发送 **EPUB 附件**，而不是由公开 GitHub 仓库持有 Gmail 凭据。GitHub 本身不具备用户 Gmail 授权，因此不能独立寄信；不可把 OAuth token、SMTP 应用密码、收件邮箱写入公开 repo。
- 发送策略：普通 BTC tick、EMA/MA 数值变化及前三名普通换位，只更新静态页，**不发邮件**；新的跨扫描持续确认的相对便宜期权、独立危机升级、显著数据失效才生成专门的 Kindle 事件邮件。消息发送端负责事件去重与送达回执；GitHub 侧只提供事实快照。
- 每日情报原本的早 8:00、中午 12:00、晚 20:00 生产与 Send-to-Kindle 发送链路独立保留，不要由排行榜再次发送相同三版邮件；先对比收件邮箱 Gmail 已发送记录，避免重复。
- Kindle 的 Send-to-Kindle 认可发件人要包含实际发件 Gmail。Gmail 显示已接受邮件不等于 Kindle 已下载文件，最终以设备资料库显示为验收。
- 策略始终是只读研究，不下单、不签名、不读取真实持仓；用户要求的是 Kindle 邮件，不是重新打开手机通知。

### Kindle 阅读版排版约定（2026-10-17）

- Kindle 页面及邮件 EPUB/TXT 一律采用同一精简结构：**标题与时间 → BTC（24h 涨跌）→ EMA200/MA120 → 风险状态与错价状态 → 最多三条 Put**。重要事件邮件额外附一段事件本身；每日情报保留「① 和你仓位有关」「② 其他动向」的原定版式。
- 每条 Put 只含合约代码、剩余天数、最小成本（U）和跌 50% 的情景倍数，数字保留原有计算口径；缺失的数据直接写「未知」。
- 去除页末免责声明、读者操作说明、风险解释长句、静态页技术说明、网站链接以及营销/装饰元素。风险状态 **WATCH/CRITICAL** 作为事实指标保留，不附冗余免责声明。
- EPUB 为一章正文、内嵌极简样式；TXT 使用空行分节，均不需要外部字体、图片和网络资源。不要在每个版本后添加尾注或链接。任何可验证的重要数据仍在系统内部留存，不把面向用户的极简排版当作删除风险校验。

### Kindle 进一步精简（2026-10-17）

- 屏幕与后续 EPUB/TXT 均直接以日期时间开头，不显示「市场速览 ·」等标题前缀，不显示「尾部 Put」分组标题，也不显示「WATCH · 无新错价」等状态行。
- 每张 Put 行仍保留真实合约、到期天数、U 本位成本和倍数，但把「跌50%」三个字从**展示层**隐藏；计算情景和排序逻辑不变。历史快照与数据有效性门槛保持原样。
- 正文只显示日期、BTC/24h 涨跌、EMA200、MA120 和至多三条 Put（如需单独重大事件邮件，只用一句事件事实，不写冗长状态栏）；无页脚和链接。


## Public LP radar — one best research candidate per source

- **Reader contract:** The Kindle digest may mention **at most one Meteora and one Merkl candidate** per edition. "Best" means the top passing research-screen candidate among sampled public data, never certified optimal net profit. If data/eligibility/exit cannot be verified, use `WATCH_NET_UNVERIFIED`, `NO_VERIFIED_CANDIDATE` or `BLOCKED_DATA`, not an invented APY.
- GitHub workflow: `.github/workflows/probe-lp-radar.yml` schedules public-only sampling near 08:17, 12:17, 16:17, 20:17 Taipei. Realtime best-effort, not a guaranteed on-time trigger. Result: `lp-opportunities.json` (schema v2); CI PR produces a shadow JSON artifact without pushing to main. Zero credentials, wallets, signing, orders, or transfers.
- **Merkl:** Official `https://api.merkl.xyz/v4/opportunities` and public campaign records. Confirmed HTTP 200 in GitHub Actions, so a ChatGPT browser/sandbox DNS or JSON-fetch failure **does not imply Merkl API downtime**. Read-only `/v4` does not require a key. Live tested `page=0` and `page=1` return different records; scanner uses zero-based page start and advances multiple pages for each of `UNISWAP_V3` and `UNISWAP_V4`. Only on network/5xx failure may it try the verified publicly available mirror `https://api.merkl.fr`; never evade 401/403/429. Require `LIVE`, an active public campaign with 48h remaining, non-gated allocation, independently priced/verified reward token and an underlying LP pool rather than Aave looping or Morpho borrowing.
- **Meteora:** Use public `https://dlmm.datapi.meteora.ag/pools`. This API supports `sort_by=tvl:desc` but **rejects** `sort_by=fees_24h:desc` with HTTP 400. Instead read both the default list and a TVL-sorted sample, deduplicate by unique pool address, and score fee continuity across 30m / 1h / 4h / 24h after basic pool age, token verification, volume and blacklist checks. An unverified high-fee meme such as `simulator-SOL` cannot be promoted solely by its fees. Gross pool fee/TVL is NOT a position's expected net fee.
- Scans are deliberately bounded (live Merkl V3/V4 opportunity sample and Meteora pool sample), so "best" **does not mean an exhaustive global maximum**. For either winner, missing 5-minute trading, independent traders, active Bin/Tick position depth, position-specific fees, reward eligibility and actual exit swap quote/IL keep `NET_EDGE_UNKNOWN`. A separate position-level shadow/backtest and successful canary are required before treating a candidate as economically superior.
- User's LP V3 target remains future net revenue per unit of occupied capital/time, comparing fees + actually claimable incentives - IL/inventory - gas - swap/slippage - rebalance/out-of-range - mapped asset and protocol risk. The ranking score is for *research attention only*.

### LP V3 evidence-first correction — Oct 17

- **Old published picks were not validated:** Merkl ETH–USDC Uniswap V4 ~37% incentive APR had no independent underlying-fee evidence or position reward-eligibility proof; Meteora DOPE–SOL is Doge Pepe/SOL with a **3% base swap fee**, 6-day age, and pool-wide fees, not a validated user's fee return. Treat both former winners as **RETRACTED_AS_BEST**; raw pool records remain useful discovery evidence.
- **Schema v2 distinction:** `data_state=PASS` confirms successful public fetching, **not profit**. `net_edge_state=UNKNOWN` and `best=null` remain until an independent position-level future-net-return estimate, actual claim eligibility, active Bin/Tick fee share, and explicit entry/exit costs pass. A single `research_lead` per platform is allowed only as unapproved secondary research, not as a recommended capital destination; for Merkl no research lead without independent underlying fee evidence.
- **Merkl:** Campaign APR alone never ranks a pool. A V3/V4 `POOL` activity must be active, non-whitelisted, have independently verified priced rewards, and join a **fresh pool-fee plus active-liquidity source** keyed by chain/pool identifier before becoming even a research lead. Hooks, weightFees, out-of-range rewards, dilution, fee and token inventory and reward claimability must be examined next; no APY inflation or substituting `o.apr` for realized fee velocity.
- **Meteora:** The low-risk Spot shortlist now requires canonical token mint identity, recognized SOL/BTC/ETH family against stable assets, token verification, minimum 7-day pool age, real rolling **30m/1h/4h/24h** fees plus volume, TVL ≥150k, and exclusion of obviously extreme fee tiers or pool-fee/TVL ratios lacking extra evidence. A high-fee Meme **Bid-Ask** remains a separate valid research strategy in LP V3, but requires 5m transactions, independent traders, credible mint/redeem and active-bin exit quotes before it can appear as a chosen lead. The public list API omits 5m in some responses, so its absence must not be fabricated as positive. Does not convert a pool gross fee ratio into the actual new-position net return.
- **Coverage improvement:** pull multiple documented Meteora sorts (TVL, 24h volume, 30m pool-fee ratio), bounded pages and filter, deduplicate by **pool address**, then re-fetch the single selected pool and cross-check **mint addresses**, blacklist and current metrics. Snapshot is still not exhaustive of all possible LP capital uses; exact scope/count is emitted.
- **Reader behavior:** Kindle reports a Merkl and/or Meteora **best** only when non-null in v2 and `net_edge_state` is independently verified. In the current public-only scanner **both are null**, not invented or quietly renamed. `research_lead` is explicitly a separate investigation queue and must not be presented as the market's globally optimal pool.
- This is display-only public research: no signing, transactions, private wallet reads or capital movement.
