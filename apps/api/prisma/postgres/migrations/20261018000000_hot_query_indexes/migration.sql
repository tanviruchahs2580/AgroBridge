-- Parity with the SQLite chain (API-7): hot-query indexes for the marketplace
-- product list (isActive + optional category, createdAt-ordered), order
-- history (userId + createdAt-ordered) and the createdAt-ordered admin audit
-- feed over an append-only table.
CREATE INDEX IF NOT EXISTS "Product_isActive_category_idx" ON "Product"("isActive", "category");
CREATE INDEX IF NOT EXISTS "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
