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
	[key: string]: unknown;
}

export type PropertyType =
	| "text"
	| "number"
	| "checkbox"
	| "date"
	| "datetime"
	| "tags"
	| "list"
	| "counter";

interface PropertyField {
	key: string;
	value: string | boolean | number | string[];
	type: PropertyType;
	counterUseSeparator?: boolean;
}

interface FolderRule {
	folderPath: string;
	properties: PropertyField[];
	startWithSeparator: boolean;
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
	const parts = path.split("/").filter((p) => p.length > 0);
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
		return this.app.vault
			.getAllLoadedFiles()
			.filter(
				(file): file is TFolder =>
					file instanceof TFolder &&
					file.path.toLowerCase().includes(lowerCaseInputStr),
			);
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

class FolderRuleModal extends Modal {
	rule: FolderRule;
	plugin: FolderAutoProperties;
	onSave: (rule: FolderRule) => Promise<void>;

	constructor(
		app: App,
		plugin: FolderAutoProperties,
		rule: FolderRule,
		onSave: (rule: FolderRule) => Promise<void>,
	) {
		super(app);
		this.plugin = plugin;
		this.rule = JSON.parse(JSON.stringify(rule)) as FolderRule;
		if (this.rule.startWithSeparator === undefined) {
			this.rule.startWithSeparator = false;
		}
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("folder-auto-prop-modal");

		// === HEADER ===
		const header = contentEl.createDiv("fap-modal-header");
		header.createEl("h3", { text: "Folder Rule Configuration" });
		header.createEl("p", { 
			text: "Properties are automatically applied when new notes are created in this folder.",
			cls: "fap-modal-description"
		});

		// === SECTION 1: Folder Path ===
		const folderSection = contentEl.createDiv("fap-modal-section");
		folderSection.createEl("h4", { text: "📁 Folder" });
		
		new Setting(folderSection)
			.setName("Target folder")
			.setDesc("Select the folder where this rule will apply")
			.addText((text) => {
				text.setPlaceholder("e.g., Notes/Lessons");
				text.setValue(this.rule.folderPath);
				new FolderSuggest(this.app, text.inputEl);
				text.onChange((v) => (this.rule.folderPath = v));
			});

		// === SECTION 2: Properties ===
		const propsSection = contentEl.createDiv("fap-modal-section");
		const propsHeader = propsSection.createDiv("fap-section-header");
		propsHeader.createEl("h4", { text: "📋 Properties" });
		
		const addPropBtn = propsHeader.createEl("button", {
			text: "+ Add Property",
			cls: "fap-add-property-btn"
		});

		const propsContainer = propsSection.createDiv("fap-properties-container");

		const renderProps = () => {
			propsContainer.empty();
			
			if (this.rule.properties.length === 0) {
				const emptyState = propsContainer.createDiv("fap-empty-props");
				emptyState.createEl("p", { text: "No properties defined yet. Click '+ Add Property' to start." });
				return;
			}

			this.rule.properties.forEach((prop, index) => {
				if (!prop.type) prop.type = "text";

				const propCard = propsContainer.createDiv("fap-property-card");
				
				// Property header with type badge and delete
				const propHeader = propCard.createDiv("fap-property-header");
				propHeader.createEl("span", { 
					text: `Property ${index + 1}`,
					cls: "fap-property-label"
				});
				
				// Type dropdown as a badge-style selector
				const typeDropdown = propHeader.createEl("select", {
					cls: "fap-type-select"
				});
				const types = [
					{ value: "text", label: "Text" },
					{ value: "number", label: "Number" },
					{ value: "checkbox", label: "Checkbox" },
					{ value: "date", label: "Date" },
					{ value: "datetime", label: "Date & Time" },
					{ value: "tags", label: "Tags" },
					{ value: "list", label: "List" },
					{ value: "counter", label: "Counter" },
				];
				types.forEach(t => {
					const option = typeDropdown.createEl("option", {
						value: t.value,
						text: t.label
					});
					if (t.value === prop.type) option.selected = true;
				});
				// In the typeDropdown change event handler:
typeDropdown.addEventListener("change", () => {
					const newType = typeDropdown.value as PropertyType;
					if (newType !== prop.type) {
						prop.type = newType;
						// Set default keys based on type
						if (newType === "checkbox") {
							prop.key = prop.key || "checkbox";
							prop.value = false;
						} else if (newType === "tags") {
							prop.key = prop.key || "tags";
							prop.value = "";
						} else if (newType === "counter") {
							prop.key = "";
							prop.value = "";
							prop.counterUseSeparator = true;
						} else if (newType === "date") {
							prop.key = prop.key || "date";
							prop.value = "";
						} else if (newType === "datetime") {
							prop.key = prop.key || "datetime";
							prop.value = "";
						} else if (newType === "number") {
							prop.key = prop.key || "number";
							prop.value = "";
						} else if (newType === "list") {
							prop.key = prop.key || "list";
							prop.value = "";
						} else {
							// text
							prop.key = prop.key || "";
							prop.value = "";
						}
						renderProps();
					}
});

				const deleteBtn = propHeader.createEl("button", {
					cls: "fap-delete-property-btn",
					attr: { "aria-label": "Delete property" }
				});
				deleteBtn.setText("✕");
				deleteBtn.addEventListener("click", () => {
					this.rule.properties.splice(index, 1);
					renderProps();
				});

				// Property body - different layouts based on type
				const propBody = propCard.createDiv("fap-property-body");

				if (prop.type === "counter") {
					// Counter: Prefix → Separator toggle → Key (optional)
					propBody.createEl("label", { text: "Title prefix", cls: "fap-field-label" });
					const prefixInput = propBody.createEl("input", {
						type: "text",
						placeholder: "e.g., Lesson, Aula, Chapter",
						value: String(prop.value || ""),
						cls: "fap-text-input"
					});
					prefixInput.addEventListener("input", () => {
						prop.value = prefixInput.value;
					});

					const separatorRow = propBody.createDiv("fap-separator-row");
					const separatorToggle = separatorRow.createEl("input", {
						type: "checkbox",
						attr: { id: `fap-sep-${index}` }
					});
					separatorToggle.checked = prop.counterUseSeparator ?? true;
					separatorToggle.addEventListener("change", () => {
						prop.counterUseSeparator = separatorToggle.checked;
					});
					separatorRow.createEl("label", {
						text: "Add ' - ' after the number (e.g., Lesson 1 - )",
						attr: { for: `fap-sep-${index}` },
						cls: "fap-checkbox-label"
					});

					propBody.createEl("label", { text: "Frontmatter key (optional)", cls: "fap-field-label" });
					const keyInput = propBody.createEl("input", {
						type: "text",
						placeholder: "Leave empty if only renaming the file",
						value: prop.key,
						cls: "fap-text-input"
					});
					keyInput.addEventListener("input", () => {
						prop.key = keyInput.value;
					});

				} else {
					// Standard: Key → Value
					propBody.createEl("label", { text: "Property name", cls: "fap-field-label" });
					const keyInput = propBody.createEl("input", {
						type: "text",
						placeholder: "e.g., tags, author, status",
						value: prop.key,
						cls: "fap-text-input"
					});
					keyInput.addEventListener("input", () => {
						prop.key = keyInput.value;
					});

					propBody.createEl("label", { text: "Default value", cls: "fap-field-label" });

					if (prop.type === "checkbox") {
						const checkboxRow = propBody.createDiv("fap-checkbox-row");
						const checkboxInput = checkboxRow.createEl("input", {
							type: "checkbox",
							attr: { id: `fap-cb-${index}` }
						});
						checkboxInput.checked = Boolean(prop.value);
						checkboxInput.addEventListener("change", () => {
							prop.value = checkboxInput.checked;
						});
						checkboxRow.createEl("label", {
							text: "Enabled by default",
							attr: { for: `fap-cb-${index}` },
							cls: "fap-checkbox-label"
						});
					} else if (prop.type === "date") {
						const dateInput = propBody.createEl("input", {
							type: "date",
							value: String(prop.value || ""),
							cls: "fap-text-input"
						});
						dateInput.addEventListener("input", () => {
							prop.value = dateInput.value;
						});
					} else if (prop.type === "datetime") {
						const dtInput = propBody.createEl("input", {
							type: "datetime-local",
							value: String(prop.value || ""),
							cls: "fap-text-input"
						});
						dtInput.addEventListener("input", () => {
							prop.value = dtInput.value;
						});
					} else if (prop.type === "number") {
						const numInput = propBody.createEl("input", {
							type: "number",
							placeholder: "0",
							value: String(prop.value || ""),
							cls: "fap-text-input"
						});
						numInput.addEventListener("input", () => {
							prop.value = Number(numInput.value);
						});
					} else {
						// text, tags, list
						const placeholder = prop.type === "tags" ? "tag1, tag2, tag3" :
										   prop.type === "list" ? "item1, item2, item3" :
										   "Enter value";
						const valueInput = propBody.createEl("input", {
							type: "text",
							placeholder: placeholder,
							value: String(prop.value || ""),
							cls: "fap-text-input"
						});
						valueInput.addEventListener("input", () => {
							prop.value = valueInput.value;
						});
					}
				}
			});
		};

		addPropBtn.addEventListener("click", () => {
			this.rule.properties.push({
				key: "",
				value: "",
				type: "text",
			});
			renderProps();
		});

		renderProps();

		// === SECTION 3: File Options ===
		const optionsSection = contentEl.createDiv("fap-modal-section");
		optionsSection.createEl("h4", { text: "⚙️ File Options" });
		
		const separatorRow = optionsSection.createDiv("fap-option-row");
		const separatorToggle = separatorRow.createEl("input", {
			type: "checkbox",
			attr: { id: "fap-start-separator" }
		});
		separatorToggle.checked = this.rule.startWithSeparator;
		separatorToggle.addEventListener("change", () => {
			this.rule.startWithSeparator = separatorToggle.checked;
		});
		const sepLabel = separatorRow.createEl("label", {
			text: "Start file with a separator line (---)",
			attr: { for: "fap-start-separator" },
			cls: "fap-checkbox-label"
		});
		sepLabel.createEl("br");
		sepLabel.createEl("small", { 
			text: "Adds a horizontal rule at the very top of the new file.",
			cls: "fap-option-hint"
		});

		// === FOOTER ===
		const footer = contentEl.createDiv("fap-modal-footer");
		
		const cancelBtn = footer.createEl("button", {
			text: "Cancel",
			cls: "fap-cancel-btn"
		});
		cancelBtn.addEventListener("click", () => this.close());

		const saveBtn = footer.createEl("button", {
			text: "Save Rule",
			cls: "fap-save-btn"
		});
		saveBtn.addEventListener("click", () => {
			// Validate
			if (!this.rule.folderPath.trim()) {
				// Show error
				return;
			}
			this.onSave(this.rule)
				.then(() => this.close())
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					console.error("Folder Auto Properties: Failed to save inside modal context", message);
				});
		});
	}
}

