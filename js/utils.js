import { GEOJSON_PROPERTY_CANDIDATES } from "./config.js";

const PARTNER_NAME_ALIASES = new Map([
  ["buzzworthy ventures", "Buzzworthy Ventures"],
  ["c3", "Centre for Catalysing Change (C3)"],
  ["centre for catalysing change (c3)", "Centre for Catalysing Change (C3)"],
  ["development alternatives", "Development Alternatives"],
  ["gdi partners", "GDi Partners"],
  ["gram vikas", "Gram Vikas Trust"],
  ["gram vikas trust", "Gram Vikas Trust"],
  ["harsha trust", "Harsha Trust"],
  ["imago", "IMAGO Global Grassroots"],
  ["imago global grassroots", "IMAGO Global Grassroots"],
  ["industree", "Industree Foundation"],
  ["industree foundation", "Industree Foundation"],
  ["leap 300", "Leap 300 (Patthana)"],
  ["leap 300 (patthana)", "Leap 300 (Patthana)"],
  ["microsave", "Microsave Consulting (MSC)"],
  ["microsave consulting (msc)", "Microsave Consulting (MSC)"],
  ["nudge", "The Nudge Foundation"],
  ["the nudge foundation", "The Nudge Foundation"],
  ["palladium", "Palladium India"],
  ["palladium india", "Palladium India"],
  ["pci", "Project Concern International (PCI), Global, India"],
  [
    "project concern international (pci) global india",
    "Project Concern International (PCI), Global, India",
  ],
  ["pradan", "Professional Assistance for Development Action (PRADAN)"],
  [
    "professional assistance for development action (pradan)",
    "Professional Assistance for Development Action (PRADAN)",
  ],
  ["rcrc", "Responsible Coalition for Resilient Communities (RCRC)"],
  [
    "responsible coalition for resilient communities (rcrc)",
    "Responsible Coalition for Resilient Communities (RCRC)",
  ],
  ["sa dhan", "Sa-Dhan"],
  ["srijan", "Self Reliant Initiatives through Joint Action (SRIJAN)"],
  [
    "self reliant initiatives through joint action (srijan)",
    "Self Reliant Initiatives through Joint Action (SRIJAN)",
  ],
  ["syngenta foundation (sfi)", "Syngenta Foundation India (SFI)"],
  ["syngenta foundation india (sfi)", "Syngenta Foundation India (SFI)"],
  ["trif", "Transform Rural India Foundation (TRIF)"],
  ["transform rural india foundation (trif)", "Transform Rural India Foundation (TRIF)"],
]);

export function normalizeString(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[._/,-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function slugify(value) {
  return normalizeString(value).replace(/\s+/g, "-");
}

export function cleanCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\uFEFF/g, "").trim();
}

export function coalesce(value, fallback) {
  return cleanCsvValue(value) || fallback;
}

export function displayProject(value) {
  return cleanCsvValue(value) || "Not specified";
}

export function displayBlock(value) {
  return cleanCsvValue(value) || "Not specified";
}

export function displayClfName(value) {
  return cleanCsvValue(value) || "Unnamed CLF";
}

export function displayPartner(value) {
  const cleaned = cleanCsvValue(value);
  if (!cleaned) {
    return "Not currently linked to partner in dataset";
  }
  return PARTNER_NAME_ALIASES.get(normalizeString(cleaned)) || cleaned;
}

export function canonicalizePartnerName(value) {
  const cleaned = cleanCsvValue(value);
  if (!cleaned) {
    return "";
  }
  return PARTNER_NAME_ALIASES.get(normalizeString(cleaned)) || cleaned;
}

export function deterministicClfId({ state, district, block, clfName }) {
  const base = [state, district, block, clfName].map(slugify).join("-");
  return base || "unassigned-clf";
}

export function uniqueValues(rows, accessor) {
  return [...new Set(rows.map(accessor).filter(Boolean))];
}

export function groupBy(rows, keyFn) {
  return rows.reduce((acc, row) => {
    const key = keyFn(row);
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(row);
    return acc;
  }, new Map());
}

export function dedupeRows(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

export function formatPercent(value, digits = 1) {
  return new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

export function debounce(fn, wait = 200) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export function getFirstMatchingProperty(properties, candidates) {
  if (!properties) {
    return "";
  }
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(properties, candidate)) {
      return cleanCsvValue(properties[candidate]);
    }
  }
  return "";
}

export function getDistrictNameFromFeature(feature) {
  return getFirstMatchingProperty(feature?.properties, GEOJSON_PROPERTY_CANDIDATES.district);
}

export function getStateNameFromFeature(feature) {
  return getFirstMatchingProperty(feature?.properties, GEOJSON_PROPERTY_CANDIDATES.state);
}

export function createDistrictMatcher(crosswalkRows = []) {
  const crosswalk = new Map();
  crosswalkRows.forEach((row) => {
    const stateKey = normalizeString(row.state);
    const csvKey = normalizeString(row.csv_district);
    const geoKey = cleanCsvValue(row.geojson_district);
    if (stateKey && csvKey && geoKey) {
      crosswalk.set(`${stateKey}::${csvKey}`, geoKey);
    }
  });

  return function matchDistrict(stateName, csvDistrict, geoDistrictNames) {
    const csvNorm = normalizeString(csvDistrict);
    const direct = geoDistrictNames.find(
      (candidate) => normalizeString(candidate) === csvNorm
    );
    if (direct) {
      return direct;
    }

    const crosswalkHit = crosswalk.get(`${normalizeString(stateName)}::${csvNorm}`);
    if (crosswalkHit) {
      return crosswalkHit;
    }

    return "";
  };
}

export function hasActiveFilters(filterState) {
  if (!filterState) {
    return false;
  }
  return Object.values(filterState).some((value) => cleanCsvValue(value));
}

export function sortAlpha(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}
