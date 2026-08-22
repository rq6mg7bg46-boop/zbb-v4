import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * ZBB v4 RootLayout (老板实战反证金标准 08-22)
 *
 * 简化版 - 只支持单屏 (HomeScreen)
 * 不引入 V2.x 的 ColorSchemeProvider / baoliService / yuexiuService
 * 后续 V4.x 渐进式精简业务时再加
 */

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ title: '' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
