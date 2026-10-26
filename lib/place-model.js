"use strict";
const createPlaceConstants = require("./place-constants");
const createPlaceNormalize = require("./place-normalize");
const createPlaceFilters = require("./place-filters");
module.exports = function createPlaceModel(deps) {
  const constants = createPlaceConstants(deps);
  const normalize = createPlaceNormalize({
    locale: deps.locale,
    leadFields: deps.leadFields,
    constants
  });
  const filters = createPlaceFilters({ isOfficialWebsite: constants.isOfficialWebsite });
  return Object.assign({}, constants, normalize, filters);
};
