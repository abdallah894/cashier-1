export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_actions: {
        Row: {
          action: string
          target_type: string
        }
        Insert: {
          action: string
          target_type: string
        }
        Update: {
          action?: string
          target_type?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string
          approved_by: string | null
          created_at: string
          id: string
          metadata: Json
          request_id: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id: string
          approved_by?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          request_id?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string
          approved_by?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          request_id?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_action_fkey"
            columns: ["action"]
            isOneToOne: false
            referencedRelation: "audit_actions"
            referencedColumns: ["action"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_metadata_keys: {
        Row: {
          key: string
        }
        Insert: {
          key: string
        }
        Update: {
          key?: string
        }
        Relationships: []
      }
      backup_runs: {
        Row: {
          created_at: string
          detail: string | null
          finished_at: string
          id: string
          location: string | null
          size_bytes: number | null
          started_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          finished_at?: string
          id?: string
          location?: string | null
          size_bytes?: number | null
          started_at?: string | null
          status: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          finished_at?: string
          id?: string
          location?: string | null
          size_bytes?: number | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      business_days: {
        Row: {
          card_net: number
          cash_net: number
          closed_at: string
          closed_by: string
          day: string
          discount_total: number
          gross_sales: number
          net_sales_ex_vat: number
          refund_count: number
          refunds_gross: number
          sale_count: number
          vat_on_sales: number
          void_count: number
          void_value: number
        }
        Insert: {
          card_net: number
          cash_net: number
          closed_at?: string
          closed_by: string
          day: string
          discount_total: number
          gross_sales: number
          net_sales_ex_vat: number
          refund_count: number
          refunds_gross: number
          sale_count: number
          vat_on_sales: number
          void_count: number
          void_value: number
        }
        Update: {
          card_net?: number
          cash_net?: number
          closed_at?: string
          closed_by?: string
          day?: string
          discount_total?: number
          gross_sales?: number
          net_sales_ex_vat?: number
          refund_count?: number
          refunds_gross?: number
          sale_count?: number
          vat_on_sales?: number
          void_count?: number
          void_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_days_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_drawer_events: {
        Row: {
          actor_id: string
          amount: number
          created_at: string
          event_type: Database["public"]["Enums"]["cash_drawer_event_type"]
          id: string
          reason: string
          return_id: string | null
          sale_id: string | null
          shift_id: string
        }
        Insert: {
          actor_id: string
          amount: number
          created_at?: string
          event_type: Database["public"]["Enums"]["cash_drawer_event_type"]
          id?: string
          reason: string
          return_id?: string | null
          sale_id?: string | null
          shift_id: string
        }
        Update: {
          actor_id?: string
          amount?: number
          created_at?: string
          event_type?: Database["public"]["Enums"]["cash_drawer_event_type"]
          id?: string
          reason?: string
          return_id?: string | null
          sale_id?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_drawer_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_drawer_events_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_drawer_events_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_drawer_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_drawer_settings: {
        Row: {
          id: boolean
          updated_at: string
          variance_approval_threshold: number | null
        }
        Insert: {
          id?: boolean
          updated_at?: string
          variance_approval_threshold?: number | null
        }
        Update: {
          id?: boolean
          updated_at?: string
          variance_approval_threshold?: number | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name_ar: string
          name_en: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name_ar: string
          name_en: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name_ar?: string
          name_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      customer_consent_events: {
        Row: {
          consent: boolean
          customer_id: string
          id: string
          recorded_at: string
          recorded_by: string
          source: string
        }
        Insert: {
          consent: boolean
          customer_id: string
          id?: string
          recorded_at?: string
          recorded_by: string
          source: string
        }
        Update: {
          consent?: boolean
          customer_id?: string
          id?: string
          recorded_at?: string
          recorded_by?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_consent_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consent_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          anonymized_at: string | null
          consent_marketing: boolean
          consent_updated_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          anonymized_at?: string | null
          consent_marketing?: boolean
          consent_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          anonymized_at?: string | null
          consent_marketing?: boolean
          consent_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_events: {
        Row: {
          actor_id: string
          created_at: string
          detail: string | null
          device_id: string | null
          document_id: string | null
          document_type: string | null
          event_type: string
          id: string
          till_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          detail?: string | null
          device_id?: string | null
          document_id?: string | null
          document_type?: string | null
          event_type: string
          id?: string
          till_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          detail?: string | null
          device_id?: string | null
          document_id?: string | null
          document_type?: string | null
          event_type?: string
          id?: string
          till_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_events_till_id_fkey"
            columns: ["till_id"]
            isOneToOne: false
            referencedRelation: "tills"
            referencedColumns: ["id"]
          },
        ]
      }
      device_profiles: {
        Row: {
          key: string
          kind: Database["public"]["Enums"]["device_kind"]
          label: string
          notes: string | null
          supported: boolean
        }
        Insert: {
          key: string
          kind: Database["public"]["Enums"]["device_kind"]
          label: string
          notes?: string | null
          supported: boolean
        }
        Update: {
          key?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          label?: string
          notes?: string | null
          supported?: boolean
        }
        Relationships: []
      }
      devices: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          health: string
          health_detail: string | null
          id: string
          kind: Database["public"]["Enums"]["device_kind"]
          last_seen_at: string | null
          name: string
          profile: string
          settings: Json
          till_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          health?: string
          health_detail?: string | null
          id?: string
          kind: Database["public"]["Enums"]["device_kind"]
          last_seen_at?: string | null
          name: string
          profile: string
          settings?: Json
          till_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          health?: string
          health_detail?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          last_seen_at?: string | null
          name?: string
          profile?: string
          settings?: Json
          till_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_profile_fkey"
            columns: ["profile"]
            isOneToOne: false
            referencedRelation: "device_profiles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "devices_till_id_fkey"
            columns: ["till_id"]
            isOneToOne: false
            referencedRelation: "tills"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_settings: {
        Row: {
          approval_threshold_bp: number
          id: boolean
        }
        Insert: {
          approval_threshold_bp?: number
          id?: boolean
        }
        Update: {
          approval_threshold_bp?: number
          id?: boolean
        }
        Relationships: []
      }
      drawer_openings: {
        Row: {
          actor_id: string
          approved_by: string | null
          completed_at: string | null
          created_at: string
          device_id: string | null
          error: string | null
          id: string
          note: string | null
          reason: Database["public"]["Enums"]["drawer_reason"]
          reference_id: string | null
          shift_id: string
          status: string
          till_id: string
        }
        Insert: {
          actor_id: string
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          error?: string | null
          id?: string
          note?: string | null
          reason: Database["public"]["Enums"]["drawer_reason"]
          reference_id?: string | null
          shift_id: string
          status?: string
          till_id: string
        }
        Update: {
          actor_id?: string
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          device_id?: string | null
          error?: string | null
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["drawer_reason"]
          reference_id?: string | null
          shift_id?: string
          status?: string
          till_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawer_openings_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawer_openings_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawer_openings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawer_openings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawer_openings_till_id_fkey"
            columns: ["till_id"]
            isOneToOne: false
            referencedRelation: "tills"
            referencedColumns: ["id"]
          },
        ]
      }
      eta_submissions: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          document_kind: string
          eta_uuid: string | null
          id: string
          last_error: string | null
          next_attempt_at: string
          return_id: string | null
          sale_id: string | null
          status: string
          submission_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          document_kind: string
          eta_uuid?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          return_id?: string | null
          sale_id?: string | null
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          document_kind?: string
          eta_uuid?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          return_id?: string | null
          sale_id?: string | null
          status?: string
          submission_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      goods_receipt_lines: {
        Row: {
          id: string
          po_line_id: string
          product_id: string
          qty: number
          receipt_id: string
          tax_rate: number
          unit_cost: number
        }
        Insert: {
          id?: string
          po_line_id: string
          product_id: string
          qty: number
          receipt_id: string
          tax_rate: number
          unit_cost: number
        }
        Update: {
          id?: string
          po_line_id?: string
          product_id?: string
          qty?: number
          receipt_id?: string
          tax_rate?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          id: string
          idempotency_key: string | null
          invoice_reference: string | null
          note: string | null
          po_id: string
          receipt_number: number
          received_at: string
          received_by: string
        }
        Insert: {
          id?: string
          idempotency_key?: string | null
          invoice_reference?: string | null
          note?: string | null
          po_id: string
          receipt_number?: number
          received_at?: string
          received_by: string
        }
        Update: {
          id?: string
          idempotency_key?: string | null
          invoice_reference?: string | null
          note?: string | null
          po_id?: string
          receipt_number?: number
          received_at?: string
          received_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_approvals: {
        Row: {
          action: string
          approved_by: string
          created_at: string
          expires_at: string
          id: string
          request_hash: string
          requested_by: string
          used_at: string | null
        }
        Insert: {
          action: string
          approved_by: string
          created_at?: string
          expires_at?: string
          id?: string
          request_hash: string
          requested_by: string
          used_at?: string | null
        }
        Update: {
          action?: string
          approved_by?: string
          created_at?: string
          expires_at?: string
          id?: string
          request_hash?: string
          requested_by?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manager_approvals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_approvals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          id: string
          kind: string
          severity: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          severity?: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          severity?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          actor_id: string | null
          amount: number | null
          created_at: string
          from_status: Database["public"]["Enums"]["payment_status"] | null
          id: string
          note: string | null
          payment_id: string
          provider: string
          provider_event_id: string | null
          source: string
          to_status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          actor_id?: string | null
          amount?: number | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["payment_status"] | null
          id?: string
          note?: string | null
          payment_id: string
          provider: string
          provider_event_id?: string | null
          source: string
          to_status: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          actor_id?: string | null
          amount?: number | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["payment_status"] | null
          id?: string
          note?: string | null
          payment_id?: string
          provider?: string
          provider_event_id?: string | null
          source?: string
          to_status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          direction: Database["public"]["Enums"]["payment_direction"]
          failure_reason: string | null
          id: string
          idempotency_key: string
          legacy: boolean
          original_payment_id: string | null
          provider: string
          provider_reference: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          return_id: string | null
          sale_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tender: Database["public"]["Enums"]["payment_method"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          direction: Database["public"]["Enums"]["payment_direction"]
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          legacy?: boolean
          original_payment_id?: string | null
          provider: string
          provider_reference?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          return_id?: string | null
          sale_id?: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tender: Database["public"]["Enums"]["payment_method"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          direction?: Database["public"]["Enums"]["payment_direction"]
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          legacy?: boolean
          original_payment_id?: string | null
          provider?: string
          provider_reference?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          return_id?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tender?: Database["public"]["Enums"]["payment_method"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_original_payment_id_fkey"
            columns: ["original_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          completed_at: string | null
          copy_number: number
          created_at: string
          device_id: string | null
          document_id: string
          document_type: string
          error: string | null
          id: string
          kind: string
          reason: string | null
          requested_by: string
          status: string
          till_id: string
        }
        Insert: {
          completed_at?: string | null
          copy_number: number
          created_at?: string
          device_id?: string | null
          document_id: string
          document_type: string
          error?: string | null
          id?: string
          kind: string
          reason?: string | null
          requested_by: string
          status?: string
          till_id: string
        }
        Update: {
          completed_at?: string | null
          copy_number?: number
          created_at?: string
          device_id?: string | null
          document_id?: string
          document_type?: string
          error?: string | null
          id?: string
          kind?: string
          reason?: string | null
          requested_by?: string
          status?: string
          till_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_till_id_fkey"
            columns: ["till_id"]
            isOneToOne: false
            referencedRelation: "tills"
            referencedColumns: ["id"]
          },
        ]
      }
      product_suppliers: {
        Row: {
          is_preferred: boolean
          lead_time_days: number | null
          min_order_qty: number
          pack_size: number
          product_id: string
          supplier_id: string
          supplier_sku: string | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          is_preferred?: boolean
          lead_time_days?: number | null
          min_order_qty?: number
          pack_size?: number
          product_id: string
          supplier_id: string
          supplier_sku?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          is_preferred?: boolean
          lead_time_days?: number | null
          min_order_qty?: number
          pack_size?: number
          product_id?: string
          supplier_id?: string
          supplier_sku?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_suppliers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          barcode: string
          category_id: string | null
          cost: number
          created_at: string
          id: string
          image_url: string | null
          low_stock_threshold: number
          name_ar: string
          name_en: string
          plu_code: string | null
          price: number
          stock_qty: number
          tax_rate: number
          unit: Database["public"]["Enums"]["product_unit"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          barcode: string
          category_id?: string | null
          cost?: number
          created_at?: string
          id?: string
          image_url?: string | null
          low_stock_threshold?: number
          name_ar: string
          name_en: string
          plu_code?: string | null
          price: number
          stock_qty?: number
          tax_rate?: number
          unit?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          barcode?: string
          category_id?: string | null
          cost?: number
          created_at?: string
          id?: string
          image_url?: string | null
          low_stock_threshold?: number
          name_ar?: string
          name_en?: string
          plu_code?: string | null
          price?: number
          stock_qty?: number
          tax_rate?: number
          unit?: Database["public"]["Enums"]["product_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          pin_attempts: number
          pin_hash: string | null
          pin_locked_until: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          pin_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          pin_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      promotion_products: {
        Row: {
          product_id: string
          promotion_id: string
        }
        Insert: {
          product_id: string
          promotion_id: string
        }
        Update: {
          product_id?: string
          promotion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_products_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_redemptions: {
        Row: {
          amount: number
          code: string | null
          created_at: string
          customer_id: string | null
          id: string
          promotion_id: string
          sale_id: string
        }
        Insert: {
          amount: number
          code?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          promotion_id: string
          sale_id: string
        }
        Update: {
          amount?: number
          code?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          promotion_id?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          category_id: string | null
          code: string | null
          created_at: string
          created_by: string
          customer_required: boolean
          discount_kind: Database["public"]["Enums"]["promotion_discount_kind"]
          ends_at: string | null
          fixed_amount: number | null
          id: string
          max_per_customer: number | null
          max_redemptions: number | null
          min_spend: number
          name_ar: string
          name_en: string
          percent_bp: number | null
          priority: number
          scope: Database["public"]["Enums"]["promotion_scope"]
          stackable: boolean
          starts_at: string | null
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          code?: string | null
          created_at?: string
          created_by: string
          customer_required?: boolean
          discount_kind: Database["public"]["Enums"]["promotion_discount_kind"]
          ends_at?: string | null
          fixed_amount?: number | null
          id?: string
          max_per_customer?: number | null
          max_redemptions?: number | null
          min_spend?: number
          name_ar: string
          name_en: string
          percent_bp?: number | null
          priority?: number
          scope: Database["public"]["Enums"]["promotion_scope"]
          stackable?: boolean
          starts_at?: string | null
        }
        Update: {
          active?: boolean
          category_id?: string | null
          code?: string | null
          created_at?: string
          created_by?: string
          customer_required?: boolean
          discount_kind?: Database["public"]["Enums"]["promotion_discount_kind"]
          ends_at?: string | null
          fixed_amount?: number | null
          id?: string
          max_per_customer?: number | null
          max_redemptions?: number | null
          min_spend?: number
          name_ar?: string
          name_en?: string
          percent_bp?: number | null
          priority?: number
          scope?: Database["public"]["Enums"]["promotion_scope"]
          stackable?: boolean
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          barcode: string
          id: string
          name_ar: string
          name_en: string
          ordered_qty: number
          po_id: string
          product_id: string
          received_qty: number
          tax_rate: number
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
        }
        Insert: {
          barcode: string
          id?: string
          name_ar: string
          name_en: string
          ordered_qty: number
          po_id: string
          product_id: string
          received_qty?: number
          tax_rate?: number
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
        }
        Update: {
          barcode?: string
          id?: string
          name_ar?: string
          name_en?: string
          ordered_qty?: number
          po_id?: string
          product_id?: string
          received_qty?: number
          tax_rate?: number
          unit?: Database["public"]["Enums"]["product_unit"]
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          expected_date: string | null
          id: string
          note: string | null
          ordered_at: string | null
          po_number: number
          status: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id: string
          supplier_name: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          expected_date?: string | null
          id?: string
          note?: string | null
          ordered_at?: string | null
          po_number?: number
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id: string
          supplier_name: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          expected_date?: string | null
          id?: string
          note?: string | null
          ordered_at?: string | null
          po_number?: number
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id?: string
          supplier_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchasing_settings: {
        Row: {
          id: boolean
          over_receipt_tolerance_pct: number
        }
        Insert: {
          id?: boolean
          over_receipt_tolerance_pct?: number
        }
        Update: {
          id?: boolean
          over_receipt_tolerance_pct?: number
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      reorder_alerts: {
        Row: {
          handled_at: string | null
          handled_by: string | null
          id: string
          note: string | null
          opened_at: string
          po_id: string | null
          product_id: string
          resolved_at: string | null
          status: string
          stock_qty_at_alert: number
          threshold: number
        }
        Insert: {
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          note?: string | null
          opened_at?: string
          po_id?: string | null
          product_id: string
          resolved_at?: string | null
          status?: string
          stock_qty_at_alert: number
          threshold: number
        }
        Update: {
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          note?: string | null
          opened_at?: string
          po_id?: string | null
          product_id?: string
          resolved_at?: string | null
          status?: string
          stock_qty_at_alert?: number
          threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "reorder_alerts_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_alerts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          created_at: string
          id: string
          line_refund_total: number
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          return_id: string
          sale_item_id: string
          tax_rate: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_refund_total: number
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          return_id: string
          sale_item_id: string
          tax_rate: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_refund_total?: number
          name_ar?: string
          name_en?: string
          product_id?: string
          qty?: number
          return_id?: string
          sale_item_id?: string
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      return_settings: {
        Row: {
          id: boolean
          manager_approval_threshold: number | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          manager_approval_threshold?: number | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          manager_approval_threshold?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      returns: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          manager_approved_by: string | null
          reason: string
          refund_tender: Database["public"]["Enums"]["payment_method"]
          refund_total: number
          restock: boolean
          return_number: number
          sale_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          manager_approved_by?: string | null
          reason: string
          refund_tender: Database["public"]["Enums"]["payment_method"]
          refund_total: number
          restock: boolean
          return_number?: number
          sale_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          manager_approved_by?: string | null
          reason?: string
          refund_tender?: Database["public"]["Enums"]["payment_method"]
          refund_total?: number
          restock?: boolean
          return_number?: number
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_manager_approved_by_fkey"
            columns: ["manager_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_item_promotions: {
        Row: {
          code: string | null
          discount: number
          id: string
          name_ar: string
          name_en: string
          promotion_id: string
          sale_item_id: string
        }
        Insert: {
          code?: string | null
          discount: number
          id?: string
          name_ar: string
          name_en: string
          promotion_id: string
          sale_item_id: string
        }
        Update: {
          code?: string | null
          discount?: number
          id?: string
          name_ar?: string
          name_en?: string
          promotion_id?: string
          sale_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_item_promotions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_item_promotions_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string
          id: string
          line_discount: number
          line_total: number
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          sale_id: string
          tax_rate: number
          unit_cost: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_discount?: number
          line_total: number
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          sale_id: string
          tax_rate: number
          unit_cost: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_discount?: number
          line_total?: number
          name_ar?: string
          name_en?: string
          product_id?: string
          qty?: number
          sale_id?: string
          tax_rate?: number
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_tendered: number | null
          cashier_id: string
          change_due: number | null
          client_sold_at: string | null
          created_at: string
          customer_id: string | null
          discount_total: number
          id: string
          idempotency_key: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          sale_number: number
          shift_id: string | null
          subtotal: number
          tax_total: number
          total: number
        }
        Insert: {
          amount_tendered?: number | null
          cashier_id: string
          change_due?: number | null
          client_sold_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount_total?: number
          id?: string
          idempotency_key?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          sale_number?: number
          shift_id?: string | null
          subtotal: number
          tax_total: number
          total: number
        }
        Update: {
          amount_tendered?: number | null
          cashier_id?: string
          change_due?: number | null
          client_sold_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount_total?: number
          id?: string
          idempotency_key?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          sale_number?: number
          shift_id?: string | null
          subtotal?: number
          tax_total?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          cashier_id: string
          closed_at: string | null
          closing_counted: number | null
          created_at: string
          expected_cash: number | null
          id: string
          opened_at: string
          opening_float: number
          till_id: string
        }
        Insert: {
          cashier_id: string
          closed_at?: string | null
          closing_counted?: number | null
          created_at?: string
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_float?: number
          till_id?: string
        }
        Update: {
          cashier_id?: string
          closed_at?: string | null
          closing_counted?: number | null
          created_at?: string
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_float?: number
          till_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_till_id_fkey"
            columns: ["till_id"]
            isOneToOne: false
            referencedRelation: "tills"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_capabilities: {
        Row: {
          capability: Database["public"]["Enums"]["capability"]
          created_at: string
          granted_by: string
          staff_id: string
        }
        Insert: {
          capability: Database["public"]["Enums"]["capability"]
          created_at?: string
          granted_by: string
          staff_id: string
        }
        Update: {
          capability?: Database["public"]["Enums"]["capability"]
          created_at?: string
          granted_by?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_capabilities_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_capabilities_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          product_id: string
          qty_change: number
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          reference_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          product_id: string
          qty_change: number
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          reference_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          product_id?: string
          qty_change?: number
          reason?: Database["public"]["Enums"]["stock_movement_reason"]
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_items: {
        Row: {
          applied_delta: number | null
          barcode: string
          counted_at: string | null
          counted_by: string | null
          counted_qty: number | null
          current_qty_at_approval: number | null
          expected_qty: number
          name_ar: string
          name_en: string
          product_id: string
          reason: string | null
          resolution: string | null
          stocktake_id: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
        }
        Insert: {
          applied_delta?: number | null
          barcode: string
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          current_qty_at_approval?: number | null
          expected_qty: number
          name_ar: string
          name_en: string
          product_id: string
          reason?: string | null
          resolution?: string | null
          stocktake_id: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
        }
        Update: {
          applied_delta?: number | null
          barcode?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          current_qty_at_approval?: number | null
          expected_qty?: number
          name_ar?: string
          name_en?: string
          product_id?: string
          reason?: string | null
          resolution?: string | null
          stocktake_id?: string
          unit?: Database["public"]["Enums"]["product_unit"]
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_stocktake_id_fkey"
            columns: ["stocktake_id"]
            isOneToOne: false
            referencedRelation: "stocktakes"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktakes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category_id: string | null
          category_name_ar: string | null
          category_name_en: string | null
          created_at: string
          created_by: string
          id: string
          note: string | null
          scope: Database["public"]["Enums"]["stocktake_scope"]
          status: Database["public"]["Enums"]["stocktake_status"]
          stocktake_number: number
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          category_name_ar?: string | null
          category_name_en?: string | null
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          scope: Database["public"]["Enums"]["stocktake_scope"]
          status?: Database["public"]["Enums"]["stocktake_status"]
          stocktake_number?: number
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category_id?: string | null
          category_name_ar?: string | null
          category_name_en?: string | null
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          scope?: Database["public"]["Enums"]["stocktake_scope"]
          status?: Database["public"]["Enums"]["stocktake_status"]
          stocktake_number?: number
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktakes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address_ar: string
          address_en: string
          business_day_cutoff_minutes: number
          default_lead_time_days: number
          eta_enabled: boolean
          id: boolean
          phone: string
          receipt_footer_ar: string
          receipt_footer_en: string
          reorder_cover_days: number
          reorder_lookback_days: number
          store_name_ar: string
          store_name_en: string
          tax_registration_number: string
          timezone: string
          weighed_barcode_enabled: boolean
          weighed_item_code_length: number
          weighed_prefix_max: number
          weighed_prefix_min: number
          weighed_value_kind: string
        }
        Insert: {
          address_ar?: string
          address_en?: string
          business_day_cutoff_minutes?: number
          default_lead_time_days?: number
          eta_enabled?: boolean
          id?: boolean
          phone?: string
          receipt_footer_ar?: string
          receipt_footer_en?: string
          reorder_cover_days?: number
          reorder_lookback_days?: number
          store_name_ar?: string
          store_name_en?: string
          tax_registration_number?: string
          timezone?: string
          weighed_barcode_enabled?: boolean
          weighed_item_code_length?: number
          weighed_prefix_max?: number
          weighed_prefix_min?: number
          weighed_value_kind?: string
        }
        Update: {
          address_ar?: string
          address_en?: string
          business_day_cutoff_minutes?: number
          default_lead_time_days?: number
          eta_enabled?: boolean
          id?: boolean
          phone?: string
          receipt_footer_ar?: string
          receipt_footer_en?: string
          reorder_cover_days?: number
          reorder_lookback_days?: number
          store_name_ar?: string
          store_name_en?: string
          tax_registration_number?: string
          timezone?: string
          weighed_barcode_enabled?: boolean
          weighed_item_code_length?: number
          weighed_prefix_max?: number
          weighed_prefix_min?: number
          weighed_value_kind?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tills: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_stock: {
        Args: {
          p_approval_id?: string
          p_note?: string
          p_product_id: string
          p_qty_change: number
          p_reason: Database["public"]["Enums"]["stock_movement_reason"]
        }
        Returns: number
      }
      anonymize_customer: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      apply_provider_event: {
        Args: {
          p_amount: number
          p_event_id: string
          p_provider: string
          p_provider_reference: string
          p_status: Database["public"]["Enums"]["payment_status"]
        }
        Returns: string
      }
      approve_stocktake: {
        Args: { p_resolutions?: Json; p_stocktake_id: string }
        Returns: number
      }
      authorize_drawer_open: {
        Args: {
          p_approval_id?: string
          p_note?: string
          p_reason: Database["public"]["Enums"]["drawer_reason"]
          p_reference_id?: string
        }
        Returns: string
      }
      begin_payment: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_provider: string
          p_provider_reference?: string
          p_tender: Database["public"]["Enums"]["payment_method"]
        }
        Returns: string
      }
      business_cutoff: { Args: never; Returns: string }
      business_day: { Args: { ts: string }; Returns: string }
      business_day_range: {
        Args: { p_from_day: string; p_to_day: string }
        Returns: {
          range_end: string
          range_start: string
        }[]
      }
      business_day_start: { Args: { d: string }; Returns: string }
      cancel_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      cancel_stocktake: { Args: { p_stocktake_id: string }; Returns: undefined }
      close_business_day: { Args: { p_day: string }; Returns: undefined }
      close_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      close_shift: {
        Args: { p_approval_id?: string; p_counted: number; p_shift_id: string }
        Returns: {
          cashier_id: string
          closed_at: string | null
          closing_counted: number | null
          created_at: string
          expected_cash: number | null
          id: string
          opened_at: string
          opening_float: number
          till_id: string
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_drawer_opening: {
        Args: {
          p_device_id?: string
          p_error?: string
          p_id: string
          p_ok: boolean
        }
        Returns: undefined
      }
      complete_print_job: {
        Args: {
          p_device_id?: string
          p_error?: string
          p_job_id: string
          p_ok: boolean
        }
        Returns: undefined
      }
      consume_manager_approval: {
        Args: {
          p_action: string
          p_approval_id: string
          p_request_hash: string
        }
        Returns: string
      }
      consume_rate_limit: {
        Args: { p_limit: number; p_scope: string; p_window_seconds: number }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
      create_customer: {
        Args: {
          p_consent_source?: string
          p_email?: string
          p_marketing_consent?: boolean
          p_name: string
          p_phone: string
        }
        Returns: string
      }
      create_manager_approval: {
        Args: { p_action: string; p_pin: string; p_request_hash: string }
        Returns: string
      }
      create_promotion: { Args: { p: Json }; Returns: string }
      create_purchase_order: {
        Args: {
          p_expected_date?: string
          p_lines: Json
          p_note?: string
          p_supplier_id: string
        }
        Returns: string
      }
      create_return: {
        Args: {
          p_approval_id?: string
          p_items: Json
          p_reason: string
          p_refund_tender: Database["public"]["Enums"]["payment_method"]
          p_restock: boolean
          p_sale_id: string
        }
        Returns: {
          created_at: string
          refund_total: number
          return_id: string
          return_number: number
        }[]
      }
      create_sale: {
        Args: {
          p_amount_tendered?: number
          p_apply_promotions?: boolean
          p_approval_id?: string
          p_card_reference?: string
          p_cashier_id?: string
          p_client_sold_at?: string
          p_customer_id?: string
          p_expected_total?: number
          p_idempotency_key?: string
          p_items: Json
          p_payment_ids?: string[]
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_promotion_codes?: string[]
          p_shift_id?: string
        }
        Returns: {
          change_due: number
          discount_total: number
          sale_id: string
          sale_number: number
          subtotal: number
          tax_total: number
          total: number
        }[]
      }
      create_stocktake: {
        Args: {
          p_category_id?: string
          p_note?: string
          p_product_ids?: string[]
          p_scope: Database["public"]["Enums"]["stocktake_scope"]
        }
        Returns: string
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      customer_purchase_history: {
        Args: { p_customer_id: string }
        Returns: {
          created_at: string
          item_count: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          sale_id: string
          sale_number: number
          total: number
        }[]
      }
      default_till_id: { Args: never; Returns: string }
      derive_po_status: {
        Args: { p_po_id: string }
        Returns: Database["public"]["Enums"]["purchase_order_status"]
      }
      eta_claim_batch: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["eta_submissions"]["Row"][]
      }
      eta_record_result: {
        Args: {
          p_error?: string
          p_eta_uuid?: string
          p_id: string
          p_outcome: string
          p_submission_id?: string
        }
        Returns: Database["public"]["Tables"]["eta_submissions"]["Row"]
      }
      evaluate_promotions: {
        Args: {
          p_codes: string[]
          p_customer_id: string
          p_lines: Json
          p_now?: string
        }
        Returns: {
          discount: number
          line_idx: number
          promotion_id: string
        }[]
      }
      find_customer: {
        Args: { p_phone: string }
        Returns: {
          id: string
          name: string
          phone_last4: string
        }[]
      }
      handle_reorder_alert: {
        Args: {
          p_action: string
          p_id: string
          p_note?: string
          p_po_id?: string
        }
        Returns: undefined
      }
      has_capability: {
        Args: { p_capability: Database["public"]["Enums"]["capability"] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      jsonb_has_sensitive_key: { Args: { p: Json }; Returns: boolean }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      ops_alerts: {
        Args: never
        Returns: {
          alert: string
          detail: string
          severity: string
          since: string
        }[]
      }
      payment_transition_allowed: {
        Args: {
          p_from: Database["public"]["Enums"]["payment_status"]
          p_to: Database["public"]["Enums"]["payment_status"]
        }
        Returns: boolean
      }
      place_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      preview_promotions: {
        Args: { p_codes: string[]; p_customer_id: string; p_lines: Json }
        Returns: {
          code: string
          discount: number
          line_idx: number
          name_ar: string
          name_en: string
          promotion_id: string
        }[]
      }
      receive_purchase_order: {
        Args: {
          p_idempotency_key?: string
          p_invoice_reference?: string
          p_lines: Json
          p_note?: string
          p_po_id: string
        }
        Returns: string
      }
      record_backup_run: {
        Args: {
          p_detail: string
          p_location: string
          p_size_bytes: number
          p_started_at: string
          p_status: string
        }
        Returns: undefined
      }
      record_cart_void: {
        Args: { p_approval_id?: string; p_item_count: number; p_value: number }
        Returns: undefined
      }
      record_cash_drawer_event: {
        Args: {
          p_amount: number
          p_approval_id?: string
          p_reason: string
          p_shift_id: string
          p_type: Database["public"]["Enums"]["cash_drawer_event_type"]
        }
        Returns: {
          actor_id: string
          amount: number
          created_at: string
          event_type: Database["public"]["Enums"]["cash_drawer_event_type"]
          id: string
          reason: string
          return_id: string | null
          sale_id: string | null
          shift_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_drawer_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_ops_event: {
        Args: { p_detail?: Json; p_kind: string; p_severity: string }
        Returns: undefined
      }
      record_payment_event: {
        Args: {
          p_actor: string
          p_amount: number
          p_event_id: string
          p_from: Database["public"]["Enums"]["payment_status"]
          p_note: string
          p_payment_id: string
          p_provider: string
          p_source: string
          p_to: Database["public"]["Enums"]["payment_status"]
        }
        Returns: undefined
      }
      record_payment_result: {
        Args: {
          p_note?: string
          p_payment_id: string
          p_reference?: string
          p_status: Database["public"]["Enums"]["payment_status"]
        }
        Returns: undefined
      }
      record_stocktake_counts: {
        Args: { p_counts: Json; p_stocktake_id: string }
        Returns: number
      }
      refresh_reorder_alerts: { Args: never; Returns: number }
      reopen_stocktake: { Args: { p_stocktake_id: string }; Returns: undefined }
      report_client_health: {
        Args: {
          p_oldest_age_seconds: number
          p_queued: number
          p_rejected: number
        }
        Returns: undefined
      }
      report_daily_summary: {
        Args: { p_from_day: string; p_to_day: string }
        Returns: {
          card_net: number
          cash_net: number
          closed: boolean
          day: string
          discount_total: number
          gross_sales: number
          net_after_refunds_gross: number
          net_sales_ex_vat: number
          override_count: number
          promo_discount: number
          refund_count: number
          refunds_gross: number
          sale_count: number
          vat_on_sales: number
          void_count: number
          void_value: number
        }[]
      }
      report_device_health: {
        Args: { p_detail?: string; p_device_id: string; p_health: string }
        Returns: undefined
      }
      report_outstanding_purchase_orders: {
        Args: never
        Returns: {
          expected_date: string
          name_ar: string
          name_en: string
          ordered_qty: number
          po_id: string
          po_number: number
          product_id: string
          received_qty: number
          remaining_qty: number
          remaining_value: number
          status: Database["public"]["Enums"]["purchase_order_status"]
          supplier_name: string
          unit_cost: number
        }[]
      }
      report_payment_reconciliation: {
        Args: { p_from: string; p_to: string }
        Returns: {
          amount: number
          created_at: string
          detail: string
          issue: string
          payment_id: string
          sale_id: string
        }[]
      }
      report_profit: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cost: number
          margin: number
          net_revenue: number
          profit: number
        }[]
      }
      report_received_cost: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cost_total: number
          qty: number
          receipt_count: number
          supplier_id: string
          supplier_name: string
          vat_total: number
        }[]
      }
      report_refunds_detail: {
        Args: { p_from_day: string; p_to_day: string }
        Returns: {
          actor_name: string
          created_at: string
          day: string
          reason: string
          refund_total: number
          restock: boolean
          return_id: string
          return_number: number
          sale_number: number
          tender: Database["public"]["Enums"]["payment_method"]
        }[]
      }
      report_reorder_suggestions: {
        Args: never
        Returns: {
          alert_id: string
          avg_daily_sales: number
          barcode: string
          cover_days: number
          days_of_cover: number
          explanation: string
          lead_time_days: number
          lookback_days: number
          low_stock_threshold: number
          min_order_qty: number
          name_ar: string
          name_en: string
          on_order_qty: number
          pack_size: number
          product_id: string
          stock_qty: number
          suggested_qty: number
          supplier_id: string
          supplier_name: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
        }[]
      }
      report_sales_by_cashier: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cashier_id: string
          full_name: string
          revenue: number
          sale_count: number
        }[]
      }
      report_sales_by_category: {
        Args: { p_from: string; p_to: string }
        Returns: {
          category_id: string
          name_ar: string
          name_en: string
          qty: number
          revenue: number
        }[]
      }
      report_sales_over_time: {
        Args: { p_bucket?: string; p_from: string; p_to: string }
        Returns: {
          avg_basket: number
          bucket_start: string
          revenue: number
          sale_count: number
        }[]
      }
      report_stock_aging: {
        Args: { p_as_of_day?: string }
        Returns: {
          barcode: string
          bucket: string
          days_since_last_sale: number
          last_received_at: string
          last_sold_at: string
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          value_at_cost: number
        }[]
      }
      report_stock_movements: {
        Args: { p_from_day: string; p_to_day: string }
        Returns: {
          adjusted_qty: number
          barcode: string
          closing_qty: number
          name_ar: string
          name_en: string
          opening_qty: number
          product_id: string
          received_qty: number
          returned_qty: number
          sold_qty: number
        }[]
      }
      report_stock_valuation: {
        Args: never
        Returns: {
          barcode: string
          category_id: string
          category_name_ar: string
          category_name_en: string
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          retail_value_gross: number
          retail_value_net: number
          unit_cost: number
          unit_price: number
          value_at_cost: number
        }[]
      }
      report_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          avg_basket: number
          net_revenue: number
          refunds: number
          revenue: number
          sale_count: number
        }[]
      }
      report_tender_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          charges: number
          net: number
          payment_count: number
          provider: string
          refunds: number
          tender: Database["public"]["Enums"]["payment_method"]
        }[]
      }
      report_top_products: {
        Args: { p_by?: string; p_from: string; p_limit?: number; p_to: string }
        Returns: {
          name_ar: string
          name_en: string
          product_id: string
          qty: number
          revenue: number
        }[]
      }
      report_vat: {
        Args: { p_from_day: string; p_to_day: string }
        Returns: {
          gross_sales: number
          input_vat_purchases: number
          net_sales: number
          net_vat: number
          rate_bp: number
          refund_gross: number
          refund_net: number
          refund_vat: number
          vat_sales: number
        }[]
      }
      report_voids_detail: {
        Args: { p_from_day: string; p_to_day: string }
        Returns: {
          actor_name: string
          amount: number
          created_at: string
          day: string
          event_id: string
          item_count: number
        }[]
      }
      reports_guard: { Args: never; Returns: undefined }
      request_print: {
        Args: {
          p_document_id: string
          p_document_type: string
          p_kind: string
          p_reason?: string
        }
        Returns: string
      }
      resolve_payment: {
        Args: { p_note: string; p_payment_id: string }
        Returns: undefined
      }
      set_customer_consent: {
        Args: { p_consent: boolean; p_customer_id: string; p_source?: string }
        Returns: undefined
      }
      set_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: undefined
      }
      set_product_supplier: { Args: { p: Json }; Returns: undefined }
      set_promotion_active: {
        Args: { p_active: boolean; p_promotion_id: string }
        Returns: undefined
      }
      set_staff_capabilities: {
        Args: {
          p_capabilities: Database["public"]["Enums"]["capability"][]
          p_staff_id: string
        }
        Returns: undefined
      }
      shift_tender_totals: {
        Args: { p_shift_id: string }
        Returns: {
          amount: number
          tender: Database["public"]["Enums"]["payment_method"]
        }[]
      }
      stocktake_conflicts: {
        Args: { p_stocktake_id: string }
        Returns: {
          counted_qty: number
          current_qty: number
          expected_qty: number
          product_id: string
        }[]
      }
      stocktake_variance_report: {
        Args: { p_stocktake_id: string }
        Returns: {
          barcode: string
          conflict: boolean
          counted_qty: number
          current_qty: number
          expected_qty: number
          name_ar: string
          name_en: string
          product_id: string
          reason: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
          variance_qty: number
          variance_value: number
        }[]
      }
      store_tz: { Args: never; Returns: string }
      submit_stocktake: { Args: { p_stocktake_id: string }; Returns: undefined }
      update_store_settings: { Args: { p: Json }; Returns: undefined }
      upsert_device: { Args: { p: Json }; Returns: string }
      valid_payment_reference: {
        Args: { p_reference: string }
        Returns: boolean
      }
      verify_database_integrity: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          ok: boolean
        }[]
      }
      verify_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: string
      }
      write_audit_event: {
        Args: {
          p_action: string
          p_actor_id: string
          p_approved_by: string
          p_metadata: Json
          p_request_id?: string
          p_target_id: string
          p_target_type: string
        }
        Returns: {
          action: string
          actor_id: string
          approved_by: string | null
          created_at: string
          id: string
          metadata: Json
          request_id: string | null
          target_id: string | null
          target_type: string
        }
        SetofOptions: {
          from: "*"
          to: "audit_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      capability:
        | "return.approve"
        | "cart.void"
        | "discount.override"
        | "stock.correct"
        | "cash.drawer.adjust"
        | "shift.close.override"
        | "customer.manage"
      cash_drawer_event_type:
        | "paid_in"
        | "paid_out"
        | "safe_drop"
        | "cash_refund"
        | "cash_sale"
      device_kind: "printer" | "scanner" | "cash_drawer"
      drawer_reason:
        | "cash_sale"
        | "cash_refund"
        | "cash_drawer_event"
        | "no_sale"
      payment_direction: "charge" | "refund"
      payment_method: "cash" | "card" | "split"
      payment_status:
        | "pending"
        | "authorized"
        | "captured"
        | "declined"
        | "failed"
        | "voided"
      product_unit: "piece" | "kg"
      promotion_discount_kind: "percent" | "fixed"
      promotion_scope: "items" | "order"
      purchase_order_status:
        | "draft"
        | "ordered"
        | "partially_received"
        | "received"
        | "closed"
        | "cancelled"
      stock_movement_reason:
        | "sale"
        | "received"
        | "damaged"
        | "correction"
        | "return"
      stocktake_scope: "full" | "cycle"
      stocktake_status: "open" | "submitted" | "approved" | "cancelled"
      user_role: "admin" | "cashier"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      capability: [
        "return.approve",
        "cart.void",
        "discount.override",
        "stock.correct",
        "cash.drawer.adjust",
        "shift.close.override",
        "customer.manage",
      ],
      cash_drawer_event_type: [
        "paid_in",
        "paid_out",
        "safe_drop",
        "cash_refund",
        "cash_sale",
      ],
      device_kind: ["printer", "scanner", "cash_drawer"],
      drawer_reason: [
        "cash_sale",
        "cash_refund",
        "cash_drawer_event",
        "no_sale",
      ],
      payment_direction: ["charge", "refund"],
      payment_method: ["cash", "card", "split"],
      payment_status: [
        "pending",
        "authorized",
        "captured",
        "declined",
        "failed",
        "voided",
      ],
      product_unit: ["piece", "kg"],
      promotion_discount_kind: ["percent", "fixed"],
      promotion_scope: ["items", "order"],
      purchase_order_status: [
        "draft",
        "ordered",
        "partially_received",
        "received",
        "closed",
        "cancelled",
      ],
      stock_movement_reason: [
        "sale",
        "received",
        "damaged",
        "correction",
        "return",
      ],
      stocktake_scope: ["full", "cycle"],
      stocktake_status: ["open", "submitted", "approved", "cancelled"],
      user_role: ["admin", "cashier"],
    },
  },
} as const
