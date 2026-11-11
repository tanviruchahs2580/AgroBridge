-- Parity with the SQLite chain (20261110130000): the eight missing foreign-key
-- indexes (F-58). See the SQLite twin for the rationale, blast radius and
-- rollback path (DROP INDEX "<name>";).
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX "Booking_farmId_idx" ON "Booking"("farmId");
CREATE INDEX "Booking_serviceId_idx" ON "Booking"("serviceId");
CREATE INDEX "Booking_providerId_idx" ON "Booking"("providerId");
CREATE INDEX "ProcurementOrder_farmId_idx" ON "ProcurementOrder"("farmId");
CREATE INDEX "FarmEvent_plotId_idx" ON "FarmEvent"("plotId");
CREATE INDEX "DiseaseCase_cropCycleId_idx" ON "DiseaseCase"("cropCycleId");
CREATE INDEX "AiUsageLog_userId_idx" ON "AiUsageLog"("userId");
