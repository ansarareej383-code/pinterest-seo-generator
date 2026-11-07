// Core engine: fetch + extract an article, analyse it, and generate a
// Pinterest SEO package. Used by app/api/generate/route.js.
//
// Two generation modes:
//  1. AI mode      — if OPENAI_API_KEY is set, call the OpenAI API.
//  2. Heuristic    — deterministic fallback based on the article's own
//                    text/keywords. Works out of the box with no key.

import * as cheerio from "cheerio";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  ("a an the and or but if then else when while at by for with about into through after over between out against during without before under around among " +
    "is are was were be been being have has had do does did will would shall should can could may might must " +
    "i you he she it we they them his her its our their this that these those am an " +
    "of to in on as from not no yes so too very just also more most other some any only own same than once here there all each few both " +
    "recipe recipes minutes mins hour hours day days time way ways make makes made making get gets got need needs use using used " +
    "one two three first second new best top good great like really want know see look take takes step steps " +
    "ingredients ingredient add adds added cook cooking cooked preheat oven degrees serve serves serving portion portions total prep " +
    "www com http https html page pages site website blog post article read")
    .split(/\s+/)
);

function cleanText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function hashTag(phrase) {
  return (
    "#" +
    String(phrase || "")
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("")
  );
}

// Tiny seeded RNG so "New Variation" is stable per seed but different
// wording from variation to variation.
function rng(seed) {
  let t = (seed * 2654435761) >>> 0 || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr, offset = 0) {
  return arr[Math.abs(Math.floor(rand() * arr.length) + offset) % arr.length];
}

/* ------------------------------------------------------------------ */
/* Fetch + extract                                                     */
/* ------------------------------------------------------------------ */

export class ArticleReadError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // "blocked" | "fetch" | "empty" | "invalid"
  }
}

export async function fetchArticle(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
  } catch {
    throw new ArticleReadError(
      "That doesn't look like a valid URL. Please paste a full article link starting with https://",
      "invalid"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  let res;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
  } catch {
    throw new ArticleReadError(
      "Couldn't read that page — the site didn't respond. Please check the link and try again.",
      "fetch"
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
    throw new ArticleReadError(
      "Couldn't read that page — this publisher blocks automated reading or puts it behind a paywall, so no content was generated from it. Try a different article URL.",
      "blocked"
    );
  }
  if (!res.ok) {
    throw new ArticleReadError(
      `Couldn't read that page — the site returned an error (HTTP ${res.status}). Please check the link and try again.`,
      "fetch"
    );
  }

  const type = res.headers.get("content-type") || "";
  if (type && !/text\/html|application\/xhtml|text\/plain/.test(type)) {
    throw new ArticleReadError(
      "That link doesn't point to a readable article page. Please paste a blog article URL.",
      "empty"
    );
  }

  const html = await res.text();
  return extractArticle(html, url.toString());
}

export function extractArticle(html, sourceUrl) {
  const $ = cheerio.load(html);

  $("script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, input, select, textarea").remove();
  $("[class*='ad-'], [class*='advert'], [id*='cookie'], [class*='popup'], [class*='newsletter'], [class*='sidebar']").remove();

  const meta = (sel) => cleanText($(sel).attr("content") || "");
  const rawTitle =
    meta('meta[property="og:title"]') ||
    meta('meta[name="twitter:title"]') ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text());
  // Strip common site-name suffixes: "Title | Site", "Title - Site"
  const title = cleanText(rawTitle.split(/\s+[|\-–—]\s+/)[0]) || rawTitle;
  const description =
    meta('meta[property="og:description"]') || meta('meta[name="description"]') || "";

  const scope = $("article").length ? $("article") : $("main").length ? $("main") : $("body");

  const headings = [];
  // Headings only from inside the article scope — global page headings
  // are usually site sections, promos and video captions, not subtopics.
  scope.find("h1, h2, h3").each((_, el) => {
    const t = cleanText($(el).text());
    if (t && t.length >= 3 && t.length <= 120 && !headings.includes(t)) headings.push(t);
  });

  const paragraphs = [];
  scope.find("p").each((_, el) => {
    const t = cleanText($(el).text());
    // Only the first ~30 real paragraphs: later page text is usually
    // reviews, comments and recommendations, which pollute keyword stats.
    if (t.length >= 40 && paragraphs.length < 30) paragraphs.push(t);
  });
  const bodyText = cleanText(paragraphs.join(" ")).slice(0, 16000);

  if (!title || bodyText.length < 200) {
    throw new ArticleReadError(
      "Couldn't read that page — no article text was found on it. It may be blocked, a paywall, or not an article page, so no content was generated.",
      "empty"
    );
  }

  return { title, description, headings: headings.slice(0, 14), bodyText, sourceUrl };
}

