# V32.34.3 logger.ts 设计文档 (3 路并打 B方案)

> **建立日期**: 2026-08-30
> **实战反证**: 6 轮 V32.27-V32.33 全失败, V32.34.1 B方案 + V32.34.3 native 修复 真正 work
> **配合文件**: `src/utils/logger.ts` (V32.34.3 版本) + `android/app/src/main/java/com/zbb/automation.v4/BusinessLogWriter.kt` (V32.34.3)

---

## 1. 设计目标

**核心目标**: ZBB V4.x JS log (任何 `logger.info/warn/error` 调用) **100% 上 server log 业务 log 段**, 长期稳定.

**扩展目标**: 覆盖越秀端/招商端/用户注册/收费功能 (V32.34.3 设计自动支持任何 JS 业务 log).

---

## 2. 3 路并打架构 (V32.34.3)

```
logger.info(tag, msg)
  ↓
logToBoth(level, line)
  ├─ 1. console.log                       ← debug 用, 不上 server
  │     ├─ switch (level):
    │     │   case 'warn':  originalWarn(...)
  │     │   case 'error': originalError(...)
  │     │   default:      originalLog(...)
  │     └─ (用 originalLog/Warn/Error, 不用 console.log/warn/error 直接调, 防 hook 递归)
  │
  ├─ 2. sendToServer HTTP POST            ← V2.x 主链路, 不依赖 RN bridge
  │     └─ sendToServerDirect(level, line)
  │        └─ fetch(`${baseUrl}/log`, {
  │             body: server 期望的字段格式
  │             (device_id, user_id, timestamp, source, log, ...)
  │           })
  │
  └─ 3. appendToBusinessLog               ← V32.33 native 治本 (去 Promise 参数)
        └─ ZBBAutomation.writeBusinessLog(level, line)
           └─ native BusinessLogWriter.append (V32.34.3 DATE_FMT_LINE 只拼日期)
              └─ <filesDir>/zbb_logs/business-YYYY-MM-DD.log
                 └─ LogUploadWorker 5min tick
                    └─ POST https://desktop-hi4ajgj.taildab2db.ts.net/log
                       └─ server: D:\projects\zbb-huawei-logs\...
```

**关键洞察**: sendToServer 是主链路 (V2.x 实战反证 14 天稳定), native writeBusinessLog 是 fallback (受 RN bridge 暴露限制).

---

## 3. 6 轮反证根因表 (V32.27 → V32.33)

| 版本 | 修法 | 失败根因 |
|---|---|---|
| V32.27 (08-27 23:50) | emitNative 设计 + logger 调 native writeBusinessLog | **RN 0.81.5 Legacy @ReactMethod Promise 方法不暴露** |
| V32.28 (08-28 08:00) | console 全局 hook + logcat 抓 | **Hermes release 替换 console 对象, hook 装的 ≠ 业务用的** |
| V32.30 (08-28 14:00) | 删 hook + 改 logger.* 内手动 emit | **同 V32.27 根因, RN bridge 仍不暴露** |
| V32.31 (08-28 18:00) | 时戳格式调整 | **未触及根因, JS log 仍 0% 上 server** |
| V32.32 (08-28 22:00) | 加 [HH:MM:SS] 前缀作为诊断标记 | **未触及根因, 但保留为后续诊断标记** |
| V32.33 (08-30 09:30) | native writeBusinessLog 去 Promise 参数 (治本) | **RN bridge 仍不暴露, V32.27 反证复刻** |
| **V32.34 (08-30 11:00)** | **B方案: 完整回滚 V2.x 设计 (3 路并打)** | ✅ **100% work, server log 业务 log 段含 [千机:步骤1]** |
| V32.34.1 (08-30 11:30) | sendToServer endpoint + body 格式修复 | ✅ server 接收 |
| V32.34.2 (08-30 12:00) | JS sendToServer log text 只显示日期 | ❌ **漏改 native BusinessLogWriter** |
| **V32.34.3 (08-30 12:20)** | **native BusinessLogWriter DATE_FMT_LINE 只拼日期** | ✅ **期望格式 100% 匹配** |

---

## 4. 关键设计细节

### 4.1 sendToServer HTTP POST (V2.x 主链路)

