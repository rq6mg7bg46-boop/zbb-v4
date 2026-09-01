/**
 * handleStart.ts - 实测 08-24 老板拍板
 *
 * 老板 3 种情况:
 * 1. 当前 = 千机 → 下滑屏幕保证数据刷新
 * 2. 当前 = ZBB 或桌面 → 拉起千机,继续下一步
 * 3. 当前 = 其他 APK → 1 轮大退出
 *
 * 错误处理 (老板拍板):
 * - 3 次重试后弹 Alert让人工介入
 */

import { Alert } from 'react-native';
import { ZBBAutomation } from '@/native';
import { qianjiPackage, qianjiMainActivity } from '@/config/env';
import { classifyScreenKind } from '@/core/screen/PageIdentifier';
import { logger } from '@/utils/logger';
import { px, centerXDp, screenHeightDp } from '@/utils/DpUtil'; // V32.36.8 老板 09-09 修 handleStart 下滑刷新 (跨机型 dp)

// 实测: 跑完整业务流 (千机→保利→越秀, 导入在文件末尾避免循环依赖)
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
    logger.info('handleStart', `第 ${attempt}/${MAX_RETRY} 次入口判断`);

    const kind = await classifyScreenKind();
    logger.info('handleStart', `当前界面类型: ${kind}`);

    switch (kind) {
      case 'qianji_inside': {
        // 老板情况 1: 已在千机 → 下滑刷新, 不重新打开
        logger.info('handleStart', '已在千机内, 下滑刷新保证数据最新');
        // V32.36.8 老板 09-09 修: 原硬编码 px(540, 1800, 540, 600, 800) 是 nova480dpi 3x
        //   改 V2.x 反证 client/.../AccessibilityServiceImpl.kt:1851 scrollDown 同款 (屏中心 + 屏上1/3→屏下1/3)
        const swipeStartX = px(centerXDp());
        const swipeStartY = px(Math.round(screenHeightDp() / 3));
        const swipeEndX = swipeStartX;
        const swipeEndY = px(Math.round(screenHeightDp() * 2 / 3));
        await ZBBAutomation.swipe(swipeStartX, swipeStartY, swipeEndX, swipeEndY, 800);
        await ZBBAutomation.delay(1500); // 等刷新加载
        return await runZbbWorkflow();
      }

      case 'zbb_home':
      case 'desktop_home': {
        // 老板情况 2: ZBB 或桌面 → 拉起千机,继续下一步
        logger.info('handleStart', '当前在 ZBB/桌面, 拉起千机业务页');
        const qianjiPkg = qianjiPackage();
        const qianjiAct = qianjiMainActivity();
        const launchWithAm = (ZBBAutomation as any).launchAppWithAmStart
          ?? (ZBBAutomation as any).launchApp;
        const launched = await launchWithAm(qianjiPkg, qianjiAct);
        if (!launched) {
          logger.info('handleStart', '千机启动失败, 重试');
          break; // 重试
        }
        await ZBBAutomation.delay(3000); // 等千机启动完成
        return await runZbbWorkflow();
      }

      case 'other':
      default: {
        // 老板情况 3: 其他 APP → 1 轮大退出 (老板拍板 A: 实测 1 轮已足够)
        logger.info('handleStart', '当前在其他 APP, 执行 1 轮大退出 (home + 多功能 + 垃圾箱)');
        await hardRollback();
        await ZBBAutomation.delay(1000);
        // 继续 loop 重试 (第 2 次 attempt 重新走入口判断)
      }
    }
  }

  // 老板拍板: 3 次重试后弹 Alert 让人工介入
  logger.error('handleStart', `${MAX_RETRY} 次重试后仍无法进入千机, 弹 Alert`);
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
 * 实测: nova 7 5G 2 轮大退出 (老板 08-24 实测坐标, 物理 1080x2400 dpi 480)
 *   1. tap HOME (555, 2350) → 回桌面
 *   2. tap 多任务 (310, 2350) → 开多任务页
 *   3. tap 垃圾箱 (545, 2160) → 清空所有任务 + 实测自动回桌面
 *
 *   老板拍板 A: 改为 1 轮, 点击垃圾箱后结束 (不重复点 HOME)
 */
async function hardRollback(): Promise<void> {
  try {
    // 实测: 复用 V4 operations/rollback.byPolicy('trash') (留作未来扩展, 当前用坐标 tap)
    const rollbackModule = (await import('@/operations/rollback')).default
      ?? (await import('@/operations/rollback'));
    if (rollbackModule && typeof (rollbackModule as any).byPolicy === 'function') {
      await (rollbackModule as any).byPolicy('trash');
      return;
    }
  } catch (e) {
    logger.warn('hardRollback', `复用失败, 用 nova 坐标 tap: ${e}`);
  }
  // nova 7 5G 1 轮大退出 (老板实测 08-24)
  await ZBBAutomation.click(555, 2350); // HOME
  await ZBBAutomation.delay(1000);
  await ZBBAutomation.click(310, 2350); // RECENTS
  await ZBBAutomation.delay(1500);
  await ZBBAutomation.click(545, 2160); // TRASH (实测: 清空 + 自动回桌面)
  await ZBBAutomation.delay(1500);
}

async function runZbbWorkflow(): Promise<void> {
  if (!runZbbWorkflowRef) {
    logger.info('handleStart', 'runZbbWorkflow 未注册, 请在 flow/index.ts 调 setZbbWorkflowRunner');
    return;
  }
  await runZbbWorkflowRef();
}