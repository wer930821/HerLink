import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";


export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSoft,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 88 + insets.bottom, paddingBottom: 18 + insets.bottom, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
        tabBarItemStyle: { minHeight: 62 },
        sceneStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "首頁", tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="chats" options={{ title: "聊天室", tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="contacts" options={{ title: "聯絡人", tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="mailbox" options={{ title: "信箱", tabBarIcon: ({ color, size }) => <Ionicons name="mail-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="safety" options={{ title: "安全與設定", tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