```typescript
// V32.34.3 src/utils/logger.ts
function sendToServerDirect(level: LogLevel | string, message: string): void {
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'https://desktop-hi4ajgj.taildab2db.ts.net';

  const now = new Date();
  const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const levelShort = level.toUpperCase().padEnd(7);
  const safeMsg = message.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  const logText = `${date} [${levelShort}] ${safeMsg}\n`;

  fetch(`${baseUrl}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: 'QMF4C20528002273',
      user_id: 'nova',
      app_version: '1.0.0',
      source: 'js-direct',
      timestamp: Date.now(),
      seq: 0,
      total_seq: 1,
      terminal: true,
      is_new_data: true,
      log: logText,
    }),
  }).catch(() => {});
}
```

### 4.2 endpoint /log (不是 V2.x /api/v1/logs)

| 来源 | endpoint |
|---|---|
| **V2.x AutomationLogger** | `/api/v1/logs` ← V2.x 仓 server 端专属 |
| **V4 native LogUploadWorker** | `/log` ← V4 server 端 zbb_log_receiver.py |
| **V4 logger sendToServer (V32.34.1)** | `/log` ← 跟 native 一致 |

**实战反证**: V32.34 用 `/api/v1/logs` → server 返 404. V32.34.1 改 `/log` → 接收成功.

### 4.3 body 格式 (跟 server 期望一致)

```json
{
  "device_id": "QMF4C20528002273",   // 必填, 设备 serial
  "user_id": "nova",                  // 必填, 用户 ID (双层目录用)
  "app_version": "1.0.0",             // 必填, 应用版本
  "source": "js-direct",              // 必填, log source
  "timestamp": 1788057295523,         // 必填, ms (不是 ISO string)
  "seq": 0,                           // 必填, 分片 seq (单 chunk default 0)
  "total_seq": 1,                     // 必填, 总分片数 (单 chunk default 1)
  "terminal": true,                   // 必填, 是否最后 chunk
  "is_new_data": true,                // 必填, 是否新数据
  "log": "2026/08/30 [INFO   ] [HH:MM:SS] [tag] msg\n"  // 必填, 完整 log 文本
}
```

**实战反证**: server 端 `zbb_log_receiver.py` L488-491 严格检查所有字段.

### 4.4 logText 格式 (V32.34.3 native + JS 一致)

```
2026/08/30 [INFO   ] [HH:MM:SS] [tag] msg\n
```

| 字段 | 来源 | 说明 |
|---|---|---|
| `2026/08/30` | native + JS 都生成 | native DATE_FMT_LINE = `yyyy/MM/dd` (V32.34.3) |
| `[INFO   ]` | native BusinessLogWriter 加 level | V18+ 稳定 |
| `[HH:MM:SS]` | JS logger.info format() 拼 | V32.32 老板拍板的诊断标记 |
| `[tag]` | JS logger.info 第1 个参数 | V32.18 已全仓替换 |
| `msg` | JS logger.info 第2 个参数 | 业务代码 |

---

## 5. installConsoleHook (V2.x 实战反证)

```typescript
// V32.34.3 src/utils/logger.ts
const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);
const originalInfo = console.info.bind(console);
const originalDebug = console.debug.bind(console);

function installConsoleHook() {
  if ((globalThis as any).__zbbConsoleHooked) return;
  (globalThis as any).__zbbConsoleHooked = true;

  console.log = (...args) => {
    originalLog(...args);  // 1. 调原 console (防递归)
    void appendToBusinessLog('info', args.map(safeStringify).join(' '));
    sendToServer('info', args.map(safeStringify).join(' '));
  };
  // console.warn/error/info/debug 同样
}

