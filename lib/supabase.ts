import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ReportCategory =
  | "suspected_male_impersonation"
  | "identity_mismatch"
  | "stolen_photo"
  | "scam"
  | "money_request"
  | "investment_scam"
  | "harassment"
  | "sexual_harassment"
  | "threat"
  | "unsolicited_explicit_content"
  | "impersonation"
  | "suspected_minor"
  | "other";

export type RiskEventType =
  | "suspicious_money_message"
  | "suspicious_investment_message"
  | "suspicious_external_link"
  | "repeated_message"
  | "mass_messaging"
  | "valid_report_received"
  | "multiple_blocks_received"
  | "credential_request"
  | "repeated_device_accounts";

export type AdminRole = "reviewer" | "moderator" | "admin";
export type ModerationCaseType =
  | "suspected_male_impersonation"
  | "identity_mismatch"
  | "stolen_photo"
  | "impersonation"
  | "scam"
  | "harassment"
  | "verification_review"
  | "photo_review"
  | "suspected_minor"
  | "other";
export type ModerationCasePriority = "low" | "normal" | "high" | "critical";
export type ModerationCaseStatus = "pending" | "reviewing" | "resolved" | "dismissed";
export type ModerationAction =
  | "case_opened"
  | "case_assigned"
  | "case_resolved"
  | "case_dismissed"
  | "warning_issued"
  | "verification_approved"
  | "verification_rejected"
  | "photo_approved"
  | "photo_rejected"
  | "photo_under_review"
  | "account_under_review"
  | "account_suspended"
  | "account_restored"
  | "report_resolved"
  | "report_dismissed"
  | "verification_media_cleanup";

