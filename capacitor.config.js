// Capacitor 配置：把 frontend/ 静态资源封装进 iOS 原生 App，
// 在手机本地 WebView 内运行（即"本地 Web 服务以 App 形式"）。
const config = {
  appId: "com.nurse.app",
  appName: "Nurse",
  webDir: "frontend",
  server: {
    // iOS 上用本地 https scheme，便于麦克风和通知等能力在 App 内正常工作
    iosScheme: "https",
    androidScheme: "https",
  },
};

module.exports = config;
