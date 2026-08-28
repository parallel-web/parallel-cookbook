export interface MonitorDef {
  id: string;
  name: string;
  class: "region" | "facility" | "discovery";
  query: string;
  frequency: string;
  processor: string;
  region?: string;
  facilityCode?: string;
  states?: string[]; // which US states this monitor covers
}

/**
 * Structured output schema for all monitors.
 * Every detected event comes back with a classified category.
 */
export const MONITOR_OUTPUT_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string" as const,
        description: "The primary category of this development",
        enum: [
          "POWER_GRID",
          "ZONING_POLICY",
          "COMMUNITY",
          "WATER",
          "LAND_SUPPLY",
          "TENANT_DEMAND",
          "CAPITAL_OWNERSHIP",
          "CONSTRUCTION",
        ],
      },
      headline: {
        type: "string" as const,
        description: "One-line headline for the event (under 120 characters)",
      },
      summary: {
        type: "string" as const,
        description:
          "2-3 sentence summary including specific entities, dates, numbers, and what changed",
      },
      severity: {
        type: "string" as const,
        description: "Impact level for datacenter infrastructure investors",
        enum: ["critical", "notable", "informational"],
      },
      affected_entities: {
        type: "string" as const,
        description:
          "Specific companies, facilities, or projects affected (e.g., 'QTS Manassas, Dominion Energy')",
      },
    },
    required: [
      "category",
      "headline",
      "summary",
      "severity",
      "affected_entities",
    ],
    additionalProperties: false,
  },
};

/**
 * Category labels for the UI
 */
export const CATEGORY_LABELS: Record<string, string> = {
  POWER_GRID: "Power & Grid",
  ZONING_POLICY: "Zoning & Policy",
  COMMUNITY: "Community",
  WATER: "Water & Cooling",
  LAND_SUPPLY: "Land & Supply",
  TENANT_DEMAND: "Tenant & Demand",
  CAPITAL_OWNERSHIP: "Capital & Ownership",
  CONSTRUCTION: "Construction",
};

// Comprehensive query template covering all signal types
function regionQuery(region: string, specifics: string): string {
  return `Data center developments in ${region}: ${specifics}. Track: utility interconnection and power capacity filings, rezoning and special-use permit applications and decisions, moratoria or development freezes, community opposition and litigation, water-use restrictions or drought actions, large land assemblies and site transactions, hyperscaler expansion announcements, operator M&A or ownership changes, and construction milestones.`;
}

function facilityQuery(facility: string, specifics: string): string {
  return `${facility}: ${specifics}. Track any material development including power interconnection filings, zoning or permit actions, construction milestones, ownership or tenant changes, community opposition, and water or environmental restrictions.`;
}

