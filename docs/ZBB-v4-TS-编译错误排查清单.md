# ZBB v4 TypeScript 编译错误排查清单

> 排查日期：2026-09-19
> 工具：铁子 (cron daemon, MiniMax-M3)
> 项目路径：`/mnt/d/projects/zbb-v4/`
> tsconfig：extends `expo/tsconfig.base`，`strict: true`，`noEmit: true`，`skipLibCheck: true`
> 验收命令：`npx tsc --noEmit` → **EXIT=0** ✅

---

## 排查结论（TL;DR）

| 错误类型 | 数量 | 根因 | 修复方案 | 状态 |
|---|---|---|---|---|
| TS2305 default export 缺失 | 1 | `src/operations/click.ts` 只导出命名对象 `click`，未导出 `default`，但 `src/operations/index.ts:15` 同时 re-export 了 `default as clickDefault` | 在 `click.ts` 末尾追加 `export default click;` 一行（最小改动，仅增不删） | ✅ 已修 |
| 依赖缺失 / 未安装 | 0 | `node_modules` 与 `package.json` 一致，无 `npm install` 需要 | — | — |
| tsconfig 引用错误 | 0 | tsconfig 极简，无 references / 复杂 paths | — | — |
| 类型定义过期 | 0 | `@types/react ~19.1.0` 与 `react 19.1.0` 对齐 | — | — |
| Node 类型问题 | 0 | 未直接用 Node-only 类型 | — | — |
| Expo SDK 类型冲突 | 0 | Expo SDK 54 ↔ RN 0.81.5 ↔ React 19.1.0 是 2025 年新组合，自洽 | — | — |
| react / react-native 版本不一致 | 0 | peer dep 全对齐 | — | — |

**最终：`npx tsc --noEmit` 0 错误**

---

## 详细排查过程

### Step 1：跑 `npx tsc --noEmit` 拿错误清单

```bash
cd /mnt/d/projects/zbb-v4
npx tsc --noEmit 2>&1 | head -100
```

**第一波输出（仅 1 个错）**：
```
src/operations/index.ts(15,17): error TS2305: Module '"./click"' has no exported member 'default'.
```

—— 数量远低于系统性故障预期，说明不是依赖/版本大崩溃，是局部模块导出形状不一致。

### Step 2：定位系统性根因

按老板 09-19 拍板的 6 类系统性根因顺序排查：

1. **依赖装了一半** ❌ 不成立 — `node_modules` 与 `package.json` 一致，无 `npm install` 需要
2. **tsconfig 引用错误** ❌ 不成立 — tsconfig.json 极简，只有 `paths: { "@/*": ["./src/*"] }`，无 references
3. **类型定义过期** ❌ 不成立 — `@types/react ~19.1.0` 与 `react 19.1.0` 完全对齐
4. **Node 类型问题** ❌ 不成立 — 未直接用 Node-only 类型
5. **Expo SDK 类型冲突** ❌ 不成立 — Expo SDK 54 ↔ RN 0.81.5 ↔ React 19.1.0 自洽（2025 年新组合）
6. **react / react-native 版本不一致** ❌ 不成立 — peer dep 全对齐

→ 全部排除，**问题就是单一文件的导出形状不匹配**。

### Step 3：分析具体文件

读 `src/operations/index.ts`，发现 8 个模块用统一模式 re-export：
```ts
export { click, default as clickDefault } from './click';
export { longPress, default as longPressDefault } from './longPress';
export { threeFingerSwipe, default as threeFingerSwipeDefault } from './threeFingerSwipe';
export { pressKey, default as pressKeyDefault } from './pressKey';
export { a11y, default as a11yDefault } from './a11y';          // 目录模块
export { judge, default as judgeDefault } from './judge';      // 目录模块
export { rollback, default as rollbackDefault } from './rollback';
export { swipe, default as swipeDefault, swipeUp, swipeDown, swipeUpByDp, swipeDownByDp } from './swipe';
```

逐个 grep 各模块的 `export` 行（结果表格）：

| 文件 | 类型 | `export const X = {...}` | `export default X` |
|---|---|---|---|
| click.ts | 单文件 | ✅ line 198 | ❌ **缺** |
| longPress.ts | 单文件 | ✅ | ✅ line 70 |
| threeFingerSwipe.ts | 单文件 | ✅ | ✅ line 87 |
| pressKey.ts | 单文件 | ✅ | ✅ line 51 |
| a11y/ | 目录 (index.ts) | ✅ line 70 | ✅ line 77 |
| judge/ | 目录 (index.ts) | ✅ line 122 | ✅ line 123 |
| rollback.ts | 单文件 | ✅ | ✅ line 81 |
| swipe.ts | 单文件 | ✅ | ✅ line 86 |

**唯一缺 default 的是 click.ts。** a11y / judge 是目录模块，`./a11y` 自动解析到 `./a11y/index.ts`，所以 TS 早期扫到它们时没报错——只报 click.ts。

### Step 4：批量修复（最小改动原则）

老板约束：只增不改不删。

**click.ts 末尾追加一行**（diff）：
```diff
 export const click = { byText, byNode, byId, byCoords };
+export default click;
```

### Step 5：验证

```bash
$ npx tsc --noEmit 2>&1
$ echo $?
0
```

→ **0 错误，PASS**。

---

## 经验总结（给后续参考）

1. **`export default` 与 named export 不一致是 RN/Expo 项目最常见 TS 错误之一**。V4 这个项目约定每个 operations 模块同时导出命名对象 + default，所以 index.ts 统一 re-export 两份。新增模块时务必保持这个约定。

2. **目录模块天然兼容** `./xxx` 路径解析（解析到 `./xxx/index.ts`），不需要额外路径配置。V4 把 a11y / judge 拆成目录是有意为之，扩展性好。

3. **TS2305 (`Module has no exported member`)** 几乎总是单一文件的导出形状问题，不要先怀疑依赖。先 `grep ^export` 对照 index 的 re-export 列表，定位比乱猜快。

4. **tsconfig 极简是好的**。V4 的 tsconfig.json 只有 26 行，没有 references、没有复杂的 paths，最小化类型系统复杂度 — 这种风格让 TS 错误几乎都能定位到具体源码文件。

5. **`skipLibCheck: true` 是 RN/Expo 必备**，否则 node_modules 里的类型噪音会淹没真实错误。V4 已经开了。

## 后续维护建议

- 新增 `src/operations/*.ts` 时：**同时提供命名导出 + default 导出**（参考 longPress.ts 的 70 行格式）
- 如果未来要扩展 a11y / judge 模块，**保持目录结构**，在 `index.ts` 里集中导出
- **跑 `npx tsc --noEmit` 应当进 CI**（目前 package.json scripts 里没有，建议加）：
  ```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    ...
  }
  ```
  ❓ 这条要不要加进 package.json？等老板拍板，不擅自动手。

## 改动文件清单

| 文件 | 改动类型 | 行数变化 |
|---|---|---|
| `src/operations/click.ts` | 追加 1 行 `export default click;` | +1 / -0 |

无文件删除、无重命名、无 tsconfig 改动、无 package.json 改动、无依赖安装。

---

*报告完成 — 铁子 2026-09-19 20:11 CST*
