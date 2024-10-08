import { App, Plugin, PluginSettingTab, Setting, Editor, TFile, Modal, SuggestModal, TFolder, Notice } from 'obsidian';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

interface AssistantSettings {
  apiKey: string;
  systemMessage: string;
  model: string;
  promptsFolder: string;
  verboseLogging: boolean; // Add a setting for verbose logging
}

const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: '',
  systemMessage: '',
  model: 'gpt-3.5-turbo',
  promptsFolder: '',
  verboseLogging: false, // Default to false
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

    // Add a command to send selected text to OpenAI with a template from the Prompts Folder
    this.addCommand({
      id: 'send-selection-with-template-to-openai',
      name: 'Send Selection with Template to OpenAI',
      editorCallback: (editor: Editor) => this.handleSelectedTextWithTemplate(editor),
    });

    // Add a command to send full note text to OpenAI with an additional prompt
    this.addCommand({
      id: 'send-full-note-with-prompt-to-openai',
      name: 'Send Full Note with Prompt to OpenAI',
      editorCallback: (editor: Editor) => this.handleFullNoteWithPrompt(editor),
    });

    // Add a command to send full note text to OpenAI with a template from the Prompts Folder
    this.addCommand({
      id: 'send-full-note-with-template-to-openai',
      name: 'Send Full Note with Template to OpenAI',
      editorCallback: (editor: Editor) => this.handleFullNoteWithTemplate(editor),
    });

    // Add a command to create embeddings for notes in a selected folder
    this.addCommand({
      id: 'create-embeddings-for-folder',
      name: 'Create Embeddings for Folder',
      callback: () => this.handleCreateEmbeddingsForFolder(),
    });

    // Add a command to reset embeddings
    this.addCommand({
      id: 'reset-embeddings',
      name: 'Reset Embeddings',
      callback: () => this.resetEmbeddings(),
    });

    // Add a command to show a SuggestModal with notes sorted by similarity to the selected text
    this.addCommand({
      id: 'show-similar-notes',
      name: 'Show Similar Notes',
      editorCallback: (editor: Editor) => this.handleShowSimilarNotes(editor),
    });
    
    // Add a command to send a prompt with the selected text and the top ten most relevant chunks
    this.addCommand({
      id: 'send-selection-with-top-chunks',
      name: 'Send Selection with Top Chunks',
      editorCallback: (editor: Editor) => this.handleSendWithTopChunks(editor),
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
      new Notice('No text selected.');
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
      new Notice('Error interacting with OpenAI.');
      console.error('Error interacting with OpenAI:', error);
    }
  }

  async handleSelectedTextWithPrompt(editor: Editor) {
    const selectedText = editor.getSelection();

    const promptModal = new PromptModal(this.app, this, async (userPrompt: string) => {
      if (!userPrompt) {
        new Notice('No prompt provided.');
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
        new Notice('Error interacting with OpenAI.');
        console.error('Error interacting with OpenAI:', error);
      }
    });

    promptModal.open();
  }

  async handleSelectedTextWithTemplate(editor: Editor) {
    const selectedText = editor.getSelection();

    const templateModal = new TemplateSuggestModal(this.app, this, async (templateContent: string) => {
      if (!templateContent) {
        new Notice('No template selected.');
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
            { role: 'user', content: `Template: ${templateContent}${selectedText ? '\n\nSelected Text: ' + selectedText : ''}` },
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
        new Notice('Error interacting with OpenAI.');
        console.error('Error interacting with OpenAI:', error);
      }
    });

    templateModal.open();
  }

  async handleFullNoteWithPrompt(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active file found.');
      return;
    }

    const fileContent = await this.app.vault.read(activeFile);
    if (!fileContent) {
      console.log('The current note is empty.');
      return;
    }

    const promptModal = new PromptModal(this.app, this, async (userPrompt: string) => {
      if (!userPrompt) {
        new Notice('No prompt provided.');
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
        new Notice('Error interacting with OpenAI.');
        console.error('Error interacting with OpenAI:', error);
      }
    });

    promptModal.open();
  }

  async handleFullNoteWithTemplate(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active file found.');
      return;
    }

    const fileContent = await this.app.vault.read(activeFile);
    if (!fileContent) {
      console.log('The current note is empty.');
      return;
    }

    const templateModal = new TemplateSuggestModal(this.app, this, async (templateContent: string) => {
      if (!templateContent) {
        new Notice('No template selected.');
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
            { role: 'user', content: `Template: ${templateContent}\n\nFull Note: ${fileContent}` },
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
        new Notice('Error interacting with OpenAI.');
        console.error('Error interacting with OpenAI:', error);
      }
    });

    templateModal.open();
  }

  async handleCreateEmbeddingsForFolder() {
    const folderModal = new FolderSuggestModal(this.app, this, async (selectedFolder: TFolder) => {
      if (!selectedFolder) {
        new Notice('No folder selected.');
        return;
      }

      new Notice(`Creating embeddings for notes in folder: ${selectedFolder.name}`);

      const client = new OpenAI({
        apiKey: this.settings.apiKey,
        dangerouslyAllowBrowser: true,
      });

      const notes = selectedFolder.children.filter((file) => file instanceof TFile) as TFile[];
      if (notes.length === 0) {
        new Notice('No notes found in the selected folder.');
        return;
      }

      const embeddingsData = [];

      for (const note of notes) {
        const fileContent = await this.app.vault.read(note);
        const chunks = this.chunkText(fileContent);

        for (const chunk of chunks) {
          try {
            const embeddingResponse = await client.embeddings.create({
              input: chunk,
              model: 'text-embedding-ada-002',
            });

            embeddingsData.push({
              embedding: embeddingResponse.data[0].embedding,
              chunk,
              notePath: note.path,
              noteFilename: note.basename,
            });
          } catch (error) {
            new Notice(`Error creating embedding for note: ${note.path}`);
            console.error(`Error creating embedding for note: ${note.path}`, error);
          }
        }
      }

      // Append the embeddingsData for future retrieval and search
      await this.appendEmbeddings(embeddingsData);
      new Notice('Embeddings created and saved successfully.');
    });

    folderModal.open();
  }

  async resetEmbeddings() {
    try {
      // Clear the embeddings data file
      await this.app.vault.adapter.write('.obsidian/plugins/assistant/embeddings.json', JSON.stringify([], null, 2));
      new Notice('Embeddings have been reset.');
    } catch (error) {
      new Notice('Error resetting embeddings.');
      console.error('Error resetting embeddings:', error);
    }
  }

  chunkText(text: string): string[] {
    const chunkSize = 500;
    const overlap = 50;
    const chunks = [];

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.substring(start, end));
      start += chunkSize - overlap;
    }

    return chunks;
  }

  async appendEmbeddings(embeddingsData: any[]) {
    try {
      const existingData = await this.app.vault.adapter.read('.obsidian/plugins/assistant/embeddings.json');
      const parsedData = existingData ? JSON.parse(existingData) : [];
      const combinedData = parsedData.concat(embeddingsData);
      await this.app.vault.adapter.write('.obsidian/plugins/assistant/embeddings.json', JSON.stringify(combinedData, null, 2));
    } catch (error) {
      console.error('Error appending embeddings:', error);
    }
  }

  async handleShowSimilarNotes(editor: Editor) {
    const selectedText = editor.getSelection();
    if (!selectedText) {
      new Notice('No text selected.');
      return;
    }

    const client = new OpenAI({
      apiKey: this.settings.apiKey,
      dangerouslyAllowBrowser: true,
    });

    try {
      // Create embedding for the selected text
      const embeddingResponse = await client.embeddings.create({
        input: selectedText,
        model: 'text-embedding-ada-002',
      });

      const selectedTextEmbedding = embeddingResponse.data[0].embedding;

      // Load existing embeddings from the file
      const embeddingsData = JSON.parse(await this.app.vault.adapter.read('.obsidian/plugins/assistant/embeddings.json'));

      // Calculate similarity for each chunk and sort them
      const similarityScores = embeddingsData.map((data) => {
        return {
          notePath: data.notePath,
          similarity: this.cosineSimilarity(selectedTextEmbedding, data.embedding),
        };
      });

      similarityScores.sort((a, b) => b.similarity - a.similarity);

      // Get unique note paths, sorted by highest similarity
      const uniqueNotePaths = Array.from(new Set(similarityScores.map((score) => score.notePath)));

      // Show the SuggestModal with sorted notes
      const similarNotesModal = new SimilarNotesSuggestModal(this.app, uniqueNotePaths);
      similarNotesModal.open();
    } catch (error) {
      new Notice('Error calculating similarity.');
      console.error('Error calculating similarity:', error);
    }
  }

  cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  async handleSendWithTopChunks(editor: Editor) {
    const selectedText = editor.getSelection();
    
    // Open a prompt modal for the user to provide additional input
    const promptModal = new PromptModal(this.app, this, async (userPrompt: string) => {
      if (!userPrompt) {
        new Notice('No prompt provided.');
        return;
      }
  
      const client = new OpenAI({
        apiKey: this.settings.apiKey,
        dangerouslyAllowBrowser: true,
      });
  
      try {
        // Create embedding for the combined prompt and selected text (if any)
        const combinedText = `${userPrompt}${selectedText ? '\n\nSelected Text: ' + selectedText : ''}`;
        const embeddingResponse = await client.embeddings.create({
          input: combinedText,
          model: 'text-embedding-ada-002',
        });
  
        const combinedEmbedding = embeddingResponse.data[0].embedding;
  
        // Load existing embeddings from the file
        const embeddingsData = JSON.parse(await this.app.vault.adapter.read('.obsidian/plugins/assistant/embeddings.json'));
  
        // Calculate similarity for each chunk and sort them
        const similarityScores = embeddingsData.map((data) => {
          return {
            chunk: data.chunk,
            similarity: this.cosineSimilarity(combinedEmbedding, data.embedding),
          };
        });
  
        // Sort chunks by similarity in descending order and get the top 10 most similar chunks
        similarityScores.sort((a, b) => b.similarity - a.similarity);
        const topChunks = similarityScores.slice(0, 10).map((score) => score.chunk).join('\n\n');
  
        // Prepare the final prompt to be sent to OpenAI
        const finalPrompt = `Prompt: ${userPrompt}${selectedText ? '\n\nSelected Text: ' + selectedText : ''}\n\nTop Relevant Chunks: ${topChunks}`;
  
        const cursorPosition = editor.getCursor('to');
  
        // Send the final prompt to OpenAI and stream the response back to the editor
        const responseStream = await client.chat.completions.create({
          messages: [
            { role: 'system', content: this.settings.systemMessage },
            { role: 'user', content: finalPrompt },
          ],
          model: this.settings.model,
          stream: true,
        });
  
        let responseText = '';
        // Add a newline before the response to separate it from the existing content
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

      // Log the conversation if verbose logging is enabled
      if (this.settings.verboseLogging) {
        console.log('Prompt:', finalPrompt);
        console.log('Response:', responseText);
      }
      } catch (error) {
        new Notice('Error interacting with OpenAI or calculating similarity.');
        console.error('Error:', error);
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

class TemplateSuggestModal extends SuggestModal<TFile> {
  plugin: AssistantPlugin;
  onSelect: (templateContent: string) => void;

  constructor(app: App, plugin: AssistantPlugin, onSelect: (templateContent: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  getSuggestions(query: string): TFile[] {
    const promptsFolderPath = this.plugin.settings.promptsFolder ? this.app.vault.getAbstractFileByPath(this.plugin.settings.promptsFolder) : null;
    if (promptsFolderPath && 'children' in promptsFolderPath) {
      return promptsFolderPath.children.filter((file) => file instanceof TFile && file.basename.toLowerCase().includes(query.toLowerCase())) as TFile[];
    }
    return [];
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createEl('div', { text: file.basename });
  }

  async onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
    const templateContent = await this.app.vault.read(file);
    this.onSelect(templateContent);
  }
}

class FolderSuggestModal extends SuggestModal<TFolder> {
  plugin: AssistantPlugin;
  onSelect: (selectedFolder: TFolder) => void;

  constructor(app: App, plugin: AssistantPlugin, onSelect: (selectedFolder: TFolder) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  getSuggestions(query: string): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder && file.name.toLowerCase().includes(query.toLowerCase())) as TFolder[];
  }

  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.createEl('div', { text: folder.name });
  }

  async onChooseSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
    this.onSelect(folder);
  }
}

class SimilarNotesSuggestModal extends SuggestModal<string> {
  notePaths: string[];

  constructor(app: App, notePaths: string[]) {
    super(app);
    this.notePaths = notePaths;
  }

  getSuggestions(query: string): string[] {
    return this.notePaths.filter((path) => path.toLowerCase().includes(query.toLowerCase()));
  }

  renderSuggestion(notePath: string, el: HTMLElement) {
    const note = this.app.vault.getAbstractFileByPath(notePath) as TFile;
    if (note) {
      el.createEl('div', { text: note.basename });
    }
  }

  async onChooseSuggestion(notePath: string, evt: MouseEvent | KeyboardEvent) {
    const note = this.app.vault.getAbstractFileByPath(notePath) as TFile;
    if (note) {
      const leaf = this.app.workspace.getLeaf(true);
      leaf.openFile(note);
    }
  }
}