# Unity Reference CodeLens

Display Unity references directly on your C# methods - instantly see which scenes, prefabs, buttons, and GameObjects are using each method.

## Features

- **CodeLens on Methods**: See reference counts directly above your C# methods
- **Detailed Information**: Click to view file name, GameObject name, and hierarchy path
- **Auto-Detection**: Automatically scans `.unity` (scene) and `.prefab` files
- **Real-time Updates**: File watcher updates references when Unity files change
- **Quick Navigation**: Click on a reference to open the Unity file at the exact line

![Demo](images/demo.png)

## How It Works

1. Open a Unity project in VS Code
2. Open any C# script file
3. Methods referenced in Unity files will show a CodeLens above them
4. Click on the CodeLens to see detailed reference information

## Extension Settings

This extension contributes the following settings:

* `unityReferenceLens.enabled`: Enable/disable Unity Reference CodeLens (default: `true`)
* `unityReferenceLens.showDetailedInfo`: Show detailed file names instead of just reference count (default: `true`)
* `unityReferenceLens.maxInlineReferences`: Maximum number of file names to show inline before collapsing (default: `3`)
* `unityReferenceLens.excludeFolders`: Folders to exclude from scanning (default: `["Library", "Temp", "Logs", "obj"]`)

## Commands

* `Unity: Rebuild Reference Index` - Manually rebuild the reference index
* `Unity: Show Index Status` - Show current index status and reference count

## Requirements

- VS Code 1.108.1 or higher
- A Unity project with `.cs`, `.unity`, and/or `.prefab` files

## Supported Reference Types

- **Button.onClick** - Button click events
- **Toggle.onValueChanged** - Toggle events
- **InputField.onEndEdit** - Input field events
- **Dropdown.onValueChanged** - Dropdown events
- **EventTrigger** - Event trigger callbacks
- **Animation Events** - Animation event callbacks

## Known Issues

- Large projects may take a few seconds to index on first load
- Hierarchy path may not be complete for deeply nested GameObjects

## Release Notes

### 1.0.0

Initial release:
- CodeLens for C# methods referenced in Unity files
- Support for scenes (.unity) and prefabs (.prefab)
- Hierarchy path display
- Real-time file watching

---

**Enjoy!**

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
