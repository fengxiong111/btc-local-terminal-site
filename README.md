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

- **Reader contract (revised after real-versus-displayed mismatch):** The Kindle digest may mention **at most one Meteora and one Merkl position**, but NEVER call either "best" merely because its pool-level research score is first. `research_leader` is an internal public-data queue; `best` stays `null` unless an independently checked position-level net return, incentive eligibility, and full exit path are available. This scan currently emits `NO_VERIFIED_NET_EDGE`. Blank is better than a misleading high-APR recommendation.
- GitHub workflow: `.github/workflows/probe-lp-radar.yml` schedules public-only sampling near 08:17, 12:17, 16:17, 20:17 Taipei. Realtime best-effort, not a guaranteed on-time trigger. Result: `lp-opportunities.json`; CI PR produces a shadow JSON artifact without pushing to main. Zero credentials, wallets, signing, orders, or transfers.
- **Merkl:** Official `https://api.merkl.xyz/v4/opportunities` and public campaign records. Confirmed HTTP 200 in GitHub Actions, so a ChatGPT browser/sandbox DNS or JSON-fetch failure **does not imply Merkl API downtime**. Read-only `/v4` does not require a key. Live tested `page=0` and `page=1` return different records; scanner uses zero-based page start and advances multiple pages for each of `UNISWAP_V3` and `UNISWAP_V4`. Only on network/5xx failure may it try the verified publicly available mirror `https://api.merkl.fr`; never evade 401/403/429. Require `LIVE`, an active public campaign with 48h remaining, non-gated allocation, independently priced/verified reward token and an underlying LP pool rather than Aave looping or Morpho borrowing.
- **Meteora（2026-10-18 最新规则）:** 官方公开 `/pools` 使用 `sort_by=fee_24h:desc`，结合 `filter_by=tvl>=100000 && is_blacklisted=false` 从手续费榜逐页读取。只保留 **TVL ≥ $100,000、两侧代币各自 market_cap ≥ $500,000（缺失则不合格）** 的池，按绝对 24h 手续费美元总额降序选择一个；相同手续费时先较高 TVL、再池地址。取消先前 30m/1h/4h、池龄、代币 `is_verified`、APR、Fee/TVL、资产偏好与综合权重对选池的否决或加分。官方池地址及两侧 mint 仍需二次核对。研究榜首 `fee_leader/research_leader` 可进入 Kindle 情报，但只代表**全池 24h 手续费最高**，非仓位可兑现净收益；净收益 `best` 仍保持独立校验。
- Scans are deliberately bounded (live Merkl V3/V4 opportunity sample and Meteora pool sample), so "best" **does not mean an exhaustive global maximum**. For either winner, missing 5-minute trading, independent traders, active Bin/Tick position depth, position-specific fees, reward eligibility and actual exit swap quote/IL keep `NET_EDGE_UNKNOWN`. A separate position-level shadow/backtest and successful canary are required before treating a candidate as economically superior.
- User's LP V3 target remains future net revenue per unit of occupied capital/time, comparing fees + actually claimable incentives - IL/inventory - gas - swap/slippage - rebalance/out-of-range - mapped asset and protocol risk. The ranking score is for *research attention only*.

### 2026-10-17 LP research truthfulness gate

