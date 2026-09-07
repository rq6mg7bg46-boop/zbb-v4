# ZBB V4 项目级铁律 (Project Rules)

> 适用于 ZBB V4 仓 (`D:\projects\zbb-v4\`) 的所有工作 (WSL 编辑 + Win11 build + nova 装机验证).
> 跟全局规则 `~/.hermes/AGENTS.md` 配合使用 (全局平台架构 / 工具调用铁律).

> **建立日期**: 2026-08-30
> **最后更新**: 2026-09-02 V32.36.11 (老板 nova 装机 PASS)

---

## 1. 项目身份

- **项目名**: ZBB 自动化 V4 (基于 V2.x 复用 + 新增越秀端/招商端/用户注册/收费功能)
- **包名**: `com.zbb.automation.v4` (跟 V2.x `com.zbb.automation` 区分)
- **APK 类型**:
  - `release`: ~210 MB, 装 nova (生产机) + vivo (老板交付机)
  - `debug`: ~219 MB, 仅 dev 调试用 (RN bridge @ReactMethod 暴露问题)
- **JS 框架**: Expo 54.0.33 + RN 0.81.5 Legacy Architecture
- **关键库**: expo-sqlite + Android AccessibilityService + expo-router

---

## 2. 关键架构决策 (Project-Level Architectural Decisions)

### 2.1 V4.x 复用 V2.x Legacy Architecture (22 kt native)

**决策**: V4.x 复用 V2.x 已稳定的 22 kt native 代码 (AccessibilityService / WorkManager / BusinessLogWriter / LogUploadWorker / WorkOrchestrator / ZbbKeepAliveService / ZbbTimeGuard), 不重写.

**原因**:
- V2.x 已稳定跑 14+ 天 (vivo 生产机)
- 老板 08-15 拍板: V4 增量扩展, 不破坏 V2.x 稳定链路
- Native 代码 review 1 遍 = V2 + V4 共享
- V32.36.11 反证金标准: V2.x swipe (dispatchGesture) 在 nova EMUI 10 行为稳定, V4 swipeShell (input swipe) 反而被拦截, 老板现场反证后改回 V2.x 设计

### 2.2 V32.34.3 JS log 上 server 长期稳定设计 (B方案)

**决策**: V4.x JS log 上 server 采用 **3 路并打**设计 (V2.x 实战反证 14 天稳定):

```
logger.info(tag, msg)
  ↓
logToBoth(level, line)
  ├─ 1. console.log (debug 用)
  ├─ 2. sendToServer HTTP POST   ← V2.x 主链路, 不依赖 RN bridge
  │    └─ fetch(`${baseUrl}/log`, {body: server 期望格式})
  └─ 3. appendToBusinessLog       ← V32.33 native 治本 (去 Promise 参数)
       └─ ZBBAutomation.writeBusinessLog(level, line)
          └─ native BusinessLogWriter.append (V32.34.3 DATE_FMT_LINE 只拼日期)
             └─ LogUploadWorker 5min tick 上传 server
```

**实战反证**:
- 6 轮反证失败: V32.27/V32.28/V32.30/V32.31/V32.32/V32.33
- 根因: RN 0.81.5 Legacy Architecture 下 `@ReactMethod` Promise 方法不暴露到 `NativeModules.X.method` 属性
- V32.34.1 B方案实战反证 100% work
- V32.34.2 + V32.34.3 修复日期时间戳重复 (期望格式 `2026/08/30 [INFO] [HH:MM:SS] [tag] msg`)

**Reference**: `src/utils/LOGGER_DESIGN.md` (完整设计文档)

### 2.3 sendToServer endpoint = /log (不是 V2.x /api/v1/logs)

**决策**: V4 sendToServer HTTP POST 走 `/log` endpoint, **不是 V2.x 的 `/api/v1/logs`**.

**原因**:
- V4 server 端 `D:\projects\zbb-huawei-logs\server\zbb_log_receiver.py` 只接受 `/log`
- 跟 native LogUploadWorker endpoint 一致 (`https://desktop-hi4ajgj.taildab2db.ts.net/log`)
- V2.x AutomationLogger 的 的 `/api/v1/logs` 是 V2.x 仓 server 端专属 endpoint, V4 不兼容

**老板 08-30 实战反证** (V32.34.1 commit `8e459d5`):
- V32.34 用 `/api/v1/logs` → server 返 404 → 上传失败
- V32.34.1 改 `/log` → 接收成功

### 2.4 native BusinessLogWriter DATE_FMT_LINE 只拼日期 (V32.34.3)

**决策**: native `BusinessLogWriter.kt` `DATE_FMT_LINE = "yyyy/MM/dd"`, **不拼时间**.

**原因**:
- JS logger.info 内 format() 拼 `[HH:MM:SS]` (V32.32 老板拍板的诊断标记)
- native 拼时间 + JS 拼时间 = server log 业务 log 段 2 个时分秒 (重复)
- server 端 log 文件 mtime 自带时间, 业务 log 段不重复

**期望格式**:
```
2026/09/02 [INFO   ] [14:35:18] [Orchestrator] Idle --[START]--> QianjiRefreshing
2026/09/02 [INFO   ] [14:35:18] [千机:步骤1] 正在打开千机...
```

### 2.5 V4.x 7 态状态机 + 端路由 Flow Router (08-30 老板拍板)

**决策**: V4.x 用 7 态状态机 (Idle / QianjiRefreshing / BaoliRunning / YuexiuRunning / ZhaoshangRunning / UserIntervention / Error) + 端路由 Flow Router 设计:

```
Idle --START--> QianjiRefreshing
QianjiRefreshing --QIANJI_READY_BAOLI--> BaoliRunning     (端路由)
QianjiRefreshing --QIANJI_READY_YUEXIU--> YuexiuRunning    (端路由)
QianjiRefreshing --QIANJI_READY_ZHAOSHANG--> ZhaoshangRunning (端路由)
QianjiRefreshing --QIANJI_NO_REPORT--> Idle (08-27 拍板直 Idle, 删 Cooldown)
BaoliRunning --BAOLI_COMPLETE--> Idle (08-30 拍板直 Idle, 不再绕越秀)
UserIntervention --USER_CONFIRM--> Idle (老板点"开始干活")
Error --RESET--> Idle (老板手动恢复)
```

**端路由核心**: 千机端 = 纯识别 + 路由, **零 APP 知识**. 每个端 = 自主 launchApp + 自主流程. 加新端 = 1 个端文件 + registry 加 entry, 千机端零改动.

**实战反证 (08-30 + 08-31)**:
- 08-30: 端路由设计拍板, baoli.ts 删内部 QANJI_READY send, runZbbWorkflow 统一发
- 08-27: 删 Cooldown 态, 流程正常结束直 Idle, 老板点 / 千机监听 / 反息屏 都能立刻启动
- V32.36.3: 端失败统一弹窗 + INTERVENE (而非 FAILED → Error 卡住)
- V32.36.4: runZbbWorkflow 不再二次发 onFailed (避免 Illegal transition)

### 2.6 V4.x 3 入口触发架构 (08-27 老板拍板)

**决策**: V4.x 业务流程 3 个入口全部调 `runZbbWorkflow`, 100% 复用同一套流程:

| 入口 | 触发源 | 守卫 |
|---|---|---|
| **入口 1** | HomeScreen.handleStart (老板点"开始干活") | a11yEnabled + overlayGranted |
| **入口 2** | `QianjiMessageReceived` DeviceEventEmitter (千机监听) | 白名单(待审核+项目) + isRunning + isInUserIntervention + 5s 动态空闲检测 + pending 队列 |
| **入口 3** | `zbbIdleWorkTrigger` DeviceEventEmitter (native WorkOrchestrator 5min 反息屏) | isRunning + isInUserIntervention |

**实战反证 (08-31)**:
- V32.36.0: 千机监听 5s 延迟 setTimeout race + 拆 5min 静默 (user/zbb 分离)
- V32.36.0.1: 改 setTimeout 递归代替 setInterval
- V32.36.2: UserInteractionRecorded 改 native push 模式 (修 RN bridge queue 堵塞)
- V32.36.6: 删 IdleWorker 链, 只留 ZBBKeepAliveService.tick (handler.postDelayed 5min 严格不延迟, EMUI doze 不可靠)

### 2.7 V4 永远先看 V2.x 老代码别拍脑袋改 (09-02 老板反证金标准)

**决策**: 修 VBB bug 前**必 grep V2.x** (`D:\projects\project_coze0520\client\`) 找反证金标准.

**原因 (V32.36.11 4 轮反证金标准)**:
- V32.36.8: 工作台上滑改 V2.x 反证 (改坐标, 不换通道) → 仍失败
- V32.36.9: 上滑/下滑改 swipeShell (input swipe 通道) → 老板装机调试仍失败
- V32.36.10: 加 swipeShell log → 老板现场反证根因 = dispatchGesture 被拦截, 不是坐标
- **V32.36.11**: 改回 V2.x swipe (dispatchGesture) + humanSwipeWithBounceDp P+ 拟人化 → 老板 nova 装机 PASS

**V2.x 反证金标准路径**:
- TS: `client/services/BaoliService.ts` (v22.x) + `client/src/flow/baoli/BaoliFlow.ts` (重构版)
- Kotlin: `client/android/app/src/main/java/com/zbb/automation/`

### 2.8 V4 OCR 全删 (V32.36.7 老板 09-01 拍板)

**决策**: V4.x OCR (PaddleOCR / ML Kit) **全部删除**, judge 改 A11y only.

**原因**:
- 老板 09-01 拍板: OCR 误判率高, 全删
- V32.36.7 commit `20114d9` 删 OCR → build 失败 2 次 (L2607 screenContainsText 残留)
- V32.36.7 commit `4c0b664`: OCR 函数体改空 (稳健方式, 不破坏类结构)
- 修法: `findTextByMLKit/screenContainsText/ocrContainsText` 改 A11y 或返回空
- judge.isScreenText 只用 A11y (findElementByText), 加 `node?.found === true` 判 false positive (V32.36.11)

---

## 3. Build + 部署金标准 (Boss Decision SOP)

### 3.1 默认编译节点 = Win11 (PC2-a)

**WSL 只编辑代码, 不编译**. Win11 RDP 跑 `gradlew.bat :app:assembleRelease` (~30s 增量 build, ~3min 全量 build).

### 3.2 V4 V32.36.11 装机验证 4 步 SOP

```powershell
# RDP Win11 PowerShell (管理员)
adb -s QMF4C20528002273 uninstall com.zbb.automation.v4
adb -s QMF4C20528002273 install -r C:\Users\lt-ceo\Desktop\zbb-v4-v32.36.11-release-20260902-1426.apk
adb -s QMF4C20528002273 shell am start -n com.zbb.automation.v4/com.zbb.automation.v4.MainActivity

# 5min 后查 server log:
# D:\projects\zbb-huawei-logs\nova\KT-OISfXUre2\20260902T****-nova+202****0902.log
```

**装机前必 SHA256 反证** (老板 09-02 反证: 曾装错 V32.36.8 debug 当 V32.36.9 release):
```powershell
Get-FileHash C:\Users\lt-ceo\Desktop\zbb-v4-v32.36.11-release-20260902-1426.apk -Algorithm SHA256
# 期望: 618c94d9... (老板 nova 装机验证后反馈)
```

### 3.3 APK 命名规范

- `zbb-v4-v{version}-{release/debug}-{YYYYMMDD-HHmm}.apk`
- 例: `zbb-v4-v32.36.11-release-20260902-1426.apk`

### 3.4 Win11 PowerShell 编译必带 (V32.36.7 实战反证)

```powershell
# .ps1 顶部必带:
$env:NODE_ENV = 'production'  # 漏了 build 报 "NODE_ENV required"
$env:JAVA_HOME = 'D:\software\Java\jdk-17'  # Win11 用 JDK 17
```

E470 应急 build **不 export JAVA_HOME** (E470 PATH 默认 java = Oracle JRE 8, JAVA_HOME=D:\jdk17 实际不存在, 用 PATH 的 java).

---

## 4. 老板决策风格 (Boss Decision Style)

### 4.1 老板拍板流程 (4 步节奏)

1. **Understand** (分析现状, 查真实记录)
2. **Solution** (出方案 + 列决策点 Q1/Q2/Q3)
3. **Boss拍板** (老板拍 A/B/C/D)
4. **Execute** (按拍板结果执行)

### 4.2 老板铁律

- "查询真实记录再回答" — 不编造 log/APK hash/commit SHA
- "A 方案优先" (skill `react-native-gradle-cache-clearing-rerun` 实战反证) — 最小改动优先
- "destructive consent 必须显式" — commit/push/build/PowerShell 调 Win11 等 destructive op 必须老板显式 `go destructive` token
- "**永远先看 V2.x 老代码别拍脑袋改**" — 修 ZBB bug 前先 grep V2.x 找反证金标准 (V32.36.11 4 轮反证实战)

### 4.3 老板拍板 8 个常用决策点

| 决策点 | 老板偏好 | 实战反证 |
|---|---|---|
| A vs B 方案选择 | 最小改动 (A) | skill `react-native-gradle-cache-clearing-rerun` |
| console log 重复时间 | 单个时间, native + JS 二选一 | V32.34.2 JS 改 + V32.34.3 native 改 |
| RN bridge 不暴露方法 | 改用 sendToServer HTTP POST (V2.x 设计) | V32.34.1 B方案 |
| autolinking 引用陈旧依赖 | 删 package.json 依赖 + npm install | 08-30 slider 修法 |
| Hermes console 替换 | 保留 installConsoleHook (V2.x 反证不踩) | V32.34.1 |
| 长期稳定 vs 短期修复 | 长期稳定优先 (V2.x 14 天实战反证) | V32.34.3 全链路修复 |
| OCR 误判率高 | 全删, judge 改 A11y only | V32.36.7 commit `20114d9` 9-01 拍板 |
| dispatchGesture vs swipeShell | 永远先看 V2.x, V2.x 用哪个就用哪个 | V32.36.11 4 轮反证改回 V2.x swipe |

---

## 5. 扩展计划 (老板 08-30 拍板)

| 扩展功能 | 状态 | V32.36.11 设计支持 |
|---|---|---|
| **越秀端业务流程** | ❌ 占位 throw | ✅ sendToServer HTTP POST 自动覆盖 logger.info; ✅ registry.yuexiu 占位 ready |
| **招商端业务流程** | ❌ 占位 throw | ✅ 同上 |
| **用户注册** | ⏳ 待开发 | ✅ 任何 logger.info/warn/error 都走 3 路 |
| **收费功能** | ⏳ 待开发 | ✅ 同上 |

**优势**: V32.34.3 设计已支持**任何纯 JS 业务扩展**——只要业务代码调 `logger.info(tag, msg)`, server log 业务 log 段自动收到 (跟 V2.x vivo 一致 100%).

---

## 6. 关键 reference

- **`src/utils/LOGGER_DESIGN.md`** — V32.34.3 3 路并打设计完整文档
- **`README.md`** — 项目总览 + 版本时间线 + 装机 SOP
- **Skill `boss-zbb-v4-logger-server-log-long-term-sop`** — 6 轮反证 + V32.34.x 修法时间线 (skill 在 Hermes `~/.hermes/skills/`)
- **Skill `zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop`** — V32.33 commit + push + Win11 rebuild 完整链路
- **Skill `zbb-v32.36.11-workbench-swipe-fix`** — V32.36.8/9/10/11 4 轮反证 + V32.36.11 装机 PASS 金标准
- **Skill `zbb-v4-screen-aware-flow`** — V4 入口判断 3 种情况 + 千机端 PageIdentifier
- **Skill `zbb-ocr-disable-stable-build-pattern`** — OCR 全删稳健模式 (V32.36.7 实战反证)
- **Skill `zbb-v4-qianji-monitor-pending-queue`** — 千机监听 + pending 队列设计 + 3 入口触发
- **全局规则 `~/.hermes/AGENTS.md`** — 平台架构 / WSL→Win11 / 工具调用铁律

---

## 7. 关键 commit hash 时间线 (V32.27 → V32.36.11)

### 7.1 logger 3 路并打 (V32.27 → V32.34.3, 08-27 ~ 08-30)

| commit | 版本 | 事件 | 结果 |
|---|---|---|---|
| `4822ef1` | V32.27 (08-27) | logger 实装 native bridge (生产场景铁律) | ❌ RN bridge 不暴露 |
| `1b36b39` | (08-27) | console 全局 hook + app_version 跟 BuildConfig.VERSION_TAG | ❌ Hermes 替换 console |
| `692ee66` | (08-28) | logger.ts 加诊断日志 | ⚠️ 部分 |
| `1ae5eed` | V32.30 (08-28) | 回滚 hook + 改 logger.* 内手动 emit | ❌ 同 V32.27 根因 |
| `8bd76eb` | V32.30.1 (08-28) | 去掉 JS logger [HH:MM:SS] 前缀 | ⚠️ 部分 |
| `094136e` | V32.32 (08-28) | 加回 [HH:MM:SS] (诊断标记) | ❌ RN bridge 不暴露 |
| `3dd20c7` | V32.33 (08-30) | writeBusinessLog 去掉 Promise (治本) | ❌ RN bridge 仍不暴露 |
| `8905142` | (08-30) | 删未用 slider 依赖 (build fix) | ✅ Win11 build 通 |
| **`8f99cc0`** | **V32.34 (08-30)** | **完整回滚 V2.x 设计 (3 路并打)** | ✅ **JS log 100% 上 server** |
| **`8e459d5`** | **V32.34.1 (08-30)** | **sendToServer endpoint + body 格式修复** | ✅ **server 接收成功** |
| `e977d63` | V32.34.2 (08-30) | JS sendToServer log text 只显示日期 | ❌ 漏改 native |
| **`9db688f`** | **V32.34.3 (08-30)** | **native BusinessLogWriter DATE_FMT_LINE 只拼日期** | ✅ **期望格式 100% 匹配** |

### 7.2 业务流程 + 装机修复 (V32.36.0 → V32.36.11, 08-31 ~ 09-02)

| commit | 版本 | 事件 | 结果 |
|---|---|---|---|
| `61a1c46` | V32.36.0 (08-31) | 千机监听 5s 延迟 setTimeout race + 拆 5min 静默 (user/zbb 分离) | ⚠️ 仍有 race |
| `b71308d` | V32.36.0.1 (08-31) | 千机监听轮询改 setTimeout 递归 (修 setInterval 126 次悬挂) | ⚠️ build error |
| `46f3832` | V32.36.2 (08-31) | companion object 包装 emit 静态函数 (build error 修复) | ✅ build 通 |
| `54de542` | V32.36.2 (08-31) | 千机监听改 native push 模式 (UserInteractionRecorded) | ✅ 修 RN bridge queue 堵塞 |
| `e53dddc` | V32.36.3 (08-31) | 端失败弹窗 + step3 单步骤失败立刻 raiseAlert | ✅ 老板装机验证 |
| `736152b` | V32.36.4 (08-31) | runZbbWorkflow 不再二次发 onFailed (避免 Illegal transition) | ✅ |
| `ad33ab8` | V32.36.5 (08-31) | 5min 反息屏加 caller 字段 (ZBBKeepAlive_tick / IdleWorker / UserPresent) | ✅ |
| `a8d14bf` | V32.36.6 (08-31) | 删 IdleWorker 链只留 ZBBKeepAlive (handler.postDelayed 5min 严格不延迟) | ✅ 修 EMUI doze 不可靠 |
| `20114d9` | V32.36.7 (09-01) | OCR 全删 (老板 09-01 拍板 OCR 误判率高) | ⚠️ build 失败 |
| `776934e` → `4c0b664` | V32.36.7 (09-01) | OCR 函数体改空 (稳健方式, 不破坏类结构) | ✅ build 通 |
| `80d1e4a` | V32.36.8 (09-02) | 工作台上滑改 V2.x 反证 (改坐标 Y 33% 屏) | ❌ 老板装机仍不上滑 |
| `ecee6b9` | V32.36.9 (09-02) | 上滑/下滑改 swipeShell (input swipe 通道) | ❌ 老板装机调试仍失败 |
| `dae0283` | V32.36.10 (09-02) | 加 swipeShell log (装机调试) | ❌ 老板现场反证根因 = dispatchGesture 被拦截, 不是坐标 |
| **`817ba7d`** | **V32.36.11 (09-02)** | **judge found:true + V2.x humanSwipeWithBounceDp P+ 拟人化** | ✅ **老板 nova 装机 PASS** |