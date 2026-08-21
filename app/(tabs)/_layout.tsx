import { ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors } from "../../theme/colors";

function tabIcon(name: React.ComponentProps<typeof Ionicons>["name"]) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSoft,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 68,
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700",
        },
        sceneStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "探索", tabBarIcon: tabIcon("compass-outline") }} />
      <Tabs.Screen name="likes" options={{ title: "互動", tabBarIcon: tabIcon("heart-outline") }} />
      <Tabs.Screen name="chat" options={{ title: "聊天", tabBarIcon: tabIcon("chatbubble-ellipses-outline") }} />
      <Tabs.Screen name="safety" options={{ title: "安全", tabBarIcon: tabIcon("shield-checkmark-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "我的", tabBarIcon: tabIcon("person-outline") }} />
    </Tabs>
  );
}
