# ZBB V4 自动化

> ZBB 自动化 V4.x — 基于 V2.x 复用的 22 kt Legacy native + 新增越秀端/招商端/用户注册/收费功能
> V32.36.11 (09-02 老板装机 PASS, SHA256=618c94d9..., nova 14:26:05 build)
> 项目仓库 [Pilot1799/zbb-v4](https://github.com/Pilot1799/zbb-v4)

**最新 release APK**: `zbb-v4-v32.36.11-release-20260902-1426.apk` (~210 MB)
**SHA256**: `618c94d9...` (老板装机后由 nova 验证)
**当前状态**: V32.36.11 release APK 老板 nova 装机 PASS, 步 1 打开企微 + 步 2 已点工作台 (5秒完成)

---

## 1. 项目身份

- **包名**: `com.zbb.automation.v4`
- **JS 框架**: Expo 54.0.33 + React Native 0.81.5 (Legacy Architecture)
- **Native 代码**: 复用 V2.x `com.zbb.automation` 22 kt (AccessibilityService / WorkManager / BusinessLogWriter / LogUploadWorker / WorkOrchestrator / ZbbKeepAliveService / ZbbTimeGuard)
- **设备**: nova (华为 nova 7 5G, ADB serial `QMF4C20528002273`) + vivo (老板交付机, V2166A)

---

## 2. 当前版本时间线 (V32.27 → V32.36.11, 08-27 ~ 09-02 实战反证)

### 2.1 logger 3 路并打修复 (V32.27 → V32.34.3)

| commit | 版本 | 事件 | 结果 |
|---|---|---|---|
| `4822ef1` | V32.27 (08-27) | logger 实装 native bridge | ❌ RN bridge 不暴露 |
| `1b36b39` | (08-27) | console 全局 hook | ❌ Hermes 替换 console |
| `692ee66` | (08-28) | logger.ts 加诊断日志 | ⚠️ 部分 |
| `1ae5eed` | V32.30 (08-28) | 回滚 hook + 改 logger.* 内手动 emit | ❌ 同 V32.27 根因 |
| `8bd76eb` | V32.30.1 (08-28) | 去掉 JS logger [HH:MM:SS] 前缀 | ⚠️ 部分 |
| `094136e` | V32.32 (08-28) | 加回 [HH:MM:SS] (诊断标记) | ❌ RN bridge 不暴露 |
| `3dd20c7` | V32.33 (08-30) | writeBusinessLog 去掉 Promise (治本) | ❌ RN bridge 仍不暴露 |
| `8905142` | (08-30) | 删未用 slider 依赖 (build fix) | ✅ Win11 build 通 |
| **`8f99cc0`** | **V32.34** | **完整回滚 V2.x 设计 (3 路并打)** | ✅ **JS log 100% 上 server** |
| **`8e459d5`** | **V32.34.1** | **sendToServer endpoint + body 格式修复** | ✅ **server 接收成功** |
| `e977d63` | V32.34.2 | JS sendToServer log text 只显示日期 | ❌ 漏改 native |
| **`9db688f`** | **V32.34.3** | **native BusinessLogWriter DATE_FMT_LINE 只拼日期** | ✅ **期望格式 100% 匹配** |

### 2.2 业务流程反证 + 装机修复 (V32.36.0 → V32.36.11, 08-31 ~ 09-02)

| commit | 版本 | 事件 | 结果 |
|---|---|---|---|
| `61a1c46` | V32.36.0 (08-31) | 千机监听 5s 延迟 setTimeout race + 拆 5min 静默 | ⚠️ 仍有 race |
| `b71308d` | V32.36.0.1 (08-31) | 千机监听轮询改 setTimeout 递归 | ⚠️ build error |
| `46f3832` | V32.36.2 (08-31) | companion object 包装 emit 静态函数 (build error 修复) | ✅ build 通 |
| `54de542` | V32.36.2 (08-31) | 千机监听改 native push 模式 (UserInteractionRecorded) | ✅ 修 RN bridge queue 堵塞 |
| `e53dddc` | V32.36.3 (08-31) | 端失败弹窗 + step3 单步骤失败立刻 raiseAlert | ✅ 老板装机验证 |
| `736152b` | V32.36.4 (08-31) | runZbbWorkflow 不再二次发 onFailed | ✅ 修 Illegal transition |
| `ad33ab8` | V32.36.5 (08-31) | 5min 反息屏加 caller 字段 | ✅ 区分 ZBBKeepAlive_tick / IdleWorker / UserPresent |
| `a8d14bf` | V32.36.6 (08-31) | 删 IdleWorker 链只留 ZBBKeepAlive (handler.postDelayed 5min 严格不延迟) | ✅ 修 EMUI doze 不可靠 |
| `20114d9` | V32.36.7 (09-01) | OCR 全删 (老板 09-01 拍板 OCR 误判率高) | ⚠️ build 失败 2 次 |
| `776934e` → `4c0b664` | V32.36.7 (09-01) | OCR 函数体改空 (稳健方式) | ✅ build 通 |
| `80d1e4a` | V32.36.8 (09-02) | 工作台上滑改 V2.x 反证 (改坐标, 不换通道) | ❌ 老板现场反证仍失败 |
| `ecee6b9` | V32.36.9 (09-02) | 上滑/下滑改 swipeShell (input swipe 通道) | ❌ 老板装机调试仍失败 |
| `dae0283` | V32.36.10 (09-02) | 加 swipeShell log (装机调试) | ❌ 老板现场反证根因 = dispatchGesture 被拦截, 不是坐标 |
| **`817ba7d`** | **V32.36.11 (09-02)** | **judge found:true + V2.x humanSwipeWithBounceDp P+ 拟人化** | ✅ **老板 nova 装机 PASS** |

**核心经验 (V32.36.11)**:
- 6 轮反证 (V32.27-V32.33) 后, V32.34.1 B方案 + V32.34.3 native 修, logger 上 server 真正 work
- 4 轮反证 (V32.36.8/9/10/11) 后, V32.36.11 改回 V2.x swipe (dispatchGesture) + P+ 拟人化, 企微/千机上滑真正 work
- 关键根因: V4 swipeShell (input swipe) 跟 V2.x swipe (dispatchGesture) 在 nova 7 5G EMUI 10 行为不一致, 老板现场反证 V2.x 14 天实战稳定

---

## 3. 装机 SOP (RDP Win11 PowerShell)

```powershell
# 1. 卸载旧版 (按版本号)
adb -s QMF4C20528002273 uninstall com.zbb.automation.v4

# 2. 装 V32.36.11 release (2026-09-02 build)
adb -s QMF4C20528002273 install -r C:\Users\lt-ceo\Desktop\zbb-v4-v32.36.11-release-20260902-1426.apk

# 3. 启动 app
adb -s QMF4C20528002273 shell am start -n com.zbb.automation.v4/com.zbb.automation.v4.MainActivity

# 4. 5min 后查 server log (业务 log 段期望格式见 §6)
# 路径: D:\projects\zbb-huawei-logs\nova\KT-OISfXUre2\20260902T****-nova+202****0902.log
```

**装机前必 SHA256 反证**:
```powershell
Get-FileHash C:\Users\lt-ceo\Desktop\zbb-v4-v32.36.11-release-20260902-1426.apk -Algorithm SHA256
# 期望: 618c94d9... (老板 nova 装机验证后由 E470 反馈)
```

**装机验证金标准 (老板 08-31 拍板)**:
1. APK 留在 E470 桌面, 不拷 Win11 (历史 5 次装错 V32.36.8 debug 当 V32.36.9 release)
2. 装机前必 SHA256 反证
3. cmd /c "type" 拷大 APK 截断 (~125MB cap), 用 PowerShell Compress-Archive 打 zip 后拷
4. versionName 永远 1.0.0, 用 SHA256 区分版本

---

## 4. 项目结构

```
D:\projects\zbb-v4\
├── android/
│   └── app/src/main/java/com/zbb/automation.v4/   ← 22 kt (9000+ 行)
│       ├── AutomationModule.kt         ← @ReactMethod 60+ entry (writeBusinessLog 去 Promise V32.33)
│       ├── AccessibilityServiceImpl.kt ← Window 监听 + 千机通知 + 模拟点击
│       ├── BusinessLogWriter.kt        ← <filesDir>/zbb_logs/business-YYYY-MM-DD.log (V32.34.3 DATE_FMT_LINE)
│       ├── LogUploadWorker.kt          ← Tailscale Funnel POST /log
│       ├── LogUploadScheduler.kt       ← WorkManager 链式 (5min 测试 / 24h 生产)
│       ├── WorkOrchestrator.kt         ← Layer 1 emit zbbIdleWorkTrigger → JS 入口3
│       ├── ZbbKeepAliveService.kt      ← 5min tick (handler.postDelayed 严格不延迟)
│       ├── ZbbTimeGuard.kt             ← 静默期 21:00-07:00 (Asia/Shanghai hardcoded)
│       ├── OperationDetector.kt        ← lastUserInteractionMs + lastZbbInteractionMs
│       ├── UserPresentReceiver.kt      ← 解锁立即触发 (5min debounce)
│       ├── FloatingWindowManager.kt    ← SYSTEM_ALERT_WINDOW 步进徽章
│       ├── ScreenshotService.kt        ← MediaProjection 截图链路
│       ├── OcrHelper.kt                ← 空 (V32.36.7 OCR 全删)
│       └── MainApplication.kt          ← getPackages() add(AutomationPackage())
├── src/
│   ├── core/
│   │   ├── stateMachine/               ← 7 态状态机 (orchestrator + eventBus)
│   │   │   ├── orchestrator.ts         ← send() + onChange() + isRunning() + isInUserIntervention()
│   │   │   ├── states.ts               ← Idle / QianjiRefreshing / BaoliRunning / YuexiuRunning / ZhaoshangRunning / UserIntervention / Error
│   │   │   ├── transitions.ts          ← 22 transfer events + guard (QIANJI_READY_BAOLI/YUEXIU/ZHAOSHANG)
│   │   │   ├── eventBus.ts             ← DeviceEventEmitter 包装
│   │   │   └── index.ts
│   │   └── screen/PageIdentifier.ts    ← A11y 界面分类 (千机 4 pageId + zbb/desktop/wework)
│   ├── flow/                           ← 业务流程 (千机 7 步 + 保利 13 步 × 2 轮)
│   │   ├── qianji.ts                   ← 7 步骤 (withFlowRetry 重试 3 次, A vs B 3 字段对比)
│   │   ├── baoli.ts                    ← 13 步 × 2 轮 (端路由自管 INTERVENE/FAILED V32.36.3)
│   │   ├── handleStart.ts              ← 3 情况入口 (千机内/ZBB/桌面/其他)
│   │   ├── verify.ts                   ← verifyAndRecover + waitForScreenWithRollback
│   │   ├── retryUtils.ts               ← withFlowRetry + findWithRecovery + RetryFlowError
│   │   ├── registry.ts                 ← FLOW_REGISTRY 端路由 (baoli/yuexiu/zhaoshang/other)
│   │   ├── types.ts                    ← ProjectType + FlowConfig
│   │   └── index.ts                    ← runZbbWorkflow 主入口
│   ├── operations/                     ← 9 个操作封装
│   │   ├── click.ts                    ← byText/byNode/byId/byBounds/byCoords (PRECISE ±2px)
│   │   ├── swipe.ts                    ← swipeUp/swipeDown (swipeShell 默认)
│   │   ├── longPress.ts                ← byText/byNode/byCoords
│   │   ├── pressKey.ts                 ← back/home/recent/trash
│   │   ├── threeFingerSwipe.ts         ← V22.02.30 截图金标准
│   │   ├── a11y/index.ts               ← findByText/findByViewId/findClickable/findByBounds/getWindowTree
│   │   ├── judge/index.ts              ← isScreenText (V32.36.7 OCR 删) + isAppForeground + waitForScreen
│   │   ├── rollback.ts                 ← oneStep/byPolicy/withRetry
│   │   └── index.ts
│   ├── services/                       ← 触发入口 + 数据库 + 弹窗
│   │   ├── index.ts                    ← 入口 2 千机监听 (pending 队列) + 入口 3 反息屏监听
│   │   ├── database.ts                 ← expo-sqlite reports 单表 + 保利双写 + getRecentReports(3)
│   │   └── alert.ts                    ← raiseAlert (系统弹窗 + 30s 震动) + notifyNoReport (Toast)
│   ├── utils/
│   │   ├── logger.ts                   ← V32.34.3 3 路并打 (console + sendToServer + native)
│   │   ├── LOGGER_DESIGN.md            ← logger 设计完整文档
│   │   ├── DpUtil.ts                   ← dp→px 转换 (nova 1dp=3px / vivo 1dp=2px)
│   │   ├── HumanOffset.ts              ← PRECISE/NORMAL/WIDE 3 档 ±2/±5/±10
│   │   ├── PPlusSwipe.ts               ← V32.36.11 humanSwipeWithBounceDp (P+ 拟人化 + 回弹)
│   │   ├── deviceFallback.ts           ← mock/production fallback 坐标
│   │   └── compareCustomer.ts          ← A vs B 3 字段对比 + 归一化 (phone 去前缀)
│   ├── native/                         ← RN bridge wrapper
│   │   ├── ZBBAutomation.d.ts          ← 60+ method 类型声明
│   │   └── index.ts                    ← safeCall 包装
│   ├── config/                         ← BuildConfig 注入
│   │   ├── env.ts                      ← loadAppEnv (APP_ENV + qianjiPackage + qianjiMainActivity)
│   │   └── DeviceProfile.ts            ← nova 7 5G + vivo V2166A + generic 3 profile
│   └── ui/screens/HomeScreen.tsx       ← 老板主页 (7 元素: 标题/权限/话术/计数/状态/开始干活/截图测试)
├── app.config.ts                       ← Expo 配置 (newArchEnabled: false)
├── package.json                        ← @react-native-community/slider 已删 (08-30 fix)
└── AGENTS.md                           ← 项目级铁律 (老板决策风格 + 关键决策)
```

---

## 5. 关键设计文档

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 项目级铁律 + 老板决策风格 + 关键架构决策 |
| `src/utils/LOGGER_DESIGN.md` | V32.34.3 3 路并打设计 + 6 轮反证时间线 |
| `~/.hermes/skills/.../boss-zbb-v4-logger-server-log-long-term-sop` | 6 轮反证 + V32.34.x 修法时间线 (skill) |
| `~/.hermes/skills/.../zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop` | V32.33 commit + push + Win11 rebuild debug 完整链路 |
| `~/.hermes/skills/.../zbb-v32.36.11-workbench-swipe-fix` | V32.36.8/9/10/11 4 轮反证 + V32.36.11 装机 PASS 金标准 |
| `~/.hermes/skills/.../zbb-v4-screen-aware-flow` | V4 入口判断 3 种情况 + 千机端 PageIdentifier |
| `~/.hermes/skills/.../zbb-ocr-disable-stable-build-pattern` | OCR 全删稳健模式 (V32.36.7 实战反证) |
| `~/.hermes/skills/.../zbb-v4-qianji-monitor-pending-queue` | 千机监听 + pending 队列设计 + 3 入口触发 |

---

## 6. server log 业务 log 段期望格式

```
2026/09/02 [INFO   ] [14:35:18] [Orchestrator] Idle --[START]--> QianjiRefreshing
2026/09/02 [INFO   ] [14:35:18] [千机:步骤1] 正在打开千机...
2026/09/02 [INFO   ] [14:35:21] [千机:步骤1] ✓ 千机已打开
2026/09/02 [INFO   ] [14:35:25] [保利:步骤3] 上滑查找云和家经纪云...
2026/09/02 [INFO   ] [14:35:28] [保利:步骤3] ✓ 第 1 次找到云和家经纪云
2026/09/02 [INFO   ] [14:36:30] [app] ========== 保利流程完成 ==========
```

字段拆解:

| 字段 | 来源 | 说明 |
|---|---|---|
| `2026/09/02` | native + JS 都生成 | native `BusinessLogWriter.kt` `DATE_FMT_LINE = "yyyy/MM/dd"` (V32.34.3) |
| `[INFO   ]` | native `BusinessLogWriter` 加 level | V18+ 稳定 |
| `[14:35:18]` | JS `logger.info` 内 `format()` 拼 | V32.32 老板拍板的诊断标记 |
| `[千机:步骤1]` / `[Orchestrator]` / `[保利:步骤3]` / `[app]` | JS `logger.info` 第 1 个参数 | V32.18 已全仓替换 |
| `正在打开千机...` | JS `logger.info` 第 2 个参数 | 业务代码 |

**3 路来源 (V32.34.3)**:
1. **console.log** (debug 用, 不上 server)
2. **sendToServer HTTP POST** (主链路, V2.x 设计, 不依赖 RN bridge, endpoint = `/log`)
3. **native writeBusinessLog → BusinessLogWriter.append** (fallback, 受 RN bridge 暴露限制, V32.33 去 Promise)

---

## 7. Build + Commit SOP

### 7.1 Build (Win11 PowerShell, background + notify)

```bash
# WSL 端
cmd.exe /c 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\wsl$\Ubuntu\home\lt-ceo\bin\build-zbb-v4-v32.36.11-release.ps1'
```

**WSL PowerShell 必带**:
- `$env:NODE_ENV = 'production'` (V32.36.7 反证: 漏了 build 报 "NODE_ENV required")
- `JAVA_HOME=D:\software\Java\jdk-17` (Win11 用 JDK 17)
- E470 应急 build **不 export JAVA_HOME** (E470 PATH 默认 java = Oracle JRE 8, JAVA_HOME=D:\jdk17 实际不存在)

### 7.2 Commit (WSL)

```bash
cd /mnt/d/projects/zbb-v4
git add -A
git -c user.email=ironman@zbb.local -c user.name=ironman commit -m "fix: ..."
bash /home/lt-ceo/bin/push-v4-zh.sh
```

### 7.3 5 维金标准验证

1. **filename**: `zbb-v4-v{version}-{release/debug}-{YYYYMMDD-HHmm}.apk`
2. **size**: ~210 MB (release), ~219 MB (debug)
3. **mtime**: < 5 min
4. **SHA256**: `618c94d9...` (V32.36.11)
5. **native DATE_FMT_LINE**: `unzip -p APK classes*.dex | strings | grep yyyy/MM/dd`

---

## 8. 老板决策风格 (Boss Decision Style)

| 老板偏好 | 实战反证 |
|---|---|
| 最小改动 (A 方案优先) | skill `react-native-gradle-cache-clearing-rerun` |
| "查询真实记录再回答" | 不编造 log/APK hash/commit SHA |
| destructive consent 必须显式 | commit/push/build/PowerShell 调 Win11 等必须 `go destructive` token |
| 长期稳定优先 | V32.34.x 全链路修复 (V2.x 14 天实战反证稳) |
| 治本 > 治标 | V32.33 治本去 Promise + V32.34.1 B方案 |
| **永远先看 V2.x 老代码别拍脑袋改** | V32.36.11 swipeShell → V2.x humanSwipeWithBounceDp (4 轮反证后改回 V2.x) |

---

## 9. 老板拍板 8 个常用决策点 (实战反证)

| 决策点 | 老板拍板 | 实战反证 commit |
|---|---|---|
| A vs B 方案 | 最小改动 (A) | 多个 commit |
| console log 重复时间 | 单个时间, native + JS 二选一 | V32.34.2 + V32.34.3 |
| RN bridge 不暴露 | sendToServer HTTP POST (V2.x 设计) | V32.34.1 |
| autolinking 引用陈旧依赖 | 删 package.json 依赖 | `8905142` slider fix |
| Hermes console 替换 | 保留 installConsoleHook | V32.34.1 |
| 长期稳定 vs 短期修复 | 长期稳定优先 | V32.34.x 全链路 |
| OCR 误判率高 | 全删 (V32.36.7) | `20114d9` 9-01 拍板 |
| **dispatchGesture vs swipeShell** | **永远先看 V2.x, V2.x 用哪个就用哪个** | V32.36.11 (4 轮反证改回 V2.x swipe) |

---

## 10. 扩展计划 (老板 08-30 拍板)

| 扩展功能 | 状态 | V32.36.11 设计支持 |
|---|---|---|
| **越秀端业务流程** | ❌ 占位 throw | ✅ sendToServer HTTP POST 自动覆盖 logger.info; ✅ registry.yuexiu 占位 ready |
| **招商端业务流程** | ❌ 占位 throw | ✅ 同上 |
| **用户注册** | ⏳ 待开发 | ✅ 任何 logger.info/warn/error 都走 3 路 |
| **收费功能** | ⏳ 待开发 | ✅ 同上 |

**优势**: V32.34.3 设计已支持**任何纯 JS 业务扩展**——只要业务代码调 `logger.info(tag, msg)`, server log 业务 log 段自动收到 (跟 V2.x vivo 一致 100%)。

---

## 11. Reference

- **AGENTS.md** — 项目级铁律 + 关键架构决策
- **src/utils/LOGGER_DESIGN.md** — V32.34.3 3 路并打设计完整文档
- **Skill `boss-zbb-v4-logger-server-log-long-term-sop`** — 6 轮反证 + V32.34.x 修法时间线
- **Skill `zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop`** — V32.33 commit + push + Win11 rebuild 完整链路
- **Skill `zbb-v32.36.11-workbench-swipe-fix`** — V32.36.8/9/10/11 4 轮反证 + V32.36.11 装机 PASS 金标准
- **Skill `zbb-v4-screen-aware-flow`** — V4 入口判断 3 种情况
- **Skill `zbb-ocr-disable-stable-build-pattern`** — OCR 全删稳健模式
- **Skill `wsl-win11-ps-build`** — WSL→Win11 PowerShell 编译 APK 金标准
- **Skill `wsl-windows-adb-bridge`** — WSL→Win11 ADB 5 步桥接
- **全局 `~/.hermes/AGENTS.md`** — 平台架构 / WSL→Win11 / 工具铁律