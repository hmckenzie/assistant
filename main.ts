import { App, Plugin, PluginSettingTab, Setting, Editor, TFile, Modal } from 'obsidian';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

interface AssistantSettings {
  apiKey: string;
  systemMessage: string;
}

const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: '',
  systemMessage: '',
};

export default class AssistantPlugin extends Plugin {
  settings: AssistantSettings;

  async onload() {
    await this.loadSettings();

    // Load default system message from file
    try {
      const fileContent = await this.app.vault.adapter.read('.obsidian/plugins/assistant/default-system-message.txt');
      if (!this.settings.systemMessage) {
        this.settings.systemMessage = fileContent;
        await this.saveSettings();
      }
    } catch (error) {
      console.error('Failed to load default system message:', error);
    }

    // Add a command to send selected text to OpenAI and append the response
    this.addCommand({
      id: 'send-selection-to-openai',
      name: 'Send Selection to OpenAI',
      editorCallback: (editor: Editor) => this.handleSelectedText(editor),
    });

    // Add a command to send selected text to OpenAI with an additional prompt
    this.addCommand({
      id: 'send-selection-with-prompt-to-openai',
      name: 'Send Selection with Prompt to OpenAI',
      editorCallback: (editor: Editor) => this.handleSelectedTextWithPrompt(editor),
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
        messages: [
          { role: 'system', content: this.settings.systemMessage },
          { role: 'user', content: selectedText },
        ],
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

  async handleSelectedTextWithPrompt(editor: Editor) {
    const selectedText = editor.getSelection();
    if (!selectedText) {
      console.log('No text selected.');
      return;
    }

    const promptModal = new PromptModal(this.app, async (userPrompt: string) => {
      if (!userPrompt) {
        console.log('No prompt provided.');
        return;
      }

      const client = new OpenAI({
        apiKey: this.settings.apiKey,
        dangerouslyAllowBrowser: true,
      });

      const cursorPosition = editor.getCursor('to');

      try {
        const responseStream = await client.chat.completions.create({
          messages: [
            { role: 'system', content: this.settings.systemMessage },
            { role: 'user', content: `Prompt: ${userPrompt}\n\nSelected Text: ${selectedText}` },
          ],
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
    });

    promptModal.open();
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

    containerEl.createEl('h2', { text: 'Settings for Assistant Plugin' });

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

    new Setting(containerEl)
      .setName('System Message')
      .setDesc('Enter the system message for GPT interactions. Leave blank for no system message.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Enter system message here...')
          .setValue(this.plugin.settings.systemMessage)
          .onChange(async (value) => {
            this.plugin.settings.systemMessage = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

class PromptModal extends Modal {
  onSubmit: (input: string) => void;

  constructor(app: App, onSubmit: (input: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Enter your prompt' });

    const inputEl = contentEl.createEl('textarea', {
      cls: 'prompt-input',
    });

    inputEl.focus();

    contentEl.createEl('button', {
      text: 'Submit',
      cls: 'prompt-submit',
    }).addEventListener('click', () => {
      this.onSubmit(inputEl.value);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
