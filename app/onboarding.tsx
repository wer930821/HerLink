import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert, ScrollView } from "react-native";
import { useAuth } from "../context/auth";
import { supabase } from "../lib/supabase";
import { useRouter } from "expo-router";

const relationshipGoalsOptions = ["長期關係", "短期關係", "交朋友", "不確定"];
const interestsOptions = ["閱讀", "電影", "運動", "美食", "旅行", "音樂", "藝術", "戶外"];

export default function OnboardingScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [birthday, setBirthday] = useState(profile?.birthday || "");
  const [city, setCity] = useState(profile?.city || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [orientation, setOrientation] = useState(profile?.orientation || "");
  const [identityLabel, setIdentityLabel] = useState(profile?.identity_label || "");
  const [selectedRelationshipGoals, setSelectedRelationshipGoals] = useState<string[]>(profile?.relationship_goals || []);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile?.interests || []);
  const [loading, setLoading] = useState(false);

  const handleSelectGoal = (goal: string) => {
    setSelectedRelationshipGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  };

  const handleSelectInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const saveProfile = async () => {
    if (!user) {
      Alert.alert("錯誤", "用戶未登入。");
      return;
    }

    setLoading(true);
    
    const updates: any = {
      id: user.id,
      display_name: displayName,
      birthday,
      city,
      bio,
      orientation,
      identity_label: identityLabel,
      relationship_goals: selectedRelationshipGoals,
      interests: selectedInterests,
      onboarding_completed: true,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("profiles").upsert(updates);

    if (error) {
      Alert.alert("儲存失敗", error.message);
      console.error(error);
    } else {
      Alert.alert("成功", "個人資料已儲存！");
      await refreshProfile();
      router.replace("/(tabs)");
    }
    setLoading(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>完善您的個人資料</Text>

      <Text style={styles.label}>顯示名稱</Text>
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="您的稱呼" />

      <Text style={styles.label}>生日 (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={birthday} onChangeText={setBirthday} placeholder="例如: 1990-01-01" />

      <Text style={styles.label}>城市</Text>
      <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="您所在的城市" />

      <Text style={styles.label}>關於我</Text>
      <TextInput style={styles.input} value={bio} onChangeText={setBio} placeholder="簡單介紹自己" multiline />

      <Text style={styles.label}>性向</Text>
      <TextInput style={styles.input} value={orientation} onChangeText={setOrientation} placeholder="例如: 女同志, 雙性戀" />

      <Text style={styles.label}>身份標籤 (可選)</Text>
      <TextInput style={styles.input} value={identityLabel} onChangeText={setIdentityLabel} placeholder="例如: 跨性別女性" />

      <Text style={styles.label}>交友目的</Text>
      <View style={styles.optionsContainer}>
        {relationshipGoalsOptions.map((goal) => (
          <Button
            key={goal}
            title={goal}
            onPress={() => handleSelectGoal(goal)}
            color={selectedRelationshipGoals.includes(goal) ? "#ff69b4" : "#ccc"}
          />
        ))}
      </View>

      <Text style={styles.label}>興趣</Text>
      <View style={styles.optionsContainer}>
        {interestsOptions.map((interest) => (
          <Button
            key={interest}
            title={interest}
            onPress={() => handleSelectInterest(interest)}
            color={selectedInterests.includes(interest) ? "#ff69b4" : "#ccc"}
          />
        ))}
      </View>

      <Button
        title={loading ? "儲存中..." : "儲存"}
        onPress={saveProfile}
        disabled={loading}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8f8f8",
  },
  contentContainer: {
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 30,
    textAlign: "center",
    color: "#333",
  },
  label: {
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 10,
    color: "#555",
  },
  input: {
    height: 50,
    borderColor: "#ddd",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    backgroundColor: "#fff",
  },
  optionsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
});
