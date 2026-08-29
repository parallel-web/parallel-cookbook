// Secondary listing verification via the Task API. Approach: avoid subjective
// "is_likely_spam" outputs — decompose into fact-based booleans the API can
// verify with citations, then weight them in code.

export const SPAM_SCHEMA = {
  type: "object",
  properties: {
    demands_off_platform_payment: {
      type: "boolean",
      description:
        "Entity: this rental listing's body text. " +
        "Action: determine if the listing requests payment via wire transfer, " +
        "Western Union, MoneyGram, Zelle, Cash App, gift cards, or any other " +
        "off-platform / irreversible payment method. " +
        "If no payment method is mentioned, return false.",
    },
    owner_claims_to_be_abroad: {
      type: "boolean",
      description:
        "Entity: this rental listing's body text. " +
        "Action: determine if the owner/landlord explicitly claims to be " +
        "out of the country, deployed in the military, relocated for work, " +
        "or otherwise unable to show the unit in person. " +
        "If no such claim appears, return false.",
    },
    withholds_address_until_contact: {
      type: "boolean",
      description:
        "Entity: this rental listing's body text. " +
        "Action: determine if the listing explicitly withholds the property " +
        "address (e.g., 'address upon serious inquiry', 'message for address'). " +
        "If a specific street address is shown, return false. " +
        "If no address is mentioned at all, return false.",
    },
    no_in_person_viewing_offered: {
      type: "boolean",
      description:
        "Entity: this rental listing's body text. " +
        "Action: determine if the listing requires email-only contact and " +
        "explicitly disallows or avoids in-person viewings (e.g., 'email only', " +
        "'no calls', 'no in-person showings'). " +
        "If a phone number, tour link, or open-house time is shown, return false.",
    },
    unusual_incentives: {
      type: "boolean",
      description:
        "Entity: this rental listing's body text. " +
        "Action: determine if the listing offers unusually generous incentives " +
        "that suggest below-market pricing or pressure to commit (e.g., " +
        "'first month free', 'no deposit', 'rent well below market'). " +
        "Standard offers like 'pet rent waived' or 'parking included' do NOT count. " +
        "If no incentives are mentioned, return false.",
    },
  },
  required: [
    "demands_off_platform_payment",
    "owner_claims_to_be_abroad",
    "withholds_address_until_contact",
    "no_in_person_viewing_offered",
    "unusual_incentives",
  ],
  additionalProperties: false,
}

// Weights chosen so any single canonical scam signal alone (off-platform
// payment) clears the hide threshold (50), while soft signals accumulate.
const SPAM_WEIGHTS: Record<string, number> = {
  demands_off_platform_payment: 60,
  owner_claims_to_be_abroad: 30,
  withholds_address_until_contact: 25,
  no_in_person_viewing_offered: 20,
  unusual_incentives: 15,
}

// Sources we trust enough to skip verification on.
export const TRUSTED_SOURCES = new Set([
  "apartments", "zillow", "redfin", "realtor", "trulia", "rent", "hotpads",
])

export function computeSpamScore(content: Record<string, unknown>): { score: number; flags: string[] } {
  let score = 0
  const flags: string[] = []
  for (const [key, weight] of Object.entries(SPAM_WEIGHTS)) {
    if (content[key] === true) {
      score += weight
      flags.push(key)
    }
  }
  return { score: Math.min(100, score), flags }
}

export const TASK_SPAM_PROCESSOR = process.env.TASK_SPAM_PROCESSOR ?? "base"
