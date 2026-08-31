export type Service = {
  id: string;
  category: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
};

export type Stylist = {
  id: string;
  name: string;
  title: string;
  specialties: string[];
  isAnyStylist?: boolean;
};

export type BookingStatus = "upcoming" | "cancelled" | "past";

export type Booking = {
  id: string;
  serviceId: string;
  serviceName: string;
  price: number;
  durationMinutes: number;
  stylistId: string;
  stylistName: string;
  dateISO: string; // yyyy-mm-dd
  time: string; // HH:mm, 24h
  customerName: string;
  customerPhone: string;
  notes?: string;
  status: BookingStatus;
  createdAt: string;
};

import type { NavigatorScreenParams } from "@react-navigation/native";

export type MainTabsParamList = {
  Home: undefined;
  Services: undefined;
  MyBookings: undefined;
  SalonInfo: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabsParamList> | undefined;
  ServiceDetail: { serviceId: string };
  Booking: { serviceId: string };
  Confirmation: { bookingId: string };
};
