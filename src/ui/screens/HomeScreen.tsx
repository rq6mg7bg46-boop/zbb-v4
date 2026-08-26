/**
 * ZBB v4 HomeScreen - 精简版 (老板实战反证金标准 08-22)
 *
 * V4.x UI = V2.x HomeScreen 截图里 9 个元素:
 * 1. 标题 Action Surrogate + 副标题 Disconnect to reconnect with life.
 * 2. 双权限状态 (无障碍 + 悬浮窗)
 * 3. 情绪话术卡 (5 时段随机)
 * 4. 今日完成计数
 * 5. 当前状态
 * 6. 开始干活按钮
 * 7. 三指下滑截图测试按钮
 * 8. 悬浮窗徽章
 *
 * 实战反证金标准: 不复制 V2.x 巨型 services (BaoliService / CustomerTable / QianjiService)
 *                不复制 V2.x 流程步骤 / 客户信息 / License / Admin
 *                只用 V4.x 精简 native module + ZBBAutomation basic methods
 */

// 🆕 08-26 老板拍板 v32.18: 模块级 cooldownTimer (不被 useEffect 依赖变化清理)
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { runZbbWorkflow } from '@/flow';
import { orchestrator, OrchState } from '@/core/stateMachine';
import { showSystemToast } from '@/services/alert';

// ================== V4.x 精简 Native Bridge ==================
// 实战反证金标准: V4.x 用 ZBBAutomation native module (V2.x 26 kt 已支持)
// 实战反证金标准 (08-22): V4.x native 暴露 isAccessibilityServiceRunning, 不是 isServiceRunning
import { NativeModules } from 'react-native';
const ZBBAutomation = (NativeModules as any).ZBBAutomation ?? {
  isAccessibilityServiceRunning: () => Promise.resolve(false),
  isOverlayPermissionGranted: () => Promise.resolve(false),
  start: () => Promise.resolve(false),
  stop: () => Promise.resolve(false),
  openAccessibilitySettings: () => Promise.resolve(false),
  openOverlaySettings: () => Promise.resolve(false),
};

// ================== 5 时段情绪话术库 ==================
// 实战反证金标准: 老板 nova 截图里"上午好,小主,今天见到你真开心~"
type IdleMsg = { icon: string; text: string };

const IDLE_MESSAGES: Record<string, IdleMsg[]> = {
  dawn: [
    { icon: '🌙', text: '小主还没睡呀…我也快没电了,能让我歇会儿吗?' },
    { icon: '☕', text: '小主起这么早呀,要不要先泡杯咖啡?' },
    { icon: '🌅', text: '早安小主~ 今天也要元气满满哦!' },
    { icon: '😢', text: '这个点还在忙吗?注意身体呀小主~' },
  ],
  morning: [
    { icon: '☀️', text: '上午好,小主,今天见到你真开心~' },
    { icon: '😄', text: '小主早!新的一天,准备好搬砖了吗?' },
    { icon: '💼', text: '上班路上小心点哦,客户都在等着呢~' },
    { icon: '💪', text: '开工大吉,今天的报备肯定顺利!' },
  ],
  afternoon: [
    { icon: '☕', text: '下午好,小主,要不要来杯下午茶?' },
    { icon: '🍴', text: '小主,午饭吃了吗?别饿着肚子搬砖呀~' },
    { icon: '😉', text: '小主辛苦啦,休息一下眼睛吧~' },
    { icon: '💪', text: '下午高峰来了!小主加油,今天一定能冲业绩!' },
  ],
  evening: [
    { icon: '🌇', text: '傍晚啦,小主今天战绩如何?' },
    { icon: '😩', text: '快收工了,小主也累了吧?时间到就下班了~' },
    { icon: '🏪', text: '18 点了,客户都准备下班,小主今天还要加班吗?' },
  ],
  night: [
    { icon: '😩', text: '小主,我今天转了 {count} 组客户,快累死了。让我歇歇呗~' },
    { icon: '🌙', text: '今天帮小主搞定了 {count} 单,眼睛都花了~' },
    { icon: '😘', text: '夜深了,小主也要早点睡哦~' },
  ],
};

