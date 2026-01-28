/**
 * Types and interfaces for Unity Reference CodeLens
 */

/** Represents a reference to a C# method found in Unity files */
export interface MethodReference {
    /** The method name being referenced */
    methodName: string;
    /** GUID of the script containing the method */
    scriptGuid: string;
    /** Path to the Unity file (.unity, .prefab) */
    filePath: string;
    /** Name of the file without path */
    fileName: string;
    /** Type of Unity file */
    fileType: 'scene' | 'prefab';
    /** Name of the GameObject containing the reference */
    gameObjectName?: string;
    /** Hierarchy path to the GameObject (e.g., "Canvas/Panel/Button") */
    hierarchyPath?: string;
    /** Name of the component containing the event (e.g., "Button", "EventTrigger") */
    componentName?: string;
    /** Type of reference (button click, animation event, etc.) */
    referenceType: 'UnityEvent' | 'AnimationEvent' | 'CustomEvent';
    /** Line number in the Unity file where reference was found */
    lineNumber?: number;
}

/** Represents a reference to a C# script (class) attached to a GameObject */
export interface ScriptReference {
    /** GUID of the script */
    scriptGuid: string;
    /** Path to the Unity file (.unity, .prefab) */
    filePath: string;
    /** Name of the file without path */
    fileName: string;
    /** Type of Unity file */
    fileType: 'scene' | 'prefab';
    /** Name of the GameObject the script is attached to */
    gameObjectName?: string;
    /** Hierarchy path to the GameObject */
    hierarchyPath?: string;
    /** Line number in the Unity file where the script component was found */
    lineNumber?: number;
}

/** Represents a parsed C# method in a file */
export interface CSharpMethod {
    /** Method name */
    name: string;
    /** Line number where the method is declared (0-based) */
    line: number;
    /** Start character position */
    startChar: number;
    /** End character position */
    endChar: number;
    /** Full method signature */
    signature: string;
    /** Access modifier */
    accessModifier: 'public' | 'private' | 'protected' | 'internal' | '';
}

/** Represents a parsed C# class declaration */
export interface CSharpClass {
    /** Class name */
    name: string;
    /** Line number where the class is declared (0-based) */
    line: number;
    /** Start character position */
    startChar: number;
    /** End character position */
    endChar: number;
    /** Access modifier */
    accessModifier: 'public' | 'private' | 'protected' | 'internal' | '';
    /** Base class or interfaces */
    baseTypes?: string[];
}

/** Cache entry for a Unity file's references */
export interface UnityFileCache {
    /** File path */
    filePath: string;
    /** Last modified time */
    lastModified: number;
    /** All method references found in this file */
    references: MethodReference[];
}

/** Index mapping scriptGuid+methodName to references */
export type ReferenceIndex = Map<string, MethodReference[]>;

/** Configuration options */
export interface ExtensionConfig {
    /** Enable/disable CodeLens */
    enabled: boolean;
    /** Show reference count only or detailed info */
    showDetailedInfo: boolean;
    /** Maximum number of references to show inline */
    maxInlineReferences: number;
    /** Folders to exclude from scanning */
    excludeFolders: string[];
}
