"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineConfig = void 0;
exports.engineConfig = {
    thresholds: {
        ctrLow: 0.012,
        ctrCritical: 0.008,
        conversionRateLow: 0.03,
        landingPageDropoffHigh: 0.35,
        sessionDropoffHigh: 0.25,
        checkoutDropoffHigh: 0.45,
        roasLow: 1.5,
        frequencyHigh: 3.5,
        bounceRateHigh: 0.58,
        cpaHigh: 80
    },
    weights: {
        creative: 0.28,
        audience: 0.22,
        landingPage: 0.28,
        budget: 0.22
    },
    actionPriority: {
        impactWeight: 0.5,
        effortWeight: 0.15,
        urgencyWeight: 0.35
    }
};
