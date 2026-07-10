import { GEOJSON_PROPERTY_CANDIDATES } from "./config.js";

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
  return cleanCsvValue(value) || "Not currently linked to partner in dataset";
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
  function districtKey(value) {
    return cleanCsvValue(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\bmetropolitan\b/gi, "metro")
      .replace(/\bnorth\s+cachar\s+hills\b/gi, " ")
      .replace(/\bpashchim\b/gi, "west")
      .replace(/\bpaschim\b/gi, "west")
      .replace(/\bpurbi\b/gi, "east")
      .replace(/\bpoorbi\b/gi, "east")
      .replace(/\bpurba\b/gi, "east")
      .replace(/\bdakshin\b/gi, "south")
      .replace(/\buttar\b/gi, "north")
      .replace(/&/g, " and ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(dist|district)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function districtKeys(value) {
    const key = districtKey(value);
    const compactKey = key.replace(/\s+/g, "");

    return [...new Set([key, compactKey].filter(Boolean))];
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 0; i < a.length; i += 1) {
      const current = [i + 1];

      for (let j = 0; j < b.length; j += 1) {
        const insert = current[j] + 1;
        const remove = previous[j + 1] + 1;
        const replace = previous[j] + (a[i] === b[j] ? 0 : 1);

        current.push(Math.min(insert, remove, replace));
      }

      previous.splice(0, previous.length, ...current);
    }

    return previous[b.length];
  }

  function similarity(a, b) {
    const longer = Math.max(a.length, b.length);

    if (!longer) return 1;

    return 1 - levenshtein(a, b) / longer;
  }

  function hasTokenSubsetMatch(csvKey, geoKey) {
    const csvTokens = csvKey.split(" ").filter((token) => token.length >= 5);
    const geoTokens = new Set(geoKey.split(" "));

    return csvTokens.length > 0 && csvTokens.every((token) => geoTokens.has(token));
  }

  const crosswalk = new Map();

  crosswalkRows.forEach((row) => {
    const stateKeys = districtKeys(row.state);
    const csvKeys = districtKeys(row.csv_district);
    const geoDistrict = cleanCsvValue(row.geojson_district);

    if (!geoDistrict) return;

    stateKeys.forEach((stateKey) => {
      csvKeys.forEach((csvKey) => {
        crosswalk.set(`${stateKey}::${csvKey}`, geoDistrict);
      });
    });
  });

  return function matchDistrict(stateName, csvDistrict, geoDistrictNames = []) {
    const stateKeys = districtKeys(stateName);
    const csvKeys = districtKeys(csvDistrict);
    const geoNames = geoDistrictNames.filter(Boolean);

    const geoByKey = new Map();

    geoNames.forEach((geoName) => {
      districtKeys(geoName).forEach((geoKey) => {
        if (!geoByKey.has(geoKey)) {
          geoByKey.set(geoKey, geoName);
        }
      });
    });

    // 1. Direct match after stronger cleanup:
    // Kaimur (Bhabua) -> Kaimur
    // Kushi Nagar -> Kushinagar
    // Kamrup Metropolitan -> Kamrup Metro
    for (const csvKey of csvKeys) {
      if (geoByKey.has(csvKey)) {
        return geoByKey.get(csvKey);
      }
    }

    // 2. Existing crosswalk still works for old/parent-district boundaries:
    // Mauganj -> Rewa
    // Prayagraj -> Allahabad
    // Narmadapuram -> Hoshangabad
    for (const stateKey of stateKeys) {
      for (const csvKey of csvKeys) {
        const crosswalkHit = crosswalk.get(`${stateKey}::${csvKey}`);

        if (crosswalkHit) {
          const verifiedGeoName = geoNames.find((geoName) =>
            districtKeys(geoName).some((geoKey) =>
              districtKeys(crosswalkHit).includes(geoKey)
            )
          );

          return verifiedGeoName || crosswalkHit;
        }
      }
    }

    // 3. Safe token-subset match:
    // Kheri -> Lakhimpur Kheri
    for (const csvKey of csvKeys) {
      for (const geoName of geoNames) {
        const geoKey = districtKey(geoName);

        if (hasTokenSubsetMatch(csvKey, geoKey)) {
          return geoName;
        }
      }
    }

    // 4. Fuzzy fallback for small spelling differences:
    // East Singhbum -> East Singhbhum
    // Sahebganj -> Sahibganj
    // Rajnandagon -> Rajnandgaon
    let bestMatch = "";
    let bestScore = 0;
    let secondBestScore = 0;

    const csvComparable = csvKeys
      .filter((key) => key.length >= 5)
      .sort((a, b) => b.length - a.length)[0];

    if (!csvComparable) {
      return "";
    }

    geoNames.forEach((geoName) => {
      const geoComparableKeys = districtKeys(geoName).filter((key) => key.length >= 5);

      const score = Math.max(
        0,
        ...geoComparableKeys.map((geoKey) => similarity(csvComparable, geoKey))
      );

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestMatch = geoName;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    });

    if (bestScore >= 0.88 && bestScore - secondBestScore >= 0.03) {
      return bestMatch;
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
