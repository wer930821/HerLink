import React, { useState } from "react";
import { View, Text, TextInput, Button, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";
import { Link } from "expo-router";

export default function SignUpScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function signUpWithEmail() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) Alert.alert("註冊失敗", error.message);
    else Alert.alert("註冊成功", "請檢查您的電子郵件以驗證帳戶！");
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>註冊 HerLink</Text>
      <TextInput
        style={styles.input}
        onChangeText={setEmail}
        value={email}
        placeholder="Email"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        onChangeText={setPassword}
        value={password}
        secureTextEntry
        placeholder="密碼"
        autoCapitalize="none"
      />
      <Button
        title={loading ? "註冊中..." : "註冊"}
        onPress={signUpWithEmail}
        disabled={loading}
      />
      <Link href="/login" style={styles.link}>已有帳號？登入</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#f8f8f8",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 30,
    textAlign: "center",
    color: "#333",
  },
  input: {
    height: 50,
    borderColor: "#ddd",
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 15,
    paddingHorizontal: 15,
    backgroundColor: "#fff",
  },
  link: {
    marginTop: 20,
    textAlign: "center",
    color: "#ff69b4",
    fontSize: 16,
  },
});