function getHourBucket(): keyof typeof IDLE_MESSAGES {
  const h = new Date().getHours();
  if (h < 9) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function getRandomMessage(count: number): IdleMsg {
  const bucket = getHourBucket();
  const pool = IDLE_MESSAGES[bucket];
  const msg = pool[Math.floor(Math.random() * pool.length)];
  return {
    ...msg,
    text: msg.text.replace('{count}', String(count)),
  };
}

// ================== HomeScreen 主组件 ==================
export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  // 状态
  const [a11yEnabled, setA11yEnabled] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  // 🆕 08-25: Cooldown 进入时间戳 (用于 Toast 显示剩余秒数)
  const [_cooldownEnterTime, setCooldownEnterTime] = useState(0);

  // V4.x 实战反证金标准 (08-22): 每秒检测, 检测到开启就停
  const checkA11yOnce = useCallback(async (): Promise<boolean> => {
    try {
      const ok = await ZBBAutomation.isAccessibilityServiceRunning();
      console.log(`[pollA11y] ${new Date().toISOString().slice(11, 19)} → ${ok}`);
      return ok;
    } catch (e) {
      console.error('[pollA11y] error:', e);
      return false;
    }
  }, []);

  const checkOverlayOnce = useCallback(async (): Promise<boolean> => {
    try {
      const ok = await ZBBAutomation.isOverlayPermissionGranted();
      console.log(`[pollOverlay] ${new Date().toISOString().slice(11, 19)} → ${ok}`);
      return ok;
    } catch (e) {
      console.error('[pollOverlay] error:', e);
      return false;
    }
  }, []);

  useEffect(() => {
    let a11yTimer: ReturnType<typeof setInterval> | null = null;
    let overlayTimer: ReturnType<typeof setInterval> | null = null;
    // 🆕 08-26 v32.18: cooldownTimer 改为模块级, 不在这里声明

    // 🆕 08-25: 监听状态机, Cooldown 进入时记录时间戳 + UserIntervention 时弹 1 次 Toast
    const unsub = orchestrator.onChange((newState, prevState) => {
      if (newState === OrchState.Cooldown) {
        const enterTime = Date.now();
        setCooldownEnterTime(enterTime);
        console.log('[HomeScreen] 进入 Cooldown, 记录时间戳, 60s 后自动 COOLDOWN_DONE');
        // 🆕 08-26 老板拍板修法: Cooldown 60s 后自动发 COOLDOWN_DONE → Idle
        //   - 之前没自动 trigger → 一直 stuck Cooldown
        //   - 用 setTimeout, 重复进入 Cooldown 时清旧 timer
        if (cooldownTimer) {
          clearTimeout(cooldownTimer);
          cooldownTimer = null;
        }
        cooldownTimer = setTimeout(() => {
          cooldownTimer = null;
          // 二次校验: 状态仍是 Cooldown 才发 (避免被 RESET/USER_CONFIRM 抢先)
          if (orchestrator.getState() === OrchState.Cooldown) {
            console.log('[HomeScreen] Cooldown 60s 到期 → 发 COOLDOWN_DONE → Idle');
            orchestrator.send('COOLDOWN_DONE');
          }
        }, 60_000);
      } else if (newState === OrchState.Idle) {
        setCooldownEnterTime(0); // 重置
        if (cooldownTimer) {
          clearTimeout(cooldownTimer);
          cooldownTimer = null;
        }
      } else if (newState === OrchState.UserIntervention && prevState !== OrchState.UserIntervention) {
        // 🆕 08-26 老板拍板: 状态机切到 UserIntervention 不再弹窗
        //   - 弹窗由 qianji.ts 步骤 4 raiseAlert 统一发 (有按钮 + 震动 30s)
        //   - HomeScreen 只负责监听状态变化
        console.log('[HomeScreen] 进入 UserIntervention, 弹窗已由 qianji.ts 步骤 4 触发');
        // 清 Cooldown timer (避免在 UserIntervention 状态误发 COOLDOWN_DONE)
        if (cooldownTimer) {
          clearTimeout(cooldownTimer);
          cooldownTimer = null;
        }
      }
    });

    const startA11yPoll = () => {
      if (a11yTimer) return;
      checkA11yOnce().then((ok) => {
        setA11yEnabled(ok);
        if (ok) return;
        a11yTimer = setInterval(async () => {
          const o = await checkA11yOnce();
          setA11yEnabled(o);
          if (o && a11yTimer) {
            clearInterval(a11yTimer);
            a11yTimer = null;
            console.log('[pollA11y] 检测到已开启, 停止轮询');
          }
        }, 1000);
      });
    };

    const startOverlayPoll = () => {
      if (overlayTimer) return;
      checkOverlayOnce().then((ok) => {
        setOverlayGranted(ok);
        if (ok) return;
        overlayTimer = setInterval(async () => {
          const o = await checkOverlayOnce();
          setOverlayGranted(o);
          if (o && overlayTimer) {
            clearInterval(overlayTimer);
            overlayTimer = null;
            console.log('[pollOverlay] 检测到已开启, 停止轮询');
          }
        }, 1000);
      });
    };

    startA11yPoll();
    startOverlayPoll();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!a11yEnabled) startA11yPoll();
        if (!overlayGranted) startOverlayPoll();
      }
    });

    return () => {
      unsub();
      if (a11yTimer) clearInterval(a11yTimer);
      if (overlayTimer) clearInterval(overlayTimer);
      // 🆕 08-26 v32.18: 不清模块级 cooldownTimer, 让 60s 计时继续跑
    };
  }, [checkA11yOnce, checkOverlayOnce, a11yEnabled, overlayGranted]);

  // 情绪话术 (随机, 但稳定不抖动)
  const idleMessage = useMemo(() => getRandomMessage(todayCount), [todayCount]);

  // 点击无障碍 chip — 跳转系统无障碍设置
  const handleA11yChipPress = useCallback(() => {
    ZBBAutomation.openAccessibilitySettings?.();
  }, []);

  // 点击悬浮窗 chip — 跳转系统悬浮窗设置
  const handleOverlayChipPress = useCallback(() => {
    ZBBAutomation.openOverlaySettings?.();
  }, []);

