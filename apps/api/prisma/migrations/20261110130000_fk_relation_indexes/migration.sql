-- F-58: eight relation columns carried a foreign key but no index, while
-- docs/database.md claims "indexes on all foreign keys". Every relation walk
-- (`include:` from the parent side, deletion checks, per-parent aggregation)
-- degraded to a scan as the tables grew. Additive, forward-only change, kept in
-- its own migration so it is independently revertible.
--
-- Blast radius: eight CREATE INDEX statements, each briefly locking its table
-- while the index builds (pre-launch row counts today; re-check at volume).
-- No data change, no constraint change. Rollback: DROP INDEX "<name>"; per
-- index, in any order.
--
-- The indexes are justified by the relation predicates in the code — several of
-- these tables are still tiny locally, so the planner may keep choosing a scan
-- on today's data (the project skill requires reading the plan at volume; this
-- migration is the growth path the documented invariant claims to have).
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX "Booking_farmId_idx" ON "Booking"("farmId");
CREATE INDEX "Booking_serviceId_idx" ON "Booking"("serviceId");
CREATE INDEX "Booking_providerId_idx" ON "Booking"("providerId");
CREATE INDEX "ProcurementOrder_farmId_idx" ON "ProcurementOrder"("farmId");
CREATE INDEX "FarmEvent_plotId_idx" ON "FarmEvent"("plotId");
CREATE INDEX "DiseaseCase_cropCycleId_idx" ON "DiseaseCase"("cropCycleId");
CREATE INDEX "AiUsageLog_userId_idx" ON "AiUsageLog"("userId");
