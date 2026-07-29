// ARTPARK's 13 industry domains — the real prod `industry_categories` labels
// (what the admin pipeline row's `domain` field contains) mapped to their
// tokens (what the IISc roster's `matched_domains` uses). Used to recommend
// jury-selected applications to professors by shared domain.

export const LABEL_TO_TOKEN = {
  "Artificial Intelligence / Foundational Models": "ai",
  "Robotics & Automation": "robotics",
  "Healthcare / MedTech": "health",
  "Defense & Aerospace": "defense",
  "EV Mobility & Services": "ev_mobility_services",
  "Advanced Manufacturing / Industry 5.0": "industry",
  "Semiconductor / Hardware": "semi",
  "Communication (Wired & Wireless)": "comms",
  "Climate Fintech / Urban Resilience": "climate_fintech",
  "EdTech": "edtech",
  "Developer Tools / DevOps": "dev_tools",
  "E-commerce & Artisanal Crafts": "e_commerce_crafts",
  "Other / Frontier": "other",
};

export const TOKEN_TO_LABEL = Object.fromEntries(
  Object.entries(LABEL_TO_TOKEN).map(([label, tok]) => [tok, label]),
);

export const DOMAIN_TOKENS = Object.values(LABEL_TO_TOKEN);
