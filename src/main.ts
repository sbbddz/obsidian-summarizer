import {App, Modal, Notice, Plugin, TFile, Editor, Menu, MarkdownView, MarkdownFileInfo, htmlToMarkdown, requestUrl, RequestUrlParam, RequestUrlResponse} from 'obsidian';
import {SummarizerSettings, DEFAULT_SETTINGS, SummarizerSettingTab} from "./settings";
import {fetchTranscript} from 'youtube-transcript';
import {extractText, getDocumentProxy} from 'unpdf';

async function requestUrlLogged(params: RequestUrlParam): Promise<RequestUrlResponse> {
	try {
		return await requestUrl(params);
	} catch (err: unknown) {
		const error = err as { status?: number; text?: string; response?: { status?: number; text?: string } };
		const status = error.status ?? error.response?.status;
		const body = error.text ?? error.response?.text;
		if (body) {
			console.warn(`[HTTP ${status ?? 'error'}] ${params.method ?? 'GET'} ${params.url}\nResponse body:`, body);
		} else {
			console.warn(`[HTTP ${status ?? 'error'}] ${params.method ?? 'GET'} ${params.url}`, err);
		}
		throw err;
	}
}

const SYSTEM_PROMPT = `You are a helpful assistant that summarizes {contentType}.

STRICT OUTPUT FORMAT - You MUST follow this exact structure:
- Start directly with the first topic heading
- Each section MUST have a heading starting with "## " followed by the topic name
- Always use ONLY TWO "## " as heading size. Never more.
- Follow each heading with ONE paragraph explaining that topic
- Aim for minimum of 2 sections up to 8 sections depending on how info-dense the content is
- Sections should not exceed 3-4 lines
- No introductions, conclusions, or filler text
- No bullet points, lists, or nested headings

Example:
## Topic One
Explanation of the first main point.

## Topic Two
Explanation of the second main point.`;

const KEY_IDEAS_PROMPT = `From the following {contentType}, extract a minimum of 5 concise bullet points representing the key ideas or main takeaways.
Do not include introductory text.`;

const EXTEND_PROMPT = `You are an assistant that expands text passages. Given the selected paragraph from a summary and the original {contentType}, expand the paragraph with more relevant details from the original content. Keep the same writing style, tone, and level of detail as the original paragraph. Only output the expanded paragraph - no introductions or explanations.`;

type ContentType = 'web' | 'youtube' | 'pdf';

function getContentTypeDescription(type: ContentType): string {
	switch (type) {
		case 'youtube':
			return 'YouTube video content from transcripts. Write the summary in the SAME LANGUAGE as the transcript content.';
		case 'pdf':
			return 'PDF documents';
		case 'web':
			return 'web content';
	}
}

function getContentTypeLabel(type: ContentType): string {
	switch (type) {
		case 'youtube':
			return 'video transcript';
		case 'pdf':
			return 'PDF document';
		case 'web':
			return 'web page';
	}
}

interface OpenRouterResponse {
	choices: Array<{ message: { content: string } }>;
}

class URLInputModal extends Modal {
	constructor(app: App, private onSubmit: (url: string) => void) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: 'Summarize URL'});
		
		const inputEl = contentEl.createEl('input', {type: 'text', placeholder: 'Paste URL here...', cls: 'summarizer-modal-input'});
		const buttonContainer = contentEl.createEl('div', {cls: 'summarizer-modal-buttons'});
		
		const submitBtn = buttonContainer.createEl('button', {text: 'Summarize'});
		submitBtn.addEventListener('click', () => {
			const url = inputEl.value.trim();
			if (url) {
				this.close();
				this.onSubmit(url);
			} else {
				new Notice('Please enter a URL');
			}
		});

		buttonContainer.createEl('button', {text: 'Cancel'}).addEventListener('click', () => this.close());
		inputEl.focus();
		inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submitBtn.click();
			}
		});
	}

	onClose() { this.contentEl.empty(); }
}

class ExtendParagraphModal extends Modal {
	private showOriginal = false;
	private originalText: string;
	private extendedText: string;
	private onAccept: (text: string) => void;

	constructor(
		app: App,
		originalText: string,
		extendedText: string,
		onAccept: (text: string) => void
	) {
		super(app);
		this.originalText = originalText;
		this.extendedText = extendedText;
		this.onAccept = onAccept;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Extend paragraph'});

		const toggleEl = contentEl.createEl('a', {
			text: 'Show original',
			href: '#',
			cls: 'extend-modal-toggle'
		});
		toggleEl.addEventListener('click', (e) => {
			e.preventDefault();
			this.showOriginal = !this.showOriginal;
			toggleEl.textContent = this.showOriginal ? 'Show extended' : 'Show original';
			contentEl.querySelector('.extend-modal-content')?.remove();
			this.displayContent();
		});

		this.displayContent();

		const buttonContainer = contentEl.createEl('div', {cls: 'summarizer-modal-buttons'});
		const acceptBtn = buttonContainer.createEl('button', {text: 'Accept'});
		acceptBtn.addEventListener('click', () => {
			this.close();
			this.onAccept(this.extendedText);
		});
		buttonContainer.createEl('button', {text: 'Cancel'}).addEventListener('click', () => this.close());
	}