export interface Database {
  public: {
    Tables: {
      admin_users: {
        Row: {
          user_id: string;
          role: AdminRole;
          active: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          role: AdminRole;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          role?: AdminRole;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          id: string;
          blocker_id: string;
          blocked_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          blocker_id: string;
          blocked_user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          blocker_id?: string;
          blocked_user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      devices: {
        Row: {
          id: string;
          user_id: string;
          device_hash: string;
          first_seen_at: string;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          device_hash: string;
          first_seen_at?: string;
          last_seen_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          device_hash?: string;
          first_seen_at?: string;
          last_seen_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      likes: {
        Row: {
          id: string;
          from_user_id: string;
          to_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          from_user_id: string;
          to_user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          from_user_id?: string;
          to_user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          user_1_id: string;
          user_2_id: string;
          status: "active" | "unmatched" | "blocked";
          matched_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_1_id: string;
          user_2_id: string;
          status?: "active" | "unmatched" | "blocked";
          matched_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_1_id?: string;
          user_2_id?: string;
          status?: "active" | "unmatched" | "blocked";
          matched_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      match_reads: {
        Row: {
          match_id: string;
          user_id: string;
          last_read_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          match_id: string;
          user_id: string;
          last_read_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          match_id?: string;
          user_id?: string;
          last_read_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          match_id: string;
          sender_id: string;
          type: "text";
          content: string;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          sender_id: string;
          type?: "text";
          content: string;
          created_at?: string;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          match_id?: string;
          sender_id?: string;
          type?: "text";
          content?: string;
          created_at?: string;
          read_at?: string | null;
        };
        Relationships: [];
      };
      moderation_cases: {
        Row: {
          id: string;
          subject_user_id: string;
          case_type: ModerationCaseType;
          priority: ModerationCasePriority;
          status: ModerationCaseStatus;
          source: "report" | "verification" | "photo" | "risk_event" | "system";
          source_id: string | null;
          assigned_admin_id: string | null;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          subject_user_id: string;
          case_type: ModerationCaseType;
          priority?: ModerationCasePriority;
          status?: ModerationCaseStatus;
          source: "report" | "verification" | "photo" | "risk_event" | "system";
          source_id?: string | null;
          assigned_admin_id?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          subject_user_id?: string;
          case_type?: ModerationCaseType;
          priority?: ModerationCasePriority;
          status?: ModerationCaseStatus;
          source?: "report" | "verification" | "photo" | "risk_event" | "system";
          source_id?: string | null;
          assigned_admin_id?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      moderation_logs: {
        Row: {
          id: string;
          case_id: string | null;
          admin_user_id: string | null;
          target_user_id: string | null;
          action: ModerationAction;
          reason: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id?: string | null;
          admin_user_id?: string | null;
          target_user_id?: string | null;
          action: ModerationAction;
          reason?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          case_id?: string | null;
          admin_user_id?: string | null;
          target_user_id?: string | null;
          action?: ModerationAction;
          reason?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [];
      };
      profile_photos: {
        Row: {
          id: string;
          user_id: string;
          storage_path: string;
          sort_order: number;
          is_primary: boolean;
          moderation_status: "pending" | "approved" | "rejected" | "under_review";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          storage_path: string;
          sort_order?: number;
          is_primary?: boolean;
          moderation_status?: "pending" | "approved" | "rejected" | "under_review";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          storage_path?: string;
          sort_order?: number;
          is_primary?: boolean;
          moderation_status?: "pending" | "approved" | "rejected" | "under_review";
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
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
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          birthday?: string | null;
          city?: string | null;
          bio?: string | null;
          orientation?: string | null;
          identity_label?: string | null;
          relationship_goals?: string[] | null;
          interests?: string[] | null;
          verified?: boolean;
          account_status?: string;
          trust_score?: number;
          onboarding_completed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          birthday?: string | null;
          city?: string | null;
          bio?: string | null;
          orientation?: string | null;
          identity_label?: string | null;
          relationship_goals?: string[] | null;
          interests?: string[] | null;
          verified?: boolean;
          account_status?: string;
          trust_score?: number;
          onboarding_completed?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_user_id: string;
          category: ReportCategory;
          description: string | null;
          status: "pending" | "reviewing" | "resolved" | "dismissed";
          created_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          reported_user_id: string;
          category: ReportCategory;
          description?: string | null;
          status?: "pending" | "reviewing" | "resolved" | "dismissed";
          created_at?: string;
          reviewed_at?: string | null;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          reported_user_id?: string;
          category?: ReportCategory;
          description?: string | null;
          status?: "pending" | "reviewing" | "resolved" | "dismissed";
          created_at?: string;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
      risk_events: {
        Row: {
          id: string;
          user_id: string;
          event_type: RiskEventType;
          risk_score_delta: number;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_type: RiskEventType;
          risk_score_delta: number;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_type?: RiskEventType;
          risk_score_delta?: number;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [];
      };
      verifications: {
        Row: {
          id: string;
          user_id: string;
          status: "unverified" | "pending" | "verified" | "rejected" | "manual_review";
          method: "liveness_manual" | "selfie_manual";
          media_path: string | null;
          submitted_at: string;
          reviewed_at: string | null;
          rejection_reason: string | null;
          metadata: Record<string, unknown>;
          media_delete_after: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: "unverified" | "pending" | "verified" | "rejected" | "manual_review";
          method: "liveness_manual" | "selfie_manual";
          media_path: string;
          submitted_at?: string;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          metadata?: Record<string, unknown>;
          media_delete_after?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          status?: "unverified" | "pending" | "verified" | "rejected" | "manual_review";
          method?: "liveness_manual" | "selfie_manual";
          media_path?: string | null;
          submitted_at?: string;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          metadata?: Record<string, unknown>;
          media_delete_after?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          id: string;
          display_name: string | null;
          city: string | null;
          bio: string | null;
          orientation: string | null;
          identity_label: string | null;
          relationship_goals: string[] | null;
          interests: string[] | null;
          verified: boolean;
          age: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      apply_risk_event: {
        Args: {
          p_user_id: string;
          p_event_type: RiskEventType;
          p_metadata?: Record<string, unknown>;
        };
        Returns: {
          event_id: string;
          new_trust_score: number;
          new_account_status: string;
        }[];
      };
      block_user: {
        Args: {
          target_user_id: string;
        };
        Returns: {
          blocked: boolean;
          active_match_blocked: boolean;
        }[];
      };
      cleanup_expired_verification_media: {
        Args: {
          p_now?: string;
        };
        Returns: number;
      };
      create_profile_photo: {
        Args: {
          p_file_extension?: string;
        };
        Returns: {
          id: string;
          user_id: string;
          storage_path: string;
          sort_order: number;
          is_primary: boolean;
          moderation_status: "pending" | "approved" | "rejected" | "under_review";
          created_at: string;
        }[];
      };
      create_verification_submission: {
        Args: {
          p_method: "liveness_manual" | "selfie_manual";
          p_file_extension?: string;
        };
        Returns: {
          id: string;
          user_id: string;
          status: "pending";
          method: "liveness_manual" | "selfie_manual";
          media_path: string;
          submitted_at: string;
          created_at: string;
        }[];
      };
      delete_profile_photo: {
        Args: {
          p_photo_id: string;
        };
        Returns: boolean;
      };
      flag_photo_under_review: {
        Args: {
          p_photo_id: string;
          p_reason?: string | null;
        };
        Returns: boolean;
      };
      get_public_primary_photos: {
        Args: {
          p_user_ids: string[];
        };
        Returns: {
          id: string;
          user_id: string;
          storage_path: string;
          moderation_status: "approved";
          created_at: string;
        }[];
      };
      get_public_profile_photos: {
        Args: {
          p_user_ids: string[];
        };
        Returns: {
          id: string;
          user_id: string;
          storage_path: string;
          sort_order: number;
          is_primary: boolean;
          created_at: string;
        }[];
      };
      get_visible_public_profiles: {
        Args: {
          p_user_ids: string[];
        };
        Returns: {
          id: string;
          display_name: string | null;
          city: string | null;
          bio: string | null;
          orientation: string | null;
          identity_label: string | null;
          relationship_goals: string[] | null;
          interests: string[] | null;
          verified: boolean;
          age: number | null;
        }[];
      };
      has_block_between: {
        Args: {
          user_a: string;
          user_b: string;
        };
        Returns: boolean;
      };
      is_match_member: {
        Args: {
          p_match_id: string;
          p_user_id: string;
          p_required_status?: string | null;
        };
        Returns: boolean;
      };
      is_profile_eligible: {
        Args: {
          p_user_id: string;
        };
        Returns: boolean;
      };
      like_user: {
        Args: {
          target_user_id: string;
        };
        Returns: {
          liked: boolean;
          matched: boolean;
          match_id: string | null;
        }[];
      };
      list_discover_profiles: {
        Args: {
          p_min_age?: number | null;
          p_max_age?: number | null;
          p_cities?: string[] | null;
          p_relationship_goals?: string[] | null;
          p_interests?: string[] | null;
          p_verified_only?: boolean | null;
          p_identity_labels?: string[] | null;
          p_limit?: number | null;
          p_cursor_interest_count?: number | null;
          p_cursor_goal_count?: number | null;
          p_cursor_verified_rank?: number | null;
          p_cursor_rotation_key?: string | null;
          p_cursor_id?: string | null;
        };
        Returns: {
          id: string;
          display_name: string | null;
          city: string | null;
          bio: string | null;
          orientation: string | null;
          identity_label: string | null;
          relationship_goals: string[] | null;
          interests: string[] | null;
          verified: boolean;
          age: number | null;
          sort_interest_count: number;
          sort_goal_count: number;
          sort_verified_rank: number;
          sort_rotation_key: string;
        }[];
      };
      list_active_conversations: {
        Args: Record<PropertyKey, never>;
        Returns: {
          match_id: string;
          match_user_1_id: string;
          match_user_2_id: string;
          match_status: "active" | "unmatched" | "blocked";
          matched_at: string;
          match_created_at: string;
          other_user_id: string;
          display_name: string | null;
          age: number | null;
          city: string | null;
          bio: string | null;
          orientation: string | null;
          identity_label: string | null;
          relationship_goals: string[] | null;
          interests: string[] | null;
          verified: boolean;
          latest_message_id: string | null;
          latest_message_content: string | null;
          latest_message_created_at: string | null;
          latest_message_sender_id: string | null;
          unread_count: number;
        }[];
      };
      mark_match_messages_read: {
        Args: {
          p_match_id: string;
        };
        Returns: number;
      };
      register_device: {
        Args: {
          p_device_hash: string;
        };
        Returns: {
          device_id: string;
          owner_user_id: string;
          device_hash_value: string;
          first_seen_at: string;
          last_seen_at: string;
          created_at: string;
          risk_signal_created: boolean;
        }[];
      };
      reorder_profile_photos: {
        Args: {
          p_photo_ids: string[];
        };
        Returns: boolean;
      };
      report_user: {
        Args: {
          target_user_id: string;
          p_category: ReportCategory;
          p_description?: string | null;
        };
        Returns: {
          report_id: string;
          status: "pending" | "reviewing" | "resolved" | "dismissed";
          created_at: string;
        }[];
      };
      moderate_account: {
        Args: {
          target_user_id: string;
          p_action: "under_review" | "suspend" | "restore";
          p_reason?: string | null;
        };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
      review_moderation_case: {
        Args: {
          p_case_id: string;
          p_decision: "resolved" | "dismissed";
          p_reason?: string | null;
        };
        Returns: Database["public"]["Tables"]["moderation_cases"]["Row"];
      };
      review_profile_photo: {
        Args: {
          p_photo_id: string;
          p_decision: "approved" | "rejected" | "under_review";
          p_reason?: string | null;
        };
        Returns: Database["public"]["Tables"]["profile_photos"]["Row"];
      };
      review_report: {
        Args: {
          p_report_id: string;
          p_decision: "resolved" | "dismissed";
          p_reason?: string | null;
        };
        Returns: Database["public"]["Tables"]["reports"]["Row"];
      };
      review_verification: {
        Args: {
          p_verification_id: string;
          p_status: "verified" | "rejected" | "manual_review";
          p_rejection_reason?: string | null;
        };
        Returns: {
          verification_id: string;
          user_id: string;
          status: "verified" | "rejected" | "manual_review";
          reviewed_at: string;
          profile_verified: boolean;
        }[];
      };
      run_verification_media_cleanup_job: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      send_message: {
        Args: {
          p_match_id: string;
          p_content: string;
        };
        Returns: {
          id: string;
          match_id: string;
          sender_id: string;
          type: "text";
          content: string;
          created_at: string;
          read_at: string | null;
          safety_warning: string | null;
          risk_level: "low" | "medium" | "high";
        }[];
      };
      set_primary_profile_photo: {
        Args: {
          p_photo_id: string;
        };
        Returns: boolean;
      };
      take_moderation_case: {
        Args: {
          p_case_id: string;
        };
        Returns: Database["public"]["Tables"]["moderation_cases"]["Row"];
      };
      unmatch_user: {
        Args: {
          p_match_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {};
    CompositeTypes: {};
  };
}

export type MatchStatus = Database["public"]["Tables"]["matches"]["Row"]["status"];
export type AdminUser = Database["public"]["Tables"]["admin_users"]["Row"];
export type Match = Database["public"]["Tables"]["matches"]["Row"];
export type MatchRead = Database["public"]["Tables"]["match_reads"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type Like = Database["public"]["Tables"]["likes"]["Row"];
export type Block = Database["public"]["Tables"]["blocks"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type ModerationCase = Database["public"]["Tables"]["moderation_cases"]["Row"];
export type ModerationLog = Database["public"]["Tables"]["moderation_logs"]["Row"];
export type ProfilePhoto = Database["public"]["Tables"]["profile_photos"]["Row"];
export type Verification = Database["public"]["Tables"]["verifications"]["Row"];
export type Report = Database["public"]["Tables"]["reports"]["Row"];
export type RiskEvent = Database["public"]["Tables"]["risk_events"]["Row"];
export type PublicProfile = Database["public"]["Views"]["public_profiles"]["Row"];
export type LikeUserResult = Database["public"]["Functions"]["like_user"]["Returns"][number];
export type BlockUserResult = Database["public"]["Functions"]["block_user"]["Returns"][number];
export type ReportStatus = Database["public"]["Tables"]["reports"]["Row"]["status"];
export type ReportUserResult = Database["public"]["Functions"]["report_user"]["Returns"][number];
export type SendMessageResult = Database["public"]["Functions"]["send_message"]["Returns"][number];
export type CreateProfilePhotoResult = Database["public"]["Functions"]["create_profile_photo"]["Returns"][number];
export type CreateVerificationResult =
  Database["public"]["Functions"]["create_verification_submission"]["Returns"][number];
export type RegisterDeviceResult = Database["public"]["Functions"]["register_device"]["Returns"][number];
export type ReviewVerificationResult =
  Database["public"]["Functions"]["review_verification"]["Returns"][number];
export type ModerateAccountResult = Database["public"]["Functions"]["moderate_account"]["Returns"];
export type DiscoverProfileRow = Database["public"]["Functions"]["list_discover_profiles"]["Returns"][number];
export type ConversationRow = Database["public"]["Functions"]["list_active_conversations"]["Returns"][number];
export type PublicProfilePhoto = Database["public"]["Functions"]["get_public_profile_photos"]["Returns"][number];

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const authStorage =
  typeof window === "undefined"
    ? {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      }
    : AsyncStorage;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
