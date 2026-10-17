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


## iPhone 条件推送 + Kindle Oasis 3 纯文本视图

云端通知与看板完全分离，仍然只读。GitHub Actions 工作流：`.github/workflows/tail-notify.yml`；事件判定：`tail-alert-lib.js`；HTTP 发送：`scripts/tail-notify.mjs`；公开、无敏感内容的去重状态：`tail-notify-state.json`（首次运行自动生成）。

**通知规则**
- 计划每小时第 29/59 分钟检查快照，和第 23/53 分钟的原期权扫描错开。GitHub 定时执行不保证准点。
- 两轮**不同**有效扫描都发现 `RELATIVE_DISCOUNT_REVIEW`（IV 折价 ≥1 个百分点、盘口质量及非外推参照通过）才推送；同一期权重复事件不推送，若折价再改善至少 2 个 IV 百分点则提醒一次。它仍然只是研究，不是买入指令。
- 新增的独立协议风险证据使 `WATCH` 升级时推送；`CRITICAL` 需至少两类独立协议机制证据。单协议多个市场异常不构成独立证据。
- 有效数据连续缺失超过 2 小时后推送一次故障；无变化不推送；例行日报每日台北时间 **20:00**。
- 只从可信新鲜快照产生机会/风险推送；`BLOCKED_DATA`、`BLOCKED_EVIDENCE`、超过 90 分钟旧数据均不会产生所谓“新机会”。
- 单轮最多发一条消息；仅在 ntfy HTTP 成功接受消息后保存“已发送”收据。若下游未送达 iOS，HTTP 成功不代表设备已收到。

**启用 iPhone 接收（需要账户本人完成，仅一次）**
1. iPhone App Store 安装官方 `ntfy`，服务器选择 `https://ntfy.sh`，添加并订阅 **至少 24 位的随机 topic**（建议 32 位及以上）；允许 iOS 通知。
2. GitHub → `fengxiong111/btc-local-terminal-site` → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`。名称 **`NTFY_TOPIC`**，值填刚才 iPhone 订阅的同一串 topic。
3. GitHub → `Actions` → `Tail research iPhone notifications` → `Run workflow`，选择 `test`。测试成功时应收到“期权监控手机推送测试成功”。工作流日志会写 `ACCEPTED_BY_PROVIDER`，这仍不是设备到达证明。
4. 如果缺少 Secret，工作流只会显示 `NOT_CONFIGURED`，**不会发送通知**；绝不将 topic 或手机凭据写进公开仓库、Issue 或日志。

**安全提示：** `ntfy.sh` 默认 topic 不是严格的私密空间，知道 topic 的人可能订阅或发布消息。请用随机难猜的 topic，只发送仓库已有的公开市场研究信息，绝不发送真实持仓、额度、密钥或私人身份资料。若需要严格私密性，之后迁移到鉴权 ntfy 服务或其他私有推送平台。

**Kindle Oasis 3**
- 页面路径：`https://fengxiong111.github.io/btc-local-terminal-site/kindle.html`
- `scripts/build-kindle-tail.mjs` 在云端期权扫描后生成简洁黑白静态 HTML（不依赖 JavaScript、持续连接或 Mac mini）。
- Kindle **建议每天晚上 20:00 左右主动打开一次**，或每次醒来需要研究时手动刷新；网页随扫描更新，但 Kindle 休眠时不会自动送达、震动或弹窗。
- 重要异常使用 iPhone 推送；不要把 Kindle 的试验性浏览器当作可靠的即时告警设备。如需离线阅读，可通过 Amazon 官方 Send to Kindle 手动导入 HTML 文档；该功能不是此处已启用的自动递送服务。

验收：
```bash
node --test scripts/tail-convexity.test.mjs scripts/market-page.test.mjs scripts/tail-alert.test.mjs
node scripts/build-kindle-tail.mjs
node scripts/tail-notify.mjs watch
```
