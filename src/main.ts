import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TAbstractFile,
    TFolder,
    AbstractInputSuggest,
    Modal,
} from "obsidian";

interface PropertyField {
    key: string;
    value: string;
}

interface FolderRule {
    folderPath: string;
    properties: PropertyField[];
}

interface FolderAutoPropertiesSettings {
    rules: FolderRule[];
}

const DEFAULT_SETTINGS: FolderAutoPropertiesSettings = {
    rules: [],
};

// Helper to get the "LastTwo/Folder" name for the UI
const getFolderDisplayName = (path: string): string => {
    if (!path) return "";
    const parts = path.split("/").filter(p => p.length > 0);
    if (parts.length <= 2) return path;
    return parts.slice(-2).join("/");
};

class FolderRuleModal extends Modal {
    rule: FolderRule;
    plugin: FolderAutoProperties;
    onSave: () => Promise<void>;

    constructor(app: App, plugin: FolderAutoProperties, rule: FolderRule, onSave: () => Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.rule = rule;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: `Rule for: ${this.rule.folderPath}` });

        const propsContainer = contentEl.createDiv();

        const renderProps = () => {
            propsContainer.empty();
            this.rule.properties.forEach((prop, index) => {
                new Setting(propsContainer)
                    .addText(cb => cb
                        .setPlaceholder("Key")
                        .setValue(prop.key)
                        .onChange(async (v) => { 
                            prop.key = v; 
                            await this.plugin.saveSettings(); 
                        }))
                    .addText(cb => cb
                        .setPlaceholder("Value")
                        .setValue(prop.value)
                        .onChange(async (v) => { 
                            prop.value = v; 
                            await this.plugin.saveSettings(); 
                        }))
                    .addExtraButton(cb => cb
                        .setIcon("trash")
                        .onClick(async () => {
                            this.rule.properties.splice(index, 1);
                            renderProps();
                            await this.plugin.saveSettings();
                        }));
            });
        };

        renderProps();

        new Setting(contentEl)
            .addButton(bt => bt
                .setButtonText("Add property")
                .onClick(() => {
                    this.rule.properties.push({ key: "", value: "" });
                    renderProps();
                }))
            .addButton(bt => bt
                .setButtonText("Save & close")
                .setCta()
                .onClick(async () => {
                    await this.onSave();
                    this.close();
                }));
    }
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
    textInputEl: HTMLInputElement;

    constructor(app: App, textInputEl: HTMLInputElement) {
        super(app, textInputEl);
        this.textInputEl = textInputEl;
    }

    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((file: TAbstractFile) => {
            if (file instanceof TFolder && file.path.toLowerCase().includes(lowerCaseInputStr)) {
                folders.push(file);
            }
        });
        return folders;
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.textInputEl.value = folder.path;
        this.textInputEl.trigger("input");
        this.close();
    }
}

export default class FolderAutoProperties extends Plugin {
    settings!: FolderAutoPropertiesSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new FolderAutoPropertiesSettingTab(this.app, this));

        // Registry for right-click folder menu
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!(file instanceof TFolder)) return;

                const existingRule = this.settings.rules.find(r => r.folderPath === file.path);

                menu.addItem((item) => {
                    item
                        .setTitle(existingRule ? "Edit folder auto properties" : "Add folder auto property rule")
                        .setIcon("settings-2")
                        .setSection("action") // Forces it into the main action block
                        .onClick(async () => {
                            let ruleToEdit = existingRule;
                            if (!ruleToEdit) {
                                ruleToEdit = { 
                                    folderPath: file.path, 
                                    properties: [{ key: "tags", value: "" }] 
                                };
                                this.settings.rules.push(ruleToEdit);
                                await this.saveSettings();
                            }
                            
                            new FolderRuleModal(this.app, this, ruleToEdit, async () => {
                                await this.saveSettings();
                            }).open();
                        });
                });
            })
        );

        this.registerEvent(
            this.app.vault.on("create", (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === "md") {
                    window.setTimeout(() => {
                        void this.applyProperties(file);
                    }, 1000); 
                }
            }),
        );
    }

    async applyProperties(file: TFile) {
        const activeRule = this.settings.rules.find(
            (rule) => rule.folderPath && (file.path === rule.folderPath || file.path.startsWith(rule.folderPath + "/")),
        );

        if (activeRule && activeRule.properties.length > 0) {
            try {
                await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | boolean | string[]>) => {
                    for (const prop of activeRule.properties) {
                        const key = prop.key.trim();
                        const rawValue = prop.value.trim();

                        if (key !== "" && rawValue !== "") {
                            if (frontmatter[key] === undefined) {
                                const lowerValue = rawValue.toLowerCase();
                                if (lowerValue === "true") frontmatter[key] = true;
                                else if (lowerValue === "false") frontmatter[key] = false;
                                else if (key.toLowerCase() === "tags") {
                                    frontmatter[key] = rawValue.split(",").map(t => t.trim()).filter(t => t !== "");
                                } else frontmatter[key] = rawValue;
                            }
                        }
                    }
                });
            } catch (e) {
                console.error("Folder Auto Properties Error:", e);
            }
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as FolderAutoPropertiesSettings;
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class FolderAutoPropertiesSettingTab extends PluginSettingTab {
    plugin: FolderAutoProperties;

    constructor(app: App, plugin: FolderAutoProperties) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Add new rule")
            .addButton((btn) =>
                btn
                    .setButtonText("Add rule")
                    .setCta()
                    .onClick(async () => {
                        this.plugin.settings.rules.push({
                            folderPath: "",
                            properties: [{ key: "tags", value: "" }],
                        });
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        containerEl.createEl("hr");

        this.plugin.settings.rules.forEach((rule, ruleIndex) => {
            const ruleContainer = containerEl.createDiv("folder-auto-prop-rule-card");
            
            // UI Update: Rule Label with Last Two Folders
            const folderLabel = getFolderDisplayName(rule.folderPath);
            const ruleTitle = folderLabel ? `Rule ${ruleIndex + 1} - ${folderLabel}` : `Rule ${ruleIndex + 1}`;

            new Setting(ruleContainer)
                .setName(ruleTitle)
                .addText((text) => {
                    text.setPlaceholder("Path...");
                    text.setValue(rule.folderPath);
                    new FolderSuggest(this.app, text.inputEl);
                    text.onChange(async (value) => {
                        rule.folderPath = value;
                        await this.plugin.saveSettings();
                        // Optional: trigger refresh of the name immediately
                        this.display(); 
                    });
                })
                .addButton((btn) =>
                    btn
                        .setButtonText("Edit properties")
                        .onClick(() => {
                            new FolderRuleModal(this.app, this.plugin, rule, async () => {
                                await this.plugin.saveSettings();
                                this.display();
                            }).open();
                        }),
                )
                .addExtraButton((btn) =>
                    btn
                        .setIcon("trash")
                        .onClick(async () => {
                            this.plugin.settings.rules.splice(ruleIndex, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        }),
                );
        });
    }
}