/**
 * Unity File Parser
 * Parses .unity (scene) and .prefab files to extract method references
 */

import * as fs from 'fs';
import * as path from 'path';
import { MethodReference, ScriptReference } from './types';

/** Represents a parsed Unity object */
interface UnityObject {
    fileId: string;
    classId: string;
    name?: string;
    gameObjectId?: string;  // For components, the GO they belong to
    transformFatherId?: string;  // For transforms, the parent transform fileId
}

/** GameObject with its hierarchy info */
interface GameObjectInfo {
    fileId: string;
    name: string;
    transformId?: string;
    parentGameObjectId?: string;
}

/**
 * Parse a Unity file (.unity or .prefab) and extract all method references
 * @param filePath Path to the Unity file
 * @returns Array of method references found in the file
 */
export function parseUnityFile(filePath: string): MethodReference[] {
    const references: MethodReference[] = [];
    
    if (!fs.existsSync(filePath)) {
        return references;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    const fileType: 'scene' | 'prefab' = filePath.endsWith('.unity') ? 'scene' : 'prefab';

    // First pass: Build a map of all objects (GameObjects and their relationships)
    const objectMap = buildObjectMap(lines);
    
    // Second pass: Find all method references
    let currentObjectFileId: string | undefined;
    let currentScriptGuid: string | undefined;
    let currentComponentType: string | undefined;

    const methodNameRegex = /m_MethodName:\s*(\S+)/;
    const functionNameRegex = /functionName:\s*(\S+)/;
    const objectHeaderRegex = /^--- !u!(\d+)\s*&(\d+)/;
    const scriptGuidRegex = /m_Script:\s*\{fileID:\s*\d+,\s*guid:\s*([a-f0-9]+)/;
    const gameObjectRefRegex = /m_GameObject:\s*\{fileID:\s*(\d+)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Track current object
        const headerMatch = line.match(objectHeaderRegex);
        if (headerMatch) {
            currentObjectFileId = headerMatch[2];
            currentScriptGuid = undefined;
            currentComponentType = undefined;
            
            // Look for script GUID and component info in the next few lines
            for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
                const nextLine = lines[j];
                if (nextLine.startsWith('---')) break;
                
                const guidMatch = nextLine.match(scriptGuidRegex);
                if (guidMatch) {
                    currentScriptGuid = guidMatch[1];
                }
                
                // Try to detect component type from known patterns
                if (nextLine.includes('m_OnClick:')) currentComponentType = 'Button';
                else if (nextLine.includes('m_OnValueChanged:')) currentComponentType = 'Toggle/Slider';
                else if (nextLine.includes('m_OnEndEdit:')) currentComponentType = 'InputField';
                else if (nextLine.includes('m_onValueChanged:')) currentComponentType = 'Dropdown';
                else if (nextLine.includes('m_Delegates:')) currentComponentType = 'EventTrigger';
            }
        }

        // Find m_MethodName (UnityEvent callbacks)
        const methodMatch = line.match(methodNameRegex);
        if (methodMatch && methodMatch[1]) {
            const methodName = methodMatch[1];
            
            if (methodName && methodName !== '' && !methodName.startsWith('Internal')) {
                // Find the GameObject this component belongs to
                const gameObjectInfo = findGameObjectForComponent(lines, i, objectMap);
                const hierarchyPath = gameObjectInfo ? buildHierarchyPath(gameObjectInfo.fileId, objectMap) : undefined;
                
                references.push({
                    methodName,
                    scriptGuid: findTargetScriptGuid(lines, i) || currentScriptGuid || '',
                    filePath,
                    fileName,
                    fileType,
                    gameObjectName: gameObjectInfo?.name,
                    hierarchyPath,
                    componentName: currentComponentType || detectComponentType(lines, i),
                    referenceType: 'UnityEvent',
                    lineNumber: i + 1
                });
            }
        }

        // Find functionName (Animation Events)
        const funcMatch = line.match(functionNameRegex);
        if (funcMatch && funcMatch[1]) {
            const methodName = funcMatch[1];
            
            if (methodName && methodName !== '') {
                const gameObjectInfo = findGameObjectForComponent(lines, i, objectMap);
                const hierarchyPath = gameObjectInfo ? buildHierarchyPath(gameObjectInfo.fileId, objectMap) : undefined;
                
                references.push({
                    methodName,
                    scriptGuid: currentScriptGuid || '',
                    filePath,
                    fileName,
                    fileType,
                    gameObjectName: gameObjectInfo?.name,
                    hierarchyPath,
                    componentName: 'Animation',
                    referenceType: 'AnimationEvent',
                    lineNumber: i + 1
                });
            }
        }
    }

    return references;
}

/**
 * Build a map of all objects in the Unity file
 * Tracks GameObjects, Transforms, and their parent-child relationships
 */
function buildObjectMap(lines: string[]): Map<string, UnityObject> {
    const objectMap = new Map<string, UnityObject>();
    const objectHeaderRegex = /^--- !u!(\d+)\s*&(\d+)/;
    const nameRegex = /m_Name:\s*(.+)/;
    const fatherRegex = /m_Father:\s*\{fileID:\s*(\d+)/;
    const gameObjectRefRegex = /m_GameObject:\s*\{fileID:\s*(\d+)/;

    let currentObject: UnityObject | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        const headerMatch = line.match(objectHeaderRegex);
        if (headerMatch) {
            // Save previous object
            if (currentObject) {
                objectMap.set(currentObject.fileId, currentObject);
            }
            
            currentObject = {
                fileId: headerMatch[2],
                classId: headerMatch[1]
            };
            continue;
        }

        if (currentObject && !line.startsWith('---')) {
            // Parse object properties
            const nameMatch = line.match(nameRegex);
            if (nameMatch && !currentObject.name) {
                currentObject.name = nameMatch[1].trim();
            }

            // For Transform/RectTransform, track parent transform
            const fatherMatch = line.match(fatherRegex);
            if (fatherMatch && fatherMatch[1] !== '0') {
                currentObject.transformFatherId = fatherMatch[1];
            }

            // For components, track which GameObject they belong to
            const goRefMatch = line.match(gameObjectRefRegex);
            if (goRefMatch) {
                currentObject.gameObjectId = goRefMatch[1];
            }
        }
    }

    // Save last object
    if (currentObject) {
        objectMap.set(currentObject.fileId, currentObject);
    }

    return objectMap;
}

/**
 * Find the GameObject that a component belongs to
 */
function findGameObjectForComponent(lines: string[], lineIndex: number, objectMap: Map<string, UnityObject>): GameObjectInfo | undefined {
    const objectHeaderRegex = /^--- !u!(\d+)\s*&(\d+)/;
    const gameObjectRefRegex = /m_GameObject:\s*\{fileID:\s*(\d+)/;

    // Find the object header for this line (search backwards)
    let componentFileId: string | undefined;
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 100); i--) {
        const headerMatch = lines[i].match(objectHeaderRegex);
        if (headerMatch) {
            componentFileId = headerMatch[2];
            break;
        }
    }

    if (!componentFileId) return undefined;

    // Get the component object
    const component = objectMap.get(componentFileId);
    
    // If component has a gameObjectId reference, use that
    if (component?.gameObjectId) {
        const gameObject = objectMap.get(component.gameObjectId);
        if (gameObject) {
            return {
                fileId: gameObject.fileId,
                name: gameObject.name || 'Unknown'
            };
        }
    }

    // Fallback: search around the line for m_GameObject reference
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 50); i--) {
        if (lines[i].startsWith('--- !u!1 ')) {
            // Found a GameObject header, get its name
            for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                if (lines[j].startsWith('---')) break;
                const nameMatch = lines[j].match(/m_Name:\s*(.+)/);
                if (nameMatch) {
                    return {
                        fileId: lines[i].match(/&(\d+)/)?.[1] || '',
                        name: nameMatch[1].trim()
                    };
                }
            }
        }
    }

    return undefined;
}

