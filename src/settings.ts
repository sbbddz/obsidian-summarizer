import {App, PluginSettingTab, Setting} from "obsidian";
import SummarizerPlugin from "./main";

export interface SummarizerSettings {
	apiKey: string;
	apiBaseUrl: string;
	model: string;
	folder: string;
	includeMetadataHeader: boolean;
}

export const DEFAULT_SETTINGS: SummarizerSettings = {
	apiKey: '',
	apiBaseUrl: 'https://openrouter.ai/api/v1',
	model: 'openai/gpt-4o-mini',
	folder: 'Summaries',
	includeMetadataHeader: true
};

export class SummarizerSettingTab extends PluginSettingTab {
	plugin: SummarizerPlugin;

	constructor(app: App, plugin: SummarizerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('AI Provider')
			.setHeading();

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your API key')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API base URL')
			.setDesc('Base URL for the AI API (e.g., https://openrouter.ai/api/v1)')
			.addText(text => text
				.setPlaceholder('https://openrouter.ai/api/v1')
				.setValue(this.plugin.settings.apiBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.apiBaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model to use for summarization')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder('openai/gpt-4o-mini')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Output folder')
			.setDesc('Folder where summaries are saved')
			.addText(text => text
				.setPlaceholder('SUMMARIES')
				.setValue(this.plugin.settings.folder)
				.onChange(async (value) => {
					this.plugin.settings.folder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include metadata header')
			.setDesc('Add YAML frontmatter with tags and description to summary files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeMetadataHeader)
				.onChange(async (value) => {
					this.plugin.settings.includeMetadataHeader = value;
					await this.plugin.saveSettings();
				}));
	}
}
