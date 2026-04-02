"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBusinessIntake = runBusinessIntake;
const campaignBuild_1 = require("../../domain/campaignBuild");
const schemaValidator_1 = require("../../engine/schemaValidator");
async function runBusinessIntake(input) {
    const business = (0, schemaValidator_1.validateWithSchema)(campaignBuild_1.businessProfileSchema, input, 'Business intake');
    return {
        ...business,
        businessName: business.businessName.trim(),
        category: business.category.trim(),
        offer: business.offer.trim(),
        targetOutcome: business.targetOutcome.trim(),
        pricing: {
            currency: business.pricing.currency ?? 'USD',
            amount: business.pricing.amount ?? null,
            model: business.pricing.model
        },
        currentAssets: business.currentAssets ?? {},
        constraints: business.constraints ?? [],
        budget: {
            monthly: business.budget.monthly ?? null,
            testBudget: business.budget.testBudget ?? null
        }
    };
}
