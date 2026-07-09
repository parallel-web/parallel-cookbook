# Parallel Procurement — Live System Mockup

A snapshot of the system running for 15 vendors. Dozens of AI agents working simultaneously across the web. Information flowing to your team in Slack.

## System in Action

```mermaid
flowchart LR
    subgraph VENDORS["YOUR VENDOR PORTFOLIO (15 vendors)"]
        direction TB

        subgraph TECH["Technology"]
            MS["Microsoft\nHIGH"]
            AWS["AWS\nHIGH"]
            SF["Salesforce\nHIGH"]
            CS["CrowdStrike\nHIGH"]
        end

        subgraph FIN["Financial Services"]
            JPM["JPMorgan Chase\nHIGH"]
            GS["Goldman Sachs\nMEDIUM"]
            STR["Stripe\nHIGH"]
        end

        subgraph HEALTH["Healthcare"]
            UHG["UnitedHealth\nHIGH"]
            PFE["Pfizer\nMEDIUM"]
            JNJ["Johnson & Johnson\nMEDIUM"]
        end

        subgraph MFG["Manufacturing"]
            SIE["Siemens\nMEDIUM"]
            CAT["Caterpillar\nLOW"]
            MMM["3M\nLOW"]
        end

        subgraph SVC["Professional Services"]
            DEL["Deloitte\nMEDIUM"]
            ACN["Accenture\nMEDIUM"]
        end
    end

    subgraph PARALLEL["PARALLEL AI — AGENTS ACROSS THE WEB"]
        direction TB

        subgraph RESEARCH["Deep Research Agents (daily batch)"]
            direction LR
            R_MS["Researching Microsoft\n6 dimensions\nultra8x processor"]
            R_STR["Researching Stripe\n6 dimensions\nultra8x processor"]
            R_UHG["Researching UnitedHealth\n6 dimensions\nultra8x processor"]
            R_JPM["Researching JPMorgan\n6 dimensions\nultra8x processor"]
            R_CS["Researching CrowdStrike\n6 dimensions\nultra8x processor"]
        end

        subgraph DIMS["What each agent investigates"]
            D1["Financial Health\nearnings, credit, debt"]
            D2["Legal & Regulatory\nlawsuits, SEC, sanctions"]
            D3["Cybersecurity\nbreaches, CVEs, SOC2"]
            D4["Leadership\nexec changes, M&A"]
            D5["ESG & Reputation\nrecalls, labor, fines"]
            D6["Adverse Events\nbreaking news"]
        end

        subgraph MONITORS["47 Persistent Monitors (always watching)"]
            direction TB
            M1["CrowdStrike — cyber\ndata breach OR ransomware\nDAILY"]
            M2["CrowdStrike — legal\nlawsuit OR SEC investigation\nDAILY"]
            M3["Microsoft — cyber\ndata breach OR ransomware\nDAILY"]
            M4["Microsoft — leadership\nCEO departure OR acquisition\nDAILY"]
            M5["JPMorgan — financial\nbankruptcy OR credit downgrade\nDAILY"]
            M6["JPMorgan — legal\nlawsuit OR SEC investigation\nDAILY"]
            M7["Stripe — cyber\ndata breach OR ransomware\nDAILY"]
            M8["Stripe — financial\nbankruptcy OR credit downgrade\nDAILY"]
            M9["Pfizer — legal\nFDA action OR enforcement\nDAILY"]
            M10["Goldman Sachs — legal\nlawsuit OR SEC investigation\nDAILY"]
            M11["Caterpillar — legal\nlawsuit OR regulatory action\nWEEKLY"]
            M12["3M — financial\nbankruptcy OR credit downgrade\nWEEKLY"]
            M13["Siemens — cyber\ndata breach OR ransomware\nDAILY"]
            M14["Deloitte — financial\nfinancial distress OR layoffs\nDAILY"]
        end

        subgraph ADHOC["Ad-Hoc Agent (on-demand)"]
            SLASH["/vendor-research Goldman Sachs"]
            AGENT["Agent researching\nGoldman Sachs..."]
            REPLY["Thread reply:\nGoldman Sachs assessed at\nMEDIUM risk. No adverse."]
        end
    end

    subgraph SCORING["RISK SCORING ENGINE"]
        direction TB
        RULES["Deterministic Rules\nany CRITICAL dim = CRITICAL\nany HIGH dim = HIGH\n3+ MEDIUM = MEDIUM adverse\nelse = LOW"]
        OVERRIDES["Overrides\ncyber CRITICAL = force CRITICAL\nlegal CRITICAL = force min HIGH\nrisk_tier_override = floor"]
    end

    subgraph DELIVERY["SLACK — YOUR TEAM SEES THIS"]
        direction TB
        CH1["#procurement-critical\nCRITICAL: CrowdStrike\nActive vulnerability disclosure\naffecting endpoint platform.\nReview within 24 hours."]
        CH2["#procurement-alerts\nHIGH: Pfizer\nFDA regulatory action on\nmanufacturing compliance.\nReview within 48 hours."]
        CH3["#procurement-digest\nWeekly Digest: 15 vendors\n1 CRITICAL, 1 HIGH\n3 MEDIUM, 10 LOW\n1 adverse finding"]
        CH4["#vendor-risk-ops\nHealth Check: 47 monitors\nactive. 0 failed.\n0 orphaned. Webhook OK."]
    end

    subgraph AUDIT["AUDIT LOG (Google Sheets)"]
        direction TB
        A1["2026-03-05 02:14 | CrowdStrike | CRITICAL | true\nActive vulnerability disclosure | deep_research"]
        A2["2026-03-05 02:14 | Pfizer | HIGH | true\nFDA regulatory action | deep_research"]
        A3["2026-03-05 02:15 | Microsoft | LOW | false\nNo adverse conditions | deep_research"]
        A4["2026-03-05 09:41 | Goldman Sachs | MEDIUM | false\nModerate financial findings | adhoc"]
        A5["2026-03-05 14:22 | JPMorgan | MEDIUM | true\nSEC inquiry reported | monitor_event"]
    end

    %% === VENDOR TO RESEARCH CONNECTIONS ===
    MS --> R_MS
    STR --> R_STR
    UHG --> R_UHG
    JPM --> R_JPM
    CS --> R_CS

    %% === VENDOR TO MONITOR CONNECTIONS ===
    CS -.-> M1
    CS -.-> M2
    MS -.-> M3
    MS -.-> M4
    JPM -.-> M5
    JPM -.-> M6
    STR -.-> M7
    STR -.-> M8
    PFE -.-> M9
    GS -.-> M10
    CAT -.-> M11
    MMM -.-> M12
    SIE -.-> M13
    DEL -.-> M14

    %% === RESEARCH DIMENSION FAN-OUT ===
    R_MS --> D1
    R_MS --> D2
    R_MS --> D3
    R_MS --> D4
    R_MS --> D5
    R_MS --> D6

    %% === RESEARCH TO SCORING ===
    R_MS ==> RULES
    R_STR ==> RULES
    R_UHG ==> RULES
    R_JPM ==> RULES
    R_CS ==> RULES

    %% === MONITOR EVENTS TO SCORING ===
    M1 -- "EVENT DETECTED" --> RULES
    M6 -- "EVENT DETECTED" --> RULES
    M9 -- "EVENT DETECTED" --> RULES

    %% === AD-HOC FLOW ===
    SLASH --> AGENT
    AGENT --> RULES
    RULES --> REPLY

    %% === SCORING TO DELIVERY ===
    RULES --> OVERRIDES
    OVERRIDES -- "CRITICAL" --> CH1
    OVERRIDES -- "HIGH" --> CH2
    OVERRIDES -- "MEDIUM" --> CH3
    OVERRIDES -- "ops" --> CH4

    %% === SCORING TO AUDIT ===
    OVERRIDES --> A1
    OVERRIDES --> A2
    OVERRIDES --> A3
    OVERRIDES --> A4
    OVERRIDES --> A5

    %% === STYLES ===
    classDef tech fill:#dbeafe,stroke:#1971c2,color:#1e1e1e
    classDef fin fill:#d3f9d8,stroke:#2f9e44,color:#1e1e1e
    classDef health fill:#fce4ec,stroke:#c92a2a,color:#1e1e1e
    classDef mfg fill:#f1f3f5,stroke:#495057,color:#1e1e1e
    classDef svc fill:#e8dff5,stroke:#6741d9,color:#1e1e1e
    classDef agent fill:#d0bfff,stroke:#6741d9,color:#1e1e1e
    classDef monitor fill:#e8dff5,stroke:#6741d9,color:#1e1e1e
    classDef scoring fill:#ffe3e3,stroke:#c92a2a,color:#1e1e1e
    classDef slack fill:#fff3bf,stroke:#e67700,color:#1e1e1e
    classDef critical fill:#ffc9c9,stroke:#c92a2a,color:#1e1e1e
    classDef audit fill:#d3f9d8,stroke:#2f9e44,color:#1e1e1e

    class MS,AWS,SF,CS tech
    class JPM,GS,STR fin
    class UHG,PFE,JNJ health
    class SIE,CAT,MMM mfg
    class DEL,ACN svc
    class R_MS,R_STR,R_UHG,R_JPM,R_CS,AGENT agent
    class D1,D2,D3,D4,D5,D6 agent
    class M1,M2,M3,M4,M5,M6,M7,M8,M9,M10,M11,M12,M13,M14 monitor
    class RULES,OVERRIDES scoring
    class CH1 critical
    class CH2,CH3,SLASH,REPLY slack
    class CH4 tech
    class A1,A2,A3,A4,A5 audit
```

