# Coupon supply on the open web

Measured October 11, 2026, with HoldBot 0.1, a read-only research crawler:
- main crawl: 7:13–7:25 PM EDT;
- Shopify check: 8:05–8:07 PM EDT.

Nothing was built for shoppers. No code was tried at a checkout, and no store was contacted.

The question: is there enough public, owner-posted coupon supply to make a Hold coupon index worth building?

## Answer

**Not yet.** One of the three bars is met, and only for stores that sell goods.

| Bar | Result | Met? |
|---|---|---|
| Tier 1 stores ≥ 100 | **58 stores** (71 codes). 42 of them sell goods. | **No** |
| Several creators per popular brand | **Most brands have one.** 71 of 88 podcast-promoted brands have 1 creator; the most-promoted brand has 4. | **No** |
| Majority of Tier 1 stores on Shopify | **27 of 58 (47%)** confirmed. Among the 42 goods stores: **26 (62%)**. | **Only for goods stores** |

Tier 1 means a code that is high confidence, under 30 days old, and either a creator's code or open to the public (details below).

Headline numbers:
- **122 distinct codes for 93 stores**, from 415 mentions. A distinct code is one code + store pair.
  - 117 codes came from podcast show notes.
  - 5 came from store websites.
  - **None came from YouTube.** youtube.com's robots.txt disallows `/feeds/videos.xml`, so HoldBot skipped YouTube entirely.
- **110 of the 117 podcast codes are creator codes.** They carry the show's or host's name or initials, so using one credits that creator.
- **The supply is thin and concentrated.**
  - Only 28 of 88 top shows print codes; 16% of episodes have one.
  - Five shows supply 51 of the 117 podcast codes.
  - True crime yielded 1 code from 20 feeds, and technology yielded none.
- **It is mostly the wrong stores for Hold's current users.**
  - Only 10 of 93 stores sell electronics or appliances.
  - None of the 52 electronics, appliance and tool stores HoldBot visited appears in any show's notes.
  - Those stores' own sites printed 5 codes in 47 sites.
- **It is fresh.** 92 of 122 codes (75%) appeared in the last 30 days. 10 are over 90 days old (`likely_stale`).
- **Expiry is rare.** 3 of 122 state one.

## How HoldBot worked

- **User-Agent:** `HoldBot/0.1 (research; contact hold.extensionn@gmail.com)`.
- **robots.txt:**
  - Fetched with that User-Agent and obeyed for every host, including `*` and `$` wildcards.
  - A robots.txt that answered 401, 403, 5xx or a challenge page counted as "stay out".
  - Redirects were followed by hand, and each hop was checked against robots.txt.
- **Pacing:** at least 5 s between requests to the same host. About 500 requests in total (311 pages and feeds, plus robots.txt reads).
- **Blocks:** any 403, 429 or captcha/challenge page stopped all further requests to that host. There were no retries and no workarounds.
- **Podcasts:**
  - `itunes.apple.com/search` is disallowed by robots.txt, so it was not used.
  - The 100 feeds came from three allowed sources:
    - Apple's US top-100 chart feed (`rss.marketingtools.apple.com`);
    - the "Top Shows" shelf of Apple's Technology, Business, Comedy and True Crime chart pages;
    - Apple's `/lookup` endpoint. robots.txt disallows only `/*/lookup?`, not `/lookup`.
  - HoldBot read each feed once and kept the latest 20 episodes' notes.
- **Store sites:** 52 sites, made up of 43 electronics, appliance and tool brands and 9 big retailers.
  - HoldBot read the homepage, plus one sale or deals page linked from it.
  - It found a sale page on 39 sites and read 38 of them.
- **YouTube:** not crawled.
  - `https://www.youtube.com/robots.txt` has `Disallow: /feeds/videos.xml` for all user agents.
  - Following the rule, HoldBot also used no channel pages, search pages or API.
  - The allowed route is the official YouTube Data API, with a key the founder would create.
- **No coupon sites, deal forums, Reddit or social networks** were requested.
- **Patterns:**
  - "use / enter / with / w/ (promo) code X";
  - "promo / discount / coupon code X";
  - "code X for N% off / to save / at checkout";
  - sponsor lists written "Brand – url – code: X";
  - Shopify `/discount/CODE` links (one found, on JLab).
