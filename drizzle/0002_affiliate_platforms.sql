-- ============================================================================
-- CREATORMETRICS: COMPREHENSIVE AFFILIATE PLATFORM SCHEMA
-- ============================================================================
-- This schema supports: LTK, ShopMy, Amazon Associates, Mavely
-- Architecture: Raw Snapshots → Normalized Sales → Unified Views
-- Applied: 2026-02-27
-- Notes:
--   - profiles(id) → users(id) (profiles table does not exist in this project)
--   - sales.user_id → NULL::uuid (sales table uses creator_id text, not user_id)
--   - sales.id cast to text for UNION type consistency
--   - sales.platform cast to text in WHERE clause (USER-DEFINED enum)
--   - Function dollar-quoting uses $$ throughout
--   - RLS policies use users.full_name instead of profiles.display_name
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 1: RAW SNAPSHOT TABLES (Platform-Specific)
-- ============================================================================

-- 1.2 SHOPMY SNAPSHOTS
CREATE TABLE IF NOT EXISTS shopmy_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extracted_at timestamptz NOT NULL DEFAULT now(),
    creator_name text NOT NULL,
    source text NOT NULL DEFAULT 'n8n_api',
    shopmy_user_id text,
    user_info jsonb DEFAULT '{}'::jsonb,
    payments jsonb DEFAULT '[]'::jsonb,
    payout_summary jsonb DEFAULT '{}'::jsonb,
    pins jsonb DEFAULT '[]'::jsonb,
    pins_count integer DEFAULT 0,
    commissions jsonb DEFAULT '[]'::jsonb,
    commissions_count integer DEFAULT 0,
    total_clicks integer DEFAULT 0,
    total_orders integer DEFAULT 0,
    total_commission numeric(12,2) DEFAULT 0,
    pending_commission numeric(12,2) DEFAULT 0,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopmy_snapshots_creator ON shopmy_snapshots(creator_name);
CREATE INDEX IF NOT EXISTS idx_shopmy_snapshots_extracted ON shopmy_snapshots(extracted_at DESC);

-- 1.3 AMAZON ASSOCIATES SNAPSHOTS
CREATE TABLE IF NOT EXISTS amazon_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extracted_at timestamptz NOT NULL DEFAULT now(),
    creator_name text NOT NULL,
    source text NOT NULL DEFAULT 'n8n_api',
    report_date date NOT NULL,
    tracking_id text NOT NULL,
    tracking_tag_name text,
    earnings_report jsonb DEFAULT '[]'::jsonb,
    orders_report jsonb DEFAULT '[]'::jsonb,
    orders_count integer DEFAULT 0,
    tracking_report jsonb DEFAULT '{}'::jsonb,
    link_type_report jsonb DEFAULT '[]'::jsonb,
    daily_trends jsonb DEFAULT '[]'::jsonb,
    category_performance jsonb DEFAULT '[]'::jsonb,
    bounties jsonb DEFAULT '[]'::jsonb,
    total_clicks integer DEFAULT 0,
    total_items_shipped integer DEFAULT 0,
    total_revenue numeric(12,2) DEFAULT 0,
    total_ad_fees numeric(12,2) DEFAULT 0,
    total_bounties numeric(12,2) DEFAULT 0,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amazon_snapshots_creator ON amazon_snapshots(creator_name);
