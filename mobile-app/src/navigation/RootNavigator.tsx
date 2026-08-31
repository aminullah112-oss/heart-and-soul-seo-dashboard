import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { colors, fonts } from "../theme/theme";
import BookingScreen from "../screens/BookingScreen";
import ConfirmationScreen from "../screens/ConfirmationScreen";
import ServiceDetailScreen from "../screens/ServiceDetailScreen";
import type { RootStackParamList } from "../types";
import MainTabs from "./MainTabs";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.midnight },
          headerTintColor: colors.white,
          headerTitleStyle: { fontFamily: fonts.bodySemiBold },
          headerBackTitle: "Back",
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="ServiceDetail" component={ServiceDetailScreen} options={{ title: "Service" }} />
        <Stack.Screen name="Booking" component={BookingScreen} options={{ title: "Book appointment" }} />
        <Stack.Screen
          name="Confirmation"
          component={ConfirmationScreen}
          options={{ title: "Confirmed", headerBackVisible: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
