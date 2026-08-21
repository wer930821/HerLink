import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../context/auth";
import {
  createAdminSignedUrl,
  fetchAdminDashboardCounts,
  fetchModerationCases,
  fetchMyAdminUser,
  fetchPendingPhotos,
  fetchPendingReports,
  fetchPendingVerifications,
  fetchProfilesByIds,
  moderateAccount,
  reviewCase,
  reviewProfilePhoto,
  reviewReport,
  reviewVerification,
  takeCase,
} from "../lib/moderation";
import { getErrorMessage } from "../lib/social";
import { ModerationCase, ProfilePhoto, Report, Verification } from "../lib/supabase";

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

export default function AdminScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<Awaited<ReturnType<typeof fetchMyAdminUser>>>(null);
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof fetchAdminDashboardCounts>> | null>(null);
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [profileMap, setProfileMap] = useState<Map<string, any>>(new Map());

  const loadData = useCallback(
    async (showRefreshing = false) => {
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
        const [adminRow, dashboardCounts, caseList, verificationList, photoList, reportList] = await Promise.all([
          fetchMyAdminUser(),
          fetchAdminDashboardCounts(),
          fetchModerationCases(),
          fetchPendingVerifications(),
          fetchPendingPhotos(),
          fetchPendingReports(),
        ]);

        setAdminUser(adminRow);
        setDashboard(dashboardCounts);
        setCases(caseList);
        setVerifications(verificationList);
        setPhotos(photoList);
        setReports(reportList);

        const subjectIds = [
          ...caseList.map((item) => item.subject_user_id),
          ...verificationList.map((item) => item.user_id),
          ...photoList.map((item) => item.user_id),
          ...reportList.map((item) => item.reported_user_id),
        ];
        setProfileMap(await fetchProfilesByIds(subjectIds));
      } catch (loadFailure) {
        setError(getErrorMessage(loadFailure, "無法載入 moderation admin。"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    if (authLoading || !user?.id) {
      return;
    }

    void loadData();
  }, [authLoading, user?.id, loadData]);

  const activeAdmin = adminUser?.active ? adminUser : null;
  const adminDenied = !loading && !activeAdmin;

  const summaryCards = useMemo(
    () =>
      dashboard
        ? [
            { label: "Pending Cases", value: dashboard.pendingCases },
            { label: "Pending Verification", value: dashboard.pendingVerification },
            { label: "Pending Reports", value: dashboard.pendingReports },
            { label: "Photos Under Review", value: dashboard.photosUnderReview },
          ]
        : [],
    [dashboard]
  );

  const runAction = async (key: string, task: () => Promise<void>) => {
    setBusyKey(key);

    try {
      await task();
      await loadData(true);
    } catch (actionFailure) {
      Alert.alert("操作失敗", getErrorMessage(actionFailure, "這個 moderation 操作沒有成功。"));
    } finally {
      setBusyKey(null);
    }
  };

  const openSignedUrl = async (bucket: "verification-private" | "profile-photos", path: string) => {
    try {
      const url = await createAdminSignedUrl(bucket, path);
      await Linking.openURL(url);
    } catch (failure) {
      Alert.alert("開啟失敗", getErrorMessage(failure, "無法建立短效檢視連結。"));
    }
  };

  if (loading || authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#ca6b4f" />
        <Text style={styles.statusText}>載入 moderation admin 中...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.primaryButton} onPress={() => void loadData(true)}>
          <Text style={styles.primaryButtonText}>重新載入</Text>
        </Pressable>
      </View>
    );
  }

  if (adminDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>這個管理頁只開放 active admin 使用。</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace("/(tabs)/profile")}>
          <Text style={styles.primaryButtonText}>回到我的資料</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
    >
      <Text style={styles.eyebrow}>HerLink Moderation Admin</Text>
      <Text style={styles.title}>只處理信任、安全與社群資格審核，不讓一般 client 碰到內部案件資料。</Text>
      <Text style={styles.subtitle}>目前角色：{activeAdmin?.role || "unknown"}</Text>

      <View style={styles.summaryGrid}>
        {summaryCards.map((item) => (
          <View key={item.label} style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{item.value}</Text>
            <Text style={styles.summaryLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      <SectionTitle title="Cases" subtitle="案件列表可做接手、帳號限制，以及 resolve / dismiss。" />
      {cases.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>目前沒有 pending / reviewing cases。</Text>
        </View>
      ) : (
        cases.map((item) => {
          const subject = profileMap.get(item.subject_user_id);
          return (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {subject?.display_name || "Unknown user"} ・ {item.case_type}
              </Text>
              <Text style={styles.cardMeta}>
                {item.priority} ・ {item.status} ・ {subject?.account_status || "unknown"}
              </Text>
              <Text style={styles.cardBody}>
                trust_score: {subject?.trust_score ?? "?"} ・ city: {subject?.city || "未填寫"}
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`take-${item.id}`, async () => {
                    await takeCase(item.id);
                  })}
                  disabled={busyKey === `take-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>接手</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`review-${item.id}`, async () => {
                    await moderateAccount(item.subject_user_id, "under_review", "Admin moderation review");
                  })}
                  disabled={busyKey === `review-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>設 under review</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`suspend-${item.id}`, async () => {
                    await moderateAccount(item.subject_user_id, "suspend", "Moderation suspension");
                  })}
                  disabled={busyKey === `suspend-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Suspend</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`restore-${item.id}`, async () => {
                    await moderateAccount(item.subject_user_id, "restore", "Moderation restore");
                  })}
                  disabled={busyKey === `restore-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Restore</Text>
                </Pressable>
              </View>
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.primaryButtonInline}
                  onPress={() => void runAction(`resolve-case-${item.id}`, async () => {
                    await reviewCase(item.id, "resolved", "Case resolved in admin web");
                  })}
                  disabled={busyKey === `resolve-case-${item.id}`}
                >
                  <Text style={styles.primaryButtonText}>Resolve</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`dismiss-case-${item.id}`, async () => {
                    await reviewCase(item.id, "dismissed", "Case dismissed in admin web");
                  })}
                  disabled={busyKey === `dismiss-case-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}

      <SectionTitle title="Verification" subtitle="短時效 signed URL + approve / reject / manual review。" />
      {verifications.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>目前沒有待審 verification。</Text>
        </View>
      ) : (
        verifications.map((item) => {
          const subject = profileMap.get(item.user_id);
          return (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{subject?.display_name || "Unknown user"} ・ {item.status}</Text>
              <Text style={styles.cardMeta}>{item.method}</Text>
              <View style={styles.actionRow}>
                {item.media_path ? (
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => void openSignedUrl("verification-private", item.media_path!)}
                  >
                    <Text style={styles.secondaryButtonText}>開啟媒體</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.primaryButtonInline}
                  onPress={() => void runAction(`verify-${item.id}`, async () => {
                    await reviewVerification(item.id, "verified", "Verified in admin web");
                  })}
                  disabled={busyKey === `verify-${item.id}`}
                >
                  <Text style={styles.primaryButtonText}>Approve</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`reject-verification-${item.id}`, async () => {
                    await reviewVerification(item.id, "rejected", "Rejected in admin web");
                  })}
                  disabled={busyKey === `reject-verification-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Reject</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`manual-${item.id}`, async () => {
                    await reviewVerification(item.id, "manual_review", "Needs manual review");
                  })}
                  disabled={busyKey === `manual-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Manual review</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}

      <SectionTitle title="Photo" subtitle="只處理 pending / under_review 照片，審核後立即影響公開可見性。" />
      {photos.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>目前沒有待審照片。</Text>
        </View>
      ) : (
        photos.map((item) => {
          const subject = profileMap.get(item.user_id);
          return (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {subject?.display_name || "Unknown user"} ・ {item.moderation_status}
              </Text>
              <Text style={styles.cardMeta}>primary: {item.is_primary ? "yes" : "no"}</Text>
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void openSignedUrl("profile-photos", item.storage_path)}
                >
                  <Text style={styles.secondaryButtonText}>開啟照片</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryButtonInline}
                  onPress={() => void runAction(`approve-photo-${item.id}`, async () => {
                    await reviewProfilePhoto(item.id, "approved", "Approved in admin web");
                  })}
                  disabled={busyKey === `approve-photo-${item.id}`}
                >
                  <Text style={styles.primaryButtonText}>Approve</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`reject-photo-${item.id}`, async () => {
                    await reviewProfilePhoto(item.id, "rejected", "Rejected in admin web");
                  })}
                  disabled={busyKey === `reject-photo-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Reject</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`under-review-photo-${item.id}`, async () => {
                    await reviewProfilePhoto(item.id, "under_review", "Further review required");
                  })}
                  disabled={busyKey === `under-review-photo-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Under review</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}

      <SectionTitle title="Reports" subtitle="resolve 會進 risk / case flow，dismiss 不扣 trust score。" />
      {reports.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>目前沒有待審 reports。</Text>
        </View>
      ) : (
        reports.map((item) => {
          const subject = profileMap.get(item.reported_user_id);
          return (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {subject?.display_name || "Unknown user"} ・ {item.category}
              </Text>
              <Text style={styles.cardMeta}>{item.status}</Text>
              {item.description ? <Text style={styles.cardBody}>{item.description}</Text> : null}
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.primaryButtonInline}
                  onPress={() => void runAction(`resolve-report-${item.id}`, async () => {
                    await reviewReport(item.id, "resolved", "Resolved in admin web");
                  })}
                  disabled={busyKey === `resolve-report-${item.id}`}
                >
                  <Text style={styles.primaryButtonText}>Resolve</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void runAction(`dismiss-report-${item.id}`, async () => {
                    await reviewReport(item.id, "dismissed", "Dismissed in admin web");
                  })}
                  disabled={busyKey === `dismiss-report-${item.id}`}
                >
                  <Text style={styles.secondaryButtonText}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3eee7",
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 48,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3eee7",
    padding: 24,
  },
  eyebrow: {
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#8d624f",
  },
  title: {
    marginTop: 10,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
    color: "#2b211d",
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#6d625a",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 22,
  },
  summaryCard: {
    width: 180,
    borderRadius: 20,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 18,
  },
  summaryValue: {
    fontSize: 30,
    fontWeight: "700",
    color: "#2f221e",
  },
  summaryLabel: {
    marginTop: 8,
    fontSize: 14,
    color: "#7a685e",
  },
  sectionHeader: {
    marginTop: 30,
  },
  sectionTitle: {
    fontSize: 24,
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
    borderRadius: 20,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 18,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#40312a",
  },
  card: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 18,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2f221e",
  },
  cardMeta: {
    marginTop: 6,
    fontSize: 14,
    color: "#846f63",
  },
  cardBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#584a42",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  primaryButton: {
    marginTop: 18,
    borderRadius: 16,
    backgroundColor: "#ca6b4f",
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  primaryButtonInline: {
    borderRadius: 14,
    backgroundColor: "#ca6b4f",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: "#fff8f1",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 14,
    backgroundColor: "#efe3d8",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#6a554b",
    fontSize: 14,
    fontWeight: "700",
  },
  statusText: {
    marginTop: 12,
    fontSize: 16,
    color: "#6e625a",
  },
  errorText: {
    fontSize: 16,
    lineHeight: 24,
    color: "#8d3f38",
    textAlign: "center",
  },
});
