# Unity Reference CodeLens

Display Unity references directly on your C# methods - instantly see which scenes, prefabs, buttons, and GameObjects are using each method.

## Features

- **Go to References (Shift+F12)**: Prefab and scene hits show up in the same references peek as C# callers
- **Show in Unity Editor**: Ping the prefab/scene in a running Unity Editor (Visual Studio Editor protocol)
- **CodeLens on Methods**: See reference counts; click to pick a usage and ping it in Unity
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
* `Unity: Show in Unity Editor` - Ping the current asset (or pick a script usage) in the running Editor

## Requirements

- VS Code 1.108.1 or higher
- A Unity project with `.cs`, `.unity`, and/or `.prefab` files
- For ping: Unity running, External Script Editor = Visual Studio Code, **Visual Studio Editor 2.0.22** enabled. Remove the legacy **Visual Studio Code Editor** (`com.unity.ide.vscode`) package or the UDP listener never starts.

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
- Prefab ping highlights the asset in the Project window, not a nested GameObject
- Ping needs the Visual Studio Editor package listener; the legacy vscode package blocks it

## Release Notes

### 1.5.0 (this fork)

- Ping/Pong handshake and `Assets/` paths for ShowUsage
- Method references match by script GUID only (no more false `Initialize` hits)
- Requires removing legacy `com.unity.ide.vscode`

### 1.4.0 (this fork)

- Ping prefab/scene in the Unity Editor via Visual Studio Editor ShowUsage
- CodeLens pick list pings Unity; explorer context menu: Show in Unity Editor
- Requires External Script Editor = Visual Studio / VS Code / Cursor and a running Editor

### 1.3.0 (this fork)

- Go to References (Shift+F12) includes Unity prefab and scene usages, merged with C# callers
- CodeLens clicks open the same peek view instead of a QuickPick

### 1.2.0

- Prefab variant support, including inherited scripts from the source prefab
- Scene / prefab / variant counts and icons in CodeLens

### 1.1.1

- Deduped duplicate script references on the same GameObject

### 1.1.0

- CodeLens on class declarations for scene/prefab script usage

### 1.0.0

- Initial release: CodeLens for methods in scenes and prefabs, hierarchy path, file watching

## Install this fork

```powershell
cd D:\Projects\unity-reference-code-lens
npm install
npm run compile
npx --yes @vscode/vsce package
```

In Cursor: Command Palette → **Extensions: Install from VSIX...** → pick the `.vsix` in this folder.

Uninstall the marketplace copy first if both would run at once.

## Credits

Original extension by **QuangCan** ([CQuangX](https://github.com/CQuangX)), published on the VS Marketplace as **AkiraGameDev**.

Upstream: [CQuangX/unity-reference-code-lens](https://github.com/CQuangX/unity-reference-code-lens)