/* ------------------------------------------------------------------ */
/* Keyword analysis                                                    */
/* ------------------------------------------------------------------ */

function tokenize(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

// Boilerplate / site-chrome words that are never article keywords.
const BLOCKED_TOKENS = new Set(
  ("subscribe subscription premium newsletter signup login log sign account membership " +
    "copyright privacy terms cookies cookie advertisement sponsored comments comment rating ratings review reviews " +
    "facebook twitter instagram pinterest youtube tiktok share shares whatsapp email print")
    .split(/\s+/)
);

function ngramCounts(tokens, n, weight, map) {
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    const words = gram.split(" ");
    if (words.some((w) => STOPWORDS.has(w) || BLOCKED_TOKENS.has(w))) continue;
    map.set(gram, (map.get(gram) || 0) + weight);
  }
}

export function analyseArticle(article) {
  const scores = new Map();
  const addWeighted = (text, weight) => {
    const tokens = tokenize(text);
    ngramCounts(tokens, 1, weight, scores);
    ngramCounts(tokens, 2, weight * 1.6, scores);
    ngramCounts(tokens, 3, weight * 2.1, scores);
  };

  addWeighted(article.title, 5);
  addWeighted(article.description, 3);
  (article.headings || []).forEach((h) => addWeighted(h, 2.5));
  addWeighted(article.bodyText, 1);

  const ranked = [...scores.entries()]
    // 3-word phrases need a higher bar: a single body occurrence is
    // usually page chrome or a caption, not a real topic phrase.
    .filter(([phrase, score]) => phrase.length >= 3 && score >= (phrase.split(" ").length === 3 ? 4 : 2.2))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([phrase]) => phrase);

  const phrases = (minWords, maxWords) =>
    ranked.filter((p) => {
      const n = p.split(" ").length;
      return n >= minWords && n <= maxWords;
    });

  // The article title is the strongest topic signal there is: derive the
  // topic from it first (longest sensible title phrase wins), and only
  // fall back to body-frequency phrases when the title gives nothing.
  const titleTokens = tokenize(article.title);
  const titlePhrases = [];
  for (let n = Math.min(3, titleTokens.length); n >= 1; n--) {
    for (let i = 0; i + n <= titleTokens.length; i++) {
      titlePhrases.push(titleTokens.slice(i, i + n).join(" "));
    }
  }
  const topicPhrase =
    titlePhrases.find((p) => p.split(" ").length >= 2) ||
    titlePhrases[0] ||
    phrases(2, 3)[0] ||
    phrases(1, 1)[0] ||
    "this topic";

  const primary = [];
  const pushPrimary = (p) => {
    if (!p || primary.length >= 5) return;
    if (primary.some((x) => x.includes(p) || p.includes(x))) return;
    primary.push(p);
  };
  pushPrimary(topicPhrase);
  titlePhrases.forEach(pushPrimary);
  [...phrases(2, 3), ...phrases(1, 1)].forEach(pushPrimary);
  const primaryTrim = primary.slice(0, 5);

  const secondary = [];
  for (const p of ranked) {
    if (secondary.length >= 7) break;
    if (primaryTrim.includes(p)) continue;
    if (primaryTrim.some((x) => x.includes(p) || p.includes(x))) continue;
    if (secondary.some((x) => x.includes(p) || p.includes(x))) continue;
    secondary.push(p);
  }

  // Long-tail: real extracted 3-word phrases + grounded expansions.
  const longTailSet = new Set(phrases(3, 3).slice(0, 5));
  const seed = primaryTrim[0] || topicPhrase;
  [
    `how to make ${seed}`,
    `best ${seed} ideas`,
    `easy ${seed} for beginners`,
    `${seed} step by step`,
    `${topicPhrase} tips and tricks`,
  ].forEach((x) => {
    if (longTailSet.size < 8) longTailSet.add(cleanText(x));
  });
  const longTail = [...longTailSet].slice(0, 8);

  // Trending: Pinterest-style search expansions. These are ESTIMATES —
  // the UI labels them as such, never as verified search volume.
  const month = new Date().getMonth();
  const season =
    month >= 2 && month <= 4 ? "spring" : month >= 5 && month <= 7 ? "summer" : month >= 8 && month <= 10 ? "fall" : "winter";
  const year = new Date().getFullYear();
  const trendingSet = new Set();
  [
    `${topicPhrase} ideas`,
    `${season} ${topicPhrase}`,
    `${topicPhrase} ${year}`,
    `easy ${seed}`,
    `${seed} aesthetic`,
    `viral ${seed}`,
    `${topicPhrase} inspiration`,
  ].forEach((x) => trendingSet.add(cleanText(x)));
  const trending = [...trendingSet].slice(0, 7);

  const intent = /recipe|ingredient|bake|cook|meal|dinner|lunch|breakfast|dessert|cake/.test(
    (article.title + " " + article.bodyText.slice(0, 2000)).toLowerCase()
  )
    ? "recipe / how-to"
    : /how to|guide|tutorial|step|diy|tips/.test((article.title + " " + article.bodyText.slice(0, 2000)).toLowerCase())
      ? "how-to / tutorial"
      : /ideas|inspiration|decor|outfit|style|design/.test((article.title + " " + article.bodyText.slice(0, 2000)).toLowerCase())
        ? "ideas / inspiration"
        : "informational";

  const subtopics = (article.headings || [])
    .filter((h) => h.toLowerCase() !== article.title.toLowerCase())
    .slice(0, 6);

  return {
    topic: topicPhrase,
    subtopics,
    intent,
    keywords: { primary: primaryTrim, secondary, longTail, trending },
  };
}

