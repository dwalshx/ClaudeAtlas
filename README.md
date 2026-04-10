# ClaudeAtlas

The curated discovery index for production-quality Claude ecosystem skills.

**[claudeatlas.com](https://claudeatlas.com)** · **[github.com/dwalshx/ClaudeAtlas](https://github.com/dwalshx/ClaudeAtlas)**

## What is this?

ClaudeAtlas automatically discovers, scores, and indexes SKILL.md files across GitHub, presenting them as a browsable, searchable directory. Every skill is scored on 7 transparent signals and ranked into three tiers: Featured, Solid, and Listed.

## How it works

1. **Discovery** — GitHub Code Search API with size-range partitioning finds SKILL.md files across all public repos
2. **Scoring** — 7-signal quality composite (stars, recency, frontmatter, docs, issues, license, description)
3. **Categorization** — Keyword-based assignment into 8 categories
4. **Publishing** — Astro static site deployed to Cloudflare Pages, rebuilt daily

## Stack

- **Scraper:** Node.js + GitHub API
- **Site:** Astro 5 + Tailwind CSS
- **Hosting:** Cloudflare Pages (free tier)
- **CI/CD:** GitHub Actions (daily cron)
- **Search:** Client-side filtering (zero JS frameworks)
- **Cost:** ~$12/year (domain only)

## Development

```bash
# Install dependencies
npm install

# Run the scraper (requires GitHub PAT)
export GITHUB_TOKEN=ghp_xxx
npm run scrape

# Start dev server
npm run dev

# Build for production
npm run build
```

## Methodology

Quality scoring is fully transparent. See [claudeatlas.com/methodology](https://claudeatlas.com/methodology/) for the complete formula.

## License

Code: MIT. Data: CC-BY-4.0.
