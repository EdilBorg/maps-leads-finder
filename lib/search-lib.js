"use strict";
const createPlaceModel = require("./place-model");
const createSearchEngines = require("./search-engines");
module.exports = function createSearchLib(deps) {
  const place = createPlaceModel(deps);
  const engines = createSearchEngines({ fetch: deps.fetch, place });
  return Object.assign(
    {
      hasApify: place.hasApify,
      hasOsm: place.hasOsm,
      friendlyError: place.friendlyError,
      dedupeAndMerge: place.dedupeAndMerge,
      applyFilters: place.applyFilters,
      sortByQuality: place.sortByQuality
    },
    engines
  );
};
