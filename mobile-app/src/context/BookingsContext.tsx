import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Booking } from "../types";

const STORAGE_KEY = "@heart_and_soul_booking/bookings";

type NewBookingInput = Omit<Booking, "id" | "status" | "createdAt">;

type BookingsContextValue = {
  bookings: Booking[];
  loading: boolean;
  addBooking: (input: NewBookingInput) => Promise<Booking>;
  cancelBooking: (id: string) => Promise<void>;
  isSlotTaken: (stylistId: string, dateISO: string, time: string) => boolean;
};

const BookingsContext = createContext<BookingsContextValue | undefined>(undefined);

function generateId(): string {
  return `bk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function BookingsProvider({ children }: { children: React.ReactNode }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setBookings(JSON.parse(raw));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (next: Booking[]) => {
    setBookings(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addBooking = useCallback(
    async (input: NewBookingInput) => {
      const booking: Booking = {
        ...input,
        id: generateId(),
        status: "upcoming",
        createdAt: new Date().toISOString(),
      };
      await persist([booking, ...bookings]);
      return booking;
    },
    [bookings, persist]
  );

  const cancelBooking = useCallback(
    async (id: string) => {
      const next = bookings.map((b) => (b.id === id ? { ...b, status: "cancelled" as const } : b));
      await persist(next);
    },
    [bookings, persist]
  );

  const isSlotTaken = useCallback(
    (stylistId: string, dateISO: string, time: string) => {
      if (stylistId === "stylist-any") return false;
      return bookings.some(
        (b) =>
          b.status === "upcoming" &&
          b.stylistId === stylistId &&
          b.dateISO === dateISO &&
          b.time === time
      );
    },
    [bookings]
  );

  const value = useMemo(
    () => ({ bookings, loading, addBooking, cancelBooking, isSlotTaken }),
    [bookings, loading, addBooking, cancelBooking, isSlotTaken]
  );

  return <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>;
}

export function useBookings(): BookingsContextValue {
  const ctx = useContext(BookingsContext);
  if (!ctx) throw new Error("useBookings must be used within a BookingsProvider");
  return ctx;
}
