import { Tabs } from "expo-router";
import { colors } from "../../theme/colors";


export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" },
        sceneStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "匿名聊天" }} />
      <Tabs.Screen name="safety" options={{ title: "安全" }} />
    </Tabs>
  );
}
