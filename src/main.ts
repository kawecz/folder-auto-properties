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

interface FrontMatter {
    [key: string]: string | string[] | boolean | number | null | undefined;
}

export type PropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "tags" | "list";

interface PropertyField {
    key: string;
    value: string | boolean | number | string[];
    type: PropertyType;
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

const getFolderDisplayName = (path: string): string => {
    if (!path) return "";
    const parts = path.split("/").filter(p => p.length > 0);
    if (parts.length <= 2) return path;
    return parts.slice(-2).join("/");
};

class FolderSuggest extends AbstractInputSuggest<TFolder> {
    textInputEl: HTMLInputElement;
    constructor(app: App, textInputEl: HTMLInputElement) {
        super(app, textInputEl);
        this.textInputEl = textInputEl;
    }
    
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

class FolderRuleModal extends Modal {
    rule: FolderRule;
    plugin: FolderAutoProperties;
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
        contentEl.addClass("folder-auto-prop-modal");
        
        new Setting(contentEl)
            .setName("Rule for Folder")
            .setDesc("Select the target folder path")
            .addText(text => {
                text.setPlaceholder("Folder path...");
                text.setValue(this.rule.folderPath);
                new FolderSuggest(this.app, text.inputEl);
                text.onChange(v => this.rule.folderPath = v);
            });

        const propsContainer = contentEl.createDiv();

        const renderProps = () => {
            propsContainer.empty();
            this.rule.properties.forEach((prop, index) => {
                if (!prop.type) prop.type = "text"; 

                const setting = new Setting(propsContainer)
                    .addText(cb => cb
                        .setPlaceholder("Key")
                        .setValue(prop.key)
                        .onChange((v) => { prop.key = v; }))
                    .addDropdown(cb => cb
                        .addOptions({
                            text: "Text", number: "Number", checkbox: "Checkbox",
                            date: "Date", datetime: "Date & Time", tags: "Tags", list: "List"
                        })
                        .setValue(prop.type)
                        .onChange((v) => {
                            prop.type = v as PropertyType;
                            // Reset value based on type to prevent bad data
                            if (prop.type === "checkbox") prop.value = false;
                            else prop.value = "";
                            renderProps();
                        })
                    );

                // Dynamically render the input based on type
                if (prop.type === "checkbox") {
                    setting.addToggle(cb => cb
                        .setValue(Boolean(prop.value))
                        .onChange(v => prop.value = v)
                    );
                } else {
                    setting.addText(cb => {
                        cb.setValue(String(prop.value || ""));
                        if (prop.type === "date") cb.inputEl.type = "date";
                        if (prop.type === "datetime") cb.inputEl.type = "datetime-local";
                        if (prop.type === "number") cb.inputEl.type = "number";
                        
                        cb.onChange(v => {
                            if (prop.type === "number") prop.value = Number(v);
                            else prop.value = v;
                        });
                    });
                }

                setting.addExtraButton(cb => cb
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
                    this.rule.properties.push({ key: "", value: "", type: "text" });
                    renderProps();
                }))
            .addButton(bt => bt
                .setButtonText("Save and close")
                .setCta()
                .onClick(() => {
                    this.onSave(this.rule)
                        .then(() => this.close())
                        .catch(console.error);
                }));
    }
}

export default class FolderAutoProperties extends Plugin {
    settings!: FolderAutoPropertiesSettings;
    private processingFiles: Set<string> = new Set();

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new FolderAutoPropertiesSettingTab(this.app, this));

        // Folder Context Menu Listener
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
                                properties: [{ key: "tags", value: "", type: "tags" as PropertyType }] 
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

