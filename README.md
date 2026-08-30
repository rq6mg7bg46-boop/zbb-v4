# ZBB V4 自动化

> ZBB 自动化 V4.x — 基于 V2.x 复用的 26 kt Legacy native + 新增越秀端/招商端/用户注册/收费功能

**最新 release APK**: `zbb-v4-v32.34.3-release-20260830-1220.apk` (159 MB)
**SHA256**: `d04c546cd0007882e999cef3e07a786cff2da0d1a357c8ce3a9b9ea449a683db`
**当前状态**: V32.34.3 release APK 已 build, 等老板装机 nova 验证 server log 格式

---

## 1. 项目身份

- **包名**: `com.zbb.automation.v4`
- **JS 框架**: Expo 54.0.33 + React Native 0.81.5 (Legacy Architecture)
- **Native 代码**: 复用 V2.x `com.zbb.automation` 26 kt (AccessibilityService / WorkManager / BusinessLogWriter / LogUploadWorker)
- **设备**: nova (华为 nova75G, ADB serial `QMF4C20528002273`) + vivo (老板交付机)

---

## 2. 当前版本时间线 (V32.27 → V32.34.3, 08-30 实战反证)

| commit | 版本 | 事件 | 结果 |
|---|---|---|---|
| `3dd20c7` | V32.33 | writeBusinessLog 去掉 Promise (治本) | ❌ RN bridge 不暴露 |
| `8905142` | V32.33.1 | 删未用 slider 依赖 (build fix) | ✅ Win11 build 通 |
| **`8f99cc0`** | **V32.34** | **完整回滚 V2.x 设计 (3 路并打)** | ✅ **JS log 100% 上 server** |
| **`8e459d5`** | **V32.34.1** | **sendToServer endpoint + body 格式修复** | ✅ **server 接收成功** |
| `e977d63` | V32.34.2 | JS sendToServer log text 只显示日期 | ❌ 漏改 native |
| **`9db688f`** | **V32.34.3** | **native BusinessLogWriter DATE_FMT_LINE 只拼日期** | ✅ **期望格式 100% 匹配** |

**核心经验**: 6 轮反证 (V32.27-V32.33) 后, V32.34.1 B方案 + V32.34.3 修复 date 格式, 真正 work.

---

## 3. 装机 SOP (RDP Win11 PowerShell)

```powershell
# 1. 卸载旧版
adb -s QMF4C20528002273 uninstall com.zbb.automation.v4

# 2. 装 V32.34.3 release
adb -s QMF4C20528002273 install -r C:\Users\lt-ceo\Desktop\zbb-v4-v32.34.3-release-20260830-1220.apk

# 3. 启动 app
adb -s QMF4C20528002273 shell am start -n com.zbb.automation.v4/com.zbb.automation.v4.MainActivity

# 4. 5min 后查 server log
# 路径: D:\projects\zbb-huawei-logs\nova\KT-OISfXUre2\20260830T031429-nova+20260830.log
```

**期望 server log 业务 log 段格式**:
```
2026/08/30 [INFO   ] [11:09:28] [Orchestrator] Idle --[START]--> QianjiRefreshing
2026/08/30 [INFO   ] [11:09:28] [千机:步骤1] 正在打开千机...
2026/08/30 [INFO   ] [11:09:31] [千机:步骤1] ✓ 千机已打开
```

---

## 4. 项目结构

```
D:\projects\zbb-v4\
├── android/
│   └── app/src/main/java/com/zbb/automation.v4/
│       ├── AutomationModule.kt       ← @ReactMethod 入口 (writeBusinessLog 去 Promise)
│       ├── AccessibilityServiceImpl.kt ← 通知监听 + WindowChanged
│       ├── BusinessLogWriter.kt       ← 写 <filesDir>/zbb_logs/business-YYYY-MM-DD.log
│       ├── LogUploadWorker.kt         ← 5min tick POST https://desktop-hi4ajgj.taildab2db.ts.net/log
│       └── MainApplication.kt         ← getPackages() add(AutomationPackage())
├── src/
│   ├── utils/
│   │   ├── logger.ts                 ← V32.34.3 3 路并打 (console + sendToServer + native)
│   │   └── LOGGER_DESIGN.md          ← V32.34.3 设计详细文档
│   ├── native/
│   │   └── ZBBAutomation.d.ts
│   ├── services/                     ← 业务流程 (千机/越秀/招商/注册/收费)
│   ├── api/                          ← HTTP API 客户端
│   └── config/env.ts                 ← BuildConfig / 版本
├── app.config.ts                     ← Expo 配置 (newArchEnabled: false)
├── package.json                      ← @react-native-community/slider 已删 (08-30 fix)
└── AGENTS.md                         ← 项目级铁律 (老板决策风格 + 关键决策)
```