// 开始干活 (V4.x 08-24 + 08-25 正常/非正常结束)
  //   - 正常结束 (Cooldown/Idle): 自动接龙 → runZbbWorkflow
  //   - 非正常结束 (UserIntervention): 老板点"开始干活" → USER_CONFIRM → Idle → 再跑
  //   - 5min 自动触发器也调同一个 runZbbWorkflow, 100% 复用同一套流程
  const handleStart = useCallback(async () => {
    if (!a11yEnabled || !overlayGranted) {
      Alert.alert(
        '权限不足',
        '请先开启「无障碍」和「悬浮窗」权限,小主才能开始干活~',
      );
      return;
    }

    // 🆕 08-25 老板拍板: UserIntervention 状态 → 先发 USER_CONFIRM 回 Idle, 再走流程
    const currentState = orchestrator.getState();
    if (currentState === OrchState.UserIntervention) {
      console.log('[开始干活] UserIntervention 状态 → 发 USER_CONFIRM → Idle → 再跑流程');
      orchestrator.send('USER_CONFIRM');
      // fallthrough 继续跑流程 (USER_CONFIRM → Idle → START → QianjiRefreshing)
    } else if (currentState === OrchState.Cooldown) {
      // 🆕 08-26 老板拍板 v32.18: 老板点开始干活 → 直接强制退出 Cooldown, 不弹窗
      console.log('[开始干活] 老板强制退出 Cooldown → 发 COOLDOWN_DONE → Idle → 走流程');
      orchestrator.send('COOLDOWN_DONE');
      // fallthrough 继续走流程 (COOLDOWN_DONE → Idle → START → QianjiRefreshing)
    } else if (orchestrator.isRunning()) {
      // 🆕 08-25 老板拍板: Running 中 → Toast 提示已在跑, 不响应
      console.warn('[开始干活] Running 中 (千机/保利/越秀在跑), 跳过本次点击');
      await showSystemToast('小主,我已经在努力干活中!', 3000);
      return;
    }

    setIsRunning(true);
    console.log('[开始干活] 启动业务流程 (handleStart → runZbbWorkflow)...');
    try {
      const result = await runZbbWorkflow();
      if (result.skipped) {
        console.warn(`[开始干活] 流程跳过: ${result.reason}`);
        Alert.alert('提示', `流程跳过: ${result.reason}`);
      } else if (result.ok) {
        console.log(`[开始干活] 流程完成: ${result.customerName} (自动接龙中...)`);
        // 🆕 08-25 老板拍板: 正常结束不弹"完成" Alert, 避免打断自动接龙
      } else {
        console.warn(`[开始干活] 流程失败: ${result.reason} → UserIntervention`);
        // 失败已转 UserIntervention, 等老板点"开始干活"才恢复
      }
    } catch (e: any) {
      console.error('[开始干活] 流程异常:', e);
      Alert.alert('启动失败', String(e?.message ?? e));
    } finally {
      setIsRunning(false);
    }
  }, [a11yEnabled, overlayGranted]);

  // 🆕 08-25 老板拍板: 计算 Cooldown 剩余秒数
  //   Cooldown 进入时间存在 _cooldownEnterTime, 60s 后 COOLDOWN_DONE
  function getCooldownRemainingMs(): number {
    const COOLDOWN_MS = 60_000;
    const elapsed = Date.now() - _cooldownEnterTime;
    return Math.max(0, COOLDOWN_MS - elapsed);
  }

  // 三指下滑截图测试
  const handleThreeFingerTest = useCallback(() => {
    Alert.alert(
      '三指下滑截图测试',
      '请在任意界面三指下滑,系统会截屏并保存到相册。',
      [{ text: '好的' }],
    );
  }, []);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. 标题 + 副标题 */}
      <View style={styles.header}>
        <Text style={styles.title}>Action Surrogate</Text>
        <Text style={styles.subtitle} numberOfLines={1}>Disconnect to reconnect with life.</Text>
      </View>

      {/* 2. 双权限状态 (副标题下面, 占满一行) — V4.x 2 态: 已开启 (绿) / 未开启 (红) */}
      <View style={styles.permissionBadges}>
        <TouchableOpacity
          style={[styles.permChip, styles.permChipFlex, a11yEnabled ? styles.permChipOk : styles.permChipFail]}
          onPress={handleA11yChipPress}
          activeOpacity={0.6}
        >
          <View style={styles.dot} />
          <Text style={styles.permChipText}>无障碍 {a11yEnabled ? '已开启' : '未开启'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permChip, styles.permChipFlex, overlayGranted ? styles.permChipOk : styles.permChipFail]}
          onPress={handleOverlayChipPress}
          activeOpacity={0.6}
        >
          <View style={styles.dot} />
          <Text style={styles.permChipText}>悬浮窗 {overlayGranted ? '已开启' : '未开启'}</Text>
        </TouchableOpacity>
      </View>

      {/* 3. 情绪话术卡 */}
      <View style={styles.messageCard}>
        <Text style={styles.messageIcon}>{idleMessage.icon}</Text>
        <Text style={styles.messageText}>{idleMessage.text}</Text>
      </View>

      {/* 4+5. 今日完成 + 当前状态 */}
      <View style={styles.statusRow}>
        <View style={[styles.statusCard, styles.statusCardLeft]}>
          <View style={styles.statusHeader}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
            <Text style={styles.statusNumber}>{todayCount}</Text>
          </View>
          <Text style={styles.statusLabel}>今日完成</Text>
        </View>

        <View style={[styles.statusCard, styles.statusCardRight]}>
          <View style={styles.statusHeader}>
            <Text style={styles.clockIcon}>⏰</Text>
            <Text style={[styles.statusValue, isRunning && styles.statusValueRunning]}>
              {isRunning ? '运行中' : '空闲'}
            </Text>
          </View>
          <Text style={styles.statusLabel}>当前状态</Text>
        </View>
      </View>

      {/* 6. 开始干活按钮 */}
      <TouchableOpacity style={styles.primaryButton} onPress={handleStart} activeOpacity={0.8}>
        <Text style={styles.primaryButtonIcon}>🔨</Text>
        <Text style={styles.primaryButtonText}>开始干活</Text>
        <Text style={styles.primaryButtonArrow}>›</Text>
      </TouchableOpacity>

      {/* 7. 三指下滑截图测试 */}
      <TouchableOpacity style={styles.secondaryButton} onPress={handleThreeFingerTest} activeOpacity={0.8}>
        <Text style={styles.secondaryButtonIcon}>✋</Text>
        <Text style={styles.secondaryButtonText}>三指下滑截图测试</Text>
        <Text style={styles.secondaryButtonArrow}>›</Text>
      </TouchableOpacity>

      {/* (实战反证金标准 08-22 老板 nova 实测: 左下角 G 徽章删除, 不符合跨应用设计) */}
    </ScrollView>
  );
}