CREATE INDEX IF NOT EXISTS idx_amazon_snapshots_tracking ON amazon_snapshots(tracking_id);
CREATE INDEX IF NOT EXISTS idx_amazon_snapshots_date ON amazon_snapshots(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_snapshots_extracted ON amazon_snapshots(extracted_at DESC);

-- 1.4 MAVELY SNAPSHOTS
CREATE TABLE IF NOT EXISTS mavely_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extracted_at timestamptz NOT NULL DEFAULT now(),
    creator_name text NOT NULL,
    source text NOT NULL DEFAULT 'n8n_api',
    period_start date,
    period_end date,
    mavely_user_id text,
    user_info jsonb DEFAULT '{}'::jsonb,
    analytics_overview jsonb DEFAULT '{}'::jsonb,
    top_links jsonb DEFAULT '[]'::jsonb,
    top_links_count integer DEFAULT 0,
    transactions jsonb DEFAULT '[]'::jsonb,
    transactions_count integer DEFAULT 0,
    retailer_performance jsonb DEFAULT '[]'::jsonb,
    brand_performance jsonb DEFAULT '[]'::jsonb,
    traffic_sources jsonb DEFAULT '[]'::jsonb,
    earnings_summary jsonb DEFAULT '{}'::jsonb,
    total_sales numeric(12,2) DEFAULT 0,
    total_commission numeric(12,2) DEFAULT 0,
    total_clicks integer DEFAULT 0,
    total_orders integer DEFAULT 0,
    conversion_rate numeric(5,2) DEFAULT 0,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mavely_snapshots_creator ON mavely_snapshots(creator_name);
CREATE INDEX IF NOT EXISTS idx_mavely_snapshots_period ON mavely_snapshots(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_mavely_snapshots_extracted ON mavely_snapshots(extracted_at DESC);


-- ============================================================================
-- SECTION 2: NORMALIZED TRANSACTION TABLES
-- ============================================================================

-- 2.1 SHOPMY TRANSACTIONS
CREATE TABLE IF NOT EXISTS shopmy_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid REFERENCES shopmy_snapshots(id) ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    shopmy_commission_id text,
    shopmy_order_id text,
    shopmy_pin_id text,
    transaction_date timestamptz NOT NULL,
    product_name text NOT NULL,
    brand text,
    retailer text,
    category text,
    order_amount numeric(12,2) NOT NULL,
    commission_amount numeric(12,2) NOT NULL,
    commission_rate numeric(5,2),
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
    ordered_at timestamptz,
    approved_at timestamptz,
    paid_at timestamptz,
    customer_location text,
    source_url text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT unique_shopmy_transaction UNIQUE (shopmy_commission_id)
);
CREATE INDEX IF NOT EXISTS idx_shopmy_txn_user ON shopmy_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_shopmy_txn_date ON shopmy_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_shopmy_txn_status ON shopmy_transactions(status);

-- 2.2 AMAZON TRANSACTIONS
CREATE TABLE IF NOT EXISTS amazon_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid REFERENCES amazon_snapshots(id) ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    amazon_order_id text,
    asin text,
    tracking_id text NOT NULL,
    transaction_date timestamptz NOT NULL,
    product_title text NOT NULL,
    category text,
    seller text,
    items_ordered integer DEFAULT 1,
    items_shipped integer DEFAULT 0,
    price numeric(12,2) NOT NULL,
    revenue numeric(12,2),
    ad_fees numeric(12,2) NOT NULL,
    commission_rate numeric(5,2),
    link_type text,
    device_type text,
    customer_country text,
    is_bounty boolean DEFAULT false,
    bounty_program text,
    bounty_amount numeric(12,2),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT unique_amazon_transaction UNIQUE (amazon_order_id, asin, tracking_id)
);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_user ON amazon_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_date ON amazon_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_tracking ON amazon_transactions(tracking_id);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_asin ON amazon_transactions(asin);
CREATE INDEX IF NOT EXISTS idx_amazon_txn_link_type ON amazon_transactions(link_type);

-- 2.3 MAVELY TRANSACTIONS
CREATE TABLE IF NOT EXISTS mavely_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid REFERENCES mavely_snapshots(id) ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    mavely_transaction_id text,
    mavely_order_id text,
    mavely_link_id text,
    transaction_date timestamptz NOT NULL,
    product_name text NOT NULL,
    brand text,
    retailer text NOT NULL,
    category text,
    order_amount numeric(12,2) NOT NULL,
    commission_amount numeric(12,2) NOT NULL,
    commission_rate numeric(5,2),
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
    ordered_at timestamptz,
    approved_at timestamptz,
    paid_at timestamptz,
    traffic_source text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT unique_mavely_transaction UNIQUE (mavely_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_mavely_txn_user ON mavely_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_mavely_txn_date ON mavely_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_mavely_txn_status ON mavely_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mavely_txn_retailer ON mavely_transactions(retailer);


-- ============================================================================
-- SECTION 3: AGGREGATED METRICS TABLES
-- ============================================================================

-- 3.1 DAILY PLATFORM METRICS
CREATE TABLE IF NOT EXISTS daily_platform_metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    metric_date date NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ltk', 'shopmy', 'amazon', 'mavely')),
    clicks integer DEFAULT 0,
    orders integer DEFAULT 0,
    items_sold integer DEFAULT 0,
    gross_sales numeric(12,2) DEFAULT 0,
    commission numeric(12,2) DEFAULT 0,
    conversion_rate numeric(5,2) DEFAULT 0,
    pending_commission numeric(12,2) DEFAULT 0,
    approved_commission numeric(12,2) DEFAULT 0,
    paid_commission numeric(12,2) DEFAULT 0,
    reversed_commission numeric(12,2) DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT unique_daily_platform UNIQUE (user_id, metric_date, platform)
);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_date ON daily_platform_metrics(user_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_platform ON daily_platform_metrics(platform);

-- 3.2 MONTHLY PLATFORM METRICS
CREATE TABLE IF NOT EXISTS monthly_platform_metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    metric_month date NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ltk', 'shopmy', 'amazon', 'mavely')),
    total_clicks integer DEFAULT 0,
    total_orders integer DEFAULT 0,
    total_items_sold integer DEFAULT 0,
    gross_sales numeric(12,2) DEFAULT 0,
    total_commission numeric(12,2) DEFAULT 0,
    avg_order_value numeric(12,2) DEFAULT 0,
    avg_commission_per_order numeric(12,2) DEFAULT 0,
    conversion_rate numeric(5,2) DEFAULT 0,
    top_brands jsonb DEFAULT '[]'::jsonb,
    top_products jsonb DEFAULT '[]'::jsonb,
    top_categories jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT unique_monthly_platform UNIQUE (user_id, metric_month, platform)
);
CREATE INDEX IF NOT EXISTS idx_monthly_metrics_user_month ON monthly_platform_metrics(user_id, metric_month DESC);


