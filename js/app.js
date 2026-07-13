import {
  CLF_SCOPE_LABELS,
  STATE_ORDER,
  STATE_SLUGS,
} from "./config.js";
import { loadDashboardData } from "./data-loader.js";
import {
  applyBaseFilters,
  applyDistrictDetailFocus,
  clearStateFilters,
  getRoute,
  getRouteFromHash,
  getSelectedClf,
  getSelectedDistrict,
  getSelectedPartner,
  getUniversalSearch,
  getStateFilters,
  hasFilterSelection,
  setRoute,
  setSelectedClf,
  setSelectedDistrict,
  setUniversalSearch,
  toggleSelectedDistrict,
  toggleSelectedPartner,
  updateStateFilter,
} from "./filters.js";
import { renderHomeMap, renderStateDistrictMap } from "./maps.js";
import {
  initDistrictDetailTable,
  initStateComparisonTable,
  applyStateComparisonSearch,
  updateDistrictDetailTable,
  updateStateComparisonTable,
} from "./tables.js";
import {
  cleanCsvValue,
  debounce,
  displayBlock,
  displayClfName,
  displayPartner,
  displayProject,
  formatNumber,
  groupBy,
  hasActiveFilters,
  normalizeString,
  sortAlpha,
  uniqueValues,
} from "./utils.js";

const els = {
  loading: document.getElementById("app-loading"),
  error: document.getElementById("app-error"),
  homeView: document.getElementById("home-view"),
  stateView: document.getElementById("state-view"),
  navTabs: document.getElementById("nav-tabs"),
  universalSearch: document.getElementById("universal-search"),
  searchStatus: document.getElementById("search-status"),
  nationalKpis: document.getElementById("national-kpis"),
  homeFootnotes: document.getElementById("home-footnotes"),
  indiaMapMessage: document.getElementById("india-map-message"),
  statePageTitle: document.getElementById("state-page-title"),
  stateCoverageNote: document.getElementById("state-coverage-note"),
  stateFilterBar: document.getElementById("state-filter-bar"),
  stateKpis: document.getElementById("state-kpis"),
  stateKpiNote: document.getElementById("state-kpi-note"),
  hotspotList: document.getElementById("hotspot-list"),
  sharedDirectory: document.getElementById("shared-clf-directory"),
  districtSummary: document.getElementById("district-details-summary"),
  geographicMapMessage: document.getElementById("geographic-map-message"),
  clfMapMessage: document.getElementById("clf-map-message"),
  geographicMapSummary: document.getElementById("geographic-map-summary"),
  clfMapSummary: document.getElementById("clf-map-summary"),
};

let dashboardData = null;

function countUniqueClfs(rows) {
  return new Set(rows.map((row) => row.clf_key)).size;
}

function rowsWithPartners(rows) {
  return rows.filter((row) => cleanCsvValue(row.partner_organization));
}

function countUniquePartners(rows) {
  return new Set(
    rows
      .map((row) => cleanCsvValue(row.partner_organization))
      .filter(Boolean)
      .map((value) => normalizeString(value))
  ).size;
}

function getStateSummaryRows(allRows, metadata) {
  return metadata.map((stateMeta) => {
    const stateRows = allRows.filter((row) => row.state_slug === stateMeta.state_slug);
    const engagedRows = rowsWithPartners(stateRows);
    return {
      state: stateMeta.state,
      state_slug: stateMeta.state_slug,
      districtsCovered: new Set(engagedRows.map((row) => `${row.state_slug}::${row.district}`))
        .size,
      partners: countUniquePartners(engagedRows),
      clfs: countUniqueClfs(stateRows),
    };
  });
}

function createKpiCard({ label, value, displayValue = "", meta = "", filtered = false }) {
  return `
    <article class="kpi-card">
      <div class="label">${label}</div>
      <div class="value">${displayValue || formatNumber(value)}</div>
      ${meta ? `<div class="meta">${meta}</div>` : ""}
      ${filtered ? `<div class="filtered-pill">Filtered view</div>` : ""}
    </article>
  `;
}

function renderNav(currentRoute) {
  els.navTabs.innerHTML = STATE_ORDER.map((item) => {
    const active = currentRoute === item.slug ? "active" : "";
    return `<a class="nav-link ${active}" href="${item.route}" role="tab" aria-selected="${
      currentRoute === item.slug
    }">${item.name}</a>`;
  }).join("");
}

