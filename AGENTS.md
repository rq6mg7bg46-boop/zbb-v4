# ZBB V4 项目级铁律 (Project Rules)

> 适用于 ZBB V4 仓 (`D:\projects\zbb-v4\`) 的所有工作 (WSL 编辑 + Win11 build + nova 装机验证).
> 跟全局规则 `~/.hermes/AGENTS.md` 配合使用 (全局平台架构 / 工具调用铁律).
>
> **建立日期**: 2026-08-30
> **最后更新**: 2026-08-30 V32.34.3

---

## 1. 项目身份

- **项目名**: ZBB 自动化 V4 (基于 V2.x 复用 + 新增越秀端/招商端/用户注册/收费功能)
- **包名**: `com.zbb.automation.v4` (跟 V2.x `com.zbb.automation` 区分)
- **APK 类型**:
  - `release`: 159 MB, 装 nova (生产机) + vivo (老板交付机)
  - `debug`: 219 MB, 仅 dev 调试用 (RN bridge @ReactMethod 暴露问题)
- **JS 框架**: Expo 54.0.33 + RN 0.81.5 Legacy Architecture
- **关键库**: expo-sqlite + Android AccessibilityService + expo-router

---

## 2. 关键架构决策 (Project-Level Architectural Decisions)

### 2.1 V4.x 复用 V2.x Legacy Architecture (26 kt native)

**决策**: V4.x 复用 V2.x 已稳定的 26 kt native 代码 (AccessibilityService / WorkManager / BusinessLogWriter / LogUploadWorker), 不重写.

**原因**:
- V2.x 已稳定跑 14+ 天 (vivo 生产机)
- 老板 08-15 拍板: V4 增量扩展, 不破坏 V2.x 稳定链路
- Native 代码 review 1 遍 = V2 + V4 共享

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
- V2.x AutomationLogger 的 `/api/v1/logs` 是 V2.x 仓 server 端专属 endpoint, V4 不兼容

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
2026/08/30 [INFO   ] [11:09:28] [Orchestrator] Idle --[START]--> QianjiRefreshing
2026/08/30 [INFO   ] [11:09:28] [千机:步骤1] 正在打开千机...
```

---

## 3. Build + 部署金标准 (Boss Decision SOP)

### 3.1 默认编译节点 = Win11 (PC2-a)

**WSL 只编辑代码, 不编译**. Win11 RDP 跑 `gradlew.bat :app:assembleRelease` (~30s 增量 build, ~3min 全量 build).

### 3.2 V4 V32.34.3 装机验证 4 步 SOP

```powershell
# RDP Win11 PowerShell (管理员)
adb -s QMF4C20528002273 uninstall com.zbb.automation.v4
adb -s QMF4C20528002273 install -r C:\Users\lt-ceo\Desktop\zbb-v4-v32.34.3-release-20260830-1220.apk
adb -s QMF4C20528002273 shell am start -n com.zbb.automation.v4/com.zbb.automation.v4.MainActivity

# 5min 后查 server log:
# D:\projects\zbb-huawei-logs\nova\KT-OISfXUre2\20260830T031429-nova+20260830.log
```

### 3.3 APK 命名规范

- `zbb-v4-v{version}-{release/debug}-{YYYYMMDD-HHmm}.apk`
- 例: `zbb-v4-v32.34.3-release-20260830-1220.apk`

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

### 4.3 老板拍板 6 个常用决策点

| 决策点 | 老板偏好 | 实战反证 |
|---|---|---|
| A vs B 方案选择 | 最小改动 (A) | skill `react-native-gradle-cache-clearing-rerun` |
| console log 重复时间 | 单个时间, native + JS 二选一 | V32.34.2 JS 改 + V32.34.3 native 改 |
| RN bridge 不暴露方法 | 改用 sendToServer HTTP POST (V2.x 设计) | V32.34.1 B方案 |
| autolinking 引用陈旧依赖 | 删 package.json 依赖 + npm install | 08-30 slider 修法 |
| Hermes console 替换 | 保留 installConsoleHook (V2.x 反证不踩) | V32.34.1 |
| 长期稳定 vs 短期修复 | 长期稳定优先 (V2.x 14 天实战反证) | V32.34.3 全链路修复 |

---

## 5. 扩展计划 (老板 08-30 拍板)

| 扩展功能 | 状态 | V32.34.3 设计支持 |
|---|---|---|
| **越秀端业务流程** | ⏳ 待开发 | ✅ sendToServer HTTP POST 自动覆盖任何 logger.info |
| **招商端业务流程** | ⏳ 待开发 | ✅ 同上 |
| **用户注册** | ⏳ 待开发 | ✅ 任何 logger.info/warn/error 都走 3 路 |
| **收费功能** | ⏳ 待开发 | ✅ 同上 |

**优势**: V32.34.3 设计已支持**任何纯 JS 业务扩展**——只要业务代码调 `logger.info(tag, msg)`, server log 业务 log 段自动收到 (跟 V2.x vivo 一致 100%).

---

## 6. 关键 reference

- **`src/utils/LOGGER_DESIGN.md`** — V32.34.3 3 路并打设计完整文档
- **`README.md`** — 项目总览 + 版本时间线 + 装机 SOP
- **Skill `boss-zbb-v4-logger-server-log-long-term-sop`** — 6 轮反证 + V32.34.x 修法时间线 (skill 在 Hermes `~/.hermes/skills/`)
- **Skill `zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop`** — V32.33 commit + push + Win11 rebuild 完整链路
- **全局规则 `~/.hermes/AGENTS.md`** — 平台架构 / WSL→Win11 / 工具铁律

---

## 7. 关键 commit hash 时间线 (V32.27 → V32.34.3)

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