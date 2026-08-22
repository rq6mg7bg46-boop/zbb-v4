import { ExpoConfig, ConfigContext } from 'expo/config';

const appName = process.env.COZE_PROJECT_NAME || process.env.EXPO_PUBLIC_COZE_PROJECT_NAME || 'ZBB自动化';
const projectId = process.env.COZE_PROJECT_ID || process.env.EXPO_PUBLIC_COZE_PROJECT_ID;
const slugAppName = projectId ? `app${projectId}` : 'zbb-automation';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    "name": appName,
    "slug": slugAppName,
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "myapp",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": false,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": `com.anonymous.${projectId || 'zbb'}`
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#4F46E5"
      },
      "package": `com.zbb.automation.v4`,
      // Android 权限配置
      "permissions": [
        "android.permission.INTERNET",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION"
      ]
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      // 必须放在最前面
      "expo-dev-client",
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
        "expo-router",
        {
          "origin": process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        }
      ] : 'expo-router',
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#4F46E5"
        }
      ],
      // 图片选择器
      [
        "expo-image-picker",
        {
          "photosPermission": "允许ZBB访问您的相册，以便您上传或保存图片。",
          "cameraPermission": "允许ZBB使用您的相机，以便您直接拍摄照片上传。",
          "microphonePermission": "允许ZBB访问您的麦克风，以便您拍摄带有声音的视频。"
        }
      ],
      // 位置服务
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "ZBB需要访问您的位置以提供周边服务及导航功能。"
        }
      ],
      // 相机
      [
        "expo-camera",
        {
          "cameraPermission": "ZBB需要访问相机以拍摄照片和视频。",
          "microphonePermission": "ZBB需要访问麦克风以录制视频声音。",
          "recordAudioAndroid": true
        }
      ],
      // 媒体库（Android 截图保存）
      [
        "expo-media-library",
        {
          "photosPermission": "允许ZBB访问您的相册，以便保存截图和图片。",
          "savePhotosPermission": "允许ZBB保存截图到您的相册。",
          "isAccessMediaLocationEnabled": true
        }
      ],
      // 文件系统（用于存储截图）
      [
        "expo-file-system",
        {
          "photoLibraryPermission": "允许ZBB访问您的照片库。"
        }
      ],
      // SQLite 数据库
      "expo-sqlite"
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