function renderHome(allRows) {
  const search = cleanCsvValue(getUniversalSearch());
  const stateSummaryRows = getStateSummaryRows(allRows, dashboardData.metadata);
  const matchedStates =
    search.length > 0
      ? new Set(
          allRows
            .filter((row) =>
              [row.district, row.clf_name, row.partner_organization, row.project_title]
                .join(" ")
                .toLowerCase()
                .includes(search.toLowerCase())
            )
            .map((row) => row.state_slug)
        )
      : new Set(stateSummaryRows.map((item) => item.state_slug));
  const matchedStateSlugs = new Set(
    [...matchedStates]
  );

  const engagedRows = rowsWithPartners(allRows);

  els.nationalKpis.innerHTML = [
    createKpiCard({ label: "States Covered", value: 7 }),
    createKpiCard({
      label: "Districts Covered",
      value: new Set(engagedRows.map((row) => `${row.state_slug}::${row.district}`)).size,
    }),
    createKpiCard({
      label: "Partner Organizations",
      value: countUniquePartners(engagedRows),
    }),
    createKpiCard({
      label: "Cluster Level Federations (CLFs)",
      value: countUniqueClfs(allRows),
    }),
  ].join("");

  els.homeFootnotes.innerHTML = dashboardData.warnings
    .map((warning) => `<div class="footnote">${warning}</div>`)
    .join("");

  updateStateComparisonTable(
    search ? stateSummaryRows.filter((row) => matchedStateSlugs.has(row.state_slug)) : stateSummaryRows
  );
  applyStateComparisonSearch("");
  renderHomeMap({
    stateStats: stateSummaryRows,
    matchedStateSlugs,
    messageTarget: els.indiaMapMessage,
  });
}

function buildStateFilterOptions(rows) {
  return {
    district: sortAlpha(uniqueValues(rows, (row) => row.district)),
    partner: sortAlpha(uniqueValues(rows, (row) => row.partner_organization)),
    clf: rows
      .map((row) => ({ key: row.clf_key, label: `${row.clf_name} (${row.district})` }))
      .filter(
        (item, index, self) =>
          item.key &&
          self.findIndex((candidate) => candidate.key === item.key) === index
      )
      .sort((a, b) => a.label.localeCompare(b.label)),
    project: sortAlpha(uniqueValues(rows, (row) => row.project_title)),
  };
}

function renderFilterBar(stateSlug, stateRows) {
  const filters = getStateFilters(stateSlug);
  const options = buildStateFilterOptions(stateRows);
  els.stateFilterBar.innerHTML = `
    <div class="filter-group">
      <label for="filter-district">District</label>
      <select id="filter-district" aria-label="Filter by district">
        <option value="">All districts</option>
        ${options.district.map((value) => `<option value="${value}" ${
          filters.district === value ? "selected" : ""
        }>${value}</option>`).join("")}
      </select>
    </div>
    <div class="filter-group">
      <label for="filter-partner">Partner Organization</label>
      <select id="filter-partner" aria-label="Filter by partner organization">
        <option value="">All partners</option>
        ${options.partner.map((value) => `<option value="${value}" ${
          filters.partner === value ? "selected" : ""
        }>${value}</option>`).join("")}
      </select>
    </div>
    <div class="filter-group">
      <label for="filter-clf">CLF</label>
      <select id="filter-clf" aria-label="Filter by CLF">
        <option value="">All CLFs</option>
        ${options.clf.map((item) => `<option value="${item.key}" ${
          filters.clf === item.key ? "selected" : ""
        }>${item.label}</option>`).join("")}
      </select>
    </div>
    <div class="filter-group">
      <label for="filter-project">Project Title</label>
      <select id="filter-project" aria-label="Filter by project title">
        <option value="">All projects</option>
        ${options.project.map((value) => `<option value="${value}" ${
          filters.project === value ? "selected" : ""
        }>${value || "Not specified"}</option>`).join("")}
      </select>
    </div>
    <div class="filter-group">
      <label for="clear-filters">Actions</label>
      <button id="clear-filters" type="button" aria-label="Clear all filters">Clear All Filters</button>
    </div>
  `;

  ["district", "partner", "clf", "project"].forEach((key) => {
    document.getElementById(`filter-${key}`).addEventListener("change", (event) => {
      updateStateFilter(stateSlug, key, event.target.value);
      setSelectedClf(stateSlug, "");
      render();
    });
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    clearStateFilters(stateSlug);
    render();
  });
}

