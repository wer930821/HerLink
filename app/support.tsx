import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors, radii, spacing, typography } from "../theme";

// Mirrors the web support page (apps/web/app/support/page.tsx).
const AMOUNTS = [50, 100, 300, 500];

const BANK_INFO = {
  bank: "臺灣企銀",
  bankCode: "050",
  branch: "台中分行",
  account: "49064610863",
  holder: "賴加雯",
};

export default function SupportScreen() {
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [copied, setCopied] = useState(false);

  const finalAmount = customAmount ? Number(customAmount) : amount;
  const hasAmount = finalAmount !== null && !!finalAmount && finalAmount > 0;

  const copyAccount = async () => {
    await Clipboard.setStringAsync(BANK_INFO.account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoid} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>支持 HerLink</Text>
      <Text style={styles.copy}>
        HerLink 是免費的，由站長一個人維護。伺服器、資料庫這些每個月都要錢。如果你覺得好用，歡迎隨喜支持——多少都好，心意最重要。
      </Text>

      <Text style={styles.sectionTitle}>選擇金額</Text>
      <View style={styles.amountGrid}>
        {AMOUNTS.map((a) => {
          const selected = amount === a && !customAmount;
          return (
            <Pressable
              key={a}
              accessibilityRole="button"
              accessibilityLabel={`NT$ ${a}`}
              style={[styles.amountButton, selected && styles.amountButtonSelected]}
              onPress={() => {
                setAmount(a);
                setCustomAmount("");
                setShowInfo(false);
              }}
            >
              <Text style={styles.amountText}>NT$ {a}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        value={customAmount}
        onChangeText={(value) => {
          setCustomAmount(value.replace(/[^0-9]/g, ""));
          setAmount(null);
          setShowInfo(false);
        }}
        keyboardType="number-pad"
        placeholder="自訂金額"
        placeholderTextColor={colors.textSoft}
      />

      {hasAmount ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`贊助 NT$ ${finalAmount}`}
          style={styles.primaryButton}
          onPress={() => setShowInfo(true)}
        >
          <Text style={styles.primaryButtonText}>贊助 NT$ {finalAmount}</Text>
        </Pressable>
      ) : null}

      {showInfo && hasAmount ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>轉帳資訊（NT$ {finalAmount}）</Text>

          <Text style={styles.fieldLabel}>銀行</Text>
          <Text style={styles.fieldValue}>
            {BANK_INFO.bank}（{BANK_INFO.bankCode}）{BANK_INFO.branch}
          </Text>

          <Text style={styles.fieldLabel}>帳號</Text>
          <View style={styles.accountRow}>
            <Text selectable style={styles.accountText}>
              {BANK_INFO.account}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="複製帳號" style={styles.copyButton} onPress={() => void copyAccount()}>
              <Text style={styles.copyButtonText}>{copied ? "已複製 ✓" : "複製"}</Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>戶名</Text>
          <Text style={styles.fieldValue}>{BANK_INFO.holder}</Text>

          <Text style={styles.note}>請用銀行 App 轉帳 NT$ {finalAmount} 到以上帳戶。轉帳後不用特別通知，真的很謝謝你 🙏</Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          ※ 贊助是自願的，不影響任何功能。{"\n"}※ 贊助款用於支付 Supabase、Vercel 等營運費用。{"\n"}※ 如有問題請透過站長信箱聯繫。
        </Text>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  title: {
    color: colors.text,
    ...typography.title,
    marginBottom: spacing.md,
  },
  copy: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 24,
  },
  sectionTitle: {
    color: colors.text,
    ...typography.cardTitle,
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  amountGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  amountButton: {
    flexBasis: "47%",
    flexGrow: 1,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  amountButtonSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  amountText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  input: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  primaryButton: {
    marginTop: spacing.xl,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.primaryText,
    fontSize: 17,
    fontWeight: "800",
  },
  card: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.text,
    ...typography.cardTitle,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    color: colors.textSoft,
    ...typography.caption,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  fieldValue: {
    color: colors.text,
    fontSize: 16,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  accountText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 1,
  },
  copyButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  copyButtonText: {
    color: colors.text,
    ...typography.caption,
  },
  note: {
    color: colors.textMuted,
    ...typography.caption,
    marginTop: spacing.lg,
  },
  footer: {
    marginTop: spacing.xxl,
    padding: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
  },
  footerText: {
    color: colors.textSoft,
    ...typography.caption,
  },
});