/* ------------------------------------------------------------------ */
/* Pinterest research sources                                          */
/* ------------------------------------------------------------------ */

export function researchSources(analysis) {
  const terms = [analysis.topic, ...(analysis.keywords.primary || []).slice(0, 3)];
  const seen = new Set();
  const sources = [];
  for (const term of terms) {
    const slug = slugify(term);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    sources.push({
      label: `Pinterest Ideas: ${titleCase(term)}`,
      url: `https://www.pinterest.com/ideas/${slug}/`,
    });
    sources.push({
      label: `Pinterest Search: ${titleCase(term)}`,
      url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}`,
    });
  }
  return sources.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Heuristic generation                                                */
/* ------------------------------------------------------------------ */

function enforcePinDescription(text, hashtags) {
  let out = cleanText(text);
  const tags = (hashtags || []).filter(Boolean);
  // Keep appending tags only while safely under the 500-char limit.
  for (const tag of tags) {
    if ((out + " " + tag).length < 495) out += " " + tag;
    else break;
  }
  if (out.length >= 500) out = out.slice(0, 496).replace(/\s+\S*$/, "") + "…";
  return out;
}

export function heuristicGenerate(article, analysis, variation = 0) {
  const rand = rng(variation + 1);
  const { primary, secondary, longTail } = analysis.keywords;
  const topic = titleCase(analysis.topic);
  const p1 = titleCase(primary[0] || analysis.topic);
  const p2 = titleCase(primary[1] || secondary[0] || analysis.topic);
  // Prefer a secondary phrase that actually relates to the topic; raw
  // frequency lists can contain in-article promo text that reads oddly
  // when dropped into a sentence.
  const topicWords = new Set(analysis.topic.split(" "));
  const s1 =
    secondary.find((p) => p.split(" ").some((w) => topicWords.has(w))) ||
    primary[2] ||
    primary[1] ||
    analysis.topic;
  const lt1 = longTail[0] || `how to make ${analysis.topic}`;
  const isRecipe = analysis.intent.startsWith("recipe");

  const boardNames = [
    `${topic} Ideas | ${p2} & Inspiration`,
    `${topic}: Best Ideas, Tips & Inspiration`,
    `${p1} Board — Ideas You'll Love to Save`,
    `All Things ${topic} | ${titleCase(s1)} Ideas`,
  ];
  const boardName = pick(rand, boardNames, variation);

  // Rotate the board description deterministically per variation so a
  // "New Variation" click always changes the wording.
  const boardDescriptions = [
    `Discover the best ${analysis.topic} ideas, plus ${s1} tips and ${lt1} guides. This board collects ${analysis.topic} inspiration, step-by-step ideas and reader favourites — save the pins you love and come back whenever you need a fresh ${analysis.topic} idea.`,
    `Your go-to board for ${analysis.topic}: find ${p1.toLowerCase()} ideas, ${s1} inspiration and practical ${analysis.topic} tips in one place. Every pin leads to a full guide, so you can go from saving to doing in minutes.`,
    `Explore ${analysis.topic} ideas that actually work — from ${lt1} to ${s1} favourites. Follow this board for fresh ${analysis.topic} inspiration, seasonal updates and the most-saved ideas on Pinterest.`,
  ];
  const boardDescription = boardDescriptions[variation % boardDescriptions.length];

  const pinTitles = [
    isRecipe
      ? `This ${topic} Is the One Everyone Keeps Saving — Here's Why`
      : `The ${topic} Guide Everyone Wishes They'd Found Sooner`,
    `${topic}: ${variation % 2 ? "The Simple Trick That Changes Everything" : "Easy Ideas That Actually Work"}`,
    `Stop Scrolling — This ${topic} Idea Is Worth Saving`,
    isRecipe
      ? `${topic} That Tastes Like You Spent All Day on It (You Didn't)`
      : `How to Nail ${topic} Without Overthinking It`,
  ];
  // Rotate the pin title deterministically per variation as well.
  let pinTitle = pinTitles[variation % pinTitles.length];
  // Hard rule: never copy the original article title word-for-word.
  if (pinTitle.trim().toLowerCase() === article.title.trim().toLowerCase()) {
    pinTitle = `Save This: ${pinTitle}`;
  }

  const ctas = isRecipe
    ? ["Tap to get the full recipe!", "Click through for the full recipe and tips!", "Save this pin and tap for the step-by-step recipe!"]
    : ["Tap to read the full guide!", "Click through for the full step-by-step guide!", "Save this pin and tap to see how it's done!"];
  const cta = pick(rand, ctas, variation);

  const openers = [
    `Looking for ${lt1}? This ${analysis.topic} guide breaks it down step by step, with ${s1} tips you'll actually use.`,
    `Save this ${analysis.topic} idea for later! Inside you'll find ${lt1} explained simply, plus ${s1} ideas to try next.`,
    `This ${analysis.topic} pin is packed with practical ideas — from ${s1} basics to the details that make it work every time.`,
  ];
  const opener = pick(rand, openers, variation);
  const tags = [analysis.topic, primary[1] || s1, isRecipe ? "easy recipes" : `${analysis.topic} ideas`]
    .filter(Boolean)
    .map(hashTag)
    .filter((t, i, a) => t.length > 2 && a.indexOf(t) === i)
    .slice(0, 4);

  const pinDescription = enforcePinDescription(`${opener} ${cta}`, tags);

  return { boardName, boardDescription, pinTitle, pinDescription };
}

/* ------------------------------------------------------------------ */
/* OpenAI generation (optional)                                        */
/* ------------------------------------------------------------------ */

async function openAiGenerate(article, analysis, variation) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt = {
    articleTitle: article.title,
    articleExcerpt: article.bodyText.slice(0, 3500),
    headings: article.headings,
    topic: analysis.topic,
    searchIntent: analysis.intent,
    extractedKeywords: analysis.keywords,
    variation,
    rules: [
      "Output English only.",
      "pinTitle must NOT copy the article title word-for-word; make it new, catchy and curiosity-driven.",
      "pinDescription must be UNDER 480 characters, human and readable (not keyword-stuffed), end with a call to action followed by 3-4 relevant hashtags.",
      "boardName and boardDescription must naturally include the primary/secondary keywords.",
      "Return JSON only with keys: boardName, boardDescription, pinTitle, pinDescription.",
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a Pinterest SEO expert. You write board names, board descriptions, pin titles and pin descriptions that rank in Pinterest search and earn clicks. You never invent search-volume numbers.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  if (!parsed.boardName || !parsed.boardDescription || !parsed.pinTitle || !parsed.pinDescription) {
    throw new Error("OpenAI returned incomplete JSON");
  }
  if (parsed.pinTitle.trim().toLowerCase() === article.title.trim().toLowerCase()) {
    parsed.pinTitle = `Save This: ${parsed.pinTitle}`;
  }
  if (parsed.pinDescription.length >= 500) {
    parsed.pinDescription = parsed.pinDescription.slice(0, 496).replace(/\s+\S*$/, "") + "…";
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Top-level                                                           */
/* ------------------------------------------------------------------ */

export async function generatePackage(rawUrl, variation = 0) {
  const article = await fetchArticle(rawUrl);
  const analysis = analyseArticle(article);

  let results;
  let mode = "heuristic";
  if (process.env.OPENAI_API_KEY) {
    try {
      results = await openAiGenerate(article, analysis, variation);
      mode = "openai";
    } catch {
      results = heuristicGenerate(article, analysis, variation);
      mode = "heuristic-fallback";
    }
  } else {
    results = heuristicGenerate(article, analysis, variation);
  }

  // Final safety net on the two hard rules.
  if (results.pinDescription.length >= 500) {
    results.pinDescription = results.pinDescription.slice(0, 496).replace(/\s+\S*$/, "") + "…";
  }
  if (results.pinTitle.trim().toLowerCase() === article.title.trim().toLowerCase()) {
    results.pinTitle = `Save This: ${results.pinTitle}`;
  }

  return {
    url: article.sourceUrl,
    originalTitle: article.title,
    topic: analysis.topic,
    subtopics: analysis.subtopics,
    searchIntent: analysis.intent,
    mode,
    variation,
    results,
    keywords: analysis.keywords,
    keywordNote:
      "Keywords are AI-generated estimates based on the article and Pinterest-style search patterns — not verified Pinterest search-volume data.",
    sources: researchSources(analysis),
    generatedAt: new Date().toISOString(),
  };
}