function getSharedClfGroups(rows, minimumPartners = 2) {
  const grouped = groupBy(rows, (row) => row.clf_key);
  return [...grouped.entries()]
    .map(([clfKey, clfRows]) => {
      const partners = sortAlpha(uniqueValues(clfRows, (row) => row.partner_organization));
      return {
        clfKey,
        clfName: clfRows[0]?.clf_name || "Unnamed CLF",
        district: clfRows[0]?.district || "",
        partners,
        rows: clfRows,
      };
    })
    .filter((item) => item.partners.length >= minimumPartners)
    .sort((a, b) => a.clfName.localeCompare(b.clfName));
}

function buildDistrictStats(rows, hotspotRows = [], stateTotalClfs = countUniqueClfs(rows)) {
  const allDistricts = sortAlpha(uniqueValues(rows, (row) => row.district));
  return allDistricts.map((district) => {
    const districtRows = rows.filter((row) => row.district === district);
    const partnerRows = rowsWithPartners(districtRows);
    const totalClfs = countUniqueClfs(districtRows);
    const engagedClfs = countUniqueClfs(partnerRows);
    const hotspotClfKeys = new Set(
      hotspotRows.filter((item) => item.district === district).map((item) => item.clfKey)
    );
    const hotspotPartners = new Set(
      hotspotRows
        .filter((item) => item.district === district)
        .flatMap((item) => item.partners)
    );
    return {
      district,
      activePartners: new Set(partnerRows.map((row) => row.partner_organization)).size,
      clfs: totalClfs,
      totalClfs,
      engagedClfs,
      engagementShare: stateTotalClfs ? engagedClfs / stateTotalClfs : 0,
      notEngagedClfs: Math.max(0, totalClfs - engagedClfs),
      hotspots: hotspotClfKeys.size,
      hotspotPartners: hotspotPartners.size,
    };
  });
}