	private displayContent() {
		const content = this.showOriginal ? this.originalText : this.extendedText;
		this.contentEl.createEl('div', {
			cls: 'extend-modal-content',
			text: content
		});
	}

	onClose() { this.contentEl.empty(); }
}

function extractYouTubeVideoId(url: string): string | null {
	const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
	return match?.[1] ?? null;
}

function extractPdfTitle(url: string): string {
	try {
		const filename = new URL(url).pathname.split('/').pop() || '';
		return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ') || 'Untitled PDF';
	} catch { return 'Untitled PDF'; }
}

async function detectContentType(url: string): Promise<ContentType> {
	if (extractYouTubeVideoId(url)) return 'youtube';
	try {
		const response = await requestUrlLogged({url, method: 'HEAD'});
		const contentType = response.headers?.['content-type'] || '';
		if (contentType.includes('application/pdf')) return 'pdf';
	} catch { /* fall through to 'web' */ }
	return 'web';
}

function createObsidianFetch(): typeof fetch {
	return async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const response = await requestUrlLogged({
			url,
			method: (init?.method as 'GET' | 'POST') || 'GET',
			headers: init?.headers as Record<string, string>,
			body: init?.body as string,
		});
		return {
			ok: response.status >= 200 && response.status < 300,
			status: response.status,
			statusText: '',
			headers: new Headers(),
			json: async () => response.json as unknown,
			text: async () => response.text,
			arrayBuffer: async () => response.arrayBuffer,
			blob: async () => new Blob([response.arrayBuffer]),
			clone: function() { return this; },
			body: null, bodyUsed: false, redirected: false,
			type: 'basic' as ResponseType, url,
			formData: async () => { throw new Error('Not implemented'); },
			bytes: async () => { throw new Error('Not implemented'); }
		} as Response;
	};
}

export default class SummarizerPlugin extends Plugin {
	settings: SummarizerSettings;
	private contentCache: Map<string, {title: string; content: string}> = new Map();