        // Vault Rename Listener (Updates paths automatically)
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            if (file instanceof TFolder) {
                let changed = false;
                this.settings.rules.forEach(rule => {
                    if (rule.folderPath === oldPath) {
                        rule.folderPath = file.path;
                        changed = true;
                    } else if (rule.folderPath.startsWith(oldPath + "/")) {
                        rule.folderPath = file.path + rule.folderPath.substring(oldPath.length);
                        changed = true;
                    }
                });
                if (changed) this.saveSettings();
            }
        }));

        // Vault Delete Listener (Cleans up orphan rules)
        this.registerEvent(this.app.vault.on("delete", (file) => {
            const initialCount = this.settings.rules.length;
            this.settings.rules = this.settings.rules.filter(rule => 
                !(rule.folderPath === file.path || rule.folderPath.startsWith(file.path + "/"))
            );
            if (this.settings.rules.length !== initialCount) {
                this.saveSettings();
            }
        }));

        // Main File Creation Listener
        this.registerEvent(
            this.app.vault.on("create", (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === "md") {
                    if (this.processingFiles.has(file.path)) return;
                    
                    this.processingFiles.add(file.path);

                    window.setTimeout(async () => { 
                        try {
                            const stillExists = this.app.vault.getAbstractFileByPath(file.path);
                            if (stillExists instanceof TFile) {
                                await this.applyProperties(stillExists);
                            }
                        } catch (err) {
                            console.error("Folder Auto Properties: Async error", err);
                        } finally {
                            this.processingFiles.delete(file.path);
                        }
                    }, FILE_CREATION_DEBOUNCE_MS);
                }
            }),
        );
    }

    private parseTags(rawValue: string): string[] {
        return rawValue.split(",").map(t => t.trim()).filter(t => t !== "");
    }

    private mergeLists(existing: any, newItems: string[]): string[] {
        let existingItems: string[] = [];
        if (Array.isArray(existing)) {
            existingItems = existing.map(String);
        } else if (typeof existing === "string") {
            existingItems = this.parseTags(existing);
        }
        return [...new Set([...existingItems, ...newItems])];
    }

    async applyProperties(file: TFile) {
        const matchingRules = this.settings.rules.filter(
            (rule) => rule.folderPath && (file.path === rule.folderPath || file.path.startsWith(rule.folderPath + "/"))
        );

        if (matchingRules.length === 0) return;

        // Apply parent rules first, then sub-rules
        matchingRules.sort((a, b) => a.folderPath.length - b.folderPath.length);

        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontMatter) => {
                for (const rule of matchingRules) {
                    for (const prop of rule.properties) {
                        const key = prop.key.trim();
                        if (!key) continue;

                        let valToSet = prop.value;

                        if (prop.type === "tags" || prop.type === "list") {
                            const newItems = typeof valToSet === "string" ? this.parseTags(valToSet) : [];
                            frontmatter[key] = this.mergeLists(frontmatter[key], newItems);
                        } else if (!frontmatter[key] || frontmatter[key] === "") {
                            frontmatter[key] = valToSet;
                        }
                    }
                }
            });
        } catch (e) { 
            console.warn("Folder Auto Properties: Could not process frontmatter (file might be busy or deleted).");
        }
    }

    async loadSettings() { 
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as FolderAutoPropertiesSettings; 
        
        // Backwards compatibility migration
        this.settings.rules.forEach(rule => {
            rule.properties.forEach(prop => {
                if (!prop.type) prop.type = "text";
            });
        });
    }
    
    async saveSettings() { 
        await this.saveData(this.settings); 
    }
}

class FolderAutoPropertiesSettingTab extends PluginSettingTab {
    plugin: FolderAutoProperties;
    collapsedPaths: Set<string> = new Set(); // Tracks collapsed UI state

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
                .setClass("add-rule-btn-custom")
                .onClick(() => {
                    const newRule = { folderPath: "", properties: [{ key: "tags", value: "", type: "tags" as PropertyType }] };
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
                r.folderPath !== rule.folderPath && rule.folderPath.startsWith(r.folderPath + "/")
            );

            // If parent is collapsed, skip rendering this child
            if (parentRule && this.collapsedPaths.has(parentRule.folderPath)) return;

            const depth = this.plugin.settings.rules.filter(r => 
                r.folderPath !== rule.folderPath && rule.folderPath.startsWith(r.folderPath + "/")
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

            const settingItem = new Setting(ruleContainer)
                .setName(ruleTitle)
                .addText((text) => {
                    text.setPlaceholder("Path...");
                    text.setValue(rule.folderPath);
                    new FolderSuggest(this.app, text.inputEl);
                    text.onChange((value) => {
                        rule.folderPath = value;
                        this.plugin.saveSettings()
                            .then(() => this.display())
                            .catch(console.error); 
                    });
                });

            // Toggle Visibility Button (if it has children)
            const hasChildren = this.plugin.settings.rules.some(r => r.folderPath !== rule.folderPath && r.folderPath.startsWith(rule.folderPath + "/"));
            if (hasChildren) {
                const isCollapsed = this.collapsedPaths.has(rule.folderPath);
                settingItem.addExtraButton(btn => btn
                    .setIcon(isCollapsed ? "chevron-right" : "chevron-down")
                    .setTooltip(isCollapsed ? "Expand sub-rules" : "Collapse sub-rules")
                    .onClick(() => {
                        if (isCollapsed) this.collapsedPaths.delete(rule.folderPath);
                        else this.collapsedPaths.add(rule.folderPath);
                        this.display(); // Re-render to show/hide children
                    })
                );
            }

            // Add Sub-rule Button
            settingItem.addExtraButton((btn) => btn
                .setIcon("plus")
                .setTooltip("Add Sub-rule")
                .onClick(() => {
                    const newRule = { folderPath: rule.folderPath + "/subfolder", properties: [{ key: "tags", value: "", type: "tags" as PropertyType }] };
                    new FolderRuleModal(this.app, this.plugin, newRule, async (savedRule) => {
                        this.plugin.settings.rules.push(savedRule);
                        this.collapsedPaths.delete(rule.folderPath); // Ensure parent expands
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                })
            );

            settingItem.addButton((btn) => btn
                .setButtonText("Edit")
                .onClick(() => {
                    new FolderRuleModal(this.app, this.plugin, rule, async (savedRule) => {
                        this.plugin.settings.rules[ruleIndex] = savedRule;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                })
            );

            settingItem.addExtraButton((btn) => btn
                .setIcon("trash")
                .setTooltip("Delete rule")
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