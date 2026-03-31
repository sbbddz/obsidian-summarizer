import {App, PluginSettingTab, Setting} from "obsidian";
import SummarizerPlugin from "./main";

export interface SummarizerSettings {
	openrouterApiKey: string;
	model: string;
	folder: string;
}

export const DEFAULT_SETTINGS: SummarizerSettings = {
	openrouterApiKey: '',
	model: 'openai/gpt-4o-mini',
	folder: 'Summaries'
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName('OpenRouter')
			.setHeading();

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName('Api key')
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc('Your OpenRouter API key')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder('sk-or-...')
				.setValue(this.plugin.settings.openrouterApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openrouterApiKey = value;
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
	}
}
