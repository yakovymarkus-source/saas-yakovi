"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMetrics = computeMetrics;
function divide(a, b) {
    return b > 0 ? a / b : 0;
}
function computeMetrics(metrics) {
    const cpa = metrics.leads > 0 ? metrics.spend / metrics.leads : null;
    const roas = metrics.spend > 0 ? metrics.revenue / metrics.spend : null;
    return {
        ctr: divide(metrics.clicks, metrics.impressions),
        cpc: divide(metrics.spend, metrics.clicks),
        cpa,
        conversionRate: divide(metrics.leads || metrics.purchases, metrics.clicks),
        landingPageDropoffRate: metrics.clicks > 0 ? Math.max(0, 1 - divide(metrics.landingPageViews, metrics.clicks)) : 0,
        sessionDropoffRate: metrics.landingPageViews > 0 ? Math.max(0, 1 - divide(metrics.sessions, metrics.landingPageViews)) : 0,
        checkoutDropoffRate: metrics.initiatedCheckout > 0 ? Math.max(0, 1 - divide(metrics.purchases, metrics.initiatedCheckout)) : 0,
        roas
    };
}