- Specific discrepancy: Merkl UniswapV4 ETH-USDC Dynamic fee has a real active public campaign, but `weightFees=8000` (80% score weight, per campaign params) and `isOutOfRangeIncentivized=false`. A headline 37% campaign APR DOES NOT apply to arbitrary LP position/inactive ranges; the previous APR-centric ranking is not a position profit estimate.
- Specific discrepancy: Meteora DOPE-SOL's token `is_verified=true` is only metadata verification; this does not indicate price safety. The pool's base fee is ~3%; $4k+ 24h swap fees are **whole-pool fees**, not fees claimable by an unknown Bin allocation. Price risk, 5m trading, independent trader activity and full withdrawal/swap cost were not screened before the former "best" label. The original confidence statement was too strong.
- Radar now widens sampling to independent top TVL, top 24h volume, top 1h fees and top 24h fees (Meteora documented `fee_1h` / `fee_24h` sort fields), and attaches daily OHLCV price movement when available. This is an expanded SAMPLE, not proof of global optimum.
- Two-stage interface: `research_leader` retains one candidate for private research, with policy/failure metadata; `best=null` by default. A distinct independent full-position simulation must compare future realizable swap + flash fee revenue, actual claimable rewards, IL/inventory, gas, swap/slippage, rebalance/out-of-range, fees and exit quote on the same horizon, and only positive modeled net can graduate. No trading is enabled.
- If those facts are missing, Kindle can omit a platform rather than invent a winner. Local historical average gross pool fees, TVL and reward APR should not be promoted to a realized position-level profitability claim.

### LP 真实池身份复核（2026-10-17）

- Meteora：同名资产对可存在多个 Bin Step / Fee Tier 的真实池。以 **池地址 + 两个 Token Mint 地址**作为身份，不用 `DOPE-SOL` 这类字符串合并或代替实际 Pool ID。排行样本的研究首位须二次 GET 官方 `/pools/{address}` 核对；异常或网络失效 => 不输出研究首位。
- Merkl：只读列表的 Opportunity ID、Chain ID、Type、Pool Identifier 必须与 `/v4/opportunities/:id` 详情一致，且仍为 LIVE；详情不可读时不把旧名单冒充当前。
- 数据可读和池身份匹配只说明 **行情事实已核对**，不代表区间、仓位收费份额、激励资格与退出成本已核实。任何缺失皆保留 `best:null`，只记录 `research_leader` 用于后续审计。Kindle 不把研究首位称为正净收益最优。

### 2026-10-17 Kindle 倍数对应价格与可比较净收益

- 每张期权第二行统一采用 `剩余天数 · 买入总成本 U · 到期总回款倍数× · 跌幅情景目标价`，例如 `69天 · 3.15 U · 45.30× · 40,730`。只在原倍数**后面追加一个数字**，不增加「跌50%」「目标价」等标签。多保留一位倍数小数，以两位显示。
- 目标价严格等于**同一行期权快照的 `row.spot / 2`**。不能改用稍晚单独更新的 BTC/ETH 页眉价格；否则无法与 `row.payoff_50` 的倍数一致。缺少该行原始标的价格或倍数则不猜目标价。
- 倍数定义沿用 `crashMultiple`：`max(strike - spot*0.5, 0)*unit*min_qty / all_in_max_loss`。该口径假定**到期结算价**为目标价，只扣买入全成本（权利金与入场手续费），**尚未扣结算行权手续费**；是到期总回款比，不是净利润比，更不是提前平仓可实现倍数。需要另算净利润倍数时应减去本金，并进一步扣适用结算费用。
- LP 选标最优的数学核心从池级 APR / 手续费热度提升到同一资本、同一未来窗口的**仓位级**净收益比较：`swap_fees + flash_fees + claimable_rewards - inventory_loss - gas - swap/slippage - rebalance - out_of_range - exit_cost`，再比较新增迁移成本。纯函数 `compareSameHorizonLP` 要求成本字段齐全、真实池 ID 匹配、独立仓位级模拟、有效资格、能完整退池及换回稳定币、快照≤120秒、比较窗口同为 1h/24h/7d，缺一则阻断。仅当新池优势 **超过 2× 增量迁移总成本** 才标记 `SWITCH_REVIEW`；任何结果均为 `SHADOW_ONLY`、`order_permission=ABSENT`。
- GitHub 公共 API 获取不到用户特定 Bin/Tick 的真实收费份额、退出模拟报价和可领取激励时，`best=null` 是正确结果。允许保留各平台一个 `research_leader` 供继续核验，但绝不称为已验证正净收益的最优仓位，也不推动任何资金动作。

### 2026-10-18 Meteora SDK / Merkl 奖励资格只读接入