export const MONITOR_DEFS: MonitorDef[] = [
  // =============================================
  // CLASS 1: Region monitors (23)
  // =============================================

  // --- Original 8 regions ---
  {
    id: "region-nova",
    name: "Northern Virginia",
    class: "region",
    query: regionQuery(
      "Loudoun and Prince William County, Virginia",
      "Dominion Energy interconnection and large-load filings, SCC transmission approvals, county zoning and special-exception votes"
    ),
    frequency: "1h",
    processor: "base",
    region: "Northern Virginia",
    states: ["VA"],
  },
  {
    id: "region-atlanta",
    name: "Atlanta / Georgia",
    class: "region",
    query: regionQuery(
      "Georgia (metro Atlanta, Fayette, Coweta, DeKalb counties)",
      "Georgia Power interconnection actions, county rezoning approvals and denials, development moratoria"
    ),
    frequency: "1h",
    processor: "base",
    region: "Atlanta, GA",
    states: ["GA"],
  },
  {
    id: "region-ohio",
    name: "Central Ohio",
    class: "region",
    query: regionQuery(
      "central Ohio (New Albany, Columbus, Licking County, Etna Township)",
      "AEP Ohio power agreements and tariff disputes, township zoning bans, statewide moratorium legislation"
    ),
    frequency: "1h",
    processor: "base",
    region: "Central Ohio",
    states: ["OH"],
  },
  {
    id: "region-phoenix",
    name: "Phoenix / Arizona",
    class: "region",
    query: regionQuery(
      "metro Phoenix and Maricopa County, Arizona",
      "APS and SRP power capacity, groundwater restrictions, municipal water-use caps for data centers, Pinal County developments"
    ),
    frequency: "1h",
    processor: "base",
    region: "Phoenix, AZ",
    states: ["AZ"],
  },
  {
    id: "region-utah",
    name: "Utah",
    class: "region",
    query: regionQuery(
      "Utah (Eagle Mountain, Salt Lake City corridor, West Jordan)",
      "Rocky Mountain Power load commitments, municipal water and power approvals, West Valley and Iron County permits"
    ),
    frequency: "1h",
    processor: "base",
    region: "Utah",
    states: ["UT"],
  },
  {
    id: "region-texas",
    name: "Texas",
    class: "region",
    query: regionQuery(
      "Texas",
      "ERCOT large-load interconnection rules and Batch Zero process, grid-reliability legislation, PUCT actions, municipal approvals in Dallas, San Antonio, and Red Oak"
    ),
    frequency: "1h",
    processor: "base",
    region: "Texas",
    states: ["TX"],
  },
  {
    id: "region-pnw",
    name: "Pacific Northwest",
    class: "region",
    query: regionQuery(
      "Washington and Oregon (Seattle, Hillsboro, Quincy, The Dalles)",
      "Seattle municipal moratoria, BPA and PSE power constraints, Bonneville Power Administration capacity, Oregon permitting"
    ),
    frequency: "1h",
    processor: "base",
    region: "Pacific Northwest",
    states: ["WA", "OR"],
  },
  {
    id: "region-florida",
    name: "Florida",
    class: "region",
    query: regionQuery(
      "Florida",
      "county moratoria and rezoning freezes (Citrus, Palm Coast, Flagler, Lake), FPL power agreements, hurricane resilience requirements"
    ),
    frequency: "1h",
    processor: "base",
    region: "Florida",
    states: ["FL"],
  },

  // --- 15 new regions for 90% coverage ---
  {
    id: "region-norcal",
    name: "Northern California",
    class: "region",
    query: regionQuery(
      "Northern California (Silicon Valley, Santa Clara, Sacramento, Stockton)",
      "PG&E power capacity and interconnection, CPUC filings, Santa Clara city approvals, Bay Area environmental review"
    ),
    frequency: "1h",
    processor: "base",
    region: "Northern California",
    states: ["CA"],
  },
  {
    id: "region-socal",
    name: "Southern California",
    class: "region",
    query: regionQuery(
      "Southern California (Los Angeles, Inland Empire, San Diego)",
      "SCE and LADWP power capacity, SCAQMD air quality permits, water restrictions, Riverside and San Bernardino county approvals"
    ),
    frequency: "1h",
    processor: "base",
    region: "Southern California",
    states: ["CA"],
  },
  {
    id: "region-chicago",
    name: "Chicago / Illinois",
    class: "region",
    query: regionQuery(
      "Illinois (Chicago, Elk Grove Village, Aurora, Joliet)",
      "ComEd power capacity and interconnection, Cook and DuPage county approvals, Illinois tax incentive programs"
    ),
    frequency: "1h",
    processor: "base",
    region: "Chicago, IL",
    states: ["IL"],
  },
  {
    id: "region-nymetro",
    name: "New York Metro",
    class: "region",
    query: regionQuery(
      "New Jersey and New York",
      "PSE&G and ConEd interconnection capacity, NJ Board of Public Utilities filings, NYC and Newark zoning, New York State moratorium proposals"
    ),
    frequency: "1h",
    processor: "base",
    region: "New York Metro",
    states: ["NJ", "NY"],
  },
  {
    id: "region-newengland",
    name: "New England",
    class: "region",
    query: regionQuery(
      "New England (Massachusetts, Connecticut, New Hampshire)",
      "Eversource and National Grid power capacity, Boston-area and Hartford zoning, Maine renewable-powered DC proposals"
    ),
    frequency: "1h",
    processor: "base",
    region: "New England",
    states: ["MA", "CT", "NH", "ME", "RI", "VT"],
  },
  {
    id: "region-minnesota",
    name: "Minnesota",
    class: "region",
    query: regionQuery(
      "Minnesota (Minneapolis, Shakopee, Chaska)",
      "Xcel Energy power capacity, Shakopee and Scott County approvals, Minnesota legislative actions on data centers"
    ),
    frequency: "1h",
    processor: "base",
    region: "Minnesota",
    states: ["MN"],
  },
  {
    id: "region-michigan",
    name: "Michigan",
    class: "region",
    query: regionQuery(
      "Michigan (Detroit, Grand Rapids, West Michigan)",
      "DTE Energy and Consumers Energy power capacity, county economic incentives, Michigan Strategic Fund approvals"
    ),
    frequency: "1h",
    processor: "base",
    region: "Michigan",
    states: ["MI"],
  },
  {
    id: "region-kentucky",
    name: "Kentucky",
    class: "region",
    query: regionQuery(
      "Kentucky (Louisville, Lexington, Bowling Green)",
      "LG&E and KU power agreements, Kentucky economic development incentives, TVA-connected sites"
    ),
    frequency: "1h",
    processor: "base",
    region: "Kentucky",
    states: ["KY"],
  },
  {
    id: "region-nevada",
    name: "Las Vegas / Nevada",
    class: "region",
    query: regionQuery(
      "Nevada (Las Vegas, Reno, Henderson)",
      "NV Energy power capacity, Southern Nevada Water Authority restrictions, Clark County approvals, Switch and other operator expansions"
    ),
    frequency: "1h",
    processor: "base",
    region: "Nevada",
    states: ["NV"],
  },
  {
    id: "region-dcmetro",
    name: "DC Metro / Maryland",
    class: "region",
    query: regionQuery(
      "Maryland and Washington DC metro (Prince George's County, Frederick, Loudoun adjacent)",
      "BGE and Pepco power capacity, PJM interconnection for MD sites, county zoning, Frederick County data center ordinances"
    ),
    frequency: "1h",
    processor: "base",
    region: "DC Metro",
    states: ["MD", "DC", "DE"],
  },
  {
    id: "region-tennessee",
    name: "Tennessee",
    class: "region",
    query: regionQuery(
      "Tennessee (Nashville, Clarksville, Chattanooga)",
      "TVA power agreements and industrial rates, Clarksville campus developments, state economic incentives"
    ),
    frequency: "1h",
    processor: "base",
    region: "Tennessee",
    states: ["TN"],
  },
  {
    id: "region-midwest",
    name: "Kansas City / Midwest",
    class: "region",
    query: regionQuery(
      "the central Midwest (Missouri, Kansas, Nebraska, Iowa)",
      "Evergy and MidAmerican Energy power capacity, Kansas City metro approvals, Iowa and Nebraska economic incentives"
    ),
    frequency: "1h",
    processor: "base",
    region: "Central Midwest",
    states: ["MO", "KS", "NE", "IA"],
  },
  {
    id: "region-carolinas",
    name: "Carolinas",
    class: "region",
    query: regionQuery(
      "North and South Carolina",
      "Duke Energy power capacity and interconnection, Charlotte and Raleigh-Durham area approvals, Stokes County and rural county rezoning controversies"
    ),
    frequency: "1h",
    processor: "base",
    region: "Carolinas",
    states: ["NC", "SC"],
  },
  {
    id: "region-colorado",
    name: "Colorado",
    class: "region",
    query: regionQuery(
      "Colorado (Denver, Aurora, Colorado Springs)",
      "Xcel Energy power capacity, Aurora and Douglas County approvals, Colorado water court filings"
    ),
    frequency: "1h",
    processor: "base",
    region: "Colorado",
    states: ["CO"],
  },
  {
    id: "region-pennsylvania",
    name: "Pennsylvania",
    class: "region",
    query: regionQuery(
      "Pennsylvania (Philadelphia, Lehigh Valley, Pittsburgh)",
      "PECO and PPL Electric power capacity, Lehigh Valley zoning, Pennsylvania economic incentive programs"
    ),
    frequency: "1h",
    processor: "base",
    region: "Pennsylvania",
    states: ["PA"],
  },

  // =============================================
  // CLASS 2: Facility monitors (6)
  // =============================================
  {
    id: "facility-qts-cedar-rapids",
    name: "QTS Cedar Rapids",
    class: "facility",
    query: facilityQuery(
      "QTS Data Centers Cedar Rapids, Iowa campus",
      "Alliant Energy and ITC Midwest power agreements, Linn County approvals, construction progress"
    ),
    frequency: "1h",
    processor: "base",
    facilityCode: "QTS-CR",
    region: "Iowa",
    states: ["IA"],
  },
  {
    id: "facility-qts-new-albany",
    name: "QTS New Albany",
    class: "facility",
    query: facilityQuery(
      "QTS Data Centers New Albany, Ohio campus expansion",
      "AEP Ohio power agreements, New Albany and Licking County zoning, construction milestones"
    ),
    frequency: "1h",
    processor: "base",
    facilityCode: "QTS-NA",
    region: "Central Ohio",
    states: ["OH"],
  },
  {
    id: "facility-qts-eagle-mountain",
    name: "QTS Eagle Mountain",
    class: "facility",
    query: facilityQuery(
      "QTS Data Centers Eagle Mountain, Utah campus",
      "Rocky Mountain Power commitments, Eagle Mountain City water rights and municipal actions"
    ),
    frequency: "1h",
    processor: "base",
    facilityCode: "QTS-EM",
    region: "Utah",
    states: ["UT"],
  },
  {
    id: "facility-qts-manassas",
    name: "QTS Manassas",
    class: "facility",
    query: facilityQuery(
      "QTS Data Centers Manassas, Virginia expansion",
      "Prince William County zoning votes, Dominion Energy interconnection filings, community opposition"
    ),
    frequency: "1h",
    processor: "base",
    facilityCode: "QTS-MAN",
    region: "Northern Virginia",
    states: ["VA"],
  },
  {
    id: "facility-qts-fayetteville",
    name: "QTS Fayetteville",
    class: "facility",
    query: facilityQuery(
      "QTS Data Centers Fayetteville and Atlanta, Georgia campuses",
      "Fayette County rezoning, Georgia Power interconnection, local government actions"
    ),
    frequency: "1h",
    processor: "base",
    facilityCode: "QTS-FAY",
    region: "Atlanta, GA",
    states: ["GA"],
  },
  {
    id: "facility-qts-aurora",
    name: "QTS Aurora-Denver",
    class: "facility",
    query: facilityQuery(
      "QTS Data Centers Aurora, Colorado campus expansion",
      "Xcel Energy power agreements, Aurora city approvals, construction milestones"
    ),
    frequency: "1h",
    processor: "base",
    facilityCode: "QTS-AUR",
    region: "Colorado",
    states: ["CO"],
  },

  // =============================================
  // CLASS 3: Discovery monitors (2)
  // =============================================
  {
    id: "discovery-hyperscale",
    name: "New Hyperscale Sites",
    class: "discovery",
    query:
      "Newly disclosed or rumored hyperscale data center projects in the U.S.: large land assemblies (500+ acres), new substation load studies, county rezoning filings consistent with 200MW+ campuses, and reports of hyperscaler site selection activity where no operator has confirmed. Include brownfield or failed-industrial sites with grid access being repurposed for data centers.",
    frequency: "1h",
    processor: "base",
    region: "National",
  },
  {
    id: "discovery-power-markets",
    name: "Power-First Emerging Markets",
    class: "discovery",
    query:
      "U.S. regions newly attracting data center investment due to available power: utility announcements of large-load data center customers, new generation (gas, nuclear, SMR) tied to data center campuses, and secondary markets (Louisiana, Mississippi, Indiana, Wyoming, Alabama, Idaho, Wisconsin) seeing their first large-scale data center proposals or groundbreakings.",
    frequency: "1h",
    processor: "base",
    region: "National",
  },
];
