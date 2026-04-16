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

const FILE_CREATION_DEBOUNCE_MS = 500;
const FILE_CREATION_WINDOW_SECONDS = 5;

const getFolderDisplayName = (path: string): string => {
    if (!path) return "";
    const parts = path.split("/").filter(p => p.length > 0);
    if (parts.length <= 2) return path;
    return parts.slice(-2).join("/");
};

class FolderRuleModal extends Modal {
    rule: FolderRule;
    plugin: FolderAutoProperties;
    isSaved: boolean = false;
    onSave: (rule: FolderRule) => Promise<void>;

    constructor(app: App, plugin: FolderAutoProperties, rule: FolderRule, onSave: (rule: FolderRule) => Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.rule = JSON.parse(JSON.stringify(rule)) as FolderRule;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        new Setting(contentEl).setName(`Rule for: ${this.rule.folderPath}`).setHeading();

        const propsContainer = contentEl.createDiv();

        const renderProps = () => {
            propsContainer.empty();
            this.rule.properties.forEach((prop, index) => {
                new Setting(propsContainer)
                    .addText(cb => cb
                        .setPlaceholder("Key")
                        .setValue(prop.key)
                        .onChange((v) => { prop.key = v; }))
                    .addText(cb => cb
                        .setPlaceholder("Value")
                        .setValue(prop.value)
                        .onChange((v) => { prop.value = v; }))
                    .addExtraButton(cb => cb
                        .setIcon("trash")
                        .onClick(() => {
                            this.rule.properties.splice(index, 1);
                            renderProps();
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
                .setButtonText("Save and close")
                .setCta()
                // Fix for the bot's "Promise returned where void expected" error
                .onClick(() => {
                    this.isSaved = true;
                    this.onSave(this.rule)
                        .then(() => this.close())
                        .catch(console.error);
                }));
    }
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
    textInputEl: HTMLInputElement;
    constructor(app: App, textInputEl: HTMLInputElement) {
        super(app, textInputEl);
        this.textInputEl = textInputEl;
    }
    
    // Optimized folder filtering
    getSuggestions(inputStr: string): TFolder[] {
        const lowerCaseInputStr = inputStr.toLowerCase();
        return this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && file.path.toLowerCase().includes(lowerCaseInputStr));
    }
    
    renderSuggestion(folder: TFolder, el: HTMLElement): void { el.setText(folder.path); }
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

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!(file instanceof TFolder)) return;

                const existingRuleIndex = this.settings.rules.findIndex(r => r.folderPath === file.path);
                const existingRule = this.settings.rules[existingRuleIndex];

                menu.addItem((item) => {
                    item
                        .setTitle(existingRule ? "Edit folder auto properties" : "Add folder auto property rule")
                        .setIcon("settings-2")
                        .setSection("action")
                        .onClick(() => {
                            const ruleToEdit = existingRule ? existingRule : { 
                                folderPath: file.path, 
                                properties: [{ key: "tags", value: "" }] 
                            };
                            
                            new FolderRuleModal(this.app, this, ruleToEdit, async (savedRule) => {
                                if (existingRuleIndex > -1) {
                                    this.settings.rules[existingRuleIndex] = savedRule;
                                } else {
                                    this.settings.rules.push(savedRule);
                                }
                                await this.saveSettings();
                            }).open();
                        });
                });
            })
        );