- **Store for each code:** the domain in the same sentence, or else on the same line. A vanity path that matches the code (`dutch.com/tucker` for TUCKER) counts as strong evidence.
- **Dedupe:** by code + store.
- **Hand checks:**
  - **Precision:** all 122 codes and their fields were read by hand. That found misattributions in run-on sponsor lists, and the rules were fixed and re-run.
  - **Recall:** every remaining "code", "promo" and "coupon" mention in the 1,631 episodes was read. None of them is a code.

## Totals by source

| Source | Tried | Read | Not read | Pages read | Pages with a code | Mentions | Distinct codes | Stores |
|---|---|---|---|---|---|---|---|---|
| Podcast RSS (`podcast_rss`) | 100 feeds | 88 | 12 (robots rules) | 1,631 episodes | 254 (16%) | 402 | 117 | 88 |
| Store sites (`store_site`) | 52 sites | 47 | 5 (3 robots, 2 blocked) | 85 pages | 8 (9%) | 13 | 5 | 5 |
| YouTube (`youtube_feed`) | – | 0 | robots.txt disallows feeds | 0 | – | 0 | 0 | 0 |
| **All** | | | | | | **415** | **122** | **93** |

Feeds not read:
- Libsyn (7 feeds): its robots.txt answers HoldBot with 403.
- NBC News (2 feeds): robots.txt answered 503.
- Anchor (3 feeds): robots.txt answered with a challenge page.

Store sites not read:
- Lowe's, Micro Center and Ninja: robots.txt disallows the homepage.
- Harbor Freight and Adorama: 403, so HoldBot stopped.
- Crutchfield's homepage was read, but its sale page returned 403, so HoldBot stopped there.

### Podcasts by genre

| Genre | Feeds | Read | Shows with a code | Codes |
|---|---|---|---|---|
| News & politics | 14 | 14 | 8 | 42 |
| Comedy | 15 | 14 | 8 | 33 |
| Business | 13 | 7 | 5 | 14 |
| Technology | 7 | 5 | 0 | 0 |
| True crime | 22 | 20 | 1 | 1 |
| Other (self-help, health, sport, history…) | 29 | 28 | 6 | 28 |

- A code printed by two shows counts once per show here, so this column sums to 118.
- 530 of the 1,631 episodes carry dynamic-ad boilerplate ("ad choices"). Sponsor reads in those shows are inserted into the audio.
- The true-crime feeds mostly carry episode summaries and network boilerplate, with no sponsor text at all.

### Store sites

| Store | Code | Where |
|---|---|---|
| jlab.com | FALL20 | Sale banner linking to `/discount/Fall20`, and the cart |
| skullcandy.com | FALLSALE | Site banner: "save over 50%" |
| monoprice.com | MOVE50 | Printed under certain products on the homepage |
| newegg.com | FTTF7927 | One gift-card listing |
| us.ecoflow.com | WELCOMETOCA | A popup pointing visitors to the Canadian site |

- 35 of the 47 sites show a % or $ discount. Most of those discounts are plain sale prices with no code.
- Govee offers a "$5 off coupon code" for a newsletter sign-up. It is not public, so it was not counted.

## Codes by field

Every field comes from the source text only. `unknown` means the text doesn't say.

### Owner × source

| Owner | Podcast RSS | Store sites | YouTube | All |
|---|---|---|---|---|
| `creator` | 110 | – | – | **110** |
| `store` | – | 5 | – | **5** |
| `unknown` | 7 | – | – | **7** |

- `creator` means a podcast sponsor read where the code matches the show's or host's name or initials (SRS, TIM, SYSK, DOAC). It also covers a creator using the same code for two or more brands (DRENCHED), or notes that say "my code".
- `unknown` covers the 7 podcast codes that are generic brand promos, or the show's own membership sale: SPACE80, EATCESAR10, SUMMER26, FIGHT, LIVESTREAM, and TRUTH ×2.
- The creator's name is recorded on every podcast code.

### Audience

| Audience | Codes |
|---|---|
| `public` (an offer with no restriction stated) | 70 |
| `new_customers_only` (first order, first month, sign-up, "new customers") | 38 |
| `members_only` | 0 |
| `unknown` (no offer stated) | 14 |

