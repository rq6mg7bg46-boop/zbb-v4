const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// 2026-06-22b: 修复 release 编译 expo export:embed 找不到 expo-router/entry.js。
// 根因链：
//   1. react-native gradle plugin 的 Os.cliPath() 在 Windows 上把绝对路径转成相对路径
//      （相对 react.root，默认 = client/），所以 --entry-file 收到 "node_modules/expo-router/entry.js"。
//   2. expo CLI 的 legacySinglePageExportBundleAsync 内部给非绝对路径加 "./" 前缀
//      → "./node_modules/expo-router/entry.js"。
//   3. metro 用 projectRoot 解析相对路径。在某些情况下 expo CLI 的 metro server projectRoot
//      落到根目录（D:\projects\project_coze0520/），而不是 client/。
//      根目录的 node_modules/expo-router/entry.js 不存在（expo-router 在 client/node_modules），
//      所以报 "Unable to resolve module ./node_modules/expo-router/entry.js from ...:/."。
// 修复：用 resolveRequest 拦截 expo CLI 加 "./" 前缀的路径，重定向到 bare module name，
//       走 metro 标准 node_modules 解析（自动找 client/node_modules/expo-router/entry.js）。
// 同时显式设 projectRoot = __dirname（client/），并把根目录的 node_modules 加进
// nodeModulesPaths 兜底，防止 expo CLI 把 projectRoot 解析到根目录时找不到依赖。
config.projectRoot = projectRoot;

// 🆕 2026-07-17 fix (root node_modules 模式): npm install --no-package-lock 默认 hoist
// 把 expo-router / react-native-screens 等 native modules 装到 root node_modules。
// metro 把软链 resolve 成 root 绝对路径后，必须在 watchFolders 里才能算 SHA-1。
// 加 root node_modules 到 watchFolders + nodeModulesPaths（之前已有 path.resolve(..., '..', 'node_modules')）。
config.watchFolders = [
    projectRoot,
];
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
];

// 🆕 2026-07-17 fix: npm dedupes react-native/react to root node_modules
// when both root and client package.json declare them. metro nested mode
// can't traverse to root via nodeModulesPaths alone — use extraNodeModules
// to force react-native/react resolution to the hoisted root copies.
// (Affects expo-router/entry.js → @expo/metro-runtime → react-native/Libraries/Core/InitializeCore)
config.resolver.extraNodeModules = {
    'react-native': path.resolve(projectRoot, 'node_modules', 'react-native'),
    'react': path.resolve(projectRoot, 'node_modules', 'react'),
};

// 🆕 2026-07-17 fix: react-native@0.81.5 package.json `exports` field doesn't
// expose ./Libraries/*/* (only ./*.js shallow + ./Libraries/*.d.ts 1-level).
// metro-resolver@0.81 with unstable_enablePackageExports=true (default)
// throws PackagePathNotExportedError on `import 'react-native/Libraries/Core/InitializeCore'`
// (file exists on disk but blocked by exports validation).
// Disable exports validation to fall through to file-based resolution.
config.resolver.unstable_enablePackageExports = false;

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    // expo CLI 加 './' 或 './../' 前缀的 entry file 路径，重定向到 bare module
    // 🆕 2026-08-10 fix: expo CLI 改用 './../' 前缀（相对 path.relative(projectRoot, filePath) 的输出形式），
    //    之前只拦 './' 不拦 './../'，导致 resolve 失败。
    if (moduleName.includes('node_modules/expo-router/entry')) {
        return context.resolveRequest(context, 'expo-router/entry', platform);
    }
    return defaultResolveRequest
        ? defaultResolveRequest(context, moduleName, platform)
        : context.resolveRequest(context, moduleName, platform);
};

config.resolver.blockList = [
    /node_modules\/.*\/node_modules\/node_modules/,
    /E:\\ZBB\\projects_coze0426\\node_modules/,
];

module.exports = config;