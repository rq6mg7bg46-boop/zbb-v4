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
      if (a11yTimer) clearInterval(a11yTimer);
      if (overlayTimer) clearInterval(overlayTimer);
      sub?.remove?.();
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

  // 开始干活
  const handleStart = useCallback(async () => {
    if (!a11yEnabled || !overlayGranted) {
      Alert.alert(
        '权限不足',
        '请先开启「无障碍」和「悬浮窗」权限,小主才能开始干活~',
      );
      return;
    }
    try {
      await ZBBAutomation.start();
      setIsRunning(true);
    } catch (e: any) {
      Alert.alert('启动失败', String(e?.message ?? e));
    }
  }, [a11yEnabled, overlayGranted]);

  // 三指下滑截图测试
  const handleThreeFingerTest = useCallback(() => {
    Alert.alert(
      '三指下滑截图测试',
      '请在任意界面三指下滑,系统会截屏并保存到相册。',
      [{ text: '好的' }],
    );
  }, []);

  // 悬浮窗徽章点击
  const handleBadgePress = useCallback(() => {
    Alert.alert('悬浮窗', '悬浮窗徽章');
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

      {/* 8. 悬浮窗徽章 (左下角) */}
      <View style={[styles.badgeContainer, { bottom: 24 + insets.bottom }]}>
        <TouchableOpacity style={styles.badge} onPress={handleBadgePress} activeOpacity={0.7}>
          <Text style={styles.badgeText}>G</Text>
        </TouchableOpacity>
      </View>
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
  badgeContainer: {
    position: 'absolute',
    left: 20,
    bottom: 24,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
});