export default class FolderAutoProperties extends Plugin {
	settings!: FolderAutoPropertiesSettings;
	private processingFiles: Set<string> = new Set();
	private initialized: boolean = false;

	async onload() {
		await this.loadSettings();
			this.addSettingTab(new FolderAutoPropertiesSettingTab(this.app, this));

		// Mark as initialized after a delay to prevent processing existing files on startup
		window.setTimeout(() => {
			this.initialized = true;
		}, 1000);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) return;
				const existingRuleIndex = this.settings.rules.findIndex(
					(r) => r.folderPath === file.path,
				);
				const existingRule = this.settings.rules[existingRuleIndex];

				menu.addItem((item) => {
					item.setTitle(
						existingRule
							? "Edit folder auto properties"
							: "Add folder auto property rule",
					)
						.setIcon("settings-2")
						.setSection("action")
						.onClick(() => {
							// When creating new rule from context menu:
							const ruleToEdit = existingRule
								? existingRule
								: {
										folderPath: file.path,
										properties: [
											{
												key: "tags",
												value: "",
												type: "tags" as PropertyType,
											},
										],
										startWithSeparator: false,
									};

							new FolderRuleModal(
								this.app,
								this,
								ruleToEdit,
								async (savedRule) => {
									if (existingRuleIndex > -1) {
										this.settings.rules[existingRuleIndex] =
											savedRule;
									} else {
										this.settings.rules.push(savedRule);
									}
									await this.saveSettings();
								},
							).open();
						});
				});
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) {
					let changed = false;
					this.settings.rules.forEach((rule) => {
						if (rule.folderPath === oldPath) {
							rule.folderPath = file.path;
							changed = true;
						} else if (rule.folderPath.startsWith(oldPath + "/")) {
							rule.folderPath =
								file.path +
								rule.folderPath.substring(oldPath.length);
							changed = true;
						}
					});
					if (changed) {
						this.saveSettings().catch((err) => {
							console.error("Folder Auto Properties: Failed to save settings after rename", err);
						});
					}
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				const initialCount = this.settings.rules.length;
				this.settings.rules = this.settings.rules.filter(
					(rule) =>
						!(
							rule.folderPath === file.path ||
							rule.folderPath.startsWith(file.path + "/")
						),
				);
				if (this.settings.rules.length !== initialCount) {
					this.saveSettings().catch((err) => {
						console.error("Folder Auto Properties: Failed to save settings after delete", err);
					});
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				if (!this.initialized) {
					return;
				}
				
				if (file instanceof TFile && file.extension === "md") {
					const filePath = file.path;
					
					window.setTimeout(async () => {
						try {
							const stillExists = this.app.vault.getAbstractFileByPath(filePath);
							if (stillExists instanceof TFile) {
								await this.applyProperties(stillExists);
							}
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							console.error("Folder Auto Properties: Async create execution failure", message);
						}
					}, FILE_CREATION_DEBOUNCE_MS);
				}
			}),
		);
	}

	private parseTags(rawValue: string): string[] {
		return rawValue
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t !== "");
	}

	private mergeLists(existing: unknown, newItems: string[]): string[] {
		let existingItems: string[] = [];
		if (Array.isArray(existing)) {
			existingItems = existing.map((item: unknown) => String(item));
		} else if (typeof existing === "string") {
			existingItems = this.parseTags(existing);
		}
		return [...new Set([...existingItems, ...newItems])];
	}

	private getMaxCounterValueExcluding(
		folder: TFolder,
		prefix: string,
		excludeFile: TFile,
): number {
		const files = folder.children.filter(
			(child): child is TFile =>
				child instanceof TFile && 
				child.extension === "md" &&
				child.path !== excludeFile.path,
		);

		let maxNumber = 0;
		const trimmedPrefix = prefix.trim();
		const escapedPrefix = trimmedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		for (const file of files) {
			const filename = file.basename;
			// Match pattern like "Lesson 1", "Lesson 1 - Something", "Lesson1", etc.
			const regex = new RegExp(`^${escapedPrefix}\\s*(\\d+)`, "i");
			const match = filename.match(regex);
			if (match && match[1]) {
				const num = parseInt(match[1], 10);
				if (num > maxNumber) maxNumber = num;
			}
		}

		return maxNumber;
}

