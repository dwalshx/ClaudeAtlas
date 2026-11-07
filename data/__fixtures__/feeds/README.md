# data/__fixtures__/feeds — Phase 4.2 API harvest fixtures

Trimmed captures of REAL source responses. Every parser test in
`scripts/lib/feeds/__tests__/` and the harvester/filter tests are pinned to
these exact bytes.

## Provenance

- Capture date: **2026-11-05**
- User-Agent: `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`
- Sources (license per Phase 4.2 D-01):
  - APIs.guru list — `https://api.apis.guru/v2/list.json` (CC0)
  - APIs.guru specs — `https://api.apis.guru/v2/specs/stripe.com/2022-11-15/openapi.json` and `https://api.apis.guru/v2/specs/data.gov/3.0/swagger.json` (CC0)
  - data.gouv.fr dataservices — `https://www.data.gouv.fr/api/1/dataservices/?page_size=200` (Licence Ouverte 2.0)
  - UK co-cddo/api-catalogue — `https://raw.githubusercontent.com/co-cddo/api-catalogue/main/data/catalogue.csv` (OGL v3)
  - marcelscruz/public-apis — `db/resources.json` raw from GitHub (MIT)

## Files

| File | What it is | Selection rule |
|---|---|---|
| `apis-guru-list-slice.json` | 7 entries of list.json, keyed by API id | `stripe.com`, `data.gov`, `adobe.com:aem` (the `x-unofficialSpec` case), `github.com` (multi-version), `azure.com:network-networkInterface` (10 versions), `twilio.com:api`, `openai.com`; `openai.com`/`stripe.com`/`github.com` overlap with public-apis for merge tests. Every `updated` is before 2024-01-01 (frozen directory). |
| `openapi3-stripe-trimmed.json` | OpenAPI 3.0.0 stripe spec, trimmed | `servers` + `components.securitySchemes` (http basic + bearer), 2 paths, `application/json` responses, no `info.license` |
| `swagger2-datagov.json` | Full Swagger 2.0 data.gov spec | `host`+`basePath`+`schemes`, `securityDefinitions.api_key` (apiKey in query), 3 paths, `produces` incl. `applicaiton/xml` (sic) and `*/*`, `externalDocs` |
| `data-gouv-page.json` | One dataservices page, 6 items, all 39 keys kept (`datasets`/`contact_points` trimmed to ≤ 1) | `api-melodi` (open, lov2, unparseable FR rate limit), `api-donnees-radar` (unparseable `850 req/5mins`), `api-bulletin-vigilance` (parseable `60 req/min`), `explore-api-v2-56` (restricted, no license), `api-service-finances-publiques-sfip` (no `base_api_url` but `machine_documentation_url`), `api-croustillant` (owner-only, no organization) |
| `uk-catalogue-10.csv` | Header + 10 raw catalogue records (LF, no BOM) | GOV.UK Notify (literal `\n` text), Bank Holidays, Access Control Service HL7 V3 API (REAL multi-line quoted field), Get into Teaching API (empty url), FINDr Matching Service (empty url AND docs), OS Maps API (license is a URL), LGInform Plus (license is free text), plus 3 GOV.UK fillers |
| `public-apis-10.json` | `{ count, entries }`, 10 entries | Auth `""` / `apiKey` / `OAuth` / `X-Mashape-Key` / `User-Agent`; short descriptions; Cat Facts, GitHub, OpenAI, Stripe, Open Food Facts, ApexVerify, Clarifai, Meteorologisk Institutt, 2 RapidAPI entries |
| `rate-limit-strings.json` | 99 rows `{ raw, requests, per }`, sorted by raw | All 99 distinct trimmed `rate_limiting` strings from the 1,281 live dataservices, with the expected parse per orchestrator decision 4: **61 parsed / 38 null**. Do not hand-edit; regenerate from a fresh capture if the parser contract changes. |

## Integrity

| File | Bytes | sha256 |
|---|---|---|
| apis-guru-list-slice.json | 24,180 | `c3618e2efee991e943789e9d1bfd501081e0608dfe12f47c27b870fd04ef9620` |
| openapi3-stripe-trimmed.json | 1,627 | `01a4d78cc8f69b5072bd1a3c9459cfd4322f16cb8e234d2fc124e1bf9cbf17ce` |
| swagger2-datagov.json | 14,871 | `312ff65be30e52f277ddd3f99f55116fb365e92b37b283b9c975f0485f34af29` |
| data-gouv-page.json | 38,304 | `4f332fc81f21a8691380ade215c96e65f7924cc76f2c037eb15ce98e1a99d511` |
| uk-catalogue-10.csv | 4,929 | `089846965bd2545f0cbb1853ab7b98984a951b1eb42ce2d15cd4d092fef2df94` |
| public-apis-10.json | 2,513 | `be0e1a3b9a20a4b6342a83672933fd7f805dd3299b948b568ceda42235963eda` |
| rate-limit-strings.json | 13,075 | `fb06b62257882174a72400cb96c7259fdd4fd697e595a8959ea0d879878c9fb9` |

`.gitattributes` marks this directory `-text` so checkouts keep LF bytes.

## Rules

- Fixtures are read only by `*.test.js` files (allowlisted for `readFileSync`
  by `scripts/check-banned-patterns.js`); pipeline code never imports them.
- Never re-capture silently: a re-capture bumps the date in this README and
  the sha256 table in the same commit.
