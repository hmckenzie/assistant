import { App, Plugin, PluginSettingTab, Setting, Editor, TFile, Modal } from 'obsidian';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

interface AssistantSettings {
  apiKey: string;
  systemMessage: string;
  model: string;
  promptsFolder: string;
}

const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: '',
  systemMessage: '',
  model: 'gpt-3.5-turbo',
  promptsFolder: '',
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

    // Add a command to send full note text to OpenAI with an additional prompt
    this.addCommand({
      id: 'send-full-note-with-prompt-to-openai',
      name: 'Send Full Note with Prompt to OpenAI',
      editorCallback: (editor: Editor) => this.handleFullNoteWithPrompt(editor),
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
        model: this.settings.model,
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

    const promptModal = new PromptModal(this.app, this, async (userPrompt: string) => {
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
            { role: 'user', content: `Prompt: ${userPrompt}${selectedText ? '\n\nSelected Text: ' + selectedText : ''}` },
          ],
          model: this.settings.model,
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

  async handleFullNoteWithPrompt(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      console.log('No active file found.');
      return;
    }

    const fileContent = await this.app.vault.read(activeFile);
    if (!fileContent) {
      console.log('The current note is empty.');
      return;
    }

    const promptModal = new PromptModal(this.app, this, async (userPrompt: string) => {
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
            { role: 'user', content: `Prompt: ${userPrompt}\n\nFull Note: ${fileContent}` },
          ],
          model: this.settings.model,
          stream: true,
        });

        let responseText = '';
        // Add a newline before the response to separate it from the full note
        editor.replaceRange('\n\n', cursorPosition);
        cursorPosition.line += 2;
        cursorPosition.ch = 0;

        for await (const part of responseStream) {
          const content = part.choices[0]?.delta?.content;
          if (content) {
            responseText += content;
            // Append new content without replacing existing text or duplicating
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
      .setName('Model')
      .setDesc('Enter the model to use for GPT interactions (e.g., gpt-3.5-turbo, gpt-4).')
      .addText((text) =>
        text
          .setPlaceholder('Enter model name here...')
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Prompts Folder')
      .setDesc('Select the folder containing your pre-saved prompts.')
      .addText((text) =>
        text
          .setPlaceholder('Enter folder path here...')
          .setValue(this.plugin.settings.promptsFolder)
          .onChange(async (value) => {
            this.plugin.settings.promptsFolder = value;
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
  plugin: AssistantPlugin;
  onSubmit: (input: string) => void;

  constructor(app: App, plugin: AssistantPlugin, onSubmit: (input: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const promptsFolderPath = this.plugin.settings.promptsFolder ? this.app.vault.getAbstractFileByPath(this.plugin.settings.promptsFolder) : null;
    let promptNotes = [];

    if (promptsFolderPath && 'children' in promptsFolderPath) {
      promptNotes = promptsFolderPath.children.filter((file) => file instanceof TFile);
    }
    contentEl.addClass('prompt-modal');

    const container = contentEl.createDiv({ cls: 'prompt-container' });

    const selectEl = container.createEl('select', {
      cls: 'prompt-select',
    });

    selectEl.createEl('option', { value: '', text: 'Select a pre-saved prompt...' });

    promptNotes.forEach((note) => {
      selectEl.createEl('option', { value: note.path, text: note.basename });
    });

    selectEl.addEventListener('change', async (event) => {
      const filePath = (event.target as HTMLSelectElement).value;
      if (filePath) {
        const promptContent = await this.app.vault.read(this.app.vault.getAbstractFileByPath(filePath) as TFile);
        inputEl.value = promptContent;
      }
    });
    container.createEl('h2', { text: 'Enter your prompt', cls: 'prompt-header' });

    const inputEl = container.createEl('textarea', {
      cls: 'prompt-input',
    });

    const buttonEl = container.createEl('button', {
      text: 'Submit',
      cls: 'prompt-submit',
    });

    inputEl.focus();

    buttonEl.addEventListener('click', () => {
      this.onSubmit(inputEl.value);
      this.close();
    });

    inputEl.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 'Enter') {
        this.onSubmit(inputEl.value);
        this.close();
      }
    });

    container.style.display = 'flex';
    container.insertBefore(selectEl, inputEl);
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '20px';

    inputEl.style.width = '80%';
    inputEl.style.height = '100px';

    buttonEl.style.marginTop = '10px';
    buttonEl.style.padding = '10px 20px';
    buttonEl.style.cursor = 'pointer';
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