// ================== 样式 ==================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 100,
  },

  // 标题
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 20,
  },

  // 权限 badges (副标题下面, 占满一行, 醒目 chip 风格)
  permissionBadges: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  permChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  permChipFlex: {
    flex: 1,
    justifyContent: 'center',
  },
  permChipOk: {
    backgroundColor: '#10B981',
  },
  permChipFail: {
    backgroundColor: '#EF4444',
  },
  permChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },

  // 情绪话术卡
  messageCard: {
    backgroundColor: '#EFF6FF',
    borderLeftWidth: 4,
    borderLeftColor: '#3B82F6',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  messageText: {
    flex: 1,
    fontSize: 14,
    color: '#1E40AF',
    lineHeight: 20,
  },

  // 状态卡
  statusRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statusCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statusCardLeft: {},
  statusCardRight: {},
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  statusNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  clockIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  statusValue: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '600',
  },
  statusValueRunning: {
    color: '#10B981',
  },
  statusLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },

  // 主按钮
  primaryButton: {
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  primaryButtonText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButtonArrow: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '300',
  },

  // 次按钮
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  secondaryButtonIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  secondaryButtonText: {
    flex: 1,
    color: '#92400E',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonArrow: {
    color: '#92400E',
    fontSize: 24,
    fontWeight: '300',
  },

  // 悬浮窗徽章
});