private getMaxCounterValue(
		folder: TFolder,
		prefix: string,
): number {
		const files = folder.children.filter(
			(child): child is TFile =>
				child instanceof TFile && child.extension === "md",
		);

		let maxNumber = 0;
		const trimmedPrefix = prefix.trim();
		const escapedPrefix = trimmedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		for (const file of files) {
			const filename = file.basename;
			const regex = new RegExp(`^${escapedPrefix}\\s*(\\d+)`, "i");
			const match = filename.match(regex);
			if (match && match[1]) {
				const num = parseInt(match[1], 10);
				if (num > maxNumber) maxNumber = num;
			}
		}

		return maxNumber;
}

async applyProperties(file: TFile) {
	const matchingRules = this.settings.rules.filter(
		(rule) =>
			rule.folderPath &&
			(file.path === rule.folderPath ||
				file.path.startsWith(rule.folderPath + "/")),
	);

	if (matchingRules.length === 0) return;

	matchingRules.sort((a, b) => a.folderPath.length - b.folderPath.length);

	// Check if this file already has frontmatter properties from the rules
	// If it does, it's an existing file that shouldn't be reprocessed
	let fileHasExistingProperties = false;
	let fileContent = "";
	try {
		fileContent = await this.app.vault.read(file);
		if (fileContent.trimStart().startsWith("---")) {
			// File has frontmatter - check if it already has any of our properties
			for (const rule of matchingRules) {
				for (const prop of rule.properties) {
					if (prop.type === "counter") continue;
					const key = prop.key.trim();
					if (key && (fileContent.includes(`\n${key}:`) || fileContent.includes(`\n${key} :`))) {
						fileHasExistingProperties = true;
						break;
					}
				}
				if (fileHasExistingProperties) break;
			}
		}
	} catch {
		// Can't read file, skip the check
	}

	// If file already has properties and has content (not empty), skip processing
	if (fileHasExistingProperties && fileContent.trim().length > 0 && !file.basename.startsWith("Untitled")) {
		return;
	}

	try {
		let needsSeparator = false;
		let newFileName = "";
		let shouldRename = false;

		for (const rule of matchingRules) {
			if (rule.startWithSeparator) {
				needsSeparator = true;
			}

			for (const prop of rule.properties) {
				if (prop.type === "counter") {
					let prefix = String(prop.value || "").trim();
					
					if (!prefix) continue;
					
					// Add space after prefix if not present
					if (!prefix.endsWith(" ")) {
						prefix = prefix + " ";
					}
					
					const folderPath = file.parent?.path || "";
					const folder = this.app.vault.getAbstractFileByPath(folderPath);
					if (folder instanceof TFolder) {
						const escapedPrefix = prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
						const pattern = new RegExp(`^${escapedPrefix}\\s*(\\d+)`, "i");
						const basename: string = file.basename || "";
						
						// Check if the file already has a counter pattern
						const match = basename.match(pattern);
						
						// Always get the next number based on existing files
						let nextNum: number;
						if (match && match[1]) {
							// File already has a number - get max from OTHER files and increment
							const currentNum = parseInt(match[1], 10);
							const maxOther = this.getMaxCounterValueExcluding(folder, prefix.trim(), file);
							// If current number is less than or equal to max, increment
							if (currentNum <= maxOther) {
								nextNum = maxOther + 1;
							} else {
								nextNum = currentNum; // Keep if it's already higher
							}
						} else {
							// No counter in filename - get next number
							nextNum = this.getMaxCounterValueExcluding(folder, prefix.trim(), file) + 1;
						}
						
						const useSeparator = prop.counterUseSeparator ?? true;
						const isUntitled = basename === "Untitled" || basename.startsWith("Untitled");
						
						// Get the rest of the name (without counter prefix)
						let cleanName = basename.replace(pattern, "").replace(/^\s*-\s*/, "").trim();
						
						// If file has content but basename might have been changed by another plugin
						// and the cleanName is empty after removing pattern, use the original basename
						if (cleanName.length === 0 && !isUntitled && match && match[1]) {
							// The file already has only the counter, keep it as is
							// This prevents renaming files that were already processed
							continue;
						}
						
						if (isUntitled || cleanName.length === 0) {
							// Untitled or only counter - just use counter
							if (useSeparator) {
								newFileName = `${prefix}${nextNum} - `;
							} else {
								newFileName = `${prefix}${nextNum}`;
							}
						} else {
							// Has a custom name (like from YouTube) - prepend counter
							if (useSeparator) {
								newFileName = `${prefix}${nextNum} - ${cleanName}`;
							} else {
								newFileName = `${prefix}${nextNum} ${cleanName}`;
							}
						}
						shouldRename = true;
					}
				}
			}
		}

		// Rename if needed
		if (shouldRename && newFileName && file.basename !== newFileName) {
			const ext = file.extension;
			const dirPath = file.parent?.path || "";
			const newPath = dirPath ? `${dirPath}/${newFileName}.${ext}` : `${newFileName}.${ext}`;
			try {
				await this.app.fileManager.renameFile(file, newPath);
				// Wait a bit for the rename to complete before continuing
				await new Promise(resolve => window.setTimeout(resolve, 100));
			} catch (err) {
				console.warn("Folder Auto Properties: Could not rename file to", newFileName, err);
			}
		}

		// Add separator if needed
		if (needsSeparator) {
			try {
				// Re-read the file in case it was renamed
				const currentFile = this.app.vault.getAbstractFileByPath(file.path);
				if (currentFile instanceof TFile) {
					const content = await this.app.vault.read(currentFile);
					if (!content.trimStart().startsWith("---")) {
						await this.app.vault.modify(currentFile, "---\n\n" + content);
					}
				}
			} catch {
				console.warn("Folder Auto Properties: Could not add separator");
			}
		}

		// Only add frontmatter properties if the file doesn't already have them
		if (!fileHasExistingProperties) {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: FrontMatter) => {
					for (const rule of matchingRules) {
						for (const prop of rule.properties) {
							const key = prop.key.trim();
							if (!key) continue;

							if (prop.type === "counter") {
								continue;
							}

							if (prop.type === "tags" || prop.type === "list") {
								const newItems: string[] =
									typeof prop.value === "string"
										? this.parseTags(prop.value)
										: [];
								const existingValue: unknown = frontmatter[key];
								frontmatter[key] = this.mergeLists(
									existingValue,
									newItems,
								);
							} else if (prop.type === "checkbox") {
								// For checkbox, always set the value if it doesn't exist
								if (frontmatter[key] === undefined || frontmatter[key] === null) {
									frontmatter[key] = prop.value;
								}
							} else if (!frontmatter[key] || frontmatter[key] === "") {
								frontmatter[key] = prop.value;
							}
						}
					}
				},
			);
		}
	} catch {
		console.warn(
			"Folder Auto Properties: Could not process frontmatter (file might be busy or deleted).",
		);
	}
}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		) as FolderAutoPropertiesSettings;

		this.settings.rules.forEach((rule) => {
			if (rule.startWithSeparator === undefined) {
				rule.startWithSeparator = false;
			}
			rule.properties.forEach((prop) => {
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
	collapsedPaths: Set<string> = new Set();

	constructor(app: App, plugin: FolderAutoProperties) {
		super(app, plugin);
		this.plugin = plugin;
		// Collapse all parent rules by default
		this.plugin.settings.rules.forEach((rule) => {
			const hasChildren = this.plugin.settings.rules.some(
				(r) =>
					r.folderPath !== rule.folderPath &&
					r.folderPath.startsWith(rule.folderPath + "/"),
			);
			if (hasChildren) {
				this.collapsedPaths.add(rule.folderPath);
			}
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Use Setting.setHeading() for consistent UI
		new Setting(containerEl)
			.setName("General Settings")
			.setHeading();

		containerEl.createEl("p", {
			text: "Define properties for specific folders. Rules apply to new notes only. Sub-rules are collapsed by default.",
			cls: "setting-item-description",
		});
		
	

		new Setting(containerEl)
			.setName("Add new rule")
			.setDesc("Create a new folder property rule")
			.addButton((btn) =>
				btn
					.setButtonText("Add rule")
					.setCta()
					.setClass("add-rule-btn-custom")
					.onClick(() => {
						// In the settings tab display method:
						const newRule = {
							folderPath: "",
							properties: [
								{
									key: "tags",
									value: "",
									type: "tags" as PropertyType,
								},
							],
							startWithSeparator: false,
						};
						new FolderRuleModal(
							this.app,
							this.plugin,
							newRule,
							async (savedRule) => {
								this.plugin.settings.rules.push(savedRule);
								await this.plugin.saveSettings();
								this.display();
							},
						).open();
					}),
			);

		containerEl.createEl("hr");

		if (this.plugin.settings.rules.length === 0) {
			const emptyEl = containerEl.createDiv("folder-auto-prop-empty");
			emptyEl.createEl("p", {
				text: "No rules yet. Click 'Add rule' to get started!",
			});
			return;
		}

		this.plugin.settings.rules.sort((a, b) =>
			a.folderPath.localeCompare(b.folderPath),
		);

		const subRuleCounters: Record<string, number> = {};
		let topLevelCount = 0;

		this.plugin.settings.rules.forEach((rule, ruleIndex) => {
			const parentRule = this.plugin.settings.rules.find(
				(r) =>
					r.folderPath !== rule.folderPath &&
					rule.folderPath.startsWith(r.folderPath + "/"),
			);

			if (parentRule && this.collapsedPaths.has(parentRule.folderPath))
				return;

			const depth = this.plugin.settings.rules.filter(
				(r) =>
					r.folderPath !== rule.folderPath &&
					rule.folderPath.startsWith(r.folderPath + "/"),
			).length;

			let ruleTitle = "";
			const folderLabel = getFolderDisplayName(rule.folderPath);

			if (depth === 0) {
				topLevelCount++;
				ruleTitle = `Rule ${topLevelCount}`;
			} else {
				const parentPath = parentRule?.folderPath || "root";
				subRuleCounters[parentPath] =
					(subRuleCounters[parentPath] || 0) + 1;
				ruleTitle = `Sub rule ${subRuleCounters[parentPath]}`;
			}

			if (folderLabel) ruleTitle += ` - ${folderLabel}`;

			const ruleContainer = containerEl.createDiv(
				"folder-auto-prop-rule-card",
			);
			if (depth > 0) {
				ruleContainer.addClass("folder-auto-prop-nested");
				ruleContainer.addClass(
					`folder-auto-prop-depth-${Math.min(depth, 5)}`,
				);
			}

			// Rule header with collapse toggle
			const ruleHeader = ruleContainer.createDiv(
				"folder-auto-prop-rule-header",
			);

			const hasChildren = this.plugin.settings.rules.some(
				(r) =>
					r.folderPath !== rule.folderPath &&
					r.folderPath.startsWith(rule.folderPath + "/"),
			);

			if (hasChildren) {
				const isCollapsed = this.collapsedPaths.has(rule.folderPath);
				const toggleBtn = ruleHeader.createEl("button", {
					cls: "folder-auto-prop-collapse-btn",
					attr: {
						"aria-label": isCollapsed
							? "Expand sub-rules"
							: "Collapse sub-rules",
					},
				});
				// Use setText() instead of innerHTML
				toggleBtn.setText(isCollapsed ? "▶" : "▼");
				toggleBtn.addEventListener("click", () => {
					if (isCollapsed) {
						this.collapsedPaths.delete(rule.folderPath);
					} else {
						this.collapsedPaths.add(rule.folderPath);
					}
					this.display();
				});
			}

			ruleHeader.createEl("strong", {
				text: ruleTitle,
				cls: "folder-auto-prop-rule-title",
			});

			if (rule.startWithSeparator) {
				ruleHeader.createEl("span", {
					text: "Starts with ---",
					cls: "folder-auto-prop-badge",
				});
			}

			// Property count badge
			const propCount = rule.properties.length;
			if (propCount > 0) {
				ruleHeader.createEl("span", {
					text: `${propCount} propert${propCount === 1 ? "y" : "ies"}`,
					cls: "folder-auto-prop-badge folder-auto-prop-badge-count",
				});
			}

			// Rule actions
			const ruleActions = ruleContainer.createDiv(
				"folder-auto-prop-rule-actions",
			);

			const editBtn = ruleActions.createEl("button", {
				cls: "folder-auto-prop-action-btn mod-cta",
				text: "Edit",
			});
			editBtn.addEventListener("click", () => {
				new FolderRuleModal(
					this.app,
					this.plugin,
					rule,
					async (savedRule) => {
						this.plugin.settings.rules[ruleIndex] = savedRule;
						await this.plugin.saveSettings();
						this.display();
					},
				).open();
			});

			const addSubBtn = ruleActions.createEl("button", {
				cls: "folder-auto-prop-action-btn",
				text: "+ Sub-rule",
			});
			addSubBtn.addEventListener("click", () => {
				const newRule = {
					folderPath: rule.folderPath + "/subfolder",
					properties: [
						{
							key: "tags",
							value: "",
							type: "tags" as PropertyType,
						},
					],
					startWithSeparator: false,
				};
				new FolderRuleModal(
					this.app,
					this.plugin,
					newRule,
					async (savedRule) => {
						this.plugin.settings.rules.push(savedRule);
						this.collapsedPaths.delete(rule.folderPath);
						await this.plugin.saveSettings();
						this.display();
					},
				).open();
			});

			const deleteBtn = ruleActions.createEl("button", {
				cls: "folder-auto-prop-action-btn folder-auto-prop-delete-btn",
				text: "Delete",
			});
			deleteBtn.addEventListener("click", () => {
				this.plugin.settings.rules.splice(ruleIndex, 1);
				this.plugin
					.saveSettings()
					.then(() => this.display())
					.catch((err) => {
						const message =
							err instanceof Error
								? err.message
								: String(err);
						console.error(
							"Folder Auto Properties: Setting card deletion failed",
							message,
						);
					});
			});

			// Folder path input
			new Setting(ruleContainer)
				.setClass("folder-auto-prop-path-setting")
				.addText((text) => {
					text.setPlaceholder("Folder path...");
					text.setValue(rule.folderPath);
					new FolderSuggest(this.app, text.inputEl);
					text.onChange((value) => {
						rule.folderPath = value;
						this.plugin
							.saveSettings()
							.then(() => this.display())
							.catch((err) => {
								const message =
									err instanceof Error
										? err.message
										: String(err);
								console.error(
									"Folder Auto Properties: Settings sync error",
									message,
								);
							});
					});
				});
		});
	}
}