-- ============================================================================
-- SECTION 4: UNIFIED VIEWS
-- ============================================================================

-- 4.1 UNIFIED EARNINGS VIEW
CREATE OR REPLACE VIEW unified_earnings AS
-- LTK Sales (sales.id is integer → cast to text; sales has no user_id → NULL)
SELECT
    s.id::text AS id,
    NULL::uuid AS user_id,
    'ltk'::text AS platform,
    s.sale_date AS transaction_date,
    s.product_name,
    s.brand,
    NULL::text AS retailer,
    NULL::text AS category,
    s.order_value AS gross_amount,
    s.commission_amount,
    s.status::text AS status,
    s.created_at
FROM sales s
WHERE s.platform::text = 'LTK'

UNION ALL

SELECT
    st.id::text AS id,
    st.user_id,
    'shopmy'::text AS platform,
    st.transaction_date,
    st.product_name,
    st.brand,
    st.retailer,
    st.category,
    st.order_amount AS gross_amount,
    st.commission_amount,
    st.status,
    st.created_at
FROM shopmy_transactions st

UNION ALL

SELECT
    at.id::text AS id,
    at.user_id,
    'amazon'::text AS platform,
    at.transaction_date,
    at.product_title AS product_name,
    NULL::text AS brand,
    at.seller AS retailer,
    at.category,
    at.revenue AS gross_amount,
    at.ad_fees AS commission_amount,
    'approved'::text AS status,
    at.created_at
FROM amazon_transactions at

UNION ALL

SELECT
    mt.id::text AS id,
    mt.user_id,
    'mavely'::text AS platform,
    mt.transaction_date,
    mt.product_name,
    mt.brand,
    mt.retailer,
    mt.category,
    mt.order_amount AS gross_amount,
    mt.commission_amount,
    mt.status,
    mt.created_at
FROM mavely_transactions mt;

-- 4.2 EARNINGS SUMMARY VIEW
CREATE OR REPLACE VIEW earnings_summary AS
SELECT
    user_id,
    platform,
    DATE_TRUNC('day', transaction_date)::date AS period_date,
    'daily'::text AS period_type,
    COUNT(*) AS transaction_count,
    SUM(gross_amount) AS total_gross,
    SUM(commission_amount) AS total_commission,
    AVG(commission_amount) AS avg_commission
FROM unified_earnings
GROUP BY user_id, platform, DATE_TRUNC('day', transaction_date)

UNION ALL

SELECT
    user_id,
    platform,
    DATE_TRUNC('week', transaction_date)::date AS period_date,
    'weekly'::text AS period_type,
    COUNT(*) AS transaction_count,
    SUM(gross_amount) AS total_gross,
    SUM(commission_amount) AS total_commission,
    AVG(commission_amount) AS avg_commission
FROM unified_earnings
GROUP BY user_id, platform, DATE_TRUNC('week', transaction_date)

UNION ALL

SELECT
    user_id,
    platform,
    DATE_TRUNC('month', transaction_date)::date AS period_date,
    'monthly'::text AS period_type,
    COUNT(*) AS transaction_count,
    SUM(gross_amount) AS total_gross,
    SUM(commission_amount) AS total_commission,
    AVG(commission_amount) AS avg_commission
FROM unified_earnings
GROUP BY user_id, platform, DATE_TRUNC('month', transaction_date);

