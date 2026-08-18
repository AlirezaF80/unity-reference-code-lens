# Changelog

All notable changes to the "Unity Reference CodeLens" extension will be documented in this file.

## [1.5.0] - 2026-08-18

### Added
- Ping handshake with Unity (Ping/Pong) before ShowUsage, with a clear error if the Visual Studio Editor UDP listener is down

### Fixed
- Method CodeLens no longer matches UnityEvents by method name alone (e.g. `Initialize` on the wrong script)
- ShowUsage uses `Assets/...` paths so Unity can resolve the prefab
- Detects all running Unity.exe processes when choosing a messaging port

### Note
Remove the legacy `com.unity.ide.vscode` package. Keep `com.unity.ide.visualstudio` 2.0.22. That old package can steal editor registration at startup so the UDP listener never binds.

## [1.4.0] - 2026-08-18

### Added
- **Show in Unity Editor**: pings the prefab/scene in a running Unity Editor via `com.unity.ide.visualstudio` ShowUsage
- CodeLens / QuickPick selection pings Unity instead of opening YAML
- Explorer context menu: Show in Unity Editor

### Note
Unity must be running this project, and External Script Editor must be Visual Studio, VS Code, or Cursor so the Visual Studio Editor package listener is enabled.

## [1.3.0] - 2026-08-18

### Added
- **Go to References (Shift+F12)**: Unity prefab and scene usages are included in the native references peek, merged with C# callers
- CodeLens clicks open the same peek view instead of a QuickPick

## [1.2.0] - 2026-02-03

### Added
- **Prefab Variant Support**: Extension now detects and displays references from Prefab Variants
- Inherited scripts from source prefabs are automatically resolved for variants
- New icon indicators: `$(file)` for scenes, `$(package)` for prefabs, `$(git-branch)` for variants
- Separate count display for scenes, prefabs, and variants in CodeLens

### Improved
- Enhanced prefab type detection using Unity's PrefabInstance structure
- Better GUID mapping for prefab files to resolve variant inheritance chains

## [1.1.1] - 2026-01-29

### Fixed
- Fixed duplicate references showing for the same script on the same GameObject
- Improved deduplication logic for script component references

## [1.1.0] - 2026-01-28

### Added
- **Class References**: CodeLens now shows on class declarations indicating which scenes/prefabs use this script
- New command: Show Script References - displays all GameObjects using the script
- Hierarchy path display for script component references

### Improved
- Better parsing of Unity MonoBehaviour components
- Enhanced reference indexing performance

## [1.0.0] - 2026-01-28

### Added
- Initial release
- CodeLens display for C# methods referenced in Unity files
- Support for `.unity` (scene) and `.prefab` files
- Detection of Button, Toggle, InputField, Dropdown, EventTrigger, and Animation events
- Hierarchy path display showing full path to referenced GameObject
- Real-time file watching for automatic index updates
- Quick navigation to reference location in Unity files
- Commands: Rebuild Index, Show Status
- Configurable settings for display preferences