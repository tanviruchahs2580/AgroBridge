# Route inventory (generated — do not edit by hand)

Regenerate with `node apps/api/scripts/route-matrix.mjs`; drift fails `tests/route-matrix.test.ts`
and the `quality-gates` CI job. `auth` values: `requireAuth`, `requirePermission:<scope>`,
`requireAuth (file-level use on …)` (module declares `router.use(requireAuth)` for that router),
or `PUBLIC` (rate-limited and validated, but unauthenticated by design — see docs/api.md).

Total: 67 routes. Summary: {"requirePermission:admin:metrics":3,"requirePermission:audit:read":1,"requirePermission:users:manage":1,"requirePermission:users:read":1,"requirePermission:finance:withdrawals":2,"requireAuth (file-level use on aiRouter)":3,"requireAuth":9,"PUBLIC":7,"requirePermission:disease:review":1,"requireAuth (file-level use on diseaseRouter)":3,"requireAuth (file-level use on farmsRouter)":4,"requireAuth (file-level use on eventsRouter)":2,"requireAuth (file-level use on ordersRouter)":5,"requireAuth (file-level use on cartRouter)":3,"requireAuth (file-level use on productsRouter)":1,"requireAuth (file-level use on paymentsRouter)":4,"requirePermission:payments:refund":1,"requirePermission:procurement:pay":1,"requireAuth (file-level use on walletRouter)":4,"requirePermission:procurement:review":1,"requireAuth (file-level use on procurementRouter)":2,"requirePermission:bookings:assign":1,"requireAuth (file-level use on bookingsRouter)":4,"requireAuth (file-level use on servicesRouter)":1,"requirePermission:services:manage":1,"requirePermission:providers:manage":1}

| module | method | path | auth |
|---|---|---|---|
| admin | GET | /ai-usage | requirePermission:admin:metrics |
| admin | GET | /analytics/summary | requirePermission:admin:metrics |
| admin | GET | /audit-logs | requirePermission:audit:read |
| admin | GET | /metrics | requirePermission:admin:metrics |
| admin | PATCH | /users/:id | requirePermission:users:manage |
| admin | GET | /users | requirePermission:users:read |
| admin | POST | /withdrawals/:id/decision | requirePermission:finance:withdrawals |
| admin | GET | /withdrawals | requirePermission:finance:withdrawals |
| aiagent | POST | /advisory | requireAuth (file-level use on aiRouter) |
| aiagent | POST | /history/:id/feedback | requireAuth (file-level use on aiRouter) |
| aiagent | GET | /history | requireAuth (file-level use on aiRouter) |
| analytics | POST | /events | requireAuth |
| auth | POST | /login | PUBLIC |
| auth | POST | /logout | requireAuth |
| auth | GET | /me/export | requireAuth |
| auth | GET | /me | requireAuth |
| auth | PATCH | /me | requireAuth |
| auth | DELETE | /me | requireAuth |
| auth | POST | /otp/request | requireAuth |
| auth | POST | /otp/verify | requireAuth |
| auth | POST | /password/forgot | PUBLIC |
| auth | POST | /password/reset | PUBLIC |
| auth | POST | /refresh | PUBLIC |
| auth | POST | /register | PUBLIC |
| disease | POST | /cases/:id/review | requirePermission:disease:review |
| disease | GET | /cases/:id | requireAuth (file-level use on diseaseRouter) |
| disease | POST | /cases | requireAuth (file-level use on diseaseRouter) |
| disease | GET | /cases | requireAuth (file-level use on diseaseRouter) |
| farms | PATCH | /:id | requireAuth (file-level use on farmsRouter) |
| farms | DELETE | /:id | requireAuth (file-level use on farmsRouter) |
| farms | GET | /events | requireAuth (file-level use on eventsRouter) |
| farms | POST | /events | requireAuth (file-level use on eventsRouter) |
| farms | GET | / | requireAuth (file-level use on farmsRouter) |
| farms | POST | / | requireAuth (file-level use on farmsRouter) |
| marketplace | POST | /:id/cancel | requireAuth (file-level use on ordersRouter) |
| marketplace | GET | /:id | requireAuth (file-level use on ordersRouter) |
| marketplace | DELETE | /:id | requireAuth (file-level use on ordersRouter) |
| marketplace | POST | /checkout | requireAuth (file-level use on ordersRouter) |
| marketplace | POST | /items | requireAuth (file-level use on cartRouter) |
| marketplace | GET | / | requireAuth (file-level use on productsRouter) |
| marketplace | POST | / | requireAuth,requirePermission:products:manage |
| marketplace | GET | / | requireAuth (file-level use on cartRouter) |
| marketplace | GET | / | requireAuth (file-level use on ordersRouter) |
| marketplace | DELETE | /items/:productId | requireAuth (file-level use on cartRouter) |
| payments-webhook | POST | /webhook/sslcommerz | PUBLIC |
| payments | POST | /:id/confirm | requireAuth (file-level use on paymentsRouter) |
| payments | POST | /:id/refund | requirePermission:payments:refund |
| payments | GET | /:id/status | requireAuth (file-level use on paymentsRouter) |
| payments | POST | /payouts | requirePermission:procurement:pay |
| payments | GET | / | requireAuth (file-level use on paymentsRouter) |
| payments | GET | / | requireAuth (file-level use on walletRouter) |
| payments | POST | /intent | requireAuth (file-level use on paymentsRouter) |
| payments | GET | /plans | PUBLIC |
| payments | GET | /summary | requireAuth (file-level use on walletRouter) |
| payments | POST | /withdrawals | requireAuth (file-level use on walletRouter) |
| payments | GET | /withdrawals | requireAuth (file-level use on walletRouter) |
| procurement | POST | /:id/review | requirePermission:procurement:review |
| procurement | GET | / | requireAuth (file-level use on procurementRouter) |
| procurement | POST | /offers | requireAuth (file-level use on procurementRouter) |
| services | POST | /:id/assign | requirePermission:bookings:assign |
| services | POST | /:id/rating | requireAuth (file-level use on bookingsRouter) |
| services | POST | /:id/status | requireAuth (file-level use on bookingsRouter) |
| services | GET | / | requireAuth (file-level use on servicesRouter) |
| services | POST | / | requirePermission:services:manage |
| services | POST | / | requireAuth (file-level use on bookingsRouter) |
| services | GET | / | requireAuth (file-level use on bookingsRouter) |
| services | POST | /providers | requirePermission:providers:manage |
