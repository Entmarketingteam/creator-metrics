-- ============================================================================
-- SECURITY FIXES — Supabase lint: 2026-03-03
-- Addresses:
--   - rls_disabled_in_public  (ERROR ×13)
--   - security_definer_view   (ERROR ×4)
--   - function_search_path_mutable (WARN ×3)
-- ============================================================================


-- ============================================================================
-- 1. ENABLE ROW LEVEL SECURITY ON ALL FLAGGED TABLES
-- Service role bypasses RLS automatically — no app changes needed.
-- Anon/public access is blocked by default once RLS is enabled with no policy.
-- ============================================================================

ALTER TABLE public.creators                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_snapshots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_snapshots             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_earnings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopmy_opportunity_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopmy_payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopmy_brand_rates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavely_links                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltk_posts                   ENABLE ROW LEVEL SECURITY;

-- ltk_snapshots — created directly in Supabase (not in local migrations)
ALTER TABLE public.ltk_snapshots               ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. FIX SECURITY DEFINER VIEWS → SECURITY INVOKER
-- Requires Postgres 15+ (Supabase default since ~2023).
-- SECURITY INVOKER means the view runs as the querying user and respects
-- their RLS policies, rather than the view creator's permissions.
-- ============================================================================

ALTER VIEW public.unified_earnings     SET (security_invoker = on);
ALTER VIEW public.earnings_summary     SET (security_invoker = on);
ALTER VIEW public.platform_comparison  SET (security_invoker = on);
ALTER VIEW public.top_performers       SET (security_invoker = on);


-- ============================================================================
-- 3. FIX MUTABLE SEARCH_PATH ON FUNCTIONS
-- Setting search_path = '' forces fully-qualified names and prevents
-- search_path injection attacks.
-- ============================================================================

-- refresh_monthly_metrics(uuid, date)
CREATE OR REPLACE FUNCTION public.refresh_monthly_metrics(p_user_id uuid, p_month date)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.monthly_platform_metrics (
        user_id, metric_month, platform,
        total_clicks, total_orders, total_items_sold,
        gross_sales, total_commission,
        avg_order_value, avg_commission_per_order, conversion_rate
    )
    SELECT
        user_id,
        DATE_TRUNC('month', metric_date)::date,
        platform,
        SUM(clicks),
        SUM(orders),
        SUM(items_sold),
        SUM(gross_sales),
        SUM(commission),
        CASE WHEN SUM(orders) > 0 THEN SUM(gross_sales) / SUM(orders) ELSE 0 END,
        CASE WHEN SUM(orders) > 0 THEN SUM(commission) / SUM(orders) ELSE 0 END,
        CASE WHEN SUM(clicks) > 0 THEN (SUM(orders)::numeric / SUM(clicks) * 100) ELSE 0 END
    FROM public.daily_platform_metrics
    WHERE user_id = p_user_id
      AND metric_date >= p_month
      AND metric_date < p_month + INTERVAL '1 month'
    GROUP BY user_id, DATE_TRUNC('month', metric_date), platform
    ON CONFLICT (user_id, metric_month, platform)
    DO UPDATE SET
        total_clicks = EXCLUDED.total_clicks,
        total_orders = EXCLUDED.total_orders,
        total_items_sold = EXCLUDED.total_items_sold,
        gross_sales = EXCLUDED.gross_sales,
        total_commission = EXCLUDED.total_commission,
        avg_order_value = EXCLUDED.avg_order_value,
        avg_commission_per_order = EXCLUDED.avg_commission_per_order,
        conversion_rate = EXCLUDED.conversion_rate,
        updated_at = now();
END;
$$;

-- update_updated_at — trigger function (no args), fixes search_path via ALTER FUNCTION.
-- If this fails due to arg mismatch, run in Supabase SQL editor after checking
-- the exact signature: \df public.update_updated_at
ALTER FUNCTION public.update_updated_at() SET search_path = '';

-- calculate_content_epc — fix search_path.
-- If this fails, check exact signature in Supabase SQL editor with:
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'calculate_content_epc';
-- Then re-run with the correct args, e.g.:
--   ALTER FUNCTION public.calculate_content_epc(text, numeric) SET search_path = '';
ALTER FUNCTION public.calculate_content_epc() SET search_path = '';