function renderStateView(stateSlug) {
  const stateMeta = dashboardData.metadataBySlug[stateSlug];
  const stateRows = dashboardData.rowsByState[stateSlug] || [];
  const baseRows = applyBaseFilters(stateRows, stateSlug);
  const focusedRows = applyDistrictDetailFocus(baseRows, stateSlug);
  const selectedDistrict = getSelectedDistrict(stateSlug);
  const selectedPartner = getSelectedPartner(stateSlug);
  const selectedClf = getSelectedClf(stateSlug);
  const filterApplied = hasFilterSelection(stateSlug);
  const activePartnerRows = rowsWithPartners(baseRows);
  const totalClfsInView = countUniqueClfs(baseRows);
  const engagedClfsInView = countUniqueClfs(activePartnerRows);
  const hotspotClfs = getSharedClfGroups(baseRows, 3);
  const districtStats = buildDistrictStats(baseRows, hotspotClfs, totalClfsInView);

  els.statePageTitle.textContent = stateMeta.state;
  els.stateCoverageNote.textContent = "";
  renderFilterBar(stateSlug, stateRows);

  const hotspotCount = hotspotClfs.length;

  els.stateKpis.innerHTML = [
    createKpiCard({
      label: "Districts Covered",
      value: new Set(activePartnerRows.map((row) => row.district)).size,
      filtered: filterApplied,
    }),
    createKpiCard({
      label: "Active Partner Organizations",
      value: countUniquePartners(activePartnerRows),
      filtered: filterApplied,
    }),
    createKpiCard({
      label: "Engaged CLFs",
      value: engagedClfsInView,
      meta: `${formatNumber(Math.max(0, totalClfsInView - engagedClfsInView))} not engaged`,
      filtered: filterApplied,
    }),
    createKpiCard({
      label: CLF_SCOPE_LABELS[stateMeta.clf_data_scope],
      value: totalClfsInView,
      filtered: filterApplied,
    }),
    createKpiCard({
      label: "3+ Partner CLF Hotspots",
      value: hotspotCount,
      meta: "CLFs linked to three or more partner organizations",
      filtered: filterApplied,
    }),
  ].join("");

  els.stateKpiNote.textContent = "";
  const hotspotDistricts = districtStats
    .filter((item) => item.hotspots > 0)
    .sort((a, b) => b.hotspots - a.hotspots || a.district.localeCompare(b.district));

  els.hotspotList.innerHTML = hotspotDistricts.length
    ? hotspotDistricts
        .map(
          (item) => `
          <button class="hotspot-item ${selectedDistrict === item.district ? "active" : ""}" type="button" data-district="${item.district}" aria-pressed="${
            selectedDistrict === item.district
          }">
            <strong>${item.district}</strong>
            <div class="hotspot-meta">${formatNumber(item.hotspots)} hotspot CLFs | ${formatNumber(item.hotspotPartners)} partners</div>
          </button>`
        )
        .join("")
    : `<div class="empty-state-card">No CLFs with three or more partners are present for this selection.</div>`;

  els.hotspotList.querySelectorAll("[data-district]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSelectedDistrict(stateSlug, button.dataset.district);
      setSelectedClf(stateSlug, "");
      render();
    });
  });

  els.sharedDirectory.innerHTML = hotspotClfs.length
    ? hotspotClfs
        .map(
          (item) => `
          <button class="shared-clf-item ${selectedClf === item.clfKey ? "active" : ""}" type="button" data-clf="${item.clfKey}" data-district="${item.district}" aria-pressed="${
            selectedClf === item.clfKey
          }">
            <strong>${item.clfName}</strong>
            <div class="shared-clf-meta">District: ${item.district}</div>
            <div class="shared-clf-meta">${item.partners.length} partners: ${item.partners.join(", ")}</div>
          </button>`
        )
        .join("")
    : `<div class="empty-state-card">No hotspot CLFs with three or more partners are present for this selection.</div>`;

  els.sharedDirectory.querySelectorAll("[data-clf]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedDistrict(stateSlug, button.dataset.district);
      setSelectedClf(stateSlug, button.dataset.clf);
      render();
    });
  });

  const detailRows = focusedRows.length ? focusedRows : baseRows;
  const detailTableRows = detailRows.map((row) => ({
    ...row,
    block_display: displayBlock(row.block),
    clf_name_display: displayClfName(row.clf_name),
    partner_display: displayPartner(row.partner_organization),
    project_display: displayProject(row.project_title),
  }));

  if (!baseRows.length) {
    els.districtSummary.className = "district-summary empty-state";
    els.districtSummary.textContent = "No CLFs found for the current filters.";
  } else if (!selectedDistrict && !detailTableRows.length) {
    els.districtSummary.className = "district-summary empty-state";
    els.districtSummary.textContent =
      "Select a district on either map or use the filters to view district-level details.";
  } else if (!selectedDistrict && filterApplied) {
    els.districtSummary.className = "district-summary";
    els.districtSummary.textContent = `Filtered view. Showing ${formatNumber(
      detailTableRows.length
    )} detail rows across ${formatNumber(
      new Set(detailTableRows.map((row) => row.district)).size
    )} districts.`;
  } else if (!selectedDistrict && selectedPartner) {
    els.districtSummary.className = "district-summary";
    els.districtSummary.textContent = `Partner focus: ${selectedPartner}. Showing ${formatNumber(
      detailTableRows.length
    )} detail rows across ${formatNumber(
      new Set(detailTableRows.map((row) => row.district)).size
    )} districts.`;
  } else if (selectedDistrict) {
    const districtRows = baseRows.filter((row) => row.district === selectedDistrict);
    const districtTotalClfs = countUniqueClfs(districtRows);
    const districtEngagedClfs = countUniqueClfs(rowsWithPartners(districtRows));
    els.districtSummary.className = "district-summary";
    els.districtSummary.textContent = `${selectedDistrict} | ${formatNumber(
      districtEngagedClfs
    )} engaged CLFs | ${formatNumber(
      districtTotalClfs
    )} total CLFs | ${formatNumber(
      Math.max(0, districtTotalClfs - districtEngagedClfs)
    )} not engaged | ${formatNumber(
      new Set(rowsWithPartners(districtRows).map((row) => row.partner_organization)).size
    )} active partners${filterApplied ? " | Filtered view" : ""}`;
  } else {
    els.districtSummary.className = "district-summary empty-state";
    els.districtSummary.textContent =
      "Select a district on either map or use the filters to view district-level details.";
  }

  updateDistrictDetailTable(detailTableRows);

  const geoMapRows = selectedPartner
    ? baseRows.filter((row) => row.partner_organization === selectedPartner)
    : baseRows;
  const focusedGeoDistrictStats = selectedPartner
    ? new Map(
        buildDistrictStats(geoMapRows, hotspotClfs, totalClfsInView).map((item) => [item.district, item])
      )
    : null;
  const geoDistrictStats = selectedPartner
    ? districtStats.map((districtItem) => {
        const focusedDistrict = focusedGeoDistrictStats.get(districtItem.district);
        return focusedDistrict
          ? {
              ...districtItem,
              engagedClfs: focusedDistrict.engagedClfs,
              engagementShare: focusedDistrict.engagementShare,
              notEngagedClfs: Math.max(
                0,
                districtItem.totalClfs - focusedDistrict.engagedClfs
              ),
              activePartners: focusedDistrict.activePartners,
            }
          : districtItem;
      })
    : districtStats;

  renderStateDistrictMap({
    slug: stateSlug,
    stateName: stateMeta.state,
    containerId: "geographic-map",
    crosswalkRows: dashboardData.crosswalkRows,
    districtStats: geoDistrictStats,
    mapType: "engagement",
    selectedDistrict,
    selectedDistrictCallback: (district) => {
      toggleSelectedDistrict(stateSlug, district);
      setSelectedClf(stateSlug, "");
      render();
    },
    messageTarget: els.geographicMapMessage,
  });

  renderStateDistrictMap({
    slug: stateSlug,
    stateName: stateMeta.state,
    containerId: "clf-map",
    crosswalkRows: dashboardData.crosswalkRows,
    districtStats,
    mapType: "coverage",
    selectedDistrict,
    selectedDistrictCallback: (district) => {
      toggleSelectedDistrict(stateSlug, district);
      setSelectedClf(stateSlug, "");
      render();
    },
    messageTarget: els.clfMapMessage,
  });

  els.stateKpiNote.textContent = selectedPartner
    ? `Partner focus: ${selectedPartner}. The first map shows each district's share of the full state CLF base linked to this partner, and the second map shows active partner coverage by district.`
    : "The first map shows each district's share of the full state CLF base that is engaged. The second map shows the number of active partners by district, with hotspot panels highlighting CLFs linked to three or more partners.";

}

