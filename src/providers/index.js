const { searchBrave, testBrave } = require("./brave");
const { searchTavily, testTavily } = require("./tavily");
const { searchExa, testExa } = require("./exa");
const { searchSearxng, testSearxng } = require("./searxng");
const { searchJina, testJina } = require("./jina");
const { searchKagi, testKagi } = require("./kagi");
const { searchFirecrawl, testFirecrawl } = require("./firecrawl");
const { searchSerpapi, testSerpapi } = require("./serpapi");
const { searchBing, testBing } = require("./bing");
const { searchGooglePse, testGooglePse } = require("./google_pse");
const { searchParallel, testParallel } = require("./parallel");
const { ProviderError } = require("./errors");

/**
 * needsSecret: API key required
 * secretHint: UI placeholder / help
 */
const PROVIDERS = {
  brave: {
    search: searchBrave,
    test: testBrave,
    needsSecret: true,
    label: "Brave Search API",
    secretHint: "X-Subscription-Token from api-dashboard.search.brave.com",
  },
  tavily: {
    search: searchTavily,
    test: testTavily,
    needsSecret: true,
    label: "Tavily",
    secretHint: "tvly-… API key",
  },
  exa: {
    search: searchExa,
    test: testExa,
    needsSecret: true,
    label: "Exa",
    secretHint: "Exa API key",
  },
  searxng: {
    search: searchSearxng,
    test: testSearxng,
    needsSecret: false,
    label: "SearXNG (self-hosted)",
    secretHint: "Optional bearer if instance is locked down",
  },
  jina: {
    search: searchJina,
    test: testJina,
    needsSecret: true,
    label: "Jina Search",
    secretHint: "Jina API key (s.jina.ai)",
  },
  kagi: {
    search: searchKagi,
    test: testKagi,
    needsSecret: true,
    label: "Kagi",
    secretHint: "Kagi API token",
  },
  firecrawl: {
    search: searchFirecrawl,
    test: testFirecrawl,
    needsSecret: true,
    label: "Firecrawl",
    secretHint: "Firecrawl API key",
  },
  serpapi: {
    search: searchSerpapi,
    test: testSerpapi,
    needsSecret: true,
    label: "SerpAPI",
    secretHint: "SerpAPI api_key",
  },
  bing: {
    search: searchBing,
    test: testBing,
    needsSecret: true,
    label: "Bing (Azure)",
    secretHint: "Ocp-Apim-Subscription-Key",
  },
  google_pse: {
    search: searchGooglePse,
    test: testGooglePse,
    needsSecret: true,
    label: "Google Programmable Search",
    secretHint: "API_KEY:CX (colon-separated)",
  },
  parallel: {
    search: searchParallel,
    test: testParallel,
    needsSecret: true,
    label: "Parallel",
    secretHint: "Parallel API key",
  },
};

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new ProviderError("bad_request", `Unknown provider: ${name}`);
  return p;
}

module.exports = { PROVIDERS, getProvider, ProviderError };
