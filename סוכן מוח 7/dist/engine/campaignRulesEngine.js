"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreAssetText = scoreAssetText;
exports.validateStrategyConsistency = validateStrategyConsistency;
exports.qualifyLandingCopy = qualifyLandingCopy;
exports.qualifyAdPack = qualifyAdPack;
exports.qualifyVideoPack = qualifyVideoPack;
exports.validateGeneratedAssets = validateGeneratedAssets;
exports.validateAssetConsistency = validateAssetConsistency;
exports.assertProductionReadyCampaign = assertProductionReadyCampaign;
exports.improveLandingCopy = improveLandingCopy;
exports.improveAdPack = improveAdPack;
exports.improveVideoPack = improveVideoPack;
exports.improveAssetFromDiagnosis = improveAssetFromDiagnosis;
const http_1 = require("../utils/http");
const PASS_THRESHOLD = 85;
const IMPROVE_THRESHOLD = 70;
const MAX_RETRIES = 2;
const genericPhrases = [
    'game changer',
    'next level',
    'revolutionary',
    'best solution',
    'unlock your potential',
    'transform your business',
    'grow faster',
    'תוצאה מטורפת',
    'הזדמנות שלא תחזור',
    'פתרון מושלם',
    'פתרון מהפכני',
    'ללא מאמץ'
];
const vaguePhrases = ['solution', 'value', 'results', 'outcome', 'growth', 'better', 'improve', 'מדהים', 'חזק', 'מיוחד'];
function containsHyperbolicClaim(text) {
    return /(guaranteed|overnight|instant|בלי מאמץ|מובטח|תוך יום|בלי סיכון בכלל)/i.test(text);
}
function normalizeScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
function containsAny(text, list) {
    const lower = text.toLowerCase();
    return list.some((item) => lower.includes(item.toLowerCase()));
}
function countConcreteSignals(text) {
    const matches = text.match(/\d+|%|₪|\$|ימים|שיחה|דמו|תהליך|שלב|proof|הוכחה|cta|booking|call|lead/gi);
    return matches?.length ?? 0;
}
function deriveStatus(total) {
    if (total < IMPROVE_THRESHOLD)
        return 'reject';
    if (total < PASS_THRESHOLD)
        return 'improve';
    return 'pass';
}
function scoreAssetText(text, angle, persona, cta) {
    const reasons = [];
    const blockedBy = [];
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const concreteSignals = countConcreteSignals(normalizedText);
    const clarity = normalizeScore(52 +
        (normalizedText.length >= 120 ? 18 : 6) +
        (/\.|\?|:/.test(normalizedText) ? 6 : 0) +
        (containsAny(normalizedText, [persona, angle, cta]) ? 10 : 0));
    const specificity = normalizeScore(38 +
        Math.min(24, concreteSignals * 4) +
        (normalizedText.toLowerCase().includes(persona.toLowerCase()) ? 14 : 0) +
        (normalizedText.toLowerCase().includes(angle.toLowerCase()) ? 12 : 0) -
        (containsAny(normalizedText, vaguePhrases) ? 10 : 0));
    const emotionalImpact = normalizeScore(45 +
        (/(כאב|פחד|תקוע|שורף|שבור|לחוץ|מאבד|נמאס|אבוד|יקר|בלבול|חיכוך)/i.test(normalizedText) ? 24 : 4) +
        (/!/.test(normalizedText) ? 4 : 0) +
        (/(לפני|אחרי|הבעיה|המחסום|הפער)/i.test(normalizedText) ? 10 : 0));
    const conversionStrength = normalizeScore(40 +
        (normalizedText.toLowerCase().includes(cta.toLowerCase()) ? 24 : 0) +
        (/(הוכחה|תהליך|שלב|בדיקה|שיחה|טופס|רכישה|פרטים|מועמדות)/i.test(normalizedText) ? 18 : 0) +
        (/CTA אחד|צעד הבא|בלי בלבול/i.test(normalizedText) ? 8 : 0));
    const strategyAlignment = normalizeScore(42 +
        (normalizedText.toLowerCase().includes(angle.toLowerCase()) ? 24 : 0) +
        (normalizedText.toLowerCase().includes(persona.toLowerCase()) ? 18 : 0) +
        (normalizedText.toLowerCase().includes(cta.toLowerCase()) ? 10 : 0));
    if (clarity < IMPROVE_THRESHOLD)
        reasons.push('clarity too weak');
    if (specificity < IMPROVE_THRESHOLD)
        reasons.push('specificity too weak');
    if (emotionalImpact < IMPROVE_THRESHOLD)
        reasons.push('emotional impact too weak');
    if (conversionStrength < IMPROVE_THRESHOLD)
        reasons.push('conversion strength too weak');
    if (strategyAlignment < IMPROVE_THRESHOLD)
        reasons.push('strategy alignment too weak');
    if (containsAny(normalizedText, genericPhrases)) {
        reasons.push('generic marketing phrase detected');
        blockedBy.push('generic_marketing_language');
    }
    if (containsHyperbolicClaim(normalizedText)) {
        reasons.push('hyperbolic claim detected');
        blockedBy.push('hyperbolic_claim');
    }
    const total = normalizeScore((clarity + specificity + emotionalImpact + conversionStrength + strategyAlignment) / 5);
    const status = blockedBy.length > 0 ? 'reject' : deriveStatus(total);
    return {
        clarity,
        specificity,
        emotionalImpact,
        conversionStrength,
        strategyAlignment,
        total,
        status,
        reasons,
        blockedBy
    };
}
function buildIteration(assetType, attempt, score) {
    return {
        assetType,
        attempt,
        maxAttempts: MAX_RETRIES + 1,
        passed: score.status === 'pass',
        improvementApplied: attempt > 1,
        reasons: score.reasons
    };
}
function qualityGuard(text, label) {
    if (containsHyperbolicClaim(text)) {
        throw new http_1.HttpError(400, `Campaign rules rejected ${label}`, { reason: 'Asset contains exaggerated promise' });
    }
    if (containsAny(text, genericPhrases)) {
        throw new http_1.HttpError(400, `Campaign rules rejected ${label}`, { reason: 'Asset contains generic marketing language' });
    }
}
function validateStrategyConsistency(strategy) {
    if (containsHyperbolicClaim(strategy.positioning.promise)) {
        throw new http_1.HttpError(400, 'Campaign rules rejected strategy', {
            reason: 'Promise is too aggressive for a production-safe campaign system'
        });
    }
    const finalStep = strategy.funnel.steps[strategy.funnel.steps.length - 1];
    if (!finalStep) {
        throw new http_1.HttpError(400, 'Campaign rules rejected strategy', { reason: 'Funnel is missing final conversion step' });
    }
    const ctaMatches = (strategy.offer.ctaType === 'book_call' && /שיחה|call/i.test(finalStep.cta)) ||
        (strategy.offer.ctaType === 'buy_now' && /רכישה|קנה|buy/i.test(finalStep.cta)) ||
        (strategy.offer.ctaType === 'leave_details' && /פרטים|learn|details/i.test(finalStep.cta)) ||
        (strategy.offer.ctaType === 'apply_now' && /מועמדות|apply/i.test(finalStep.cta));
    if (!ctaMatches) {
        throw new http_1.HttpError(400, 'Campaign rules rejected strategy', { reason: 'Offer CTA and funnel closing CTA are not aligned' });
    }
    if (!strategy.offer.offerStructure.some((item) => item.includes(strategy.positioning.coreAngle))) {
        throw new http_1.HttpError(400, 'Campaign rules rejected strategy', { reason: 'Offer structure drifted away from core angle' });
    }
    if (!strategy.funnel.steps.some((step) => step.message.includes(strategy.positioning.uniqueMechanism) || step.message.includes(strategy.business.targetOutcome))) {
        throw new http_1.HttpError(400, 'Campaign rules rejected strategy', { reason: 'Funnel lost the core mechanism or target outcome' });
    }
}
function ctaLabel(ctaType) {
    if (ctaType === 'buy_now')
        return 'לקנייה עכשיו';
    if (ctaType === 'book_call')
        return 'לקביעת שיחה';
    if (ctaType === 'apply_now')
        return 'להגשת מועמדות';
    return 'להשארת פרטים';
}
function rankVariants(items, getId) {
    const ranked = items
        .map((item, index) => ({ item, index, id: getId(item, index), total: item.qualityScore?.total ?? 0, strategicFit: item.qualityScore?.strategyAlignment ?? 0, status: item.qualityScore?.status ?? 'reject' }))
        .sort((a, b) => b.total - a.total || b.strategicFit - a.strategicFit);
    return ranked.map((entry, index) => ({
        id: entry.id,
        rank: index + 1,
        total: entry.total,
        status: entry.status,
        strategicFit: entry.strategicFit,
        selected: index === 0
    }));
}
function qualifyLandingCopy(strategy, landingCopy, attempt = 1) {
    const angle = strategy.positioning.coreAngle;
    const persona = strategy.audience.corePersona.label;
    const cta = ctaLabel(strategy.offer.ctaType);
    const composite = [
        landingCopy.heroHeadline,
        landingCopy.heroSubheadline,
        ...landingCopy.bullets,
        ...landingCopy.bodySections.map((section) => `${section.title} ${section.body}`),
        ...landingCopy.ctas,
        ...landingCopy.faq.map((faq) => `${faq.q} ${faq.a}`)
    ].join(' ');
    qualityGuard(composite, 'landing page copy');
    const score = scoreAssetText(composite, angle, persona, cta);
    landingCopy.qualityScore = score;
    landingCopy.iteration = buildIteration('landing_page', attempt, score);
    landingCopy.selected = score.status === 'pass';
    return landingCopy;
}
function qualifyAdPack(strategy, adPack, attempt = 1) {
    const angle = strategy.positioning.coreAngle;
    const persona = strategy.audience.corePersona.label;
    const requiredCta = ctaLabel(strategy.offer.ctaType);
    const hooks = new Set();
    adPack.ads.forEach((ad, index) => {
        const text = `${ad.hook} ${ad.primaryText} ${ad.headline} ${ad.description ?? ''} ${ad.cta}`;
        qualityGuard(text, 'ad copy');
        if (hooks.has(ad.hook)) {
            throw new http_1.HttpError(400, 'Campaign rules rejected ad pack', { reason: 'Ad variations are too similar' });
        }
        hooks.add(ad.hook);
        if (!ad.angle.toLowerCase().includes(angle.split(' ')[0]?.toLowerCase() ?? '')) {
            throw new http_1.HttpError(400, 'Campaign rules rejected ad pack', { reason: 'Ad angle drifted away from selected positioning angle' });
        }
        if (ad.cta !== requiredCta && !ad.cta.toLowerCase().includes(strategy.offer.ctaType.split('_')[0])) {
            throw new http_1.HttpError(400, 'Campaign rules rejected ad pack', { reason: 'Ad CTA contradicts selected offer CTA' });
        }
        ad.qualityScore = scoreAssetText(text, angle, persona, requiredCta);
        ad.versionLabel = `v${attempt}.${index + 1}`;
        ad.selected = false;
    });
    adPack.rankings = rankVariants(adPack.ads, (ad) => `${ad.platform}:${ad.versionLabel ?? ad.hook}`);
    adPack.selectedVariantId = adPack.rankings[0]?.id;
    const selected = adPack.rankings.find((entry) => entry.selected)?.id;
    adPack.ads.forEach((ad) => {
        ad.selected = `${ad.platform}:${ad.versionLabel ?? ad.hook}` === selected;
    });
    const worst = Math.min(...adPack.ads.map((ad) => ad.qualityScore?.total ?? 0));
    adPack.iteration = buildIteration('ad', attempt, {
        clarity: 0,
        specificity: 0,
        emotionalImpact: 0,
        conversionStrength: 0,
        strategyAlignment: 0,
        total: worst,
        status: deriveStatus(worst),
        reasons: adPack.ads.flatMap((ad) => ad.qualityScore?.reasons ?? [])
    });
    return adPack;
}
function qualifyVideoPack(strategy, videoPack, attempt = 1) {
    const angle = strategy.positioning.coreAngle;
    const persona = strategy.audience.corePersona.label;
    const requiredCta = ctaLabel(strategy.offer.ctaType);
    videoPack.scripts.forEach((script, index) => {
        const text = `${script.hook} ${script.body} ${script.cta} ${(script.sceneIntent ?? []).join(' ')} ${(script.pacing ?? []).join(' ')}`;
        qualityGuard(text, 'video script');
        if (script.cta !== requiredCta && !script.cta.includes(requiredCta.split(' ')[0])) {
            throw new http_1.HttpError(400, 'Campaign rules rejected video script', { reason: 'Video CTA contradicts campaign CTA' });
        }
        script.qualityScore = scoreAssetText(text, angle, persona, requiredCta);
        script.versionLabel = `v${attempt}.${index + 1}`;
        script.selected = false;
    });
    videoPack.rankings = rankVariants(videoPack.scripts, (script) => `${script.format}:${script.versionLabel ?? script.hook}`);
    videoPack.selectedVariantId = videoPack.rankings[0]?.id;
    const selected = videoPack.rankings.find((entry) => entry.selected)?.id;
    videoPack.scripts.forEach((script) => {
        script.selected = `${script.format}:${script.versionLabel ?? script.hook}` === selected;
    });
    const worst = Math.min(...videoPack.scripts.map((script) => script.qualityScore?.total ?? 0));
    videoPack.iteration = buildIteration('video_script', attempt, {
        clarity: 0,
        specificity: 0,
        emotionalImpact: 0,
        conversionStrength: 0,
        strategyAlignment: 0,
        total: worst,
        status: deriveStatus(worst),
        reasons: videoPack.scripts.flatMap((script) => script.qualityScore?.reasons ?? [])
    });
    return videoPack;
}
function validateGeneratedAssets(input) {
    const landingCopy = input.landingCopy ? qualifyLandingCopy(input.strategy, input.landingCopy) : undefined;
    const adPack = input.adPack ? qualifyAdPack(input.strategy, input.adPack) : undefined;
    const videoPack = input.videoPack ? qualifyVideoPack(input.strategy, input.videoPack) : undefined;
    validateAssetConsistency(input.strategy, { landingCopy, adPack, videoPack });
    return { landingCopy, adPack, videoPack };
}
function validateAssetConsistency(strategy, assets) {
    const angle = strategy.positioning.coreAngle;
    const cta = ctaLabel(strategy.offer.ctaType);
    const promiseWord = strategy.business.targetOutcome.split(' ')[0]?.toLowerCase();
    if (assets.landingCopy) {
        const copyText = `${assets.landingCopy.heroHeadline} ${assets.landingCopy.heroSubheadline} ${assets.landingCopy.ctas.join(' ')}`;
        if (!copyText.includes(cta)) {
            throw new http_1.HttpError(400, 'Campaign rules rejected landing page copy', { reason: 'Landing CTA contradicts the selected offer CTA' });
        }
        if (!copyText.toLowerCase().includes(angle.split(' ')[0]?.toLowerCase() ?? '')) {
            throw new http_1.HttpError(400, 'Campaign rules rejected landing page copy', { reason: 'Landing copy lost the campaign angle' });
        }
    }
    if (assets.adPack) {
        const angleDrift = assets.adPack.ads.some((ad) => ad.angle !== angle);
        const ctaDrift = assets.adPack.ads.some((ad) => ad.cta !== cta && !ad.cta.toLowerCase().includes(strategy.offer.ctaType.split('_')[0]));
        if (angleDrift || ctaDrift) {
            throw new http_1.HttpError(400, 'Campaign rules rejected ad pack', { reason: 'Ad pack contradicts campaign strategy' });
        }
    }
    if (assets.videoPack) {
        const toneDrift = assets.videoPack.scripts.some((script) => !script.body.toLowerCase().includes(promiseWord ?? '') && !script.body.includes(strategy.positioning.uniqueMechanism));
        if (toneDrift) {
            throw new http_1.HttpError(400, 'Campaign rules rejected video script', { reason: 'Video scripts drifted away from the core promise/mechanism' });
        }
    }
}
function assertProductionReadyCampaign(input) {
    validateStrategyConsistency(input.strategy);
    validateAssetConsistency(input.strategy, input);
    const failures = [];
    if ((input.landingCopy.qualityScore?.status ?? 'reject') !== 'pass')
        failures.push('landing page did not pass quality gate');
    if (input.adPack.ads.some((ad) => (ad.qualityScore?.status ?? 'reject') !== 'pass'))
        failures.push('one or more ads did not pass quality gate');
    if (input.videoPack.scripts.some((script) => (script.qualityScore?.status ?? 'reject') !== 'pass'))
        failures.push('one or more video scripts did not pass quality gate');
    if (!input.adPack.selectedVariantId)
        failures.push('ad ranking missing selected launch asset');
    if (!input.videoPack.selectedVariantId)
        failures.push('video ranking missing selected launch asset');
    if (failures.length > 0) {
        throw new http_1.HttpError(400, 'Campaign build rejected', { reason: failures.join('; ') });
    }
}
function improveLandingCopy(copy, strategy, reasons, attempt) {
    const persona = strategy.audience.corePersona.label;
    const proof = strategy.positioning.proofStrategy;
    const cta = ctaLabel(strategy.offer.ctaType);
    const reasonText = reasons.join(' | ');
    return {
        ...copy,
        heroHeadline: `${strategy.positioning.promise} עבור ${persona} — בלי מסר כללי ובלי חיכוך מיותר`,
        heroSubheadline: `${strategy.positioning.coreAngle}. ${strategy.positioning.uniqueMechanism}. ${proof}. ניסיון ${attempt} שמתקן: ${reasonText || 'חיזוק חדות והמרה'}.`,
        bullets: Array.from(new Set([...copy.bullets, `למי זה מיועד: ${persona}`, `הצעד הבא ברור: ${cta}`])).slice(0, 4),
        bodySections: copy.bodySections.map((section) => ({
            ...section,
            body: `${section.body} הוכחה: ${proof}. זווית: ${strategy.positioning.coreAngle}. CTA: ${cta}.`
        })),
        faq: copy.faq.map((item, index) => index === 1 ? { ...item, a: `${item.a} ${proof}.` } : item),
        ctas: [cta]
    };
}
function improveAdPack(adPack, strategy, reasons, attempt) {
    const cta = ctaLabel(strategy.offer.ctaType);
    const persona = strategy.audience.corePersona.label;
    const pain = strategy.audience.corePersona.pains[0];
    const proof = strategy.positioning.proofStrategy;
    const hookVariants = [
        `${pain} — זה לא עוד מסר יפה.`,
        `${pain} — זה בדיוק המחסום שמפיל את ההמרה.`,
        `${pain} — בלי זה הקליק הבא רק יתייקר.`,
        `${pain} — עד שלא מתקנים את זה, ה-CTA נשרף.`
    ];
    return {
        ...adPack,
        ads: adPack.ads.map((ad, index) => ({
            ...ad,
            angle: strategy.positioning.coreAngle,
            hook: `${hookVariants[index % hookVariants.length]} ${strategy.positioning.coreAngle}.`,
            primaryText: `${persona}. כאב: ${pain}. ${strategy.positioning.uniqueMechanism}. ${proof}. 3 שלבים ברורים. ${reasons[index % Math.max(reasons.length, 1)] ?? 'מסר מחודד יותר'}. צעד הבא: ${cta}.`,
            headline: `${strategy.positioning.promise} | ${strategy.business.targetOutcome} | ${cta}`,
            description: `זווית: ${strategy.positioning.coreAngle} | קהל: ${persona} | step ${index + 1}`,
            cta
        }))
    };
}
function improveVideoPack(videoPack, strategy, reasons, attempt) {
    const cta = ctaLabel(strategy.offer.ctaType);
    const persona = strategy.audience.corePersona.label;
    return {
        ...videoPack,
        scripts: videoPack.scripts.map((script, index) => ({
            ...script,
            hook: `${persona} — ${strategy.audience.corePersona.pains[index % strategy.audience.corePersona.pains.length]}. ${strategy.positioning.coreAngle}.`,
            body: `${strategy.positioning.coreAngle}. ${strategy.positioning.uniqueMechanism}. ${strategy.positioning.proofStrategy}. 3 שלבים ברורים. ${reasons[index % Math.max(reasons.length, 1)] ?? 'מסר חד יותר'}. צעד הבא: ${cta}.`,
            cta,
            shotNotes: Array.from(new Set([...script.shotNotes, `להראות proof ברור בניסיון ${attempt}`]))
        }))
    };
}
function improveAssetFromDiagnosis(assetType, content, diagnosis) {
    const top = diagnosis.issues?.slice(0, 2).map((issue) => issue.recommendedAction) ?? [];
    if (assetType === 'landing_page' && content?.copy) {
        return {
            ...content,
            copy: {
                ...content.copy,
                heroHeadline: `${content.copy.heroHeadline} — עכשיו עם message match קשיח יותר`,
                heroSubheadline: `${content.copy.heroSubheadline} ${top.join(' ')}`,
                bodySections: content.copy.bodySections.map((section, index) => ({
                    ...section,
                    body: `${section.body} ${top[index % Math.max(top.length, 1)] ?? ''}`.trim()
                }))
            },
            optimizationSource: 'performance_diagnosis'
        };
    }
    if (assetType === 'ad' && content?.ads) {
        return {
            ...content,
            ads: content.ads.map((ad, index) => ({
                ...ad,
                hook: `${ad.hook} ${index === 0 ? 'עצור. זה לא הוק חלש.' : ''}`.trim(),
                primaryText: `${ad.primaryText} ${top[index % Math.max(top.length, 1)] ?? ''}`.trim()
            })),
            optimizationSource: 'performance_diagnosis'
        };
    }
    if (assetType === 'video_script' && content?.scripts) {
        return {
            ...content,
            scripts: content.scripts.map((script, index) => ({
                ...script,
                body: `${script.body} ${top[index % Math.max(top.length, 1)] ?? ''}`.trim()
            })),
            optimizationSource: 'performance_diagnosis'
        };
    }
    return content;
}
