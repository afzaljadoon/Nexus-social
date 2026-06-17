// Offline/Client-side safety scanner fallback utility

export interface SafetyCheckResult {
  flagged: boolean;
  categories: string[];
}

const LOCAL_SAFETY_RULES = [
  { category: "hate", keywords: ["hate speech slur test", "slur", "hate speech", "xenophobia", "racist"] },
  { category: "violence", keywords: ["kill", "murder", "bomb", "attack", "violence", "shoot"] },
  { category: "self-harm", keywords: ["suicide", "self-harm test", "cut myself", "end my life"] },
  { category: "harassment", keywords: ["harass", "bully", "stalk", "abusive", "exploit"] },
  { category: "sexual", keywords: ["porn", "explicit", "nsfw", "xxx", "sexual content test"] }
];

export function scanContentLocally(text: string): SafetyCheckResult {
  const lowerText = text.toLowerCase();
  const flaggedCategories: string[] = [];
  let flagged = false;

  for (const rule of LOCAL_SAFETY_RULES) {
    for (const kw of rule.keywords) {
      if (lowerText.includes(kw)) {
        flagged = true;
        if (!flaggedCategories.includes(rule.category)) {
          flaggedCategories.push(rule.category);
        }
      }
    }
  }

  return {
    flagged,
    categories: flaggedCategories
  };
}
