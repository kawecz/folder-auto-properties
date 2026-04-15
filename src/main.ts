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
                .onClick(async () => {
                    this.isSaved = true;
                    await this.onSave(this.rule);
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
                    window.setTimeout(() => { 
                        this.applyProperties(file).catch(console.error); 
                    }, 1000); 
                }
            }),
        );
    }

    async applyProperties(file: TFile) {
        const matchingRules = this.settings.rules.filter(
            (rule) => rule.folderPath && (file.path === rule.folderPath || file.path.startsWith(rule.folderPath + "/"))
        );

        if (matchingRules.length > 0) {
            matchingRules.sort((a, b) => a.folderPath.length - b.folderPath.length);

            try {
                await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | boolean | string[]>) => {
                    for (const rule of matchingRules) {
                        for (const prop of rule.properties) {
                            const key = prop.key.trim();
                            const rawValue = prop.value.trim();
                            
                            if (key !== "" && rawValue !== "") {
                                const lowerValue = rawValue.toLowerCase();
                                let parsedValue: string | boolean | string[] = rawValue;

                                if (lowerValue === "true") parsedValue = true;
                                else if (lowerValue === "false") parsedValue = false;
                                else if (key.toLowerCase() === "tags") {
                                    parsedValue = rawValue.split(",").map(t => t.trim()).filter(t => t !== "");
                                }

                                if (key.toLowerCase() === "tags") {
                                    let existingTags: string[] = [];
                                    if (Array.isArray(frontmatter[key])) {
                                        existingTags = frontmatter[key];
                                    } else if (typeof frontmatter[key] === "string") {
                                        existingTags = frontmatter[key].split(",").map((t: string) => t.trim());
                                    }
                                    frontmatter[key] = [...new Set([...existingTags, ...(parsedValue as string[])])];
                                } else {
                                    frontmatter[key] = parsedValue as string | boolean;
                                }
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
    constructor(app: App, plugin: FolderAutoProperties) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Add new rule")
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

        // Sort rules so nesting logic works correctly
        this.plugin.settings.rules.sort((a, b) => a.folderPath.localeCompare(b.folderPath));

        const subRuleCounters: Record<string, number> = {};
        let topLevelCount = 0;

        this.plugin.settings.rules.forEach((rule, ruleIndex) => {
            // Find if this rule has a parent rule
            const parentRule = this.plugin.settings.rules.find(r => 
                r.folderPath !== rule.folderPath && 
                rule.folderPath.startsWith(r.folderPath + "/")
            );

            // Calculate depth
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
                    text.onChange(async (value) => {
                        rule.folderPath = value;
                        await this.plugin.saveSettings();
                        this.display(); 
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
                    .onClick(async () => {
                        this.plugin.settings.rules.splice(ruleIndex, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    })
                );
        });
    }
}