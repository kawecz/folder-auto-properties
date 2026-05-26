# Folder Auto Properties for Obsidian

Automatically apply specific properties (frontmatter) to new notes based on the folder they are created in. 

Keep your vault organized without the friction of manually typing out tags, checkboxes, and metadata every time you create a new file.

## ✨ Features

* **Zero-Friction Metadata:** Create a rule for a folder, and any new `.md` file created inside it will instantly receive your predefined properties.
* **Dynamic Property Types:** Supports Obsidian's native property types: `Text`, `Number`, `Checkbox`, `Date`, `Datetime`, `Tags`, and `List`. The settings UI adapts automatically (e.g., giving you toggles for checkboxes).
* **Smart Folder Tracking:** If you rename or move a folder in your vault, your rules update automatically. If you delete a folder, the rule cleans itself up.
* **Nested Sub-rules:** Create specific rules for sub-folders. The settings UI visualizes your folder tree and lets you collapse/expand parent folders to keep things tidy.
* **Merge Logic for Lists & Tags:** If a note already has tags (e.g., from a template), the plugin intelligently merges your folder tags without overwriting existing ones.

## 🛠️ How to Use

There are two ways to create a rule:

**Method 1: Context Menu (Quickest)**
1. Right-click any folder in your Obsidian File Explorer.
2. Select **Add folder auto property rule**.
3. Add your keys, choose their types, set the values, and hit save.

**Method 2: Settings Tab**
1. Go to `Settings` -> `Folder Auto Properties`.
2. Click **Add rule**.
3. Use the autocomplete search box to find your target folder.
4. Define your properties.
5. Use the **+** icon on any existing rule to quickly create a nested sub-rule.

## ⚙️ Requirements
* Obsidian v1.1.1 or higher.

## 📦 Installation

**Manual Installation:**
1. Download the `main.js`, `manifest.json`, and `style.css` files from the latest [GitHub Release].
2. Create a folder named `folder-auto-properties` inside your vault's `.obsidian/plugins/` directory.
3. Place the downloaded files into that folder.
4. Reload Obsidian and enable the plugin in Community Plugins.