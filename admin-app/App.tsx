import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

const ADMIN_URL = "https://her-link-kivora3.vercel.app/admin";
const UPDATE_INFO_URL =
  "https://github.com/wer930821/HerLink/releases/download/admin-latest/admin-update-info.json";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

type UpdateInfo = {
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
};

function getCurrentVersionCode() {
  const configuredCode = Constants.expoConfig?.android?.versionCode;
  return typeof configuredCode === "number" ? configuredCode : 1;
}

function AdminApp() {
  const webRef = useRef<WebView>(null);
  const lastBackPressRef = useRef(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [webKey, setWebKey] = useState(0);
  const [webReady, setWebReady] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const updatePromptedRef = useRef<number | null>(null);
  const lastMailboxUnreadRef = useRef<number | null>(null);

  const installUpdateInsideApp = async (info: UpdateInfo) => {
    if (!info.apkUrl || Platform.OS !== "android") return;
    try {
      setUpdateProgress(0);
      setUpdateStatus("正在下載更新…");
      const target = `${FileSystem.cacheDirectory}HerLink-Admin-update.apk`;
      await FileSystem.deleteAsync(target, { idempotent: true });
      const download = FileSystem.createDownloadResumable(
        info.apkUrl,
        target,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            setUpdateProgress(totalBytesWritten / totalBytesExpectedToWrite);
          }
        }
      );
      const result = await download.downloadAsync();
      if (!result?.uri) throw new Error("下載失敗");

      setUpdateProgress(1);
      setUpdateStatus("正在開啟更新安裝…");
      const contentUri = await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1,
        type: "application/vnd.android.package-archive",
      });
    } catch {
      setUpdateProgress(null);
      setUpdateStatus(null);
      Alert.alert("更新失敗", "無法在 App 內完成更新，請稍後再試。");
    }
  };

  const handleNavigation = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  };

  const reload = () => {
    setFailed(false);
    setLoading(true);
    setWebReady(false);
    setWebKey((value) => value + 1);
  };

  const goHome = () => {
    setFailed(false);
    setLoading(true);
    setWebReady(false);
    webRef.current?.injectJavaScript(
      `window.location.href = "${ADMIN_URL}"; true;`
    );
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressRef.current = now;
      if (Platform.OS === "android") {
        ToastAndroid.show("再按一次返回鍵才會離開後台", ToastAndroid.SHORT);
      }
      return true;
    });

    return () => sub.remove();
  }, [canGoBack]);

  useEffect(() => {
    let checking = false;

    const checkForUpdate = async () => {
      if (Platform.OS !== "android" || checking) return;
      checking = true;

      try {
        const response = await fetch(`${UPDATE_INFO_URL}?t=${Date.now()}`, {
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const info = (await response.json()) as UpdateInfo;
        const latestCode = Number(info.versionCode ?? 0);
        const currentCode = getCurrentVersionCode();

        if (latestCode > currentCode && info.apkUrl && updatePromptedRef.current !== latestCode) {
          updatePromptedRef.current = latestCode;
          Alert.alert(
            "發現新版後台",
            `目前版本：${Constants.expoConfig?.version ?? "目前版本"}\n最新版本：${info.versionName ?? latestCode}\n\n要現在更新嗎？`,
            [
              { text: "稍後", style: "cancel" },
              {
                text: "更新",
                onPress: () => {
                  void installUpdateInsideApp(info);
                },
              },
            ],
            { cancelable: true }
          );
        }
      } catch {
        // 更新檢查失敗不影響後台使用。
      } finally {
        checking = false;
      }
    };

    void checkForUpdate();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void checkForUpdate();
      }
    });

    return () => appStateSub.remove();
  }, []);


  useEffect(() => {
    if (Platform.OS !== "android") return;
    void (async () => {
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status === "granted") {
        await Notifications.setNotificationChannelAsync("mailbox", {
          name: "站長信箱",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 220, 120, 220],
        });
      }
    })();
  }, []);

  const handleWebMessage = async (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type?: string; count?: number; subject?: string };
      if (msg.type !== "mailbox-unread") return;
      const count = Math.max(0, Number(msg.count ?? 0));
      const previous = lastMailboxUnreadRef.current;
      lastMailboxUnreadRef.current = count;
      await Notifications.setBadgeCountAsync(count);
      if (count > 0 && previous !== null && count > previous) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "HerLink 後台｜收到新信",
            body: msg.subject ? `站長信箱：${msg.subject}` : `站長信箱有 ${count} 封未讀信件`,
            sound: "default",
            data: { url: "/admin/mailbox" },
          },
          trigger: null,
        });
      }
    } catch {}
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" backgroundColor="#0d0b16" />

      <View style={styles.webWrap}>
        <WebView
          key={webKey}
          ref={webRef}
          source={{ uri: ADMIN_URL }}
          applicationNameForUserAgent="HerLinkAdminApp"
          style={styles.web}
          originWhitelist={["https://*", "http://*"]}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          injectedJavaScriptBeforeContentLoaded={`try { window.localStorage.setItem("herlink_admin_app", "1"); } catch {} true;`}
          setSupportMultipleWindows={false}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          startInLoadingState={false}
          onNavigationStateChange={handleNavigation}
          onMessage={(event) => { void handleWebMessage(event); }}
          onLoadStart={() => {
            // 只在 App 第一次開啟或手動重新整理時顯示全頁載入。
            // 後台內頁導覽不再重新蓋上「正在載入後台」。
            if (!webReady) setLoading(true);
            setFailed(false);
          }}
          onLoadEnd={() => {
            setLoading(false);
            setWebReady(true);
          }}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 400) {
              setLoading(false);
              setFailed(true);
            }
          }}
        />

        {updateProgress !== null ? (
          <View style={styles.updateOverlay}>
            <ActivityIndicator size="large" color="#ff6f61" />
            <Text style={styles.errorTitle}>後台更新中</Text>
            <Text style={styles.loadingText}>{updateStatus ?? "正在準備更新…"}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(updateProgress * 100)}%` }]} />
            </View>
            <Text style={styles.loadingText}>{Math.round(updateProgress * 100)}%</Text>
          </View>
        ) : null}

        {loading && !webReady && updateProgress === null ? (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#ff6f61" />
            <Text style={styles.loadingText}>正在載入後台…</Text>
          </View>
        ) : null}

        {failed ? (
          <View style={styles.overlay}>
            <Text style={styles.errorTitle}>後台暫時無法開啟</Text>
            <Text style={styles.errorBody}>請確認網路後再重新整理。</Text>
            <Pressable style={styles.retryButton} onPress={reload}>
              <Text style={styles.retryText}>重新整理</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AdminApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0d0b16",
  },
  appBar: {
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#120f1d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  brandRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 4,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#ff6f61",
  },
  brandCopy: {
    minWidth: 0,
  },
  brand: {
    color: "#f6f1ff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 1,
    color: "#b7aecb",
    fontSize: 11,
    fontWeight: "500",
  },
  actions: {
    flexDirection: "row",
    gap: 6,
  },
  actionButton: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionPressed: {
    opacity: 0.68,
  },
  actionText: {
    color: "#f6f1ff",
    fontSize: 12,
    fontWeight: "700",
  },
  webWrap: {
    flex: 1,
    position: "relative",
    backgroundColor: "#0d0b16",
  },
  web: {
    flex: 1,
    backgroundColor: "#0d0b16",
  },
  updateOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 28,
    backgroundColor: "#0d0b16",
  },
  progressTrack: {
    width: "82%",
    height: 8,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#ff6f61",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 28,
    backgroundColor: "#0d0b16",
  },
  loadingText: {
    color: "#b7aecb",
    fontSize: 14,
    fontWeight: "500",
  },
  errorTitle: {
    color: "#f6f1ff",
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  errorBody: {
    color: "#b7aecb",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    minHeight: 46,
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: "#ff6f61",
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: "#1a0d0c",
    fontWeight: "800",
    fontSize: 14,
  },
});
