const { searchBrave, testBrave } = require("./brave");
const { searchTavily, testTavily } = require("./tavily");
const { searchExa, testExa } = require("./exa");
const { searchSearxng, testSearxng } = require("./searxng");
const { ProviderError } = require("./errors");

const PROVIDERS = {
  brave: { search: searchBrave, test: testBrave, needsSecret: true },
  tavily: { search: searchTavily, test: testTavily, needsSecret: true },
  exa: { search: searchExa, test: testExa, needsSecret: true },
  searxng: { search: searchSearxng, test: testSearxng, needsSecret: false },
};

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new ProviderError("bad_request", `Unknown provider: ${name}`);
  return p;
}

module.exports = { PROVIDERS, getProvider, ProviderError };
