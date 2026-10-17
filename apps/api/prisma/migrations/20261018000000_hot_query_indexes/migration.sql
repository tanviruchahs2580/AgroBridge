-- Hot-query indexes (API-7): marketplace product list filters isActive and
-- optionally category, then orders by createdAt; member/admin order history
-- filters userId and orders by createdAt; the admin audit feed is a
-- createdAt-ordered scan over an append-only table.
CREATE INDEX IF NOT EXISTS "Product_isActive_category_idx" ON "Product"("isActive", "category");
CREATE INDEX IF NOT EXISTS "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