installConsoleHook();
```

**实战反证**:
- V32.30 commit 删 console hook, 理由"Hermes release 替换 console 对象"
- **V32.34 实战反证 错** — V2.x vivo 跑 14 天, Hermes release 模式下 installConsoleHook 仍 work
- V32.34.1 恢复 installConsoleHook

---

## 6. 反模式 6 大实战反证 (老板拍板不要走)

### 6.1 console hook 单独作为 JS log 上 server 链路
| 错 | 后果 |
|---|---|
| 只靠 console hook + logcat | Hermes release 替换 console 对象, hook 装的 ≠ 业务用的 |
| **正确**: console hook + sendToServer + native writeBusinessLog 一起 | ✅ work |

### 6.2 只用 native writeBusinessLog (V32.27-33 全踩)
| 错 | 后果 |
|---|---|
| 全部依赖 RN bridge 暴露 @ReactMethod 方法 | **RN 0.81.5 Legacy 不暴露, JS log 0% 上 server** |
| **正确**: 3 路并打, sendToServer HTTP POST 为主链路, native writeBusinessLog 为 fallback | ✅ work |

### 6.3 sendToServer 沿用 V2.x endpoint /api/v1/logs
| 错 | 后果 |
|---|---|
| V4 server zbb_log_receiver.py 只接受 /log | server 返 404 → upload 失败 |
| **正确 endpoint**: `/log` (跟 native LogUploadWorker 一致) | ✅ work |

### 6.4 sendToServer body 用 V2.x {level, message}
| 错 | 后果 |
|---|---|
| server 期望 device_id/timestamp/log/source/app_version/user_id/seq/total_seq/terminal | server 解析失败 |
| **正确 body**: server 期望的字段格式 (跟 native LogUploadWorker 一致) | ✅ work |

### 6.5 native BusinessLogWriter DATE_FMT_LINE 含时间
| 错 | 后果 |
|---|---|
| `yyyy/MM/dd HH:mm:ss` + JS `[HH:MM:SS]` 重复 | server log 业务 log 段 2 个时分秒 |
| **正确格式**: `yyyy/MM/dd` (V32.34.3) + JS `[HH:MM:SS]` 诊断标记 | ✅ work, 期望格式 |

### 6.6 改 JS sendToServer 不改 native BusinessLogWriter
| 错 | 后果 |
|---|---|
| V32.34.2 修了 JS sendToServer HTTP POST 链路, 但 native 写盘链路仍是 HH:mm:ss | server log 仍有 2 个时分秒 (因为走 native writeBusinessLog 链路) |
| **正确**: JS + native 都要改 (V32.34.2 + V32.34.3 一起) | ✅ work |

---

## 7. 关键 commit hash 时间线

```
3dd20c7 V32.33 writeBusinessLog Promise fix           ❌ RN bridge 不暴露
8905142 V32.33 slider 依赖删除 (build fix)             ✅ Win11 build 通
8f99cc0 V32.34 完整回滚 V2.x 设计 (3 路并打)           ✅ JS log 100% 上 server
8e459d5 V32.34.1 sendToServer endpoint + body 格式      ✅ server 接收成功
e977d63 V32.34.2 JS sendToServer log text 只日期        ❌ 漏改 native
9db688f V32.34.3 native DATE_FMT_LINE 只拼日期          ✅ 期望格式 100% 匹配
```

---

## 8. 老板决策风格 (V4 logger 设计)

| 老板拍板 | 实战反证 |
|---|---|
| 最小改动 + B方案 (V2.x 实战反证稳) | V32.34.1 B方案 |
| console log 重复时间 → 单个时间 | V32.34.2 JS 改 + V32.34.3 native 改 |
| sendToServer HTTP POST 是 V2.x 主链路 | V32.34.1 |
| installConsoleHook 保留 (V2.x 反证不踩 Hermes) | V32.34.1 |
| 长期稳定 > 短期修复 | V32.34.3 全链路修复 |

---

## 9. Reference

- **AGENTS.md** — 项目级铁律 + 关键架构决策
- **README.md** — 项目总览 + 版本时间线 + 装机 SOP
- **Skill `boss-zbb-v4-logger-server-log-long-term-sop`** — 6 轮反证 + V32.34.x 修法时间线
- **Skill `zbb-v4-v32-33-commit-push-win11-rebuild-debug-sop`** — V32.33 commit + push + Win11 rebuild 完整链路
- **android/app/src/main/java/com/zbb/automation.v4/BusinessLogWriter.kt** — V32.34.3 DATE_FMT_LINE 修复
- **android/app/src/main/java/com/zbb/automation.v4/AutomationModule.kt** — V32.33 writeBusinessLog 去 Promise 参数