        this.registerEvent(
            this.app.vault.on("create", (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === "md") {
                    const now = Date.now();
                    const createdTime = file.stat.ctime;
                    const diffSeconds = (now - createdTime) / 1000;

                    if (diffSeconds < FILE_CREATION_WINDOW_SECONDS) {
                        window.setTimeout(() => { 
                            this.applyProperties(file).catch(console.error); 
                        }, FILE_CREATION_DEBOUNCE_MS);
                    }
                }
            }),
        );
    }

    // Copilot's extracted helpers for cleaner logic
    private parseTags(rawValue: string): string[] {
        return rawValue.split(",").map(t => t.trim()).filter(t => t !== "");
    }

    private mergeTags(existing: any, newTags: string[]): string[] {
        let existingTags: string[] = [];
        if (Array.isArray(existing)) {
            existingTags = existing;
        } else if (typeof existing === "string") {
            existingTags = this.parseTags(existing);
        }
        return [...new Set([...existingTags, ...newTags])];
    }

    private parsePropertyValue(key: string, rawValue: string): any {
        const lowerValue = rawValue.toLowerCase();
        
        if (lowerValue === "true") return true;
        if (lowerValue === "false") return false;
        if (key.toLowerCase() === "tags") {
            return this.parseTags(rawValue);
        }
        
        return rawValue;
    }

    async applyProperties(file: TFile) {
        const matchingRules = this.settings.rules.filter(
            (rule) => rule.folderPath && (file.path === rule.folderPath || file.path.startsWith(rule.folderPath + "/"))
        );

        if (matchingRules.length === 0) return;

        matchingRules.sort((a, b) => a.folderPath.length - b.folderPath.length);

        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, any>) => {
                for (const rule of matchingRules) {
                    for (const prop of rule.properties) {
                        const key = prop.key.trim();
                        const value = prop.value.trim();
                        
                        if (!key || !value) continue;

                        const parsedValue = this.parsePropertyValue(key, value);
                        const keyLower = key.toLowerCase();

                        if (keyLower === "tags") {
                            frontmatter[key] = this.mergeTags(frontmatter[key], parsedValue);
                        } else if (!frontmatter[key] || frontmatter[key] === "") {
                            frontmatter[key] = parsedValue;
                        }
                    }
                }
            });
        } catch (e) { 
            console.error("Folder Auto Properties Error:", e); 
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
    constructor(app: App, plugin: FolderAutoProperties) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Add new rule")
            .setDesc("Define properties for a specific folder. Rules apply to new notes only.")
            .addButton((btn) => btn
                .setButtonText("Add rule")
                .setCta()
                .onClick(() => {
                    const newRule = { folderPath: "", properties: [{ key: "tags", value: "" }] };
                    new FolderRuleModal(this.app, this.plugin, newRule, async (savedRule) => {
                        this.plugin.settings.rules.push(savedRule);
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                })
            );

        containerEl.createEl("hr");

        this.plugin.settings.rules.sort((a, b) => a.folderPath.localeCompare(b.folderPath));

        const subRuleCounters: Record<string, number> = {};
        let topLevelCount = 0;

        this.plugin.settings.rules.forEach((rule, ruleIndex) => {
            const parentRule = this.plugin.settings.rules.find(r => 
                r.folderPath !== rule.folderPath && 
                rule.folderPath.startsWith(r.folderPath + "/")
            );

            const depth = this.plugin.settings.rules.filter(r => 
                r.folderPath !== rule.folderPath && 
                rule.folderPath.startsWith(r.folderPath + "/")
            ).length;

            let ruleTitle = "";
            const folderLabel = getFolderDisplayName(rule.folderPath);

            if (depth === 0) {
                topLevelCount++;
                ruleTitle = `Rule ${topLevelCount}`;
            } else {
                const parentPath = parentRule?.folderPath || "root";
                subRuleCounters[parentPath] = (subRuleCounters[parentPath] || 0) + 1;
                ruleTitle = `Sub rule ${subRuleCounters[parentPath]}`;
            }

            if (folderLabel) ruleTitle += ` - ${folderLabel}`;

            const ruleContainer = containerEl.createDiv("folder-auto-prop-rule-card");
            
            if (depth > 0) {
                ruleContainer.addClass("folder-auto-prop-nested");
                ruleContainer.addClass(`folder-auto-prop-depth-${Math.min(depth, 5)}`);
            }

            new Setting(ruleContainer)
                .setName(ruleTitle)
                .addText((text) => {
                    text.setPlaceholder("Path...");
                    text.setValue(rule.folderPath);
                    new FolderSuggest(this.app, text.inputEl);
                    // Fixed the bot's promise warning here too
                    text.onChange((value) => {
                        rule.folderPath = value;
                        this.plugin.saveSettings()
                            .then(() => this.display())
                            .catch(console.error); 
                    });
                })
                .addButton((btn) => btn
                    .setButtonText("Edit properties")
                    .onClick(() => {
                        new FolderRuleModal(this.app, this.plugin, rule, async (savedRule) => {
                            this.plugin.settings.rules[ruleIndex] = savedRule;
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    })
                )
                .addExtraButton((btn) => btn
                    .setIcon("trash")
                    .onClick(() => {
                        this.plugin.settings.rules.splice(ruleIndex, 1);
                        this.plugin.saveSettings()
                            .then(() => this.display())
                            .catch(console.error);
                    })
                );
        });
    }
}