function renderSearchStatus() {
  const route = getRoute();
  const search = cleanCsvValue(els.universalSearch.value);
  if (!search) {
    els.searchStatus.textContent = "";
    return;
  }

  if (route === "home") {
    const matches = dashboardData.rows.filter((row) =>
      [row.district, row.clf_name, row.partner_organization, row.project_title]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase())
    ).length;
    els.searchStatus.textContent = `${formatNumber(matches)} matching rows`;
    return;
  }

  const rows = applyBaseFilters(dashboardData.rowsByState[route] || [], route);
  els.searchStatus.textContent = `${formatNumber(rows.length)} matching rows`;
}

function render() {
  const route = getRoute();
  renderNav(route);
  renderSearchStatus();

  els.loading.classList.add("hidden");
  els.error.classList.add("hidden");

  if (route === "home") {
    els.homeView.classList.remove("hidden");
    els.stateView.classList.add("hidden");
    renderHome(dashboardData.rows);
    return;
  }

  if (!STATE_SLUGS.includes(route)) {
    window.location.hash = "#home";
    return;
  }

  els.homeView.classList.add("hidden");
  els.stateView.classList.remove("hidden");
  renderStateView(route);
}

function bindGlobalEvents() {
  window.addEventListener("hashchange", () => {
    setRoute(getRouteFromHash(window.location.hash));
    render();
  });

  const onSearch = debounce((event) => {
    setUniversalSearch(event.target.value);
    render();
  }, 220);
  els.universalSearch.addEventListener("input", onSearch);
}

async function init() {
  try {
    dashboardData = await loadDashboardData();
    initStateComparisonTable((stateSlug) => {
      window.location.hash = `#${stateSlug}`;
    });
    initDistrictDetailTable();

    setRoute(getRouteFromHash(window.location.hash || "#home"));
    bindGlobalEvents();
    render();
  } catch (error) {
    console.error(error);
    els.loading.classList.add("hidden");
    els.error.classList.remove("hidden");
    els.error.textContent = "The dashboard could not load. Check the browser console for details.";
  }
}

init();
