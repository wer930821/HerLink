import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";

const tips = [
  ["金錢與投資要求", "匿名聊天中若有人要求匯款、轉帳、投資或代購，請直接提高警覺。"],
  ["不要提供驗證碼", "不要提供 OTP、密碼、銀行資料、信用卡資訊或可用來登入帳號的驗證碼。"],
  ["外部連結", "開啟陌生連結前先確認網址；可疑網站不要輸入任何帳號或付款資料。"],
  ["封鎖與檢舉", "在匿名聊天室內可直接封鎖或檢舉對方。封鎖後該段匿名對話會結束。"],
];

export default function SafetyScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>HerLink Safety</Text>
      <Text style={styles.title}>匿名聊天安全</Text>
      <Text style={styles.subtitle}>HerLink 現在只保留匿名隨機配對與匿名聊天室。</Text>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>匿名不等於沒有風險</Text>
        <Text style={styles.noticeBody}>
          不要因為沒有公開真實資料就降低警覺。遇到要求金錢、個資或移往可疑平台的情況，直接離開。
        </Text>
      </View>

      {tips.map(([title, body]) => (
        <View key={title} style={styles.card}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardBody}>{body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    color: colors.primary,
    ...typography.eyebrow,
  },
  title: {
    marginTop: spacing.sm,
    color: colors.text,
    ...typography.title,
  },
  subtitle: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  notice: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceStrong,
  },
  noticeTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  noticeBody: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    ...typography.body,
  },
  card: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.text,
    ...typography.cardTitle,
  },
  cardBody: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    ...typography.body,
  },
});
