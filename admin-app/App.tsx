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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const lastBackPressRef = useRef(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [webKey, setWebKey] = useState(0);

  const handleNavigation = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  };

  const reload = () => {
    setFailed(false);
    setLoading(true);
    setWebKey((value) => value + 1);
  };

  const goHome = () => {
    setFailed(false);
    setLoading(true);
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

      <View style={[styles.topbar, { paddingTop: Math.max(insets.top, 10) }]}>
        <View>
          <Text style={styles.brand}>HerLink 後台</Text>
          <Text style={styles.subtitle}>管理中心</Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.actionButton} onPress={goHome}>
            <Text style={styles.actionText}>總覽</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={reload}>
            <Text style={styles.actionText}>重新整理</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.webWrap}>
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
            setLoading(true);
            setFailed(false);
          }}
          onLoadEnd={() => setLoading(false)}
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

        {loading ? (
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
  topbar: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#14111f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  brand: {
    color: "#f7f3ff",
    fontSize: 18,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 2,
    color: "#9e96ad",
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#201c2e",
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    color: "#f7f3ff",
    fontSize: 13,
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
    padding: 24,
    backgroundColor: "#0d0b16",
  },
  loadingText: {
    color: "#a9a1b6",
    fontSize: 14,
  },
  errorTitle: {
    color: "#f7f3ff",
    fontSize: 18,
    fontWeight: "800",
  },
  errorBody: {
    color: "#a9a1b6",
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: "#ff6f61",
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: "#1b1010",
    fontWeight: "800",
    fontSize: 15,
  },
});