## Monitor Portfolio Breakdown

```mermaid
flowchart TB
    subgraph HIGH_VENDORS["HIGH PRIORITY — 5 monitors each, daily"]
        direction LR
        H1["Microsoft\n5 monitors"]
        H2["AWS\n5 monitors"]
        H3["Salesforce\n5 monitors"]
        H4["CrowdStrike\n5 monitors"]
        H5["JPMorgan\n5 monitors"]
        H6["UnitedHealth\n5 monitors"]
        H7["Stripe\n5 monitors"]
    end

    subgraph MED_VENDORS["MEDIUM PRIORITY — 3 monitors each, daily"]
        direction LR
        M1["Goldman Sachs\n3 monitors"]
        M2["Pfizer\n3 monitors"]
        M3["J&J\n3 monitors"]
        M4["Siemens\n3 monitors"]
        M5["Deloitte\n3 monitors"]
        M6["Accenture\n3 monitors"]
    end

    subgraph LOW_VENDORS["LOW PRIORITY — 2 monitors each, weekly"]
        direction LR
        L1["Caterpillar\n2 monitors"]
        L2["3M\n2 monitors"]
    end

    TOTAL["TOTAL: 35 + 18 + 4 = 57 monitors\nrunning continuously"]

    HIGH_VENDORS --> TOTAL
    MED_VENDORS --> TOTAL
    LOW_VENDORS --> TOTAL

    classDef high fill:#ffc9c9,stroke:#c92a2a
    classDef med fill:#fff3bf,stroke:#e67700
    classDef low fill:#d3f9d8,stroke:#2f9e44
    classDef total fill:#d0bfff,stroke:#6741d9

    class H1,H2,H3,H4,H5,H6,H7 high
    class M1,M2,M3,M4,M5,M6 med
    class L1,L2 low
    class TOTAL total
```

