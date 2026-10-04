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
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Notifications from "expo-notifications";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

const ADMIN_URL = "https://her-link-kivora3.vercel.app/admin";
const UPDATE_INFO_URL =
  "https://github.com/wer930821/HerLink/releases/download/admin-latest/admin-update-info.json";

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
  const [mailboxAlert, setMailboxAlert] = useState<{ count: number; subject?: string } | null>(null);
  const adminPushTokenRef = useRef<string | null>(null);
  const pendingMailboxOpenRef = useRef(false);
  const webReadyRef = useRef(false);

  const sendAdminPushTokenToWeb = (token: string) => {
    if (!webReadyRef.current) return;
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent("herlink-admin-push-token",{detail:${JSON.stringify({ token })}})); true;`
    );
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;

    let mounted = true;
    const setupNotifications = async () => {
      try {
        await Notifications.setNotificationChannelAsync("herlink-admin-mailbox", {
          name: "站長信箱",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 250, 180, 250],
        });
        const current = await Notifications.getPermissionsAsync();
        let status = current.status;
        if (status !== "granted") {
          status = (await Notifications.requestPermissionsAsync()).status;
        }
        if (status !== "granted") return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) return;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (mounted) {
          adminPushTokenRef.current = token;
          sendAdminPushTokenToWeb(token);
        }
      } catch {
        // Push registration failure must not block the admin app.
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { event_type?: string; target_url?: string };
      if (data.event_type === "admin_mail" || data.target_url === "/admin/mailbox") {
        pendingMailboxOpenRef.current = true;
        webRef.current?.injectJavaScript('window.location.href = "/admin/mailbox"; true;');
      }
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = response?.notification.request.content.data as { event_type?: string; target_url?: string } | undefined;
      if (data?.event_type === "admin_mail" || data?.target_url === "/admin/mailbox") {
        pendingMailboxOpenRef.current = true;
      }
    }).catch(() => undefined);
    void setupNotifications();

    return () => {
      mounted = false;
      responseSub.remove();
    };
  }, []);

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
    webReadyRef.current = false;
    setFailed(false);
    setLoading(true);
    setWebReady(false);
    setWebKey((value) => value + 1);
  };

  const goHome = () => {
    webReadyRef.current = false;
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



  const handleWebMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; count?: number; subject?: string; ok?: boolean; error?: string | null };
      if (message.type === "admin-push-token-request") {
        const token = adminPushTokenRef.current;
        if (token) sendAdminPushTokenToWeb(token);
        return;
      }
      if (message.type === "admin-push-registration") {
        if (Platform.OS === "android") {
          ToastAndroid.show(message.ok ? "後台通知已啟用" : `後台通知註冊失敗：${message.error ?? "未知錯誤"}`, ToastAndroid.LONG);
        }
        return;
      }
      if (message.type !== "mailbox-unread") return;
      const count = Math.max(0, Number(message.count ?? 0));
      const previous = lastMailboxUnreadRef.current;
      lastMailboxUnreadRef.current = count;
      if (count > 0 && (previous === null || count > previous)) {
        setMailboxAlert({ count, subject: message.subject });
        if (Platform.OS === "android") {
          ToastAndroid.show(`站長信箱有 ${count} 封未讀信件`, ToastAndroid.LONG);
        }
      }
    } catch {
      // 信箱提醒失敗不能影響 App 啟動或 WebView。
    }
  };

  const openMailbox = () => {
    setMailboxAlert(null);
    webRef.current?.injectJavaScript(
      'window.location.href = "/admin/mailbox"; true;'
    );
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
          onMessage={handleWebMessage}
          onLoadStart={() => {
            webReadyRef.current = false;
            // 只在 App 第一次開啟或手動重新整理時顯示全頁載入。
            // 後台內頁導覽不再重新蓋上「正在載入後台」。
            if (!webReady) setLoading(true);
            setFailed(false);
          }}
          onLoadEnd={() => {
            webReadyRef.current = true;
            setLoading(false);
            setWebReady(true);
            const token = adminPushTokenRef.current;
            if (token) {
              webRef.current?.injectJavaScript(
                `window.dispatchEvent(new CustomEvent("herlink-admin-push-token",{detail:${JSON.stringify({ token })}})); true;`
              );
            }
            if (pendingMailboxOpenRef.current) {
              pendingMailboxOpenRef.current = false;
              webRef.current?.injectJavaScript('window.location.href = "/admin/mailbox"; true;');
            }
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

        {mailboxAlert ? (
          <View style={styles.mailboxBanner}>
            <Pressable style={styles.mailboxBannerBody} onPress={openMailbox}>
              <View style={styles.mailboxBannerCopy}>
                <Text style={styles.mailboxBannerTitle}>收到新的站長信箱</Text>
                <Text style={styles.mailboxBannerText} numberOfLines={1}>
                  {mailboxAlert.subject ?? `目前有 ${mailboxAlert.count} 封未讀信件`}
                </Text>
              </View>
              <Text style={styles.mailboxBannerAction}>查看</Text>
            </Pressable>
            <Pressable style={styles.mailboxBannerClose} onPress={() => setMailboxAlert(null)}>
              <Text style={styles.mailboxBannerCloseText}>×</Text>
            </Pressable>
          </View>
        ) : null}

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
  mailboxBanner: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    zIndex: 30,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,111,97,0.45)",
    backgroundColor: "#1b1627",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  mailboxBannerBody: {
    flex: 1,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mailboxBannerCopy: { flex: 1, minWidth: 0 },
  mailboxBannerTitle: { color: "#f6f1ff", fontSize: 15, fontWeight: "800" },
  mailboxBannerText: { marginTop: 3, color: "#b7aecb", fontSize: 12 },
  mailboxBannerAction: { color: "#ff8a7d", fontSize: 13, fontWeight: "800" },
  mailboxBannerClose: { paddingHorizontal: 14, alignSelf: "stretch", justifyContent: "center" },
  mailboxBannerCloseText: { color: "#b7aecb", fontSize: 24, lineHeight: 26 },
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



