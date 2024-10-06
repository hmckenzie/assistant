import { App, Plugin, PluginSettingTab, Setting, Editor } from 'obsidian';
import OpenAI from 'openai';

interface AssistantSettings {
  apiKey: string;
}

const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: '',
};

export default class AssistantPlugin extends Plugin {
  settings: AssistantSettings;

  async onload() {
    await this.loadSettings();

    // Add a command to send selected text to OpenAI and append the response
    this.addCommand({
      id: 'send-selection-to-openai',
      name: 'Send Selection to OpenAI',
      editorCallback: (editor: Editor) => this.handleSelectedText(editor),
    });

    // Add a settings tab for API key configuration
    this.addSettingTab(new AssistantSettingTab(this.app, this));
  }

  async handleSelectedText(editor: Editor) {
    const client = new OpenAI({
      apiKey: this.settings.apiKey,
      dangerouslyAllowBrowser: true,
    });

    const selectedText = editor.getSelection();
    if (!selectedText) {
      console.log('No text selected.');
      return;
    }

    const cursorPosition = editor.getCursor('to');

    try {
      const responseStream = await client.chat.completions.create({
        messages: [{ role: 'user', content: selectedText }],
        model: 'gpt-3.5-turbo',
        stream: true,
      });

      let responseText = '';
      // Add a newline before the response to separate it from the selected text
      editor.replaceRange('\n\n', cursorPosition);
      cursorPosition.line += 2;
      cursorPosition.ch = 0;

      for await (const part of responseStream) {
        const content = part.choices[0]?.delta?.content;
        if (content) {
          responseText += content;
          // Append new content without replacing the selection or duplicating
          editor.replaceRange(content, cursorPosition);
          cursorPosition.ch += content.length;
        }
      }
    } catch (error) {
      console.error('Error interacting with OpenAI:', error);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class AssistantSettingTab extends PluginSettingTab {
  plugin: AssistantPlugin;

  constructor(app: App, plugin: AssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('h2', { text: 'Settings for OpenAI Plugin' });

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Enter your OpenAI API key')
      .addText((text) =>
        text
          .setPlaceholder('Enter your API key here...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