- 云端扫描在 `scripts/scan-lp-opportunities.mjs` 之后分两段独立运行：`scripts/verify-merkl-rewards.mjs` 使用 Merkl 官方公开 API，`scripts/sdk-probe/meteora-read.mjs` 使用固定版本 `@meteora-ag/dlmm@1.9.14` 和 Solana HTTPS RPC；每次产生只含**公共协议与池状态**的 `lp-merkl-eligibility.json` 与 `lp-meteora-sdk.json`。失败时如实标 `BLOCKED_*`，不能因为榜单 APR 或池手续费继续推荐。
- Merkl：读取与已入榜 opportunity ID 完全相同的官方详情与活动；验证开始/结束、公开性、权重（`weightFees + weightToken0 + weightToken1 = 10000`）、`isOutOfRangeIncentivized`、白/黑名单、奖励币价格及分发链。活动规则可读（`RULES_VERIFIED_POSITION_UNKNOWN`）≠ 任意钱包实际有资格。配置可选 `LP_MERKL_PUBLIC_WALLET_ADDRESS`（GitHub Actions Secret，**仅填公开地址**）后，读取 `/v4/users/{address}/rewards?chainId={distributionChainId}`；`claimable=amount-claimed`，`pending` 不算可领取；**整个钱包累计奖励不能证明来自这一个活动**，仍须仓位与活动归因记录，不擅自设 `position_eligibility_verified=true`。
- Meteora：SDK 读取 `getActiveBin()`、`getBinsAroundActiveBin(8,8)`，可选配置 `LP_METEORA_POSITION_ADDRESS`（GitHub Actions Secret，公开 Position 地址，不是钱包密钥），通过 `getPosition` 读取 `positionBinData`，计算活跃 Bin `positionLiquidity/binLiquidity`、余额、尚未领取手续费；仓位收费速度需要两次不同时点可比较的链上仓位费用快照，单次查询不推断 Fee Velocity。
- Meteora SDK `getBinArrayForSwap(...)` + `swapQuote(...,slippageBps=50)` 做**退出后的一段换币**的只读报价；只认可官方准确 Mint 的 USDC/USDT/USDG。无仓位只能进行一枚资产的 `REFERENCE_ONLY` 报价，不是退出报价。SDK 的 `removeLiquidity` 属交易构建器，**本阶段未调用**，也未用 RPC 对完整撤池交易模拟，因此 `full_lp_withdrawal_verified=false` / `same_slot_exit_verified=false`，不会晋升 `best`。非稳定币对还需要额外完整、受限滑点的稳定币退出路径。
- GitHub Actions 只配可选 `LP_SOLANA_RPC_URL`、`LP_METEORA_POSITION_ADDRESS`、`LP_MERKL_PUBLIC_WALLET_ADDRESS`，缺失则使用公开只读信息或标 BLOCKED，不要求任何私钥、助记词、交易权、API 充值或签名。私有仓位数据仅临时存在 CI 工作区的 `lp-position-private.json`/`lp-merkl-private.json`，已加入 `.gitignore` 且不进入 Workflow artifacts / git commit。所有输出 `best:null`，直到真实仓位收费和完整安全退出得到独立证据。

### 2026-10-18 单一手续费排名规则

- 输入：Meteora 官方 DLMM API；`TVL >= 100000 USD`；`token_x.market_cap >= 500000 USD` 且 `token_y.market_cap >= 500000 USD`；非黑名单；有真实 `fees["24h"] > 0`。
- 输出：**手续费绝对金额最大的一个池**。`fee_leader` 是这三个条件下的扫描胜者；不再把复杂指标和仓位级模拟当作发现池的前置资格。筛选只读，不需要钱包。
- 保留 `best=null` 专供真实仓位级净收益确认；不妨碍把 `fee_leader` 报为“24小时全池手续费第一”。
- Merkl 活动接口公开的是激励 APR，不是底层可比的 24h Swap Fees，不能伪称与 Meteora 用相同手续费排行榜。目前 Merkl 最低 TVL 也改为 $100,000，等待有可核验底层手续费/代币市值后再做同规则排行。
