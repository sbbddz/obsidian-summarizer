# Summarizer

An [Obsidian](https://obsidian.md) plugin that uses AI to summarize web pages, YouTube videos, and PDFs, then saves the results as structured notes in your vault.

## Features

- **Summarize URLs** — paste any URL and get a structured markdown summary
- **Extract key ideas** — each summary includes a bulleted list of main takeaways
- **Extend paragraphs** — right-click any paragraph in a summary to expand it with more detail from the original source
- **Multi-format support** — works with web pages, YouTube videos (via transcripts), and PDFs
- **Configurable AI backend** — use any OpenAI-compatible API (OpenRouter by default)
- **Metadata frontmatter** — summaries include YAML frontmatter with source URL, date, and tags

## Installation

### From the community plugin list

Search for "Summarizer" in **Settings → Community plugins → Browse**.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/sbbddz/obsidian-summarizer/releases)
2. Copy them into `<vault>/.obsidian/plugins/summarizer/`
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**

## Setup

1. Go to **Settings → Summarizer**
2. Enter your **API key** (get one from [OpenRouter](https://openrouter.ai) or your preferred provider)
3. Optionally change the API base URL and model
4. Choose an output folder (defaults to `Summaries`)

## Usage

### Summarize a URL

Open the command palette (`Cmd/Ctrl+P`) and run **Summarize URL**. Paste any link — the plugin detects the content type automatically and generates a summary.

### Extend a paragraph

In any note with a `source` frontmatter field (automatically set by the plugin), select a paragraph, right-click, and choose **Extend with original content**. The plugin fetches the original source and expands the selection with additional context.

## Supported content types

| Type | Source |
|------|--------|
| Web pages | HTML content extracted and converted to markdown |
| YouTube | Video transcripts fetched automatically |
| PDF | Text extracted from PDF documents |

## Development

```bash
git clone https://github.com/sbbddz/obsidian-summarizer.git
cd obsidian-summarizer
npm install
npm run dev    # watch mode
npm run build  # production build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/summarizer/` folder to test.

## License

MIT
