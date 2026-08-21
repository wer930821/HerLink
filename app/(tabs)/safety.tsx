import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/auth";
import { fetchLatestVerification } from "../../lib/media";
import {
  fetchMyReports,
  formatDateTime,
  getErrorMessage,
  getSafetyLevel,
  getVerificationLabel,
} from "../../lib/social";
import { Verification } from "../../lib/supabase";

function ReportAvatar({ name, photoUrl }: { name: string | null | undefined; photoUrl: string | null }) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={styles.reportAvatarImage} resizeMode="cover" />;
  }

  return (
    <View style={styles.reportAvatarFallback}>
      <Text style={styles.reportAvatarText}>{(name?.slice(0, 1) || "她").toUpperCase()}</Text>
    </View>
  );
}

export default function SafetyScreen() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportItems, setReportItems] = useState<Awaited<ReturnType<typeof fetchMyReports>>>([]);
  const [verification, setVerification] = useState<Verification | null>(null);

  const loadData = useCallback(async (showRefreshing = false) => {
    if (!user?.id) {
      return;
    }

    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const [reports, latestVerification] = await Promise.all([
        fetchMyReports(),
        fetchLatestVerification(),
      ]);
      setReportItems(reports);
      setVerification(latestVerification);
    } catch (loadFailure) {
      setError(getErrorMessage(loadFailure, "無法載入安全資料。"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading || !user?.id) {
      return;
    }

    void loadData();
  }, [authLoading, user?.id, loadData]);

  if (loading || authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#ca6b4f" />
        <Text style={styles.statusText}>整理安全資料中...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={() => void loadData(true)}>
          <Text style={styles.retryButtonText}>重新載入</Text>
        </Pressable>
      </View>
    );
  }

  const safetyLevel = getSafetyLevel(profile?.trust_score ?? 50);
  const verificationLabel = getVerificationLabel(verification, profile?.verified ?? false);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
    >
      <Text style={styles.eyebrow}>Safety Core</Text>
      <Text style={styles.title}>把安全感做成產品的一部分，而不是事後補救。</Text>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>我的安全狀態</Text>
        <Text style={styles.heroTitle}>{safetyLevel.title}</Text>
        <Text style={styles.heroBody}>{safetyLevel.description}</Text>
        <Text style={styles.heroHint}>
          系統不會對一般使用者顯示信任分數數值，但會在需要時調整保護與審核流程。
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>真人驗證</Text>
        <Text style={styles.sectionSubtitle}>驗證素材走私有審核流程，不會直接變成公開頭像。</Text>
        <View style={styles.verificationCard}>
          <Text style={styles.verificationTitle}>{verificationLabel}</Text>
          <Text style={styles.verificationBody}>
            {verification?.rejection_reason
              ? `最近一次審核說明：${verification.rejection_reason}`
              : "通過後會接上 verified badge；審核中的原始素材不會公開給其他使用者。"}
          </Text>
          <Pressable style={styles.profileButton} onPress={() => router.push("/(tabs)/profile")}>
            <Text style={styles.profileButtonText}>前往我的資料送出驗證</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>我送出的檢舉</Text>
        <Text style={styles.sectionSubtitle}>妳可以追蹤自己送出的檢舉狀態，但不會看到內部審查資訊。</Text>

        {reportItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>目前還沒有送出檢舉。</Text>
            <Text style={styles.emptyBody}>若遇到不舒服或可疑行為，可以在聊天或探索頁直接發起檢舉。</Text>
          </View>
        ) : (
          reportItems.map(({ report, profile: targetProfile, primaryPhotoUrl }) => (
            <View key={report.id} style={styles.reportCard}>
              <View style={styles.reportHeader}>
                <ReportAvatar
                  name={targetProfile?.display_name}
                  photoUrl={primaryPhotoUrl}
                />
                <View style={styles.reportHeaderBody}>
                  <Text style={styles.reportTitle}>{targetProfile?.display_name || "對象目前不可見"}</Text>
                  <Text style={styles.reportMeta}>類型：{report.category}</Text>
                  <Text style={styles.reportMeta}>狀態：{report.status}</Text>
                  <Text style={styles.reportMeta}>送出時間：{formatDateTime(report.created_at)}</Text>
                </View>
              </View>
              {report.description ? <Text style={styles.reportBody}>{report.description}</Text> : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>安全提醒說明</Text>
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>金錢與投資要求</Text>
          <Text style={styles.tipBody}>若對方很快要求匯款、轉帳、投資或帶妳到外部平台，請先停一下。</Text>
        </View>
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>不要提供 OTP 或驗證碼</Text>
          <Text style={styles.tipBody}>任何要求妳交出 OTP、驗證碼或密碼的訊息，都應視為高風險。</Text>
        </View>
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>需要時直接封鎖或檢舉</Text>
          <Text style={styles.tipBody}>封鎖會立即終止互動；檢舉會進入安全流程，但不會暴露妳的身分。</Text>
        </View>
      </View>

      <Pressable style={styles.profileButton} onPress={() => router.push("/(tabs)/profile")}>
        <Text style={styles.profileButtonText}>回到我的資料</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4efe8",
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f4efe8",
    padding: 24,
  },
  statusText: {
    marginTop: 12,
    fontSize: 16,
    color: "#6e625a",
  },
  eyebrow: {
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#9f745f",
    marginBottom: 10,
  },
  title: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "700",
    color: "#2d211d",
  },
  heroCard: {
    marginTop: 22,
    borderRadius: 24,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 20,
  },
  heroLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#a46c55",
  },
  heroTitle: {
    marginTop: 8,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    color: "#2d211d",
  },
  heroBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 24,
    color: "#5f5048",
  },
  heroHint: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 20,
    color: "#88766c",
  },
  verificationCard: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 18,
  },
  verificationTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#2f221e",
  },
  verificationBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 23,
    color: "#5f5048",
  },
  section: {
    marginTop: 26,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#2f221e",
  },
  sectionSubtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: "#6d625a",
  },
  emptyCard: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#e8dace",
    padding: 18,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#40312a",
  },
  emptyBody: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 23,
    color: "#6a5b54",
  },
  reportCard: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 18,
  },
  reportHeader: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  reportHeaderBody: {
    flex: 1,
  },
  reportAvatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#f0e3d8",
  },
  reportAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#f6c7b0",
    alignItems: "center",
    justifyContent: "center",
  },
  reportAvatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#704633",
  },
  reportTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2f221e",
  },
  reportMeta: {
    marginTop: 6,
    fontSize: 14,
    color: "#7b685f",
  },
  reportBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#574841",
  },
  tipCard: {
    marginTop: 14,
    borderRadius: 20,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 18,
  },
  tipTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#40312a",
  },
  tipBody: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 23,
    color: "#6a5b54",
  },
  profileButton: {
    marginTop: 26,
    borderRadius: 18,
    backgroundColor: "#ca6b4f",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  profileButtonText: {
    color: "#fff8f1",
    fontSize: 16,
    fontWeight: "700",
  },
  errorText: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    color: "#8d3f38",
  },
  retryButton: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: "#ca6b4f",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: "#fff8f1",
    fontSize: 15,
    fontWeight: "700",
  },
});
