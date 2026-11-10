// Re-export shim — canonical path:../infrastructure/metrics.js
export { registry, httpRequestsTotal, httpRequestDuration, dbUp, aiRequestsTotal, paymentIntentsTotal, metricsMiddleware, requestsShedTotal, registerMountPrefixes, mountedPrefixFor, providerHealthGauge } from "../infrastructure/metrics.js";