/**
 * Build hierarchy path from a GameObject up to the root
 */
function buildHierarchyPath(gameObjectFileId: string, objectMap: Map<string, UnityObject>): string {
    const pathParts: string[] = [];
    let currentGoId: string | undefined = gameObjectFileId;
    let depth = 0;
    const maxDepth = 50;

    // Build a map of Transform -> GameObject and Transform -> Parent Transform
    const transformToGo = new Map<string, string>(); // transformId -> gameObjectId
    const transformParent = new Map<string, string>(); // transformId -> parentTransformId
    const goToTransform = new Map<string, string>(); // gameObjectId -> transformId

    for (const [id, obj] of objectMap) {
        // Transform (4) or RectTransform (224)
        if (obj.classId === '4' || obj.classId === '224') {
            if (obj.gameObjectId) {
                transformToGo.set(id, obj.gameObjectId);
                goToTransform.set(obj.gameObjectId, id);
            }
            if (obj.transformFatherId) {
                transformParent.set(id, obj.transformFatherId);
            }
        }
    }

    while (currentGoId && depth < maxDepth) {
        const gameObject = objectMap.get(currentGoId);
        if (!gameObject || gameObject.classId !== '1') break;

        if (gameObject.name) {
            pathParts.unshift(gameObject.name);
        }

        // Find the Transform for this GameObject
        const transformId = goToTransform.get(currentGoId);
        if (!transformId) break;

        // Find the parent Transform
        const parentTransformId = transformParent.get(transformId);
        if (!parentTransformId) break;

        // Find the parent GameObject
        const parentGoId = transformToGo.get(parentTransformId);
        if (!parentGoId) break;

        currentGoId = parentGoId;
        depth++;
    }

    return pathParts.join('/');
}

