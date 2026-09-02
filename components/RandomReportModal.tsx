import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  RANDOM_REPORT_CATEGORY_OPTIONS,
  RandomReportCategory,
} from "../lib/random-chat";
import { colors, radii, spacing, typography } from "../theme";

type RandomReportModalProps = {
  visible: boolean;
  partnerName: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { category: RandomReportCategory; description: string }) => Promise<void>;
};

export function RandomReportModal({
  visible,
  partnerName,
  submitting,
  onClose,
  onSubmit,
}: RandomReportModalProps) {
  const [category, setCategory] = useState<RandomReportCategory>("harassment");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!visible) {
      setCategory("harassment");
      setDescription("");
    }
  }, [visible]);

  const canSubmit = !submitting && description.length <= 500;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>安全檢舉</Text>
          <Text style={styles.title}>檢舉 {partnerName}</Text>
          <Text style={styles.body}>
            只會讓安全流程查看。送出後也可以選擇封鎖對方，對方不會知道是誰檢舉的。
          </Text>

          <ScrollView style={styles.options} contentContainerStyle={styles.optionsContent}>
            {RANDOM_REPORT_CATEGORY_OPTIONS.map((option) => {
              const selected = category === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setCategory(option.value)}
                  disabled={submitting}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            style={styles.input}
            placeholder="補充描述（選填，500 字內）"
            placeholderTextColor={colors.textSoft}
            value={description}
            onChangeText={setDescription}
            editable={!submitting}
            multiline
            maxLength={500}
          />

          <Pressable
            style={[styles.primaryButton, !canSubmit && styles.disabledButton]}
            disabled={!canSubmit}
            onPress={() => void onSubmit({ category, description })}
          >
            <Text style={styles.primaryButtonText}>
              {submitting ? "送出中..." : "送出檢舉"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            disabled={submitting}
            onPress={onClose}
          >
            <Text style={styles.secondaryButtonText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.xl,
    maxHeight: "88%",
  },
  eyebrow: {
    color: colors.primary,
    ...typography.eyebrow,
  },
  title: {
    marginTop: spacing.sm,
    color: colors.text,
    ...typography.sectionTitle,
  },
  body: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    ...typography.body,
  },
  options: {
    marginTop: spacing.lg,
    maxHeight: 260,
  },
  optionsContent: {
    gap: spacing.sm,
  },
  option: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryPressed,
  },
  optionText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  optionTextSelected: {
    color: colors.text,
  },
  input: {
    minHeight: 88,
    marginTop: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    textAlignVertical: "top",
    ...typography.body,
  },
  primaryButton: {
    marginTop: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.primaryText,
    ...typography.bodyStrong,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    color: colors.textMuted,
    ...typography.bodyStrong,
  },
  disabledButton: {
    opacity: 0.6,
  },
});