	async onload() {
		await this.loadSettings();
		
		this.addCommand({
			id: 'summarize-url',
			name: 'Summarize URL',
			callback: () => new URLInputModal(this.app, u => void this.summarize(u)).open()
		});

		this.registerEvent(this.app.workspace.on('editor-menu', this.createExtendContextMenuHandler()));

		this.addSettingTab(new SummarizerSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SummarizerSettings> | null ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async summarize(url: string): Promise<void> {
		if (!this.settings.apiKey) {
			new Notice('Configure your API key in plugin settings');
			return;
		}

		const type = await detectContentType(url);
		try {
			const {title, content} = await this.fetchContent(url, type);

			new Notice('Generating summary and key ideas...');
			const [summary, keyIdeas] = await Promise.all([
				this.callOpenAICompatible(title, content, type, 'summary'),
				this.callOpenAICompatible(title, content, type, 'keyIdeas'),
			]);

			new Notice('Saving summary...');
			await this.saveSummary(url, title, summary.trim(), keyIdeas.trim());
			new Notice('Summary saved successfully!');
		} catch (error: unknown) {
			console.error(`${type} summarization error:`, error);
			new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private async fetchContent(url: string, type: ContentType): Promise<{title: string; content: string}> {
		switch (type) {
			case 'web': {
				new Notice('Fetching content...');
				const response = await requestUrlLogged({url, method: 'GET'});
				const text = response.text || '';
				const content = htmlToMarkdown(text) || '';
				const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
				return {title: titleMatch?.[1]?.trim() || 'Untitled', content};
			}
			
			case 'youtube': {
				const videoId = extractYouTubeVideoId(url);
				if (!videoId) throw new Error('Invalid YouTube URL');

				new Notice('Fetching video info...');
				const oembed = (await requestUrlLogged({url: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, method: 'GET'})).json as {title: string};
				
				new Notice('Fetching transcript...');
				const transcript = await fetchTranscript(videoId, {fetch: createObsidianFetch()});
				return {title: oembed.title || 'Untitled', content: transcript.map(t => t.text).join(' ')};
			}
			
			case 'pdf': {
				new Notice('Fetching PDF...');
				const response = await requestUrlLogged({url, method: 'GET'});
				const pdf = await getDocumentProxy(new Uint8Array(response.arrayBuffer));
				
				new Notice('Extracting text from PDF...');
				const { text } = await extractText(pdf, { mergePages: true });
				
				if (!text?.trim()) throw new Error('PDF appears to be empty or contains only images');
				return {title: extractPdfTitle(url), content: text};
			}
		}
	}

	private async callOpenAICompatible(
		title: string,
		content: string,
		type: ContentType,
		mode: 'summary' | 'keyIdeas'
	): Promise<string> {
		const truncatedContent = content.length > 80000
			? content.substring(0, 80000) + '\n\n[Content truncated due to length]'
			: content;

		const contentTypeLabel = getContentTypeLabel(type);
		const contentTypeDesc = getContentTypeDescription(type);

		let systemPrompt: string;
		if (mode === 'summary') {
			systemPrompt = SYSTEM_PROMPT.replace('{contentType}', contentTypeDesc);
		} else {
			systemPrompt = KEY_IDEAS_PROMPT.replace('{contentType}', contentTypeDesc);
		}

		const userPrompt = mode === 'summary'
			? `Summarize in a comprehensive way the following ${contentTypeLabel}:\n\nTitle: ${title}\n\nContent:\n${truncatedContent}`
			: `Title: ${title}\n\nContent:\n${truncatedContent}`;

		const response = await requestUrlLogged({
			url: `${this.settings.apiBaseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: this.settings.model,
				messages: [
					{role: 'system', content: systemPrompt},
					{role: 'user', content: userPrompt}
				]
			})
		});

		const data = response.json as OpenRouterResponse;
		if (!data.choices?.[0]?.message?.content) throw new Error('Invalid response from API');

		return data.choices[0].message.content;
	}

	private async extendParagraph(
		selectedText: string,
		sourceUrl: string,
		sourceType: ContentType
	): Promise<string> {
		let cached = this.contentCache.get(sourceUrl);
		if (!cached || !cached.content) {
			new Notice('Fetching source content...');
			try {
				const result = await this.fetchContent(sourceUrl, sourceType);
				if (!result || !result.content) throw new Error('Failed to fetch source content');
				cached = result;
				this.contentCache.set(sourceUrl, cached);
			} catch (err) {
				throw new Error(`Failed to fetch source: ${err instanceof Error ? err.message : 'Unknown error'}`);
			}
		}

		if (!cached.content?.trim()) throw new Error('Source content is empty');

		new Notice('Extending paragraph...');
		const contentTypeDesc = getContentTypeDescription(sourceType);
		const systemPrompt = EXTEND_PROMPT.replace('{contentType}', contentTypeDesc);
		const truncatedContent = cached.content.length > 80000
			? cached.content.substring(0, 80000) + '\n\n[Content truncated due to length]'
			: cached.content;

		const userPrompt = `Selected paragraph to expand:\n${selectedText}\n\nOriginal ${getContentTypeLabel(sourceType)} content:\n${truncatedContent}`;

		const response = await requestUrlLogged({
			url: `${this.settings.apiBaseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: this.settings.model,
				messages: [
					{role: 'system', content: systemPrompt},
					{role: 'user', content: userPrompt}
				]
			})
		});

		const data = response.json as OpenRouterResponse;
		if (!data.choices?.[0]?.message?.content) throw new Error('Invalid response from API');

		return data.choices[0].message.content;
	}

	private createExtendContextMenuHandler = () => {
		return (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			const selectedText = editor.getSelection();
			if (!selectedText.trim()) return;

			const file = info.file;
			if (!file) return;

			const cache = this.app.metadataCache.getFileCache(file);
			const sourceUrl = cache?.frontmatter?.source as string | undefined;
			if (!sourceUrl) return;

			menu.addItem((item) => {
				item.setTitle('Extend with original content')
					.setIcon('sparkles')
					.onClick(async () => {
						try {
							const sourceType = this.getSourceType(sourceUrl);
							const extendedText = await this.extendParagraph(selectedText, sourceUrl, sourceType);
							new ExtendParagraphModal(this.app, selectedText, extendedText, (accepted) => {
								editor.replaceSelection(accepted);
							}).open();
						} catch (error) {
							new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
						}
					});
			});
		};
	};

	private async saveSummary(
		url: string,
		title: string,
		summary: string,
		keyIdeas: string
	): Promise<void> {
		const folder = this.settings.folder;
		if (!await this.app.vault.adapter.exists(folder)) await this.app.vault.createFolder(folder);

		const safeTitle = title.replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, '-').substring(0, 100);
		const filepath = `${folder}/${safeTitle}.md`;

		let fileContent: string;
		if (this.settings.includeMetadataHeader) {
			const created = new Date().toISOString().split('T')[0];
			const sourceType = this.getSourceType(url);

			fileContent = `---
created: ${created}
source: ${url}
source-type: ${sourceType}
tags:
  - summaries
---
${summary}

## Key Ideas
${keyIdeas}`;
		} else {
			fileContent = `${summary}

## Key Ideas
${keyIdeas}`;
		}

		const existingFile = this.app.vault.getAbstractFileByPath(filepath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, fileContent);
		} else {
			await this.app.vault.create(filepath, fileContent);
		}
	}

	private getSourceType(url: string): ContentType {
		if (/(?:youtube\.com|youtu\.be)/.test(url)) return 'youtube';
		if (url.toLowerCase().endsWith('.pdf')) return 'pdf';
		return 'web';
	}

}