### Offer

| Kind | Codes | Typical value |
|---|---|---|
| `percent_off` | 82 | Median 20%. 20% is also the most common value (30 codes). |
| `amount_off` | 13 | $5–$99, plus "up to $200" (sleep tech) and "up to $300" (air purifiers) |
| `other` | 9 | Trials ("60 days free"), credits ("$25 credit"), betting sign-up bonuses |
| `gift_or_bogo` | 2 | "Free title history report"; "buy two months, get the third free" |
| `free_shipping` | 0 as the main offer | It appears as an extra on 10 codes |
| `unknown` | 16 | Code only, such as "Brand – url – code: dan" |

### Scope

| Scope | Codes |
|---|---|
| `sitewide` (says sitewide, entire order, or your first order) | 24 |
| `product` (a named product, plan, subscription or membership) | 34 |
| `category` (select models, a sale collection, a product line) | 3 |
| `min_spend` | 1 (a betting app's $5 deposit) |
| `unknown` | 60 |

Most of the 60 `unknown` codes read only "N% off Brand". That probably means sitewide, but the text doesn't promise it.

### Expiry

- 3 codes state an expiry:
  - two meal-kit codes: "until 09/27/2026" (already past) and "until 10/31/2026";
  - one membership sale: "ends August 31st".
- The other 119 are `none_stated`. A podcast code lives as long as the show keeps reading it.

### Freshness

Age is counted from the date the code last appeared.

| Age | Podcast | Store sites | All |
|---|---|---|---|
| 0–30 days | 87 | 5 | **92** |
| 31–90 days | 20 | 0 | **20** |
| 90+ days (`likely_stale`) | 10 | 0 | **10** |

- Store pages have no publish date. Their 5 codes were live on the page when crawled, so they count as 0 days.
- 67 podcast codes appear in two or more episodes, so a code still being read is a built-in "still live" signal.
- The 20 latest episodes of a feed cover a median of 63 days.

### Confidence

| Confidence | Codes | Rule |
|---|---|---|
| `high` | 99 | Explicit code + a stated offer + the store found in the same sentence (or a vanity path, or the store's own page) |
| `medium` | 22 | Code + store, but no offer stated, or the store found only on the same line or by brand name |
| `low` | 1 | Store found only on the same line or by brand name, and no offer stated |

## Tier 1: what the extension could show first

**Definition:** confidence `high`, last seen 30 days ago or less, and owner `creator` or audience `public`.

**Result: 71 codes at 58 stores, from 21 creators plus 3 store sites.**
- 67 codes are creator codes: 44 public and 23 new-customer only.
- 4 are store or other public codes.
- Offers: 57 percent off (median 20%), 8 amount off, 5 other, 1 gift.
- Scope: 18 sitewide, 18 product, 3 category, 32 unknown.

| Kind of store | Tier 1 stores |
|---|---|
| Goods: home, apparel, gear, electronics | 21 |
| Food, drink, supplements, skin care | 21 |
| Apps, software, memberships, services | 8 |
| Health services, telehealth | 6 |
| Betting and prediction apps | 2 |

- Electronics and appliances in Tier 1: airdoctorpro.com, apolloneuro.com, aquatru.com, eightsleep.com, jlab.com, newegg.com, skullcandy.com.
- The other 51 codes missed Tier 1 for these reasons:
  - 25 were older than 30 days;
  - 17 were not high confidence;
  - 9 failed for a mix of reasons.

### Shopify share of Tier 1 stores

HoldBot made one request per Tier 1 store to `https://<domain>/products.json?limit=1`. That URL answers with product JSON only on Shopify storefronts.

| Result | Stores | Which |
|---|---|---|
| Shopify | **27** | airdoctorpro, apolloneuro, aquatru, blueprint.bryanjohnson, bollandbranch, brooklynbedding, bubsnaturals, calderalab, cocoavia, cometeer, cozyearth, dosedaily.co, dutch, im8health, jlab, justaddbuoy, kachava, laundrysauce, neurogum, oneskin.co, ridge, roka, skullcandy, stopboxusa, takeultra, trees, troomy |
| Not Shopify | **24** | bluechew, brodo, chministries, eightsleep, fiverr, functionhealth, hometitlelock, huel, hungryroot, joiandblokes, mamabearlegalforms, manscaped, mod, monarch, nutrafol, paleovalley, polymarket.us, prizepicks, shipstation, shopmando, sundaysfordogs, takelean, trymiracle, worldwatch.news |
| `unknown` | **7** | defendcellcam and urgentcarekit (robots.txt disallows `/products.json`); joindeleteme (403); dailylook, factormeals, hostinger and newegg (challenge pages) |

- **27 of 58 Tier 1 stores (47%) are confirmed Shopify; 27 of the 51 with an answer (53%).**
- Among the 42 Tier 1 stores that sell goods: 26 Shopify (62%), 12 not, 4 unknown.
- "Not Shopify" means a 404 or no product JSON. Some brands may run a headless Shopify storefront that hides `/products.json`, so 27 is a floor.

## Creators per brand

The number of distinct shows that posted a code for each brand. YouTube channels would add to this; none were read.

| Creators per brand | Brands |
|---|---|
| 1 | 71 |
| 2 | 9 |
| 3 | 7 |
| 4 | 1 |

Top 15 brands by creator count:

| Brand | Kind | Creators | Shows |
|---|---|---|---|
| joindeleteme.com | Service | 4 | Morning Wire, The Bulwark Daily, The Dan Bongino Show, The MeidasTouch Podcast |
| bluechew.com | Telehealth | 3 | Matt and Shane's Secret Podcast, The Joe Rogan Experience, This Past Weekend |
| bollandbranch.com | Goods | 3 | IHIP News, Morning Wire, The Weekly Show |
| factormeals.com | Meal kits | 3 | Founder's Story, Smosh Reads Reddit Stories, The Shawn Ryan Show |
| prizepicks.com | Betting app | 3 | Founder's Story, Matt and Shane's Secret Podcast, This Past Weekend |
| ridge.com | Goods | 3 | The Shawn Ryan Show, The Tim Dillon Show, The Weekly Show |
| stopboxusa.com | Goods | 3 | The MeidasTouch Podcast, The Shawn Ryan Show, The Tucker Carlson Show |
| takeultra.com | Consumables | 3 | The MeidasTouch Podcast, The Shawn Ryan Show, The Tim Dillon Show |
| dosedaily.co | Consumables | 2 | The Dan Bongino Show, The Tucker Carlson Show |
| draftkings.com | Betting app | 2 | The Joe Rogan Experience, The Shawn Ryan Show |
| laundrysauce.com | Goods | 2 | IHIP News, The MeidasTouch Podcast |
| mod.com | Goods | 2 | The Tim Dillon Show, Young and Profiting |
| mudwtr.com | Consumables | 2 | The Shawn Ryan Show, The Tim Dillon Show |
| superpower.com | Health service | 2 | The Shawn Ryan Show, The Tim Dillon Show |
| takelean.com | Consumables | 2 | Morning Wire, The Megyn Kelly Show |

## 20 most common stores

Ranked by how many shows or sites carry a code for the store, then by mentions.

| Store | Kind | Shows/sites | Mentions | Codes |
|---|---|---|---|---|
| joindeleteme.com | Service | 4 | 8 | BONGINO, BULWARK, MEIDAS, WIRE |
| prizepicks.com | Betting app | 3 | 13 | DRENCHED, FOUNDERS, THEO, TPW |
| takeultra.com | Consumables | 3 | 12 | MEIDAS, SRS, TIMDILLON |
| bluechew.com | Telehealth | 3 | 11 | DRENCHED, ROGAN, THEO |
| factormeals.com | Meal kits | 3 | 4 | FOUNDERS50OFF, PITREDDIT50OFF, SRS50OFF |
| ridge.com | Goods | 3 | 4 | SRS, TIMDILLON, TWS |
| bollandbranch.com | Goods | 3 | 3 | IHIP, TWS, WIRE |
| stopboxusa.com | Goods | 3 | 3 | SRS, TRUTH, TUCKER |
| trees.com | Goods | 2 | 12 | SYSK, TWS |
| visible.com | Service | 2 | 12 | HANG, ROGAN |
| takelean.com | Consumables | 2 | 10 | MK, WIRE |
| draftkings.com | Betting app | 2 | 5 | ROGAN, SRS |
| dosedaily.co | Consumables | 2 | 4 | BONGINO, TUCKER |
| mod.com | Goods | 2 | 4 | PROFITING, TIM |
| laundrysauce.com | Goods | 2 | 2 | IHIP, MEIDAS20 |
| mudwtr.com | Consumables | 2 | 2 | SRS, TIMDILLON |
| superpower.com | Health service | 2 | 2 | SRS, TIM |
| apolloneuro.com | Goods | 1 | 20 | GEMELLI |
| chministries.org | Health service | 1 | 20 | RAMSEY |
| mamabearlegalforms.com | Service | 1 | 20 | RAMSEY |

What all 93 stores sell:

| Kind | Stores | Codes |
|---|---|---|
| Food, drink, supplements, skin care | 35 | 42 |
| Goods: home, apparel, gear, electronics | 26 | 36 |
| Apps, software, memberships, other services | 20 | 25 |
| Health services, telehealth, pharmacy | 9 | 12 |
| Betting and prediction apps | 3 | 7 |

The 10 electronics and appliance stores:
- From podcast notes: airdoctorpro.com, aquatru.com, apolloneuro.com, boncharge.com, eightsleep.com.
- From store sites: ecoflow.com, jlab.com, monoprice.com, newegg.com, skullcandy.com.

## Sample of 15 entries

How to read the table:
- All 15 were seen on October 11, 2026.
- "Published" is the date of the episode where the code last appeared. Store pages have no publish date.
- Expiry is `none_stated` unless shown.
- Podcast source links go to the episode page when the feed gives one; otherwise they go to the feed.

| Code | Store | Owner | Audience | Offer | Scope | Expiry | Published (age) | Confidence | Tier 1 | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| SRS | roka.com | creator: The Shawn Ryan Show | public | percent_off 20% | sitewide | – | Sep 17 (24 d) | high | Yes | [feed](https://rss.pdrl.fm/ac69ac/feeds.megaphone.fm/WWO7410387571), "#340 Byron Tau" |
| TIM | neurogum.com | creator: The Tim Dillon Show | new_customers_only | percent_off 20% | sitewide | – | Oct 10 (1 d) | high | Yes | [episode 516](https://audioboom.com/posts/8962835) |
| SYSK | airdoctorpro.com | creator: Something You Should Know | public | amount_off up to $300 | category | – | Oct 6 (5 d) | high | Yes | [feed](https://rss.pdrl.fm/60a606/feeds.megaphone.fm/WWO9761275037) |
| TUCKER | brooklynbedding.com | creator: The Tucker Carlson Show | public | percent_off 30% | sitewide | – | Sep 21 (20 d) | high | Yes | [feed](https://feeds.megaphone.fm/RSV1597324942) |
| MEIDAS | brodo.com | creator: The MeidasTouch Podcast | new_customers_only | percent_off 20% | sitewide | – | Oct 8 (3 d) | high | Yes | [feed](https://rss.amperwave.net/v2/feed/audacynetwork/16aa3c6bf526fae9db63070c73cad09f) |
| STEVEN | eightsleep.com | creator: The Diary Of A CEO | public | amount_off up to $200 | unknown | – | Sep 24 (17 d) | high | Yes | [feed](https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn) |
| GEMELLI | apolloneuro.com | creator: The Dylan Gemelli Podcast | public | amount_off $99 | unknown | – | Oct 10 (1 d) | high | Yes | [episode 171](https://dylangemelli.podbean.com/e/episode-171-my-heart-test-was-perfect-and-then-i-had-a-heart-attack-featuring-daniel-trevor/) |
| THEO | bluechew.com | creator: This Past Weekend | public | gift_or_bogo: buy two months, get the third free | unknown | – | Aug 10 (62 d) | medium | No (age, confidence) | [feed](https://feeds.megaphone.fm/thispastweekend), "#674" |
| BONGINO10 | allfamilypharmacy.com | creator: The Dan Bongino Show | unknown | unknown | unknown | – | Oct 8 (3 d) | medium | No (no offer stated) | [feed](https://feeds.megaphone.fm/WWO3519750118) |
| WEEKLY | bombas.com | creator: The Weekly Show | new_customers_only | percent_off 20% | sitewide | – | Sep 10 (31 d) | high | No (31 days) | [feed](https://feeds.megaphone.fm/BVLLC2163264914) |
| PITREDDIT50OFF | factormeals.com | creator: Smosh Reads Reddit Stories | new_customers_only | percent_off 50% | product | until 09/27/2026 | May 30 (134 d), `likely_stale` | high | No (stale, expired) | [episode](https://audioboom.com/posts/8909681) |
| ROGAN | draftkings.com | creator: The Joe Rogan Experience | new_customers_only | unknown | product | – | Oct 6 (5 d) | medium | No | [feed](https://feeds.megaphone.fm/GLT1412515089), "#2561" |
| FALL20 | jlab.com | store | public | percent_off 20% | category | – | page (0 d) | high | Yes | [jlab.com](https://www.jlab.com/) |
| FALLSALE | skullcandy.com | store | public | percent_off over 50% | unknown | – | page (0 d) | high | Yes | [skullcandy.com](https://www.skullcandy.com/) |
| MOVE50 | monoprice.com | store | unknown | unknown | unknown | – | page (0 d) | medium | No | [monoprice.com](https://www.monoprice.com/) |

## Honest read

**A creator-code index is real, but too small and in the wrong stores to build Hold around now.**

What works:
- **The supply is legitimate and owned.** 110 of 117 podcast codes belong to the creator who posted them, which fits Hold's "the code's owner gets the credit" model.
- **It is fresh and cheap to keep fresh.** Three in four codes appeared in the last 30 days, and one feed request per show per day would track them.
- **Where it applies, Hold can act on it.** 62% of Tier 1 goods stores run Shopify, where Hold can already test codes.

What doesn't:
- **Scale.** 58 Tier 1 stores, short of the 100 bar.
  - Only 28 of 88 top shows print codes, and five shows supply 44% of the codes.
  - True crime and technology print almost nothing.
- **Depth per brand.**
  - 71 of 88 brands are promoted by one creator, and the deepest brand has 4.
  - A shopper at a given store will rarely find a Hold code, and when they do there is usually only one to offer.
- **Store fit.**
  - The codes are for direct-to-consumer brands: supplements, food, bedding, apparel, apps, telehealth and betting apps.
  - Only 7 Tier 1 stores sell electronics or appliances.
  - None of the 52 electronics, appliance and tool stores HoldBot visited appears in any show's notes.
- **Usability for a returning shopper.** About a third of codes are new-customer only, and expiry is almost never stated.

Rough scale. This is an estimate, not a measurement.
- 88 shows gave about 1.3 codes per show over two months.
- The same sponsors repeat across shows.
- So the top 1,000 US shows would likely give around a thousand codes for a few hundred brands.
- That could clear the 100-store bar, but mostly with the same kind of direct-to-consumer brand.

What would change the answer:
1. **YouTube through the official Data API**, once the founder creates a key. youtube.com's robots.txt rules out the public feeds. Tech reviewers are the likeliest source of electronics codes, and none were measured here.
2. **More podcasts,** from a larger chart sample or a directory with an open feed list, to test the 1,000-show estimate.
3. **Network feeds** for the electronics and big-retailer checkouts, which open-web codes don't reach.

## Limits

- **One crawl on one evening.** The feed set follows Apple's chart, so technology is under-sampled (5 feeds read).
- **Robots rules skipped some sources:** 12 feeds and all of YouTube. Libsyn alone hosts many independent shows.
- **Text only.** Codes spoken only in the audio, shown in images, or drawn by scripts on store sites are invisible to HoldBot.
- **Fields are rule-based.** All 122 rows were read by hand, but a wrong store or scope may remain in long run-on sponsor lists. `unknown` is used wherever the text is silent.
- **The Shopify check is one request per store,** and headless Shopify stores read as "not Shopify".
- **No code was tested.** Some may be dead (one stated expiry had passed), or may work only through the show's vanity link.

The crawler scripts, the full per-code table (CSV and JSON), the Shopify results and the request log are kept outside the repo, in the coordinating session's notes folder, under `coupon-supply-holdbot/`.
