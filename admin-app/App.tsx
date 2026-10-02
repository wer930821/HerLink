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

        if (latestCode > currentCode && info.apkUrl) {
          Alert.alert(
            "發現新版後台",
            `目前版本：${Constants.expoConfig?.version ?? "目前版本"}\n最新版本：${info.versionName ?? latestCode}\n\n要現在更新嗎？`,
            [
              { text: "稍後", style: "cancel" },
              {
                text: "更新",
                onPress: () => {
                  void Linking.openURL(info.apkUrl!);
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" backgroundColor="#0d0b16" />

      <View style={[styles.webWrap, !webReady && styles.webWrapLoading]}>
        <WebView
          key={webKey}
          ref={webRef}
          source={{ uri: ADMIN_URL }}
          style={styles.web}
          originWhitelist={["https://*", "http://*"]}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled={false}
          setSupportMultipleWindows={false}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          startInLoadingState={false}
          onNavigationStateChange={handleNavigation}
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

        {loading && !webReady ? (
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
