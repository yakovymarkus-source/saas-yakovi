import { BusinessProfile, businessProfileSchema } from '../../domain/campaignBuild';
import { validateWithSchema } from '../../engine/schemaValidator';

export async function runBusinessIntake(input: unknown): Promise<BusinessProfile> {
  const business = validateWithSchema(businessProfileSchema, input, 'Business intake');
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