/**
 * Detect component type from context
 */
function detectComponentType(lines: string[], lineIndex: number): string | undefined {
    // Look backwards for component type indicators
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 30); i--) {
        const line = lines[i];
        if (line.startsWith('---')) break;
        
        if (line.includes('m_OnClick:')) return 'Button';
        if (line.includes('m_OnValueChanged:')) return 'Toggle/Slider';
        if (line.includes('m_OnEndEdit:')) return 'InputField';
        if (line.includes('m_onValueChanged:')) return 'Dropdown';
        if (line.includes('m_Delegates:')) return 'EventTrigger';
        if (line.includes('m_OnSubmit:')) return 'InputField';
        if (line.includes('m_OnSelect:')) return 'Selectable';
    }
    
    return 'UnityEvent';
}

/**
 * Find the script GUID of the target object for a UnityEvent call
 */
function findTargetScriptGuid(lines: string[], currentLine: number): string | undefined {
    const targetRegex = /m_Target:\s*\{fileID:\s*(\d+)/;
    const scriptGuidRegex = /m_Script:\s*\{fileID:\s*\d+,\s*guid:\s*([a-f0-9]+)/;

    for (let i = currentLine - 1; i >= Math.max(0, currentLine - 10); i--) {
        const line = lines[i];

        const targetMatch = line.match(targetRegex);
        if (targetMatch) {
            const targetFileId = targetMatch[1];
            
            const fileIdPattern = new RegExp(`^--- !u!114\\s*&${targetFileId}`);
            for (let j = 0; j < lines.length; j++) {
                if (fileIdPattern.test(lines[j])) {
                    for (let k = j + 1; k < Math.min(j + 10, lines.length); k++) {
                        const guidMatch = lines[k].match(scriptGuidRegex);
                        if (guidMatch) {
                            return guidMatch[1];
                        }
                        if (lines[k].startsWith('---')) break;
                    }
                }
            }
            break;
        }
    }

    return undefined;
}

/**
 * Extract GUID from a .meta file
 */
export function extractGuidFromMeta(metaFilePath: string): string | null {
    if (!fs.existsSync(metaFilePath)) {
        return null;
    }

    const content = fs.readFileSync(metaFilePath, 'utf8');
    const guidRegex = /guid:\s*([a-f0-9]+)/;
    const match = content.match(guidRegex);

    return match ? match[1] : null;
}

/**
 * Find all script references in a Unity file
 */
export function hasScriptReference(filePath: string, scriptGuid: string): boolean {
    if (!fs.existsSync(filePath)) {
        return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(scriptGuid);
}

/**
 * Parse a Unity file and extract all script component references (MonoBehaviour)
 * @param filePath Path to the Unity file
 * @returns Array of script references found in the file
 */
export function parseUnityFileForScripts(filePath: string): ScriptReference[] {
    const references: ScriptReference[] = [];
    
    if (!fs.existsSync(filePath)) {
        return references;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    const fileType: 'scene' | 'prefab' = filePath.endsWith('.unity') ? 'scene' : 'prefab';

    // Build object map for hierarchy
    const objectMap = buildObjectMap(lines);

    // Find all MonoBehaviour components (classId 114)
    const objectHeaderRegex = /^--- !u!114\s*&(\d+)/;
    const scriptGuidRegex = /m_Script:\s*\{fileID:\s*\d+,\s*guid:\s*([a-f0-9]+)/;
    const gameObjectRefRegex = /m_GameObject:\s*\{fileID:\s*(\d+)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for MonoBehaviour header (classId 114)
        const headerMatch = line.match(objectHeaderRegex);
        if (headerMatch) {
            let scriptGuid: string | undefined;
            let gameObjectFileId: string | undefined;

            // Look for script GUID and GameObject reference in the next few lines
            for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                const nextLine = lines[j];
                if (nextLine.startsWith('---')) break;

                const guidMatch = nextLine.match(scriptGuidRegex);
                if (guidMatch) {
                    scriptGuid = guidMatch[1];
                }

                const goRefMatch = nextLine.match(gameObjectRefRegex);
                if (goRefMatch) {
                    gameObjectFileId = goRefMatch[1];
                }
            }

            // If we found a valid script GUID, add the reference
            if (scriptGuid && scriptGuid !== '0') {
                const gameObjectInfo = gameObjectFileId ? objectMap.get(gameObjectFileId) : undefined;
                const hierarchyPath = gameObjectFileId ? buildHierarchyPath(gameObjectFileId, objectMap) : undefined;

                references.push({
                    scriptGuid,
                    filePath,
                    fileName,
                    fileType,
                    gameObjectName: gameObjectInfo?.name,
                    hierarchyPath,
                    lineNumber: i + 1
                });
            }
        }
    }

    return references;
}
