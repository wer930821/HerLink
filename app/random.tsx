import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { findOrJoinRandomMatch, leaveRandomQueue } from "../lib/random-chat";
import { colors } from "../theme/colors";

export default function RandomMatchScreen() {
  const router = useRouter(); const [waiting, setWaiting] = useState(false);
  useEffect(() => { if (!waiting) return; const timer = setInterval(() => void join(), 2500); return () => clearInterval(timer); }, [waiting]);
  const join = async () => { try { const result = await findOrJoinRandomMatch(); if (result?.status === "matched" && result.session_id) router.replace({ pathname: "/random-session/[sessionId]", params: { sessionId: result.session_id } } as never); else setWaiting(true); } catch (error) { setWaiting(false); Alert.alert("目前無法配對", error instanceof Error ? error.message : "請稍後再試。"); } };
  return <View style={styles.root}><Text style={styles.title}>{waiting ? "正在尋找聊天對象…" : "匿名即時聊天"}</Text><Text style={styles.copy}>配對後可以隨時離開、封鎖或檢舉。</Text><Pressable style={styles.button} onPress={() => void (waiting ? leaveRandomQueue().then(() => setWaiting(false)) : join())}><Text style={styles.buttonText}>{waiting ? "停止等待" : "開始配對"}</Text></Pressable></View>;
}
const styles = StyleSheet.create({ root:{flex:1,justifyContent:"center",padding:24,backgroundColor:colors.background},title:{fontSize:28,fontWeight:"700",color:colors.text},copy:{marginTop:12,color:colors.textMuted,fontSize:16},button:{marginTop:28,backgroundColor:colors.primary,padding:16,borderRadius:14,alignItems:"center"},buttonText:{color:colors.primaryText,fontWeight:"700"} });
