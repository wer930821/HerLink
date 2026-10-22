import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";
import { HalloweenDecor } from "../../components/HalloweenDecor";
import { useAuth } from "../../context/auth";

const safetyTips = [
  ["金錢與投資要求", "匿名聊天中若有人要求匯款、轉帳、投資或代購，請直接提高警覺。"],
  ["不要提供驗證碼", "不要提供一次性驗證碼、密碼、銀行資料或可用來登入帳號的驗證碼。"],
  ["外部連結", "開啟陌生連結前先確認網址；可疑網站不要輸入帳號或付款資料。"],
  ["封鎖與檢舉", "在匿名聊天室內可直接封鎖或檢舉對方，封鎖後該段對話會結束。"],
];

const settings = [
  { label: "永久恢復碼", detail: "保留匿名身分與聊天室", path: "/recovery", icon: "key-outline" },
  { label: "帳號登入／綁定", detail: "保護目前匿名資料", path: "/account-login", icon: "person-circle-outline" },
  { label: "站長支援", detail: "聯絡 HerLink 管理員", path: "/support", icon: "mail-outline" },
  { label: "隱私權政策", detail: "資料與權限說明", path: "/privacy", icon: "shield-outline" },
  { label: "使用條款", detail: "使用規範與責任", path: "/terms", icon: "document-text-outline" },
];

export default function SafetyScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <View style={styles.root}>
      <HalloweenDecor topOffset={0} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>HerLink 設定中心</Text>
        <Text style={styles.title}>安全與設定</Text>
        <Text style={styles.subtitle}>管理匿名身分、恢復方式與使用安全。</Text>

        <Text style={styles.sectionTitle}>帳號與支援</Text>
        <View style={styles.list}>
          {settings.map((item) => (
            <Pressable key={item.path} style={styles.row} onPress={() => router.push(item.path as never)}>
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon as never} size={21} color={colors.accent} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.rowDetail}>{item.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.textSoft} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>匿名聊天安全</Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>匿名不等於沒有風險</Text>
          <Text style={styles.noticeBody}>不要因為沒有公開真實資料就降低警覺。遇到要求金錢、個資或移往可疑平台的情況，直接離開。</Text>
        </View>
        {safetyTips.map(([title, body]) => (
          <View key={title} style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardBody}>{body}</Text>
          </View>
        ))}

        <Pressable style={styles.signOut} onPress={() => void signOut()}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.signOutText}>登出</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  content: { padding: spacing.xl, paddingTop: spacing.xxxl + 12, paddingBottom: 120 },
  eyebrow: { color: colors.accent, ...typography.eyebrow },
  title: { marginTop: spacing.sm, color: colors.text, ...typography.title },
  subtitle: { marginTop: spacing.md, color: colors.textMuted, ...typography.body },
  sectionTitle: { marginTop: spacing.xxl, marginBottom: spacing.md, color: colors.text, ...typography.cardTitle },
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.text, ...typography.bodyStrong },
  rowDetail: { marginTop: 2, color: colors.textSoft, ...typography.caption },
  notice: { padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.borderStrong },
  noticeTitle: { color: colors.text, ...typography.cardTitle },
  noticeBody: { marginTop: spacing.sm, color: colors.textMuted, ...typography.body },
  card: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.text, ...typography.cardTitle },
  cardBody: { marginTop: spacing.sm, color: colors.textMuted, ...typography.body },
  signOut: { marginTop: spacing.xxl, minHeight: 52, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.error, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  signOutText: { color: colors.error, ...typography.bodyStrong },
});
