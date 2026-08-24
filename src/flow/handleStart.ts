/**
 * handleStart.ts - 实战反证金标准 08-24 老板拍板
 *
 * 老板 3 种情况:
 * 1. 当前 = 千机 → 下滑屏幕保证数据刷新
 * 2. 当前 = ZBB 或桌面 → 拉起千机,继续下一步
 * 3. 当前 = 其他 APK → 2 轮大退出
 *
 * 错误处理 (老板拍板):
 * - 3 次重试后弹 Alert让人工介入
 */

import { Alert } from 'react-native';
import ZBBAutomation from '@/native';
import { qianjiPackage, qianjiMainActivity } from '@/config/env';
import { classifyScreenKind, ScreenKind } from '@/core/screen/PageIdentifier';

// 实战反证金标准: 跑完整业务流 (千机→保利→越秀, 导入在文件末尾避免循环依赖)
let runZbbWorkflowRef: (() => Promise<void>) | null = null;
export function setZbbWorkflowRunner(fn: () => Promise<void>) {
  runZbbWorkflowRef = fn;
}

const MAX_RETRY = 3; // 老板拍板: 3 次重试后弹 Alert

/**
 * 老板入口判断: 3 种情况 + 3 次重试 + Alert
 */
export async function handleStart(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    console.log(`[handleStart] 第 ${attempt}/${MAX_RETRY} 次入口判断`);

    const kind = await classifyScreenKind();
    console.log(`[handleStart] 当前界面类型: ${kind}`);

    switch (kind) {
      case 'qianji_inside': {
        // 老板情况 1: 已在千机 → 下滑刷新, 不重新打开
        console.log('[handleStart] 已在千机内, 下滑刷新保证数据最新');
        // 实战反证金标准 (V2.x qianjiFlow.refresh): swipe 540,1800 → 540,600, 800ms
        await ZBBAutomation.swipe(540, 1800, 540, 600, 800);
        await ZBBAutomation.delay(1500); // 等刷新加载
        return await runZbbWorkflow();
      }

      case 'zbb_home':
      case 'desktop_home': {
        // 老板情况 2: ZBB 或桌面 → 拉起千机,继续下一步
        console.log('[handleStart] 当前在 ZBB/桌面, 拉起千机业务页');
        const qianjiPkg = qianjiPackage();
        const qianjiAct = qianjiMainActivity();
        const launchWithAm = (ZBBAutomation as any).launchAppWithAmStart
          ?? (ZBBAutomation as any).launchApp;
        const launched = await launchWithAm(qianjiPkg, qianjiAct);
        if (!launched) {
          console.warn('[handleStart] 千机启动失败, 重试');
          break; // 重试
        }
        await ZBBAutomation.delay(3000); // 等千机启动完成
        return await runZbbWorkflow();
      }

      case 'other':
      default: {
        // 老板情况 3: 其他 APP → 2 轮大退出
        console.warn('[handleStart] 当前在其他 APP, 执行 2 轮大退出 (home + 多功能 + 垃圾箱)');
        await hardRollback();
        await ZBBAutomation.delay(1000);
        await hardRollback();
        await ZBBAutomation.delay(1000);
        // 继续 loop 重试 (第 2 次 attempt 重新走入口判断)
      }
    }
  }

  // 老板拍板: 3 次重试后弹 Alert 让人工介入
  console.error(`[handleStart] ${MAX_RETRY} 次重试后仍无法进入千机, 弹 Alert`);
  await new Promise<void>((resolve) => {
    Alert.alert(
      '界面识别失败',
      `已重试 ${MAX_RETRY} 次仍无法进入千机, 请手动确认 nova 当前界面 (千机/ZBB/桌面), 然后重试。`,
      [
        {
          text: '我已确认',
          onPress: () => resolve(),
        },
      ],
      { cancelable: false }
    );
  });
}

/**
 * 实战反证金标准: 2 轮大退出 (HOME → 多功能 → 垃圾箱)
 * 复用 V4 operations/rollback.byPolicy('trash') 实现
 */
async function hardRollback(): Promise<void> {
  try {
    // 实战反证金标准: 按 V2.x v22.00 大回滚策略 — trash = HOME + 多功能 + 垃圾箱
    const rollbackModule = (await import('@/operations/rollback')).default
      ?? (await import('@/operations/rollback'));
    if (rollbackModule && typeof (rollbackModule as any).byPolicy === 'function') {
      await (rollbackModule as any).byPolicy('trash');
      return;
    }
  } catch (e) {
    console.warn(`[hardRollback] 复用失败, 直接调 native: ${e}`);
  }
  // fallback: 直接调 native
  await ZBBAutomation.pressHome();
  await ZBBAutomation.delay(500);
  await ZBBAutomation.pressRecentApps();
  await ZBBAutomation.delay(500);
  // 垃圾箱按钮: 按 keyevent(187) 或 swipe up 清多任务 (不同 ROM 不同)
  // 简化用 keyevent(4) 多次返回
  await ZBBAutomation.pressBack().catch(() => {});
}

async function runZbbWorkflow(): Promise<void> {
  if (!runZbbWorkflowRef) {
    console.error('[handleStart] runZbbWorkflow 未注册, 请在 flow/index.ts 调 setZbbWorkflowRunner');
    return;
  }
  await runZbbWorkflowRef();
}