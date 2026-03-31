import {App, Modal, Notice, Plugin, TFile, htmlToMarkdown, requestUrl} from 'obsidian';
import {SummarizerSettings, DEFAULT_SETTINGS, SummarizerSettingTab} from "./settings";
import {fetchTranscript} from 'youtube-transcript';
import {extractText, getDocumentProxy} from 'unpdf';

const SYSTEM_PROMPTS = {
	web: `You are a helpful assistant that summarizes web content.

STRICT OUTPUT FORMAT - You MUST follow this exact structure:
- Start directly with the first topic heading
- Each section must have a heading starting with "# " followed by the topic name
- Follow each heading with ONE paragraph explaining that topic
- Use 2-3 sections maximum
- Use 2 sections minimum
- No introductions, conclusions, or filler text
- No bullet points, lists, or nested headings

Example:
# Topic One
Explanation of the first main point with key details and insights.

# Topic Two
Explanation of the second main point with relevant information.

# Topic Three
Explanation of the third main point if applicable.`,

	youtube: `You are a helpful assistant that summarizes YouTube video content from transcripts.

IMPORTANT: Write the summary in the SAME LANGUAGE as the transcript content.

STRICT OUTPUT FORMAT - You MUST follow this exact structure:
- Start directly with the first topic heading
- Each section must have a heading starting with "# " followed by the topic name
- Follow each heading with ONE paragraph explaining that topic
- Use 2-4 sections maximum
- Use 2 sections minimum
- No introductions, conclusions, or filler text
- No bullet points, lists, or nested headings

Example:
# Topic One
Explanation of the first main topic discussed in the video.

# Topic Two
Explanation of the second main topic with key insights from the video.

# Topic Three
Explanation of additional important points or recommendations mentioned.`,

	pdf: `You are a helpful assistant that summarizes PDF documents.

STRICT OUTPUT FORMAT - You MUST follow this exact structure:
- Start directly with the first topic heading
- Each section must have a heading starting with "# " followed by the topic name
- Follow each heading with ONE paragraph explaining that topic
- Use 2-4 sections maximum
- Use 2 sections minimum
- No introductions, conclusions, or filler text
- No bullet points, lists, or nested headings

Example:
# Topic One
Explanation of the first main concept from the document.

# Topic Two
Explanation of the second concept with important details.

# Topic Three
Explanation of additional key information from the document.`
} as const;

type ContentType = keyof typeof SYSTEM_PROMPTS;

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
		inputEl.addEventListener('keydown', (e) => e.key === 'Enter' && submitBtn.click());
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
		const response = await requestUrl({url, method: 'HEAD'});
		const contentType = response.headers?.['content-type'] || '';
		if (contentType.includes('application/pdf')) return 'pdf';
	} catch { /* ignore HEAD request errors */ }
	return 'web';
}

function createObsidianFetch(): typeof fetch {
	return async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const response = await requestUrl({
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

	async onload() {
		await this.loadSettings();
		
		this.addCommand({
			id: 'summarize-url',
			name: 'Summarize URL',
			callback: () => new URLInputModal(this.app, u => void this.summarize(u)).open()
		});

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
		if (!this.settings.openrouterApiKey) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice('Configure your OpenRouter API key in plugin settings');
			return;
		}

		const type = await detectContentType(url);
		try {
			const {title, content} = await this.fetchContent(url, type);
			
			new Notice('Generating summary...');
			const summary = await this.callOpenRouter(title, content, type);

			new Notice('Saving summary...');
			await this.saveSummary(url, title, summary);
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
				const response = await requestUrl({url, method: 'GET'});
				const content = htmlToMarkdown(response.text);
				const titleMatch = response.text.match(/<title[^>]*>([^<]*)<\/title>/i);
				return {title: titleMatch?.[1]?.trim() || 'Untitled', content};
			}
			
			case 'youtube': {
				const videoId = extractYouTubeVideoId(url);
				if (!videoId) throw new Error('Invalid YouTube URL');

				new Notice('Fetching video info...');
				const oembed = (await requestUrl({url: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, method: 'GET'})).json as {title: string};
				
				new Notice('Fetching transcript...');
				const transcript = await fetchTranscript(videoId, {fetch: createObsidianFetch()});
				return {title: oembed.title || 'Untitled', content: transcript.map(t => t.text).join(' ')};
			}
			
			case 'pdf': {
				new Notice('Fetching PDF...');
				const response = await requestUrl({url, method: 'GET'});
				const pdf = await getDocumentProxy(new Uint8Array(response.arrayBuffer));
				
				new Notice('Extracting text from PDF...');
				const { text } = await extractText(pdf, { mergePages: true });
				
				if (!text?.trim()) throw new Error('PDF appears to be empty or contains only images');
				return {title: extractPdfTitle(url), content: text};
			}
		}
	}

	private async callOpenRouter(title: string, content: string, type: ContentType): Promise<string> {
		const truncatedContent = content.length > 80000 
			? content.substring(0, 80000) + '\n\n[Content truncated due to length]' 
			: content;

		const response = await requestUrl({
			url: 'https://openrouter.ai/api/v1/chat/completions',
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${this.settings.openrouterApiKey}`},
			body: JSON.stringify({
				model: this.settings.model,
				messages: [
					{role: 'system', content: SYSTEM_PROMPTS[type]},
					{role: 'user', content: `Please summarize the following ${type === 'youtube' ? 'video transcript' : type === 'pdf' ? 'PDF document' : 'web page'}:\n\nTitle: ${title}\n\nContent:\n${truncatedContent}`}
				]
			})
		});

		const data = response.json as OpenRouterResponse;
		if (!data.choices?.[0]?.message?.content) throw new Error('Invalid response from OpenRouter API');
		return data.choices[0].message.content;
	}

	private async saveSummary(url: string, title: string, summary: string): Promise<void> {
		const folder = this.settings.folder;
		if (!await this.app.vault.adapter.exists(folder)) await this.app.vault.createFolder(folder);

		const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').substring(0, 100);
		const filepath = `${folder}/${new Date().toISOString().split('T')[0]}-${safeTitle}.md`;

		const fileContent = `Original URL: ${url}\n\n${summary}`;
		const existingFile = this.app.vault.getAbstractFileByPath(filepath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, fileContent);
		} else {
			await this.app.vault.create(filepath, fileContent);
		}
	}
}