## Research Batch Detail

```mermaid
flowchart LR
    subgraph BATCH["Daily Research Batch — 2 AM UTC"]
        direction TB
        B1["Batch 1: 15 vendors\nTask Group tg_abc123"]
    end

    subgraph AGENTS["Parallel AI Agents (simultaneous)"]
        direction TB
        A1["Microsoft\nFinancial: stable\nLegal: clean\nCyber: LOW\nLeadership: stable\nESG: clean"]
        A2["CrowdStrike\nFinancial: stable\nLegal: clean\nCyber: CRITICAL\nLeadership: stable\nESG: clean"]
        A3["Pfizer\nFinancial: stable\nLegal: HIGH\nCyber: LOW\nLeadership: stable\nESG: LOW"]
        A4["Stripe\nFinancial: stable\nLegal: clean\nCyber: LOW\nLeadership: stable\nESG: clean"]
        A5["JPMorgan\nFinancial: MEDIUM\nLegal: MEDIUM\nCyber: LOW\nLeadership: stable\nESG: LOW"]
        A6["... 10 more vendors\nresearching in parallel"]
    end

    subgraph RESULTS["Scoring Results"]
        direction TB
        R1["Microsoft = LOW\ncontinue_monitoring"]
        R2["CrowdStrike = CRITICAL\nsuspend_relationship\nOverride: active_data_breach"]
        R3["Pfizer = HIGH\ninitiate_contingency"]
        R4["Stripe = LOW\ncontinue_monitoring"]
        R5["JPMorgan = MEDIUM\nescalate_review\nadverse: true (2 categories)"]
    end

    BATCH --> A1
    BATCH --> A2
    BATCH --> A3
    BATCH --> A4
    BATCH --> A5
    BATCH --> A6

    A1 --> R1
    A2 --> R2
    A3 --> R3
    A4 --> R4
    A5 --> R5

    R2 -- "CRITICAL alert" --> SLACK1["#procurement-critical\nImmediate action required"]
    R3 -- "HIGH alert" --> SLACK2["#procurement-alerts\nReview within 48h"]
    R5 -- "MEDIUM digest" --> SLACK3["#procurement-digest\nBatched weekly"]
    R1 -- "LOW logged" --> LOG["Audit Log only"]
    R4 -- "LOW logged" --> LOG

    classDef batch fill:#a5d8ff,stroke:#1971c2
    classDef agent fill:#d0bfff,stroke:#6741d9
    classDef critical fill:#ffc9c9,stroke:#c92a2a
    classDef high fill:#ffe8cc,stroke:#e67700
    classDef medium fill:#fff3bf,stroke:#e67700
    classDef low fill:#d3f9d8,stroke:#2f9e44
    classDef slack fill:#fff3bf,stroke:#e67700

    class B1 batch
    class A1,A2,A3,A4,A5,A6 agent
    class R2 critical
    class R3 high
    class R5 medium
    class R1,R4 low
    class SLACK1 critical
    class SLACK2 high
    class SLACK3 slack
    class LOG low
```