-- 4.3 PLATFORM COMPARISON VIEW
CREATE OR REPLACE VIEW platform_comparison AS
SELECT
    user_id,
    DATE_TRUNC('month', transaction_date)::date AS month,
    SUM(CASE WHEN platform = 'ltk' THEN commission_amount ELSE 0 END) AS ltk_commission,
    SUM(CASE WHEN platform = 'shopmy' THEN commission_amount ELSE 0 END) AS shopmy_commission,
    SUM(CASE WHEN platform = 'amazon' THEN commission_amount ELSE 0 END) AS amazon_commission,
    SUM(CASE WHEN platform = 'mavely' THEN commission_amount ELSE 0 END) AS mavely_commission,
    SUM(commission_amount) AS total_commission,
    COUNT(CASE WHEN platform = 'ltk' THEN 1 END) AS ltk_transactions,
    COUNT(CASE WHEN platform = 'shopmy' THEN 1 END) AS shopmy_transactions,
    COUNT(CASE WHEN platform = 'amazon' THEN 1 END) AS amazon_transactions,
    COUNT(CASE WHEN platform = 'mavely' THEN 1 END) AS mavely_transactions,
    COUNT(*) AS total_transactions
FROM unified_earnings
GROUP BY user_id, DATE_TRUNC('month', transaction_date)
ORDER BY month DESC;

-- 4.4 TOP PERFORMERS VIEW
CREATE OR REPLACE VIEW top_performers AS
SELECT
    user_id,
    product_name,
    brand,
    platform,
    COUNT(*) AS order_count,
    SUM(gross_amount) AS total_gross,
    SUM(commission_amount) AS total_commission,
    AVG(commission_amount) AS avg_commission_per_order
FROM unified_earnings
WHERE transaction_date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY user_id, product_name, brand, platform
ORDER BY total_commission DESC;


-- ============================================================================
-- SECTION 5: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE shopmy_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mavely_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopmy_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE amazon_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mavely_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_platform_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_platform_metrics ENABLE ROW LEVEL SECURITY;

-- Service role full access (for n8n pipelines)
CREATE POLICY "Service role full access on shopmy_snapshots" ON shopmy_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on amazon_snapshots" ON amazon_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on mavely_snapshots" ON mavely_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on shopmy_transactions" ON shopmy_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on amazon_transactions" ON amazon_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on mavely_transactions" ON mavely_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on daily_platform_metrics" ON daily_platform_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on monthly_platform_metrics" ON monthly_platform_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users read their own data
CREATE POLICY "Users read own shopmy_snapshots" ON shopmy_snapshots FOR SELECT TO authenticated USING (creator_name IN (SELECT full_name FROM users WHERE id = auth.uid()));
CREATE POLICY "Users read own amazon_snapshots" ON amazon_snapshots FOR SELECT TO authenticated USING (creator_name IN (SELECT full_name FROM users WHERE id = auth.uid()));
CREATE POLICY "Users read own mavely_snapshots" ON mavely_snapshots FOR SELECT TO authenticated USING (creator_name IN (SELECT full_name FROM users WHERE id = auth.uid()));
CREATE POLICY "Users read own shopmy_transactions" ON shopmy_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users read own amazon_transactions" ON amazon_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users read own mavely_transactions" ON mavely_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users read own daily_platform_metrics" ON daily_platform_metrics FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users read own monthly_platform_metrics" ON monthly_platform_metrics FOR SELECT TO authenticated USING (user_id = auth.uid());


-- ============================================================================
-- SECTION 6: HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_monthly_metrics(p_user_id uuid, p_month date)
RETURNS void AS $$
BEGIN
    INSERT INTO monthly_platform_metrics (
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
    FROM daily_platform_metrics
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
$$ LANGUAGE plpgsql;


-- ============================================================================
-- SECTION 7: COMMENTS
-- ============================================================================

COMMENT ON TABLE shopmy_snapshots IS 'Raw data snapshots from ShopMy API - preserves complete API responses';
COMMENT ON TABLE amazon_snapshots IS 'Raw data snapshots from Amazon Associates - preserves complete report data';
COMMENT ON TABLE mavely_snapshots IS 'Raw data snapshots from Mavely dashboard - preserves complete analytics data';
COMMENT ON TABLE shopmy_transactions IS 'Normalized individual transactions extracted from ShopMy snapshots';
COMMENT ON TABLE amazon_transactions IS 'Normalized individual transactions extracted from Amazon snapshots';
COMMENT ON TABLE mavely_transactions IS 'Normalized individual transactions extracted from Mavely snapshots';
COMMENT ON VIEW unified_earnings IS 'Unified view of all commission earnings across all platforms';
COMMENT ON VIEW earnings_summary IS 'Aggregated earnings by day/week/month per platform';
COMMENT ON VIEW platform_comparison IS 'Side-by-side monthly comparison of all platforms';
COMMENT ON VIEW top_performers IS 'Top performing products/brands across all platforms (last 90 days)';