---

## 5. 关键设计文档

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 项目级铁律 + 老板决策风格 + 关键架构决策 |
| `src/utils/LOGGER_DESIGN.md` | V32.34.3 3 路并打设计 + 反模式实战反证 |
| `~/.hermes/skills/.../boss-zbb-v4-logger-server-log-long-term-sop` | 6 轮反证 + V32.34.x 修法时间线 (skill) |
| `~/.hermes/skills/.../zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop` | V32.33 commit + push + Win11 rebuild debug 完整链路 |

---

## 6. server log 业务 log 段期望格式

```
2026/08/30 [INFO   ] [HH:MM:SS] [tag] message
              ↑         ↑         ↑       ↑
              │         │         │       └─ JS logger.info msg
              │         │         └─ JS logger.info tag
              │         └─ JS format() 拼 [HH:MM:SS] (V32.32 老板拍板的诊断标记)
              └─ native BusinessLogWriter 加 level
```

- **日期** `2026/08/30` ← native DATE_FMT_LINE = `yyyy/MM/dd` (V32.34.3)
- **时间** `[HH:MM:SS]` ← JS logger.info 内 format() 拼 (V32.32)
- **level** `[INFO   ]` ← native BusinessLogWriter 加 level (V18+ 稳定)
- **tag** `[千机:步骤1]` / `[Orchestrator]` / `[越秀端]` ← JS logger.info tag
- **msg** ← JS logger.info msg

**3 路来源** (V32.34.3):
1. **console.log** (debug 用, 不上 server)
2. **sendToServer HTTP POST** (主链路, V2.x 设计, 不依赖 RN bridge)
3. **native writeBusinessLog → BusinessLogWriter.append** (fallback, 受 RN bridge 暴露限制)

---

## 7. Build + Commit SOP

### 7.1 Build (Win11 PowerShell, background + notify)

```bash
# WSL 端
cmd.exe /c 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\wsl$\Ubuntu\home\lt-ceo\bin\build-zbb-v4-v32.33-release.ps1'
```

### 7.2 Commit (WSL)

```bash
cd /mnt/d/projects/zbb-v4
git add -A
git -c user.email=ironman@zbb.local -c user.name=ironman commit -m "fix: ..."
bash /home/lt-ceo/bin/push-v4-zh.sh
```

### 7.3 5 维金标准验证

1. **filename**: `zbb-v4-v32.34.3-release-20260830-1220.apk`
2. **size**: ~159 MB
3. **mtime**: < 5 min
4. **SHA256**: `d04c546cd0007882e999cef3e07a786cff2da0d1a357c8ce3a9b9ea449a683db`
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

---

## 9. 老板拍板 6 个常用决策点 (实战反证)

| 决策点 | 老板拍板 | 实战反证 commit |
|---|---|---|
| A vs B 方案 | 最小改动 (A) | 多个 commit |
| console log 重复时间 | 单个时间, native + JS 二选一 | V32.34.2 + V32.34.3 |
| RN bridge 不暴露 | sendToServer HTTP POST (V2.x 设计) | V32.34.1 |
| autolinking 引用陈旧依赖 | 删 package.json 依赖 | `8905142` slider fix |
| Hermes console 替换 | 保留 installConsoleHook | V32.34.1 |
| 长期稳定 vs 短期修复 | 长期稳定优先 | V32.34.x 全链路 |

---

## 10. Reference

- **AGENTS.md** — 项目级铁律 + 关键架构决策
- **src/utils/LOGGER_DESIGN.md** — V32.34.3 设计详细文档
- **Skill `boss-zbb-v4-logger-server-log-long-term-sop`** — 6 轮反证 + V32.34.x 修法时间线
- **Skill `zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop`** — V32.33 commit + push + Win11 rebuild 完整链路
- **Skill `wsl-win11-ps-build`** — WSL→Win11 PowerShell 编译 APK 金标准
- **Skill `wsl-windows-adb-bridge`** — WSL→Win11 ADB 5 步桥接
- **全局 `~/.hermes/AGENTS.md`** — 平台架构 / WSL→Win11 / 工具铁律