## Event Detection Flow

```mermaid
sequenceDiagram
    participant Web as Public Web
    participant Mon as Parallel AI Monitor
    participant Sys as n8n Workflow
    participant Score as Risk Scorer
    participant Slack as Slack
    participant Log as Audit Log

    Note over Web: Pfizer announces FDA<br/>regulatory action

    Web->>Mon: News detected by monitor:<br/>"Pfizer" regulatory action OR enforcement

    Mon->>Sys: Webhook: monitor.event.detected<br/>monitor_id: mon_pfizer_legal<br/>severity: HIGH

    Sys->>Sys: Enrich with vendor context<br/>Pfizer | healthcare | MEDIUM priority

    Sys->>Sys: Dedup check:<br/>pfizer.com:legal:HIGH<br/>Not seen in 24h — proceed

    Sys->>Score: Score event

    Score->>Score: Legal dimension: HIGH<br/>risk_level = HIGH<br/>adverse_flag = true<br/>action_required = true<br/>recommendation = initiate_contingency

    Score->>Slack: Route to #procurement-alerts<br/>"HIGH: Pfizer — FDA regulatory<br/>action on manufacturing.<br/>Review within 48 hours."

    Score->>Log: Append audit entry<br/>2026-03-05 14:22 | Pfizer | HIGH<br/>source: monitor_event

    Note over Web: Same story picked up<br/>by ESG monitor 2 hours later

    Web->>Mon: News detected by monitor:<br/>"Pfizer" safety violation

    Mon->>Sys: Webhook: monitor.event.detected<br/>monitor_id: mon_pfizer_esg<br/>severity: HIGH

    Sys->>Sys: Dedup check:<br/>pfizer.com:esg:HIGH<br/>Already seen — SKIP

    Note over Sys: Duplicate suppressed.<br/>No alert fatigue.
```

## Ad-Hoc Research Flow

```mermaid
sequenceDiagram
    participant User as Procurement Analyst
    participant Slack as Slack
    participant Sys as n8n Workflow
    participant AI as Parallel AI
    participant Score as Risk Scorer
    participant Log as Audit Log

    User->>Slack: /vendor-research Goldman Sachs

    Slack->>Sys: POST /webhook/slack-command<br/>text: "Goldman Sachs"<br/>channel: #procurement

    Sys->>Slack: "Starting deep research on<br/>Goldman Sachs. 15-30 minutes..."

    Sys->>AI: POST /v1/tasks/runs<br/>processor: ultra8x<br/>webhook: /webhook/adhoc-result

    Note over AI: Agent researches Goldman Sachs<br/>across 6 risk dimensions...<br/>Scans news, filings, databases

    AI->>Sys: Webhook callback<br/>run_id: run_gs_001<br/>status: completed

    Sys->>AI: GET /v1/tasks/runs/run_gs_001/result

    AI->>Sys: Structured JSON result<br/>financial: MEDIUM<br/>legal: LOW<br/>cyber: LOW<br/>leadership: LOW<br/>esg: LOW

    Sys->>Score: Score with source: adhoc

    Score->>Score: 1 MEDIUM dimension<br/>risk_level = MEDIUM<br/>adverse = false<br/>recommendation = escalate_review

    Score->>Slack: Thread reply in #procurement:<br/>"Goldman Sachs assessed at MEDIUM risk.<br/>1 medium finding (financial_health).<br/>No adverse conditions.<br/>Recommendation: escalate_review"

    Score->>Log: Append audit entry<br/>source: adhoc

    User->>User: Reviews findings.<br/>Decides to proceed<br/>with contract renewal.
```
