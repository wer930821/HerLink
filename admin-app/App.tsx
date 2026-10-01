import { useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

const ADMIN_URL = "https://her-link-kivora3.vercel.app/admin";
const ALLOWED_HOST = "her-link-kivora3.vercel.app";

export default function App() {
  const webRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const handleNavigation = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  };

  const reload = () => {
    setFailed(false);
    setLoading(true);
    webRef.current?.reload();
  };

  const goHome = () => {
    setFailed(false);
    setLoading(true);
    webRef.current?.injectJavaScript(
      `window.location.href = "${ADMIN_URL}"; true;`
    );
  };

  useState(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" backgroundColor="#0d0b16" />

      <View style={styles.topbar}>
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
          ref={webRef}
          source={{ uri: ADMIN_URL }}
          style={styles.web}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
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
            if (nativeEvent.statusCode >= 500) {
              setFailed(true);
            }
          }}
          onShouldStartLoadWithRequest={(request) => {
            try {
              const url = new URL(request.url);
              return url.host === ALLOWED_HOST;
            } catch {
              return false;
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0d0b16",
  },
  topbar: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
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
