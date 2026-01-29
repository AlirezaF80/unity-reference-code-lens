# Changelog

All notable changes to the "Unity Reference CodeLens" extension will be documented in this file.

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