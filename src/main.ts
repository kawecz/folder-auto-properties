import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TAbstractFile,
    TFolder,
    AbstractInputSuggest,
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
            if (
                file instanceof TFolder &&
                file.path.toLowerCase().includes(lowerCaseInputStr)
            ) {
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
    settings: FolderAutoPropertiesSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new FolderAutoPropertiesSettingTab(this.app, this));

        this.registerEvent(
            this.app.vault.on("create", (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === "md") {
                    this.applyProperties(file);
                }
            }),
        );
    }

    async applyProperties(file: TFile) {
        const activeRule = this.settings.rules.find(
            (rule) => rule.folderPath && file.path.startsWith(rule.folderPath),
        );

        if (activeRule && activeRule.properties.length > 0) {
            setTimeout(async () => {
                await this.app.fileManager.processFrontMatter(
                    file,
                    (frontmatter) => {
                        for (const prop of activeRule.properties) {
                            const key = prop.key.trim();
                            const rawValue = prop.value.trim();

                            if (key !== "" && rawValue !== "") {
                                if (frontmatter[key] === undefined) {
                                    const lowerValue = rawValue.toLowerCase();

                                    // 1. Handle Checkboxes (Booleans)
                                    if (lowerValue === "true") {
                                        frontmatter[key] = true;
                                    } else if (lowerValue === "false") {
                                        frontmatter[key] = false;
                                    }
                                    // 2. Handle Tags (Arrays)
                                    else if (key.toLowerCase() === "tags") {
                                        const tagArray = rawValue
                                            .split(",")
                                            .map((t) => t.trim())
                                            .filter((t) => t !== "");
                                        frontmatter[key] = tagArray;
                                    } 
                                    // 3. Handle Regular Text
                                    else {
                                        frontmatter[key] = rawValue;
                                    }
                                }
                            }
                        }
                    },
                );
            }, 500);
        }
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData(),
        );
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
            .setDesc("Create a new folder to properties mapping.")
            .addButton((btn) =>
                btn
                    .setButtonText("Add Rule")
                    .setCta()
                    .onClick(async () => {
                        this.plugin.settings.rules.push({
                            folderPath: "",
                            properties: [
                                { key: "tags", value: "" },
                                { key: "banner", value: "" },
                            ],
                        });
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        containerEl.createEl("hr");

        this.plugin.settings.rules.forEach((rule, ruleIndex) => {
            const ruleContainer = containerEl.createDiv("rule-container");
            ruleContainer.style.border = "1px solid var(--background-modifier-border)";
            ruleContainer.style.padding = "15px";
            ruleContainer.style.marginBottom = "15px";
            ruleContainer.style.borderRadius = "8px";

            new Setting(ruleContainer)
                .setName(`Rule ${ruleIndex + 1}`)
                .addText((text) => {
                    text.setPlaceholder("Type folder path...");
                    text.setValue(rule.folderPath);
                    new FolderSuggest(this.app, text.inputEl);

                    text.onChange(async (value) => {
                        rule.folderPath = value;
                        await this.plugin.saveSettings();
                    });
                })
                .addButton((btn) =>
                    btn
                        .setButtonText("Delete Rule")
                        .setWarning()
                        .onClick(async () => {
                            this.plugin.settings.rules.splice(ruleIndex, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        }),
                );

            const propsContainer = ruleContainer.createDiv("properties-container");
            propsContainer.style.marginLeft = "20px";
            propsContainer.style.marginTop = "10px";

            propsContainer.createEl("h5", {
                text: "Properties (Tags: tag1, tag2 | Checkbox: true/false)",
                cls: "setting-item-name",
            });

            rule.properties.forEach((prop, propIndex) => {
                const propSetting = new Setting(propsContainer)
                    .addText((text) =>
                        text
                            .setPlaceholder("Key (e.g., status)")
                            .setValue(prop.key)
                            .onChange(async (value) => {
                                prop.key = value;
                                await this.plugin.saveSettings();
                            }),
                    )
                    .addText((text) =>
                        text
                            .setPlaceholder("Value")
                            .setValue(prop.value)
                            .onChange(async (value) => {
                                prop.value = value;
                                await this.plugin.saveSettings();
                            }),
                    )
                    .addExtraButton((btn) =>
                        btn
                            .setIcon("trash")
                            .setTooltip("Remove property")
                            .onClick(async () => {
                                rule.properties.splice(propIndex, 1);
                                await this.plugin.saveSettings();
                                this.display();
                            }),
                    );

                propSetting.controlEl
                    .querySelectorAll("input")
                    .forEach((input) => {
                        input.style.width = "150px";
                    });
            });

            new Setting(propsContainer).addButton((btn) =>
                btn.setButtonText("+ Add Property").onClick(async () => {
                    rule.properties.push({ key: "", value: "" });
                    await this.plugin.saveSettings();
                    this.display();
                }),
            );
        });
    }
}