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
import { REPORT_CATEGORIES } from "../lib/social";
import { ReportCategory } from "../lib/supabase";

interface ReportModalProps {
  visible: boolean;
  targetName: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { category: ReportCategory; description: string }) => Promise<void>;
}

export function ReportModal({
  visible,
  targetName,
  submitting,
  onClose,
  onSubmit,
}: ReportModalProps) {
  const [category, setCategory] = useState<ReportCategory>("scam");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!visible) {
      setCategory("scam");
      setDescription("");
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>安全檢舉</Text>
          <Text style={styles.title}>檢舉 {targetName}</Text>
          <Text style={styles.body}>妳送出的檢舉只會讓安全流程查看，被檢舉者不會知道是誰送出的。</Text>

          <ScrollView style={styles.options} contentContainerStyle={styles.optionsContent}>
            {REPORT_CATEGORIES.map((option) => {
              const selected = category === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setCategory(option.value)}
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
            placeholder="補充描述（選填）"
            value={description}
            onChangeText={setDescription}
            editable={!submitting}
            multiline
          />

          <Pressable
            style={[styles.primaryButton, submitting && styles.disabledButton]}
            disabled={submitting}
            onPress={() => void onSubmit({ category, description })}
          >
            <Text style={styles.primaryButtonText}>{submitting ? "送出中..." : "送出檢舉"}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} disabled={submitting} onPress={onClose}>
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
    backgroundColor: "rgba(39, 22, 18, 0.42)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#ead9cd",
    padding: 20,
    maxHeight: "88%",
  },
  eyebrow: {
    fontSize: 13,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#c26d52",
  },
  title: {
    marginTop: 8,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    color: "#2f221e",
  },
  body: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 23,
    color: "#5f5048",
  },
  options: {
    marginTop: 18,
    maxHeight: 240,
  },
  optionsContent: {
    gap: 10,
  },
  option: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ead9cd",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#f8f1ea",
  },
  optionSelected: {
    borderColor: "#ca6b4f",
    backgroundColor: "#ffe1d4",
  },
  optionText: {
    fontSize: 15,
    color: "#5f5048",
    fontWeight: "600",
  },
  optionTextSelected: {
    color: "#8b4f3b",
  },
  input: {
    minHeight: 92,
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: "#f4efe8",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#2f221e",
    textAlignVertical: "top",
  },
  primaryButton: {
    marginTop: 18,
    borderRadius: 18,
    backgroundColor: "#ca6b4f",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#fff8f1",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 18,
    backgroundColor: "#efe3d8",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#6a554b",
    fontSize: 16,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
});
