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
      audit_events: {
        Row: { action: string; actor_id: string; approved_by: string | null; created_at: string; id: string; metadata: Json; request_id: string | null; target_id: string | null; target_type: string }
        Insert: { action: string; actor_id: string; approved_by?: string | null; created_at?: string; id?: string; metadata?: Json; request_id?: string | null; target_id?: string | null; target_type: string }
        Update: { action?: string; actor_id?: string; approved_by?: string | null; created_at?: string; id?: string; metadata?: Json; request_id?: string | null; target_id?: string | null; target_type?: string }
        Relationships: []
      }
      manager_approvals: {
        Row: { action: string; approved_by: string; created_at: string; expires_at: string; id: string; request_hash: string; requested_by: string; used_at: string | null }
        Insert: { action: string; approved_by: string; created_at?: string; expires_at?: string; id?: string; request_hash: string; requested_by: string; used_at?: string | null }
        Update: { action?: string; approved_by?: string; created_at?: string; expires_at?: string; id?: string; request_hash?: string; requested_by?: string; used_at?: string | null }
        Relationships: []
      }
      staff_capabilities: {
        Row: { capability: Database["public"]["Enums"]["capability"]; created_at: string; granted_by: string; staff_id: string }
        Insert: { capability: Database["public"]["Enums"]["capability"]; created_at?: string; granted_by: string; staff_id: string }
        Update: { capability?: Database["public"]["Enums"]["capability"]; created_at?: string; granted_by?: string; staff_id?: string }
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
      discount_settings: {
        Row: { approval_threshold_bp: number; id: boolean }
        Insert: { approval_threshold_bp?: number; id?: boolean }
        Update: { approval_threshold_bp?: number; id?: boolean }
        Relationships: []
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
          unit_cost?: number
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
          created_at?: string
          discount_total?: number
          id?: string
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
        }
        Relationships: [
          {
            foreignKeyName: "shifts_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_drawer_events: {
        Row: { actor_id: string; amount: number; created_at: string; event_type: "paid_in" | "paid_out" | "safe_drop" | "cash_refund" | "cash_sale"; id: string; reason: string; return_id: string | null; sale_id: string | null; shift_id: string }
        Insert: { actor_id: string; amount: number; created_at?: string; event_type: "paid_in" | "paid_out" | "safe_drop" | "cash_refund" | "cash_sale"; id?: string; reason: string; return_id?: string | null; sale_id?: string | null; shift_id: string }
        Update: { actor_id?: string; amount?: number; created_at?: string; event_type?: "paid_in" | "paid_out" | "safe_drop" | "cash_refund" | "cash_sale"; id?: string; reason?: string; return_id?: string | null; sale_id?: string | null; shift_id?: string }
        Relationships: []
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
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
        Relationships: []
      }
      stocktake_items: {
        Row: {
          barcode: string
          counted_at: string | null
          counted_by: string | null
          counted_qty: number | null
          current_qty_at_approval: number | null
          expected_qty: number
          name_ar: string
          name_en: string
          applied_delta: number | null
          product_id: string
          reason: string | null
          resolution: "use_count" | "keep_current" | null
          stocktake_id: string
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
        }
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
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
          email?: string | null
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
        }
        Update: {
          active?: boolean
          email?: string | null
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          tax_id?: string | null
        }
        Relationships: []
      }
      purchasing_settings: {
        Row: { id: boolean; over_receipt_tolerance_pct: number }
        Insert: { id?: boolean; over_receipt_tolerance_pct?: number }
        Update: { id?: boolean; over_receipt_tolerance_pct?: number }
        Relationships: []
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
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
        Relationships: []
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
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
        Relationships: []
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
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
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
        Insert: { [_ in never]: never }
        Update: { [_ in never]: never }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_purchase_order: {
        Args: { p_expected_date?: string; p_lines: Json; p_note?: string; p_supplier_id: string }
        Returns: string
      }
      place_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      cancel_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      close_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      receive_purchase_order: {
        Args: { p_idempotency_key?: string; p_invoice_reference?: string; p_lines: Json; p_note?: string; p_po_id: string }
        Returns: string
      }
      report_outstanding_purchase_orders: {
        Args: Record<PropertyKey, never>
        Returns: {
          expected_date: string | null
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
      create_stocktake: {
        Args: {
          p_category_id?: string
          p_note?: string
          p_product_ids?: string[]
          p_scope: Database["public"]["Enums"]["stocktake_scope"]
        }
        Returns: string
      }
      record_stocktake_counts: {
        Args: { p_counts: Json; p_stocktake_id: string }
        Returns: number
      }
      submit_stocktake: { Args: { p_stocktake_id: string }; Returns: undefined }
      reopen_stocktake: { Args: { p_stocktake_id: string }; Returns: undefined }
      cancel_stocktake: { Args: { p_stocktake_id: string }; Returns: undefined }
      approve_stocktake: {
        Args: { p_resolutions?: Json; p_stocktake_id: string }
        Returns: number
      }
      stocktake_conflicts: {
        Args: { p_stocktake_id: string }
        Returns: { counted_qty: number; current_qty: number; expected_qty: number; product_id: string }[]
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
          reason: string | null
          unit: Database["public"]["Enums"]["product_unit"]
          unit_cost: number
          variance_qty: number
          variance_value: number
        }[]
      }
      adjust_stock: {
        Args: {
          p_note?: string
          p_approval_id?: string
          p_product_id: string
          p_qty_change: number
          p_reason: Database["public"]["Enums"]["stock_movement_reason"]
        }
        Returns: number
      }
      close_shift: {
        Args: { p_approval_id?: string | null; p_counted: number; p_shift_id: string }
        Returns: {
          cashier_id: string
          closed_at: string | null
          closing_counted: number | null
          created_at: string
          expected_cash: number | null
          id: string
          opened_at: string
          opening_float: number
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_cash_drawer_event: {
        Args: { p_amount: number; p_approval_id?: string; p_reason: string; p_shift_id: string; p_type: "paid_in" | "paid_out" | "safe_drop" }
        Returns: Database["public"]["Tables"]["cash_drawer_events"]["Row"]
      }
      record_cart_void: {
        Args: { p_approval_id?: string; p_item_count: number; p_value: number }
        Returns: undefined
      }
      create_sale: {
        Args: {
          p_amount_tendered?: number
          p_approval_id?: string
          p_cashier_id?: string
          p_client_sold_at?: string
          p_idempotency_key?: string
          p_items: Json
          p_payment_method: Database["public"]["Enums"]["payment_method"]
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
      create_return: {
        Args: {
          p_items: Json
          p_approval_id?: string | null
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
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      has_capability: { Args: { p_capability: Database["public"]["Enums"]["capability"] }; Returns: boolean }
      create_manager_approval: { Args: { p_action: string; p_pin: string; p_request_hash: string }; Returns: string }
      consume_manager_approval: { Args: { p_action: string; p_approval_id: string; p_request_hash: string }; Returns: string }
      report_profit: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cost: number
          margin: number
          net_revenue: number
          profit: number
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
      reports_guard: { Args: never; Returns: undefined }
      set_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: undefined
      }
      verify_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: string
      }
    }
    Enums: {
      capability: "return.approve" | "cart.void" | "discount.override" | "stock.correct" | "cash.drawer.adjust" | "shift.close.override"
      payment_method: "cash" | "card"
      product_unit: "piece" | "kg"
      stock_movement_reason: "sale" | "received" | "damaged" | "correction" | "return"
      purchase_order_status: "draft" | "ordered" | "partially_received" | "received" | "closed" | "cancelled"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      capability: ["return.approve", "cart.void", "discount.override", "stock.correct", "cash.drawer.adjust", "shift.close.override"],
      payment_method: ["cash", "card"],
      product_unit: ["piece", "kg"],
      stock_movement_reason: ["sale", "received", "damaged", "correction", "return"],
      purchase_order_status: ["draft", "ordered", "partially_received", "received", "closed", "cancelled"],
      stocktake_scope: ["full", "cycle"],
      stocktake_status: ["open", "submitted", "approved", "cancelled"],
      user_role: ["admin", "cashier"],
    },
  },
} as const
