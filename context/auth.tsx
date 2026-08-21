import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { registerCurrentDevice } from "../lib/device";
import { supabase } from "../lib/supabase";

export interface Profile {
  id: string;
  display_name: string | null;
  birthday: string | null;
  city: string | null;
  bio: string | null;
  orientation: string | null;
  identity_label: string | null;
  relationship_goals: string[] | null;
  interests: string[] | null;
  verified: boolean;
  account_status: string;
  trust_score: number;
  onboarding_completed: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // Profile non-existent, user needs onboarding
          setProfile(null);
        } else {
          console.error("Error fetching profile:", error.message);
        }
      } else {
        setProfile(data as Profile);
      }
    } catch (err) {
      console.error("Profile fetch error:", err);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const hydrateSignedInUser = async (currentUser: User) => {
    await Promise.allSettled([
      fetchProfile(currentUser.id),
      registerCurrentDevice(),
    ]);
  };

  useEffect(() => {
    // 取得當前 Session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        hydrateSignedInUser(session.user).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // 監聽 Auth 狀態
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        if (currentSession?.user) {
          await hydrateSignedInUser(currentSession.user);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

