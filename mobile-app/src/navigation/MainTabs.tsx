import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { colors, fonts } from "../theme/theme";
import type { MainTabsParamList } from "../types";
import HomeScreen from "../screens/HomeScreen";
import MyBookingsScreen from "../screens/MyBookingsScreen";
import SalonInfoScreen from "../screens/SalonInfoScreen";
import ServicesScreen from "../screens/ServicesScreen";

const Tab = createBottomTabNavigator<MainTabsParamList>();

const ICONS: Record<keyof MainTabsParamList, keyof typeof Ionicons.glyphMap> = {
  Home: "home-outline",
  Services: "cut-outline",
  MyBookings: "calendar-outline",
  SalonInfo: "location-outline",
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.sageDim,
        tabBarInactiveTintColor: colors.ink60,
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name as keyof MainTabsParamList]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Services" component={ServicesScreen} />
      <Tab.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: "My Bookings" }} />
      <Tab.Screen name="SalonInfo" component={SalonInfoScreen} options={{ title: "Info" }} />
    </Tab.Navigator>
  